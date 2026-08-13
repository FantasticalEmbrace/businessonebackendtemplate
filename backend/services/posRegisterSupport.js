'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

const ONLINE_WINDOW_SEC = Math.max(30, Number(process.env.POS_SUPPORT_ONLINE_SECONDS) || 120);
const SESSION_TTL_MIN = Math.max(10, Number(process.env.POS_SUPPORT_SESSION_MINUTES) || 45);
const SUPPORTED_PLATFORMS = new Set(['windows', 'android']);

function isSupportedPlatform(platform) {
    return SUPPORTED_PLATFORMS.has(String(platform || '').toLowerCase());
}

function generateSessionCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function parseJsonArray(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function mapSessionRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        posDeviceId: row.pos_device_id,
        sessionCode: row.session_code,
        status: row.status,
        adminUserId: row.admin_user_id,
        consentAt: row.consent_at,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        expiresAt: row.expires_at,
        signalVersion: Number(row.signal_version) || 0,
        hasOffer: Boolean(row.offer_sdp),
        hasAnswer: Boolean(row.answer_sdp),
        createdAt: row.created_at
    };
}

async function updateDeviceSupportMeta(pool, deviceRecordId, meta) {
    if (!deviceRecordId) return;
    const platform = String(meta.platform || '').toLowerCase();
    if (platform && !isSupportedPlatform(platform)) return;

    const fields = [];
    const values = [];
    if (platform) {
        fields.push('platform = ?');
        values.push(platform.slice(0, 16));
    }
    if (meta.appVersion != null) {
        fields.push('app_version = ?');
        values.push(String(meta.appVersion).slice(0, 32) || null);
    }
    if (meta.rustdeskId != null) {
        fields.push('support_rustdesk_id = ?');
        values.push(String(meta.rustdeskId).slice(0, 32) || null);
    }
    if (!fields.length) return;
    values.push(deviceRecordId);
    await pool.execute(
        `UPDATE pos_devices SET ${fields.join(', ')}, last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
    );
}

async function listRegistersForSupport(pool) {
    const [rows] = await pool.execute(
        `SELECT d.id, d.device_label, d.key_prefix, d.is_active, d.last_seen_at, d.platform,
                d.app_version, d.support_rustdesk_id,
                s.id AS session_id, s.session_code, s.status AS session_status, s.expires_at AS session_expires
         FROM pos_devices d
         LEFT JOIN pos_register_support_sessions s
           ON s.pos_device_id = d.id
          AND s.status IN ('pending', 'awaiting_consent', 'connecting', 'active')
          AND s.expires_at > CURRENT_TIMESTAMP
         WHERE d.is_active = 1
         ORDER BY d.device_label ASC`
    );

    const seen = new Set();
    const registers = [];
    for (const row of rows || []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const lastSeen = row.last_seen_at ? new Date(row.last_seen_at) : null;
        const online = lastSeen && Date.now() - lastSeen.getTime() <= ONLINE_WINDOW_SEC * 1000;
        const platform = String(row.platform || '').toLowerCase();
        registers.push({
            id: row.id,
            deviceLabel: row.device_label,
            keyPrefix: row.key_prefix,
            platform: platform || 'unknown',
            appVersion: row.app_version || '',
            rustdeskId: row.support_rustdesk_id || '',
            online,
            lastSeenAt: row.last_seen_at,
            screenShareSupported: isSupportedPlatform(platform),
            activeSession: row.session_id
                ? {
                      id: row.session_id,
                      code: row.session_code,
                      status: row.session_status,
                      expiresAt: row.session_expires
                  }
                : null
        });
    }
    return registers;
}

async function getSessionById(pool, sessionId) {
    const [rows] = await pool.execute(
        `SELECT * FROM pos_register_support_sessions WHERE id = ? LIMIT 1`,
        [Number(sessionId)]
    );
    return rows[0] || null;
}

async function getActiveSessionForDevice(pool, deviceRecordId) {
    const [rows] = await pool.execute(
        `SELECT * FROM pos_register_support_sessions
         WHERE pos_device_id = ?
           AND status IN ('pending', 'awaiting_consent', 'connecting', 'active')
           AND expires_at > CURRENT_TIMESTAMP
         ORDER BY id DESC LIMIT 1`,
        [deviceRecordId]
    );
    return rows[0] || null;
}

async function expireStaleSessions(pool) {
    await pool.execute(
        `UPDATE pos_register_support_sessions SET status = 'expired', ended_at = CURRENT_TIMESTAMP
         WHERE status IN ('pending', 'awaiting_consent', 'connecting', 'active')
           AND expires_at <= CURRENT_TIMESTAMP`
    );
}

async function requestSupportSession(pool, deviceRecordId, { platform, diagnostics } = {}) {
    if (!deviceRecordId) {
        const err = new Error('Register is not enrolled in admin. Create a register key first.');
        err.code = 'DEVICE_NOT_REGISTERED';
        throw err;
    }
    if (!isSupportedPlatform(platform)) {
        const err = new Error('Remote support is only available on Windows and Android registers.');
        err.code = 'PLATFORM_UNSUPPORTED';
        throw err;
    }

    await expireStaleSessions(pool);
    const existing = await getActiveSessionForDevice(pool, deviceRecordId);
    if (existing) {
        return mapSessionRow(existing);
    }

    const expires = new Date(Date.now() + SESSION_TTL_MIN * 60 * 1000);
    const code = generateSessionCode();
    const [result] = await pool.execute(
        `INSERT INTO pos_register_support_sessions
         (pos_device_id, session_code, status, diagnostics_json, expires_at)
         VALUES (?, ?, 'pending', ?, ?)`,
        [
            deviceRecordId,
            code,
            diagnostics ? JSON.stringify(diagnostics).slice(0, 16000) : null,
            expires
        ]
    );
    const [rows] = await pool.execute(
        `SELECT * FROM pos_register_support_sessions WHERE id = ? LIMIT 1`,
        [result.insertId]
    );
    return mapSessionRow(rows[0]);
}

async function adminJoinSession(pool, sessionId, adminUserId) {
    await expireStaleSessions(pool);
    const row = await getSessionById(pool, sessionId);
    if (!row || !['pending', 'awaiting_consent'].includes(row.status)) {
        const err = new Error('Support session is not available');
        err.code = 'SESSION_UNAVAILABLE';
        throw err;
    }
    if (new Date(row.expires_at) <= new Date()) {
        const err = new Error('Support session expired');
        err.code = 'SESSION_EXPIRED';
        throw err;
    }

    await pool.execute(
        `UPDATE pos_register_support_sessions SET
            status = 'awaiting_consent',
            admin_user_id = ?,
            signal_version = signal_version + 1,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [adminUserId, sessionId]
    );
    const updated = await getSessionById(pool, sessionId);
    return mapSessionRow(updated);
}

async function platformJoinSession(pool, sessionId, { claimedBy } = {}) {
    await expireStaleSessions(pool);
    const row = await getSessionById(pool, sessionId);
    if (!row || !['pending', 'awaiting_consent'].includes(row.status)) {
        const err = new Error('Support session is not available');
        err.code = 'SESSION_UNAVAILABLE';
        throw err;
    }
    if (new Date(row.expires_at) <= new Date()) {
        const err = new Error('Support session expired');
        err.code = 'SESSION_EXPIRED';
        throw err;
    }

    let diagnostics = null;
    try {
        diagnostics = row.diagnostics_json ? JSON.parse(row.diagnostics_json) : {};
    } catch {
        diagnostics = {};
    }
    diagnostics.platformClaimedBy = claimedBy || 'Platform support';

    await pool.execute(
        `UPDATE pos_register_support_sessions SET
            status = 'awaiting_consent',
            admin_user_id = NULL,
            diagnostics_json = ?,
            signal_version = signal_version + 1,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [JSON.stringify(diagnostics).slice(0, 16000), sessionId]
    );
    const updated = await getSessionById(pool, sessionId);
    return mapSessionRow(updated);
}

async function setSessionConsent(pool, sessionId, deviceRecordId, allowed) {
    const row = await getSessionById(pool, sessionId);
    if (!row || Number(row.pos_device_id) !== Number(deviceRecordId)) {
        const err = new Error('Session not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (row.status !== 'awaiting_consent') {
        const err = new Error('Session is not waiting for consent');
        err.code = 'INVALID_STATE';
        throw err;
    }

    if (!allowed) {
        await pool.execute(
            `UPDATE pos_register_support_sessions SET status = 'denied', ended_at = CURRENT_TIMESTAMP, signal_version = signal_version + 1 WHERE id = ?`,
            [sessionId]
        );
        return mapSessionRow(await getSessionById(pool, sessionId));
    }

    await pool.execute(
        `UPDATE pos_register_support_sessions SET
            status = 'connecting',
            consent_at = CURRENT_TIMESTAMP,
            signal_version = signal_version + 1,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [sessionId]
    );
    return mapSessionRow(await getSessionById(pool, sessionId));
}

async function bumpSignalVersion(pool, sessionId) {
    await pool.execute(
        `UPDATE pos_register_support_sessions SET signal_version = signal_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [sessionId]
    );
}

async function setOfferSdp(pool, sessionId, deviceRecordId, sdp) {
    const row = await getSessionById(pool, sessionId);
    if (!row || Number(row.pos_device_id) !== Number(deviceRecordId)) {
        const err = new Error('Session not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    await pool.execute(
        `UPDATE pos_register_support_sessions SET offer_sdp = ?, status = 'connecting', signal_version = signal_version + 1 WHERE id = ?`,
        [String(sdp || '').slice(0, 500000), sessionId]
    );
    return mapSessionRow(await getSessionById(pool, sessionId));
}

async function setAnswerSdp(pool, sessionId, adminUserId, sdp) {
    const row = await getSessionById(pool, sessionId);
    if (!row) {
        const err = new Error('Session not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (row.admin_user_id != null && Number(row.admin_user_id) !== Number(adminUserId)) {
        const err = new Error('Not authorized for this session');
        err.code = 'FORBIDDEN';
        throw err;
    }
    await pool.execute(
        `UPDATE pos_register_support_sessions SET answer_sdp = ?, status = 'active', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), signal_version = signal_version + 1 WHERE id = ?`,
        [String(sdp || '').slice(0, 500000), sessionId]
    );
    return mapSessionRow(await getSessionById(pool, sessionId));
}

async function setPlatformAnswerSdp(pool, sessionId, sdp) {
    const row = await getSessionById(pool, sessionId);
    if (!row) {
        const err = new Error('Session not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (row.admin_user_id != null) {
        const err = new Error('Session is assigned to a store admin');
        err.code = 'FORBIDDEN';
        throw err;
    }
    await pool.execute(
        `UPDATE pos_register_support_sessions SET answer_sdp = ?, status = 'active', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), signal_version = signal_version + 1 WHERE id = ?`,
        [String(sdp || '').slice(0, 500000), sessionId]
    );
    return mapSessionRow(await getSessionById(pool, sessionId));
}

async function appendIceCandidate(pool, sessionId, side, candidate, deviceRecordId = null) {
    const row = await getSessionById(pool, sessionId);
    if (!row) return null;
    if (side === 'pos' && deviceRecordId != null && Number(row.pos_device_id) !== Number(deviceRecordId)) {
        const err = new Error('Session not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    const col = side === 'admin' ? 'admin_ice_json' : 'pos_ice_json';
    const list = parseJsonArray(row[col]);
    list.push(candidate);
    const trimmed = list.slice(-40);
    await pool.execute(
        `UPDATE pos_register_support_sessions SET ${col} = ?, signal_version = signal_version + 1 WHERE id = ?`,
        [JSON.stringify(trimmed), sessionId]
    );
    return trimmed.length;
}

async function getSignalState(pool, sessionId, { sinceVersion = 0, deviceRecordId = null } = {}) {
    const row = await getSessionById(pool, sessionId);
    if (!row) {
        const err = new Error('Session not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (deviceRecordId != null && Number(row.pos_device_id) !== Number(deviceRecordId)) {
        const err = new Error('Session not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    const version = Number(row.signal_version) || 0;
    if (version <= sinceVersion) {
        return { session: mapSessionRow(row), changed: false, signalVersion: version };
    }
    return {
        session: mapSessionRow(row),
        changed: true,
        signalVersion: version,
        offerSdp: row.offer_sdp || null,
        answerSdp: row.answer_sdp || null,
        posIce: parseJsonArray(row.pos_ice_json),
        adminIce: parseJsonArray(row.admin_ice_json),
        diagnostics: (() => {
            try {
                return row.diagnostics_json ? JSON.parse(row.diagnostics_json) : null;
            } catch {
                return null;
            }
        })()
    };
}

async function endSession(pool, sessionId, { byAdmin = false, deviceRecordId = null } = {}) {
    const row = await getSessionById(pool, sessionId);
    if (!row) return false;
    if (!byAdmin && deviceRecordId != null && Number(row.pos_device_id) !== Number(deviceRecordId)) {
        const err = new Error('Session not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    await pool.execute(
        `UPDATE pos_register_support_sessions SET status = 'ended', ended_at = CURRENT_TIMESTAMP, signal_version = signal_version + 1 WHERE id = ?`,
        [sessionId]
    );
    logger.info('[pos-support] Session ended', { sessionId, byAdmin });
    return true;
}

module.exports = {
    isSupportedPlatform,
    SUPPORTED_PLATFORMS,
    updateDeviceSupportMeta,
    listRegistersForSupport,
    getActiveSessionForDevice,
    requestSupportSession,
    adminJoinSession,
    platformJoinSession,
    setSessionConsent,
    setOfferSdp,
    setAnswerSdp,
    setPlatformAnswerSdp,
    appendIceCandidate,
    getSignalState,
    endSession,
    mapSessionRow,
    getSessionById
};
