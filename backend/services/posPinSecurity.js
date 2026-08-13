'use strict';

function buildAttemptKey(deviceId, ip) {
    const device = String(deviceId || 'unknown').trim().slice(0, 64);
    const addr = String(ip || 'unknown').trim().slice(0, 64);
    return `${device}|${addr}`;
}

async function getAttemptRow(pool, attemptKey) {
    const [rows] = await pool.execute(
        `SELECT fail_count, locked_until FROM pos_pin_attempts WHERE attempt_key = ? LIMIT 1`,
        [attemptKey]
    );
    return rows[0] || null;
}

async function assertPinNotLocked(pool, attemptKey) {
    const row = await getAttemptRow(pool, attemptKey);
    if (!row?.locked_until) return;
    const lockedUntil = new Date(row.locked_until);
    if (Number.isNaN(lockedUntil.getTime()) || lockedUntil <= new Date()) return;

    const err = new Error('Too many failed PIN attempts. Try again later.');
    err.code = 'PIN_LOCKED';
    err.lockedUntil = lockedUntil.toISOString();
    throw err;
}

async function recordFailedPinAttempt(pool, attemptKey, settings) {
    const maxAttempts = settings?.pinMaxAttempts || 10;
    const lockoutMinutes = settings?.pinLockoutMinutes || 15;
    const row = await getAttemptRow(pool, attemptKey);
    const nextCount = (Number(row?.fail_count) || 0) + 1;
    const shouldLock = nextCount >= maxAttempts;
    const lockedUntil = shouldLock ? new Date(Date.now() + lockoutMinutes * 60 * 1000) : null;

    await pool.execute(
        `INSERT INTO pos_pin_attempts (attempt_key, fail_count, locked_until)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           fail_count = VALUES(fail_count),
           locked_until = VALUES(locked_until),
           updated_at = CURRENT_TIMESTAMP`,
        [attemptKey, nextCount, lockedUntil]
    );

    if (shouldLock) {
        const err = new Error('Too many failed PIN attempts. Try again later.');
        err.code = 'PIN_LOCKED';
        err.lockedUntil = lockedUntil.toISOString();
        throw err;
    }
}

async function clearPinAttempts(pool, attemptKey) {
    await pool.execute(`DELETE FROM pos_pin_attempts WHERE attempt_key = ?`, [attemptKey]);
}

module.exports = {
    buildAttemptKey,
    assertPinNotLocked,
    recordFailedPinAttempt,
    clearPinAttempts
};
