'use strict';

const crypto = require('crypto');

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

function resolveStoreUrlForNewKey() {
    try {
        const { getStoreBaseUrl } = require('../utils/platformSupportEnv');
        return getStoreBaseUrl();
    } catch {
        return '';
    }
}

async function listDevices(pool) {
    const [rows] = await pool.execute(
        `SELECT id, device_label, key_prefix, is_active, last_seen_at, created_at, updated_at
         FROM pos_devices
         WHERE is_active = 1
         ORDER BY device_label ASC`
    );
    return rows || [];
}

async function findDeviceByLabel(pool, deviceLabel) {
    const label = String(deviceLabel || '').trim().slice(0, 64);
    if (!label) return null;
    const [rows] = await pool.execute(
        `SELECT id, device_label, is_active FROM pos_devices WHERE LOWER(device_label) = LOWER(?) AND is_active = 1 LIMIT 1`,
        [label]
    );
    return rows[0] || null;
}

async function createDevice(pool, deviceLabel) {
    const label = String(deviceLabel || '').trim().slice(0, 64);
    if (label.length < 2) {
        const err = new Error('Register name must be at least 2 characters');
        err.code = 'INVALID_DEVICE_LABEL';
        throw err;
    }

    const existing = await findDeviceByLabel(pool, label);
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

    const [result] = await pool.execute(
        `INSERT INTO pos_devices (device_label, api_key_hash, key_prefix, is_active)
         VALUES (?, ?, ?, 1)`,
        [label, apiKeyHash, prefix]
    );

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

    await pool.execute(
        `UPDATE pos_devices
         SET api_key_hash = ?, key_prefix = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [apiKeyHash, prefix, id]
    );

    return {
        id,
        deviceLabel: rows[0].device_label,
        apiKey,
        keyPrefix: prefix,
        storeBaseUrl: parsed.storeBaseUrl || ''
    };
}

async function touchDeviceSeen(pool, deviceRowId) {
    if (!deviceRowId) return;
    await pool.execute(`UPDATE pos_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`, [deviceRowId]).catch(() => {});
}

async function authenticateDevice(pool, deviceLabel, providedKey) {
    const label = String(deviceLabel || 'register-1').trim().slice(0, 64);
    const key = String(providedKey || '').trim();
    if (!key) {
        return { ok: false, code: 'POS_AUTH_FAILED' };
    }

    const [rows] = await pool.execute(
        `SELECT id, device_label, api_key_hash, is_active FROM pos_devices WHERE LOWER(device_label) = LOWER(?) LIMIT 1`,
        [label]
    );
    const registered = rows[0];

    if (registered) {
        if (!registered.is_active) {
            return { ok: false, code: 'POS_DEVICE_REVOKED' };
        }
        const hash = hashDeviceKey(key);
        if (hash !== registered.api_key_hash) {
            return { ok: false, code: 'POS_AUTH_FAILED' };
        }
        await touchDeviceSeen(pool, registered.id);
        return { ok: true, deviceId: registered.device_label, deviceRecordId: registered.id };
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
    listDevices,
    createDevice,
    regenerateDeviceKey,
    revokeDevice,
    deleteDevice,
    pruneRevokedDevices,
    revokeAllDevices,
    authenticateDevice
};
