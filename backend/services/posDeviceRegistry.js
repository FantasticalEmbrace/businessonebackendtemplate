'use strict';

const crypto = require('crypto');
const { encryptSupportSecret, decryptSupportSecret } = require('../utils/posSupportCrypto');

function hashDeviceKey(apiKey) {
    const pepper = String(process.env.POS_DEVICE_KEY_PEPPER || process.env.JWT_SECRET || 'pos-device').trim();
    return crypto.createHash('sha256').update(`${pepper}:${String(apiKey || '')}`).digest('hex');
}

function toBase64Url(text) {
    return Buffer.from(String(text || ''), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function fromBase64Url(encoded) {
    const raw = String(encoded || '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const pad = raw.length % 4 === 0 ? '' : '='.repeat(4 - (raw.length % 4));
    return Buffer.from(raw + pad, 'base64').toString('utf8');
}

function normalizeStoreOrigin(raw) {
    try {
        const { normalizeStoreBaseUrl } = require('../utils/platformSupportEnv');
        return normalizeStoreBaseUrl(raw);
    } catch {
        const trimmed = String(raw || '').trim().replace(/\/+$/, '');
        if (!trimmed) return '';
        try {
            const u = new URL(trimmed);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
            return u.origin;
        } catch {
            return '';
        }
    }
}

/**
 * Self-describing key: pos1.<base64url(storeOrigin)>.<secret>
 * POS reads the store address from the key — no central lookup needed.
 */
function generateDeviceApiKey(storeBaseUrl) {
    const origin = normalizeStoreOrigin(storeBaseUrl);
    if (!origin) {
        const err = new Error(
            'Set the store website address in Admin → POS → Registers before generating a device key.'
        );
        err.code = 'STORE_URL_REQUIRED';
        throw err;
    }
    const payload = toBase64Url(origin);
    const secret = crypto.randomBytes(24).toString('hex');
    return `pos1.${payload}.${secret}`;
}

function parseDeviceApiKey(apiKey) {
    const key = String(apiKey || '').trim();
    if (!key) {
        return { format: 'empty', apiKey: '', storeBaseUrl: '' };
    }
    const match = /^pos1\.([A-Za-z0-9_-]+)\.([a-fA-F0-9]+)$/.exec(key);
    if (!match) {
        return { format: 'legacy', apiKey: key, storeBaseUrl: '' };
    }
    try {
        const decoded = fromBase64Url(match[1]);
        const storeBaseUrl = normalizeStoreOrigin(decoded);
        if (!storeBaseUrl) {
            return { format: 'invalid', apiKey: key, storeBaseUrl: '' };
        }
        return {
            format: 'pos1',
            apiKey: key,
            storeBaseUrl,
            secret: match[2]
        };
    } catch {
        return { format: 'invalid', apiKey: key, storeBaseUrl: '' };
    }
}

function keyPrefix(apiKey) {
    return String(apiKey || '').slice(0, 12);
}

/** Stable per-install id from X-POS-Install-Id (UUID or machine id). */
function normalizeInstallId(raw) {
    const id = String(raw || '')
        .trim()
        .slice(0, 64);
    if (!id || id.length < 8) return '';
    if (!/^[A-Za-z0-9._:-]+$/.test(id)) return '';
    return id;
}

function normalizeBoundPlatform(raw) {
    const p = String(raw || '')
        .trim()
        .toLowerCase()
        .slice(0, 16);
    return p || null;
}

function resolveStoreUrlForNewKey() {
    try {
        const { getStoreBaseUrl, normalizeStoreBaseUrl } = require('../utils/platformSupportEnv');
        return (
            getStoreBaseUrl() ||
            normalizeStoreBaseUrl(
                process.env.SHARED_POS_PUBLIC_ORIGIN ||
                    process.env.FRONTEND_URL ||
                    process.env.POS_PLATFORM_STORE_URL ||
                    'https://pos.businessonecomprehensive.com'
            ) ||
            'https://pos.businessonecomprehensive.com'
        );
    } catch {
        return 'https://pos.businessonecomprehensive.com';
    }
}

async function listDevices(pool, merchantId = null) {
    if (merchantId) {
        const [rows] = await pool.execute(
            `SELECT id, device_label, key_prefix, is_active, last_seen_at, created_at, updated_at,
                    bound_install_id, bound_at, bound_platform,
                    (api_key_enc IS NOT NULL AND api_key_enc != '') AS has_stored_key
             FROM pos_devices
             WHERE is_active = 1 AND merchant_id = ?
             ORDER BY device_label ASC`,
            [merchantId]
        );
        return rows || [];
    }
    const [rows] = await pool.execute(
        `SELECT id, device_label, key_prefix, is_active, last_seen_at, created_at, updated_at,
                bound_install_id, bound_at, bound_platform,
                (api_key_enc IS NOT NULL AND api_key_enc != '') AS has_stored_key
         FROM pos_devices
         WHERE is_active = 1
         ORDER BY device_label ASC`
    );
    return rows || [];
}

async function getDeviceApiKey(pool, deviceId, merchantId = null) {
    const id = Number(deviceId);
    if (!Number.isInteger(id) || id <= 0) {
        const err = new Error('Invalid register id');
        err.code = 'INVALID_DEVICE_ID';
        throw err;
    }

    let rows;
    if (merchantId) {
        [rows] = await pool.execute(
            `SELECT id, device_label, api_key_enc FROM pos_devices
             WHERE id = ? AND is_active = 1 AND merchant_id = ?
             LIMIT 1`,
            [id, merchantId]
        );
    } else {
        [rows] = await pool.execute(
            `SELECT id, device_label, api_key_enc FROM pos_devices WHERE id = ? AND is_active = 1 LIMIT 1`,
            [id]
        );
    }
    if (!rows.length) {
        const err = new Error('Register not found');
        err.code = 'DEVICE_NOT_FOUND';
        throw err;
    }

    const row = rows[0];
    const apiKey = decryptSupportSecret(row.api_key_enc);
    if (!apiKey) {
        const err = new Error(
            'This register key was created before copy-again was available. Click New key once, then Copy key will work.'
        );
        err.code = 'KEY_NOT_STORED';
        throw err;
    }

    return {
        id: row.id,
        deviceLabel: row.device_label,
        apiKey
    };
}

async function findDeviceByLabel(pool, deviceLabel, merchantId = null) {
    const label = String(deviceLabel || '').trim().slice(0, 64);
    if (!label) return null;
    if (merchantId) {
        const [rows] = await pool.execute(
            `SELECT id, device_label, is_active FROM pos_devices
             WHERE LOWER(device_label) = LOWER(?) AND is_active = 1 AND merchant_id = ?
             LIMIT 1`,
            [label, merchantId]
        );
        return rows[0] || null;
    }
    const [rows] = await pool.execute(
        `SELECT id, device_label, is_active FROM pos_devices WHERE LOWER(device_label) = LOWER(?) AND is_active = 1 LIMIT 1`,
        [label]
    );
    return rows[0] || null;
}

async function createDevice(pool, deviceLabel, merchantId = null) {
    const label = String(deviceLabel || '').trim().slice(0, 64);
    if (label.length < 2) {
        const err = new Error('Register name must be at least 2 characters');
        err.code = 'INVALID_DEVICE_LABEL';
        throw err;
    }

    const existing = await findDeviceByLabel(pool, label, merchantId);
    if (existing) {
        const err = new Error(
            `Register "${label}" already exists. Click "New key" on that register to generate a replacement key.`
        );
        err.code = 'DUPLICATE_DEVICE_LABEL';
        err.existingDeviceId = existing.id;
        throw err;
    }

    const apiKey = generateDeviceApiKey(resolveStoreUrlForNewKey());
    const apiKeyHash = hashDeviceKey(apiKey);
    const prefix = keyPrefix(apiKey);
    const parsed = parseDeviceApiKey(apiKey);
    const apiKeyEnc = encryptSupportSecret(apiKey);

    let result;
    if (merchantId) {
        [result] = await pool.execute(
            `INSERT INTO pos_devices (device_label, api_key_hash, key_prefix, api_key_enc, is_active, merchant_id)
             VALUES (?, ?, ?, ?, 1, ?)`,
            [label, apiKeyHash, prefix, apiKeyEnc, merchantId]
        );
        try {
            const { hashTenantSecret } = require('../utils/ensureTenantsSchema');
            const dirHash = hashTenantSecret(apiKey);
            await pool.execute(
                `INSERT INTO platform_merchant_keys
                 (merchant_id, kind, key_hash, key_prefix, label)
                 VALUES (?, 'device_key', ?, ?, ?)
                 ON DUPLICATE KEY UPDATE merchant_id = VALUES(merchant_id), label = VALUES(label)`,
                [merchantId, dirHash, prefix, label]
            );
        } catch {
            /* directory optional if tables missing */
        }
    } else {
        [result] = await pool.execute(
            `INSERT INTO pos_devices (device_label, api_key_hash, key_prefix, api_key_enc, is_active)
             VALUES (?, ?, ?, ?, 1)`,
            [label, apiKeyHash, prefix, apiKeyEnc]
        );
    }

    return {
        id: result.insertId,
        deviceLabel: label,
        apiKey,
        keyPrefix: prefix,
        storeBaseUrl: parsed.storeBaseUrl || ''
    };
}

async function deleteDevice(pool, deviceId) {
    const id = Number(deviceId);
    if (!Number.isInteger(id) || id <= 0) return false;

    const [rows] = await pool.execute(`SELECT id FROM pos_devices WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length) return false;

    await pool
        .execute(`DELETE FROM pos_register_support_sessions WHERE pos_device_id = ?`, [id])
        .catch(() => {});
    await pool.execute(`UPDATE pos_equipment SET pos_device_id = NULL WHERE pos_device_id = ?`, [id]).catch(() => {});
    const [result] = await pool.execute(`DELETE FROM pos_devices WHERE id = ?`, [id]);
    return result.affectedRows > 0;
}

/** Revoke removes the register so the name can be used again with a fresh key. */
async function revokeDevice(pool, deviceId) {
    return deleteDevice(pool, deviceId);
}

/** Drop legacy soft-revoked rows from before revoke deleted registers. */
async function pruneRevokedDevices(pool) {
    const [rows] = await pool.execute(`SELECT id FROM pos_devices WHERE is_active = 0`);
    let removed = 0;
    for (const row of rows || []) {
        if (await deleteDevice(pool, row.id)) removed += 1;
    }
    return removed;
}

async function revokeAllDevices(pool) {
    const [rows] = await pool.execute(`SELECT id FROM pos_devices`);
    let removed = 0;
    for (const row of rows || []) {
        if (await deleteDevice(pool, row.id)) removed += 1;
    }
    return removed;
}

async function regenerateDeviceKey(pool, deviceId) {
    const id = Number(deviceId);
    if (!Number.isInteger(id) || id <= 0) {
        const err = new Error('Invalid register id');
        err.code = 'INVALID_DEVICE_ID';
        throw err;
    }

    const [rows] = await pool.execute(
        `SELECT id, device_label FROM pos_devices WHERE id = ? AND is_active = 1 LIMIT 1`,
        [id]
    );
    if (!rows.length) {
        const err = new Error('Register not found');
        err.code = 'DEVICE_NOT_FOUND';
        throw err;
    }

    const apiKey = generateDeviceApiKey(resolveStoreUrlForNewKey());
    const apiKeyHash = hashDeviceKey(apiKey);
    const prefix = keyPrefix(apiKey);
    const parsed = parseDeviceApiKey(apiKey);
    const apiKeyEnc = encryptSupportSecret(apiKey);

    await pool.execute(
        `UPDATE pos_devices
         SET api_key_hash = ?, key_prefix = ?, api_key_enc = ?, is_active = 1,
             bound_install_id = NULL, bound_at = NULL, bound_platform = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [apiKeyHash, prefix, apiKeyEnc, id]
    );

    return {
        id,
        deviceLabel: rows[0].device_label,
        apiKey,
        keyPrefix: prefix,
        storeBaseUrl: parsed.storeBaseUrl || ''
    };
}

/** Clear exclusive install binding so another phone/tablet can activate this register key. */
async function clearDeviceBinding(pool, deviceId) {
    const id = Number(deviceId);
    if (!Number.isInteger(id) || id <= 0) {
        const err = new Error('Invalid register id');
        err.code = 'INVALID_DEVICE_ID';
        throw err;
    }

    const [rows] = await pool.execute(
        `SELECT id, device_label, bound_install_id FROM pos_devices WHERE id = ? AND is_active = 1 LIMIT 1`,
        [id]
    );
    if (!rows.length) {
        const err = new Error('Register not found');
        err.code = 'DEVICE_NOT_FOUND';
        throw err;
    }

    await pool.execute(
        `UPDATE pos_devices
         SET bound_install_id = NULL, bound_at = NULL, bound_platform = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [id]
    );

    return {
        id,
        deviceLabel: rows[0].device_label,
        wasBound: Boolean(rows[0].bound_install_id)
    };
}

async function touchDeviceSeen(pool, deviceRowId) {
    if (!deviceRowId) return;
    await pool.execute(`UPDATE pos_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`, [deviceRowId]).catch(() => {});
}

/**
 * Enforce one physical install per register key.
 * First successful auth with X-POS-Install-Id binds; later mismatch → DEVICE_BOUND_ELSEWHERE.
 */
async function enforceInstallBinding(pool, registered, bindOpts = {}) {
    const installId = normalizeInstallId(bindOpts.installId);
    const platform = normalizeBoundPlatform(bindOpts.platform);
    const bound = registered.bound_install_id ? String(registered.bound_install_id).trim() : '';

    const elsewhereMsg =
        'This register key is already linked to another device. Ask an admin to Reset device binding or generate a new key, then connect again.';

    if (!installId) {
        if (bound) {
            return { ok: false, code: 'DEVICE_BOUND_ELSEWHERE', message: elsewhereMsg };
        }
        return {
            ok: false,
            code: 'INSTALL_ID_REQUIRED',
            message:
                'This POS app must send a stable install id (X-POS-Install-Id). Update the POS app and try again.'
        };
    }

    if (!bound) {
        const [result] = await pool.execute(
            `UPDATE pos_devices
             SET bound_install_id = ?, bound_at = CURRENT_TIMESTAMP, bound_platform = ?,
                 last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND bound_install_id IS NULL`,
            [installId, platform, registered.id]
        );
        if (result.affectedRows === 0) {
            const [again] = await pool.execute(
                `SELECT bound_install_id FROM pos_devices WHERE id = ? LIMIT 1`,
                [registered.id]
            );
            if (String(again[0]?.bound_install_id || '').trim() !== installId) {
                return { ok: false, code: 'DEVICE_BOUND_ELSEWHERE', message: elsewhereMsg };
            }
        }
        return { ok: true, bound: true };
    }

    if (bound !== installId) {
        return { ok: false, code: 'DEVICE_BOUND_ELSEWHERE', message: elsewhereMsg };
    }

    if (platform && !registered.bound_platform) {
        await pool
            .execute(`UPDATE pos_devices SET bound_platform = ? WHERE id = ? AND bound_platform IS NULL`, [
                platform,
                registered.id
            ])
            .catch(() => {});
    }
    return { ok: true, bound: true };
}

async function authenticateDevice(pool, deviceLabel, providedKey, merchantId = null, bindOpts = {}) {
    const label = String(deviceLabel || 'register-1').trim().slice(0, 64);
    const key = String(providedKey || '').trim();
    if (!key) {
        return { ok: false, code: 'POS_AUTH_FAILED' };
    }

    let rows;
    if (merchantId) {
        [rows] = await pool.execute(
            `SELECT id, device_label, api_key_hash, is_active, bound_install_id, bound_platform FROM pos_devices
             WHERE LOWER(device_label) = LOWER(?) AND merchant_id = ? LIMIT 1`,
            [label, merchantId]
        );
    } else {
        [rows] = await pool.execute(
            `SELECT id, device_label, api_key_hash, is_active, bound_install_id, bound_platform
             FROM pos_devices WHERE LOWER(device_label) = LOWER(?) LIMIT 1`,
            [label]
        );
    }
    const registered = rows[0];

    if (registered) {
        if (!registered.is_active) {
            return { ok: false, code: 'POS_DEVICE_REVOKED' };
        }
        const hash = hashDeviceKey(key);
        if (hash !== registered.api_key_hash) {
            return { ok: false, code: 'POS_AUTH_FAILED' };
        }

        const bind = await enforceInstallBinding(pool, registered, bindOpts);
        if (!bind.ok) {
            return { ok: false, code: bind.code, message: bind.message };
        }

        await touchDeviceSeen(pool, registered.id);
        return {
            ok: true,
            deviceId: registered.device_label,
            deviceRecordId: registered.id
        };
    }

    // First-time registration: create device for this merchant if key is a valid pos1 key
    // (legacy open enroll disabled under shared tenancy)
    if (merchantId) {
        return { ok: false, code: 'POS_AUTH_FAILED' };
    }

    const expected = String(process.env.POS_DEVICE_API_KEY || '').trim();
    if (!expected) {
        return { ok: false, code: 'POS_API_DISABLED' };
    }

    const left = Buffer.from(key, 'utf8');
    const right = Buffer.from(expected, 'utf8');
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
        return { ok: false, code: 'POS_AUTH_FAILED' };
    }

    return { ok: true, deviceId: label, deviceRecordId: null };
}

module.exports = {
    hashDeviceKey,
    generateDeviceApiKey,
    parseDeviceApiKey,
    normalizeInstallId,
    listDevices,
    getDeviceApiKey,
    createDevice,
    regenerateDeviceKey,
    clearDeviceBinding,
    revokeDevice,
    deleteDevice,
    pruneRevokedDevices,
    revokeAllDevices,
    authenticateDevice
};
