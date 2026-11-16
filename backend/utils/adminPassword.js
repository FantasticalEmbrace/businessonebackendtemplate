'use strict';

const crypto = require('crypto');

/**
 * Admin password rules (must-change, reset, change-password):
 * - 12–128 chars
 * - upper + lower + digit + at least one special (any non-alphanumeric)
 * - no whitespace / control characters
 * Specials are intentionally broad so password managers (incl. ^ # () etc.) work.
 */
const ADMIN_PASSWORD_MIN = 12;
const ADMIN_PASSWORD_MAX = 128;
const ADMIN_PASSWORD_HINT =
    'at least 12 characters with upper, lower, a number, and a special character (e.g. @$!%*?&#^)';

/** Kept for callers that import PASSWORD_REGEX; prefer validateAdminPassword(). */
const PASSWORD_REGEX =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])(?!.*\s)[\x21-\x7E]{12,128}$/;

const ADMIN_PASSWORD_BCRYPT_ROUNDS = 12;

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
/** Temp passwords stay on a conservative special set (still includes ^). */
const SPECIAL = '@$!%*?&#^';
const ALL = UPPER + LOWER + DIGITS + SPECIAL;

function pick(chars) {
    return chars[crypto.randomInt(chars.length)];
}

/**
 * High-entropy temporary admin password (20 chars, mixed classes, no ambiguous O/0/I/l).
 * ~log2(70^20) bits of entropy from the full alphabet draws.
 */
function generateTempAdminPassword() {
    const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
    for (let i = 0; i < 16; i += 1) {
        chars.push(pick(ALL));
    }
    for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = crypto.randomInt(i + 1);
        const tmp = chars[i];
        chars[i] = chars[j];
        chars[j] = tmp;
    }
    return chars.join('');
}

function validateAdminPassword(password) {
    const pw = String(password || '');
    if (pw.length < ADMIN_PASSWORD_MIN) {
        return {
            ok: false,
            error: `Password must be ${ADMIN_PASSWORD_HINT}.`
        };
    }
    if (pw.length > ADMIN_PASSWORD_MAX) {
        return {
            ok: false,
            error: `Password must be at most ${ADMIN_PASSWORD_MAX} characters.`
        };
    }
    if (/\s/.test(pw) || /[\x00-\x1F\x7F]/.test(pw)) {
        return {
            ok: false,
            error: 'Password cannot contain spaces or control characters.'
        };
    }
    if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
        return {
            ok: false,
            error: `Password must include upper and lower case letters, a number, and a special character (e.g. @$!%*?&#^).`
        };
    }
    // Printable ASCII only (blocks unexpected unicode lookalikes from pastes).
    if (!/^[\x21-\x7E]+$/.test(pw)) {
        return {
            ok: false,
            error: 'Password may only use standard keyboard characters.'
        };
    }
    return { ok: true };
}

module.exports = {
    ADMIN_PASSWORD_BCRYPT_ROUNDS,
    ADMIN_PASSWORD_HINT,
    ADMIN_PASSWORD_MAX,
    ADMIN_PASSWORD_MIN,
    PASSWORD_REGEX,
    generateTempAdminPassword,
    validateAdminPassword
};
