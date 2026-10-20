'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { ensureAdminTotpSchema } = require('../utils/ensureAdminTotpSchema');
const { generateTotpSecret, matchTotp, otpauthUrl } = require('../utils/totp');
const { otpauthQrSvg } = require('../vendor/qrcode');

const PURPOSE = 'admin_2fa';
const CHALLENGE_TTL = '10m';
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const BACKUP_COUNT = 8;
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let cachedKey = null;
let schemaReady = false;

function encryptionKey() {
    if (cachedKey) return cachedKey;
    const secret = String(process.env.JWT_SECRET || '').trim();
    if (!secret) return null;
    cachedKey = crypto.scryptSync(secret, 'bo-admin-totp-v1', 32);
    return cachedKey;
}

function encryptSecret(plain) {
    const key = encryptionKey();
    if (!key) {
        const err = new Error('Server configuration error');
        err.status = 500;
        throw err;
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptSecret(payload) {
    const key = encryptionKey();
    if (!key || !payload) return null;
    try {
        const buf = Buffer.from(String(payload), 'base64');
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const enc = buf.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}

function totpError(status, code, message) {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
}

function hashBackupCode(code) {
    const secret = String(process.env.JWT_SECRET || '').trim();
    const normalized = String(code || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
    return crypto.createHmac('sha256', secret).update(`admin-backup:${normalized}`).digest('hex');
}

function generateBackupCode() {
    const bytes = crypto.randomBytes(8);
    let raw = '';
    for (let i = 0; i < 8; i++) {
        raw += BACKUP_ALPHABET[bytes[i] % BACKUP_ALPHABET.length];
    }
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function parseHashes(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

async function ensureSchema(pool) {
    if (schemaReady) return;
    await ensureAdminTotpSchema(pool);
    schemaReady = true;
}

function issueChallenge(adminId) {
    if (!process.env.JWT_SECRET) {
        throw totpError(500, 'SERVER', 'Server configuration error');
    }
    return jwt.sign(
        { adminId: Number(adminId), purpose: PURPOSE },
        process.env.JWT_SECRET,
        { expiresIn: CHALLENGE_TTL }
    );
}

function readChallenge(token) {
    if (!token || !process.env.JWT_SECRET) return null;
    try {
        const decoded = jwt.verify(String(token), process.env.JWT_SECRET);
        const adminId = Number(decoded.adminId);
        if (decoded.purpose !== PURPOSE || !Number.isInteger(adminId) || adminId <= 0) return null;
        return { adminId };
    } catch {
        return null;
    }
}

async function loadAdmin(pool, adminId) {
    const [rows] = await pool.execute(
        'SELECT id, email, first_name, last_name, role, is_active FROM admin_users WHERE id = ? LIMIT 1',
        [adminId]
    );
    const admin = rows[0];
    if (!admin || !admin.is_active) {
        throw totpError(401, 'CHALLENGE_EXPIRED', 'This sign-in step expired. Enter your password again.');
    }
    return admin;
}

async function loadTotp(pool, adminId) {
    await ensureSchema(pool);
    const [rows] = await pool.execute(
        `SELECT admin_user_id, secret_enc, enabled, backup_hashes, failed_attempts, last_step,
                (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked
           FROM admin_totp
          WHERE admin_user_id = ?
          LIMIT 1`,
        [adminId]
    );
    return rows[0] || null;
}

async function clearExpiredLock(pool, adminId) {
    await pool.execute(
        `UPDATE admin_totp
            SET failed_attempts = 0, locked_until = NULL
          WHERE admin_user_id = ?
            AND locked_until IS NOT NULL
            AND locked_until <= NOW()`,
        [adminId]
    );
}

async function assertUnlocked(pool, adminId) {
    await clearExpiredLock(pool, adminId);
    const row = await loadTotp(pool, adminId);
    if (row && Number(row.is_locked) === 1) {
        throw totpError(
            429,
            'TWO_FACTOR_LOCKED',
            'Too many incorrect codes. Wait 15 minutes, then try again.'
        );
    }
    return row;
}

async function recordFailure(pool, adminId) {
    const row = await loadTotp(pool, adminId);
    const attempts = Number(row?.failed_attempts || 0) + 1;
    if (!row) return attempts;
    if (attempts >= MAX_FAILURES) {
        await pool.execute(
            `UPDATE admin_totp
                SET failed_attempts = ?, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE)
              WHERE admin_user_id = ?`,
            [attempts, LOCK_MINUTES, adminId]
        );
        throw totpError(
            429,
            'TWO_FACTOR_LOCKED',
            'Too many incorrect codes. Wait 15 minutes, then try again.'
        );
    }
    await pool.execute(
        'UPDATE admin_totp SET failed_attempts = ? WHERE admin_user_id = ?',
        [attempts, adminId]
    );
    return attempts;
}

async function beginAdminTwoFactor(pool, adminId) {
    await ensureSchema(pool);
    await assertUnlocked(pool, adminId);
    const row = await loadTotp(pool, adminId);
    const enrolled = Boolean(row && Number(row.enabled) === 1);
    return {
        twoFactor: enrolled ? 'verify' : 'setup',
        challengeToken: issueChallenge(adminId)
    };
}

async function setupAdminTwoFactor(pool, challengeToken) {
    const challenge = readChallenge(challengeToken);
    if (!challenge) {
        throw totpError(401, 'CHALLENGE_EXPIRED', 'This sign-in step expired. Enter your password again.');
    }
    const admin = await loadAdmin(pool, challenge.adminId);
    const existing = await assertUnlocked(pool, admin.id);
    if (existing && Number(existing.enabled) === 1) {
        throw totpError(409, 'ALREADY_ENROLLED', 'Two-factor authentication is already on. Enter the code from your app.');
    }

    let secret = existing ? decryptSecret(existing.secret_enc) : null;
    if (!secret) {
        secret = generateTotpSecret();
        const enc = encryptSecret(secret);
        if (existing) {
            await pool.execute(
                `UPDATE admin_totp
                    SET secret_enc = ?, enabled = 0, backup_hashes = NULL, enrolled_at = NULL, last_step = NULL
                  WHERE admin_user_id = ?`,
                [enc, admin.id]
            );
        } else {
            try {
                await pool.execute(
                    'INSERT INTO admin_totp (admin_user_id, secret_enc, enabled) VALUES (?, ?, 0)',
                    [admin.id, enc]
                );
            } catch (error) {
                if (error?.errno !== 1062 && error?.code !== 'ER_DUP_ENTRY') throw error;
                await pool.execute(
                    `UPDATE admin_totp
                        SET secret_enc = ?, enabled = 0, backup_hashes = NULL, enrolled_at = NULL
                      WHERE admin_user_id = ?`,
                    [enc, admin.id]
                );
            }
        }
    }

    const url = otpauthUrl(admin.email, secret);
    let qrSvg = '';
    try {
        qrSvg = otpauthQrSvg(url);
    } catch (error) {
        logger.error('Admin 2FA QR render failed', { adminId: admin.id, message: error.message });
    }
    return {
        manualKey: secret,
        qrSvg
    };
}

function consumeBackupCode(hashes, code) {
    const digest = hashBackupCode(code);
    const given = Buffer.from(digest);
    const next = [];
    let matched = false;
    for (const hash of hashes) {
        const current = Buffer.from(String(hash));
        if (!matched && current.length === given.length && crypto.timingSafeEqual(current, given)) {
            matched = true;
            continue;
        }
        next.push(hash);
    }
    return { matched, next };
}

async function confirmAdminTwoFactor(pool, challengeToken, code) {
    const challenge = readChallenge(challengeToken);
    if (!challenge) {
        throw totpError(401, 'CHALLENGE_EXPIRED', 'This sign-in step expired. Enter your password again.');
    }
    const admin = await loadAdmin(pool, challenge.adminId);
    const row = await assertUnlocked(pool, admin.id);
    if (!row || Number(row.enabled) === 1) {
        throw totpError(409, 'ALREADY_ENROLLED', 'Two-factor authentication is already on. Enter the code from your app.');
    }
    const secret = decryptSecret(row.secret_enc);
    if (!secret) {
        throw totpError(400, 'SETUP_REQUIRED', 'Set up your authenticator app, then enter the code.');
    }
    const step = matchTotp(secret, code);
    if (step == null) {
        logger.info('Admin 2FA enrollment code rejected', { adminId: admin.id });
        await recordFailure(pool, admin.id);
        throw totpError(401, 'INVALID_CODE', 'That code is not valid. Check the app and try again.');
    }

    const backupCodes = [];
    const hashes = [];
    while (backupCodes.length < BACKUP_COUNT) {
        const backup = generateBackupCode();
        if (backupCodes.includes(backup)) continue;
        backupCodes.push(backup);
        hashes.push(hashBackupCode(backup));
    }
    await pool.execute(
        `UPDATE admin_totp
            SET enabled = 1,
                backup_hashes = ?,
                failed_attempts = 0,
                locked_until = NULL,
                last_step = ?,
                enrolled_at = NOW()
          WHERE admin_user_id = ?`,
        [JSON.stringify(hashes), step, admin.id]
    );
    return { admin, backupCodes };
}

async function verifyAdminTwoFactor(pool, challengeToken, code) {
    const challenge = readChallenge(challengeToken);
    if (!challenge) {
        throw totpError(401, 'CHALLENGE_EXPIRED', 'This sign-in step expired. Enter your password again.');
    }
    const admin = await loadAdmin(pool, challenge.adminId);
    const row = await assertUnlocked(pool, admin.id);
    if (!row || Number(row.enabled) !== 1) {
        throw totpError(400, 'SETUP_REQUIRED', 'Finish authenticator setup before signing in.');
    }
    const secret = decryptSecret(row.secret_enc);
    if (!secret) {
        throw totpError(500, 'SERVER', 'Two-factor authentication is unavailable. Try again shortly.');
    }

    const raw = String(code || '').trim();
    if (/^\d{6}$/.test(raw.replace(/\s/g, ''))) {
        const step = matchTotp(secret, raw);
        if (step == null) {
            logger.info('Admin 2FA code rejected', { adminId: admin.id });
            await recordFailure(pool, admin.id);
            throw totpError(401, 'INVALID_CODE', 'That code is not valid. Try again.');
        }
        const lastStep = row.last_step == null ? null : Number(row.last_step);
        if (lastStep != null && step <= lastStep) {
            throw totpError(401, 'INVALID_CODE', 'That code was already used. Wait for the next code.');
        }
        await pool.execute(
            `UPDATE admin_totp
                SET failed_attempts = 0, locked_until = NULL, last_step = ?
              WHERE admin_user_id = ?`,
            [step, admin.id]
        );
        return admin;
    }

    const hashes = parseHashes(row.backup_hashes);
    const consumed = consumeBackupCode(hashes, raw);
    if (!consumed.matched) {
        logger.info('Admin 2FA backup code rejected', { adminId: admin.id });
        await recordFailure(pool, admin.id);
        throw totpError(401, 'INVALID_CODE', 'That code is not valid. Try again.');
    }
    await pool.execute(
        `UPDATE admin_totp
            SET backup_hashes = ?, failed_attempts = 0, locked_until = NULL
          WHERE admin_user_id = ?`,
        [JSON.stringify(consumed.next), admin.id]
    );
    return admin;
}

module.exports = {
    beginAdminTwoFactor,
    setupAdminTwoFactor,
    confirmAdminTwoFactor,
    verifyAdminTwoFactor,
    PURPOSE
};
