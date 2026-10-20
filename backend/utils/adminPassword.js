'use strict';

const crypto = require('crypto');

/** Match storefront / common complexity rules; specials limited to this set. */
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{12,128}$/;

const ADMIN_PASSWORD_BCRYPT_ROUNDS = 12;

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '@$!%*?&';
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
    if (pw.length < 12) {
        return {
            ok: false,
            error: 'Password must be at least 12 characters and include upper, lower, a number, and a special character (@$!%*?&).'
        };
    }
    if (!PASSWORD_REGEX.test(pw)) {
        return {
            ok: false,
            error: 'Password must include upper and lower case letters, a number, and a special character (@$!%*?&).'
        };
    }
    return { ok: true };
}

module.exports = {
    ADMIN_PASSWORD_BCRYPT_ROUNDS,
    PASSWORD_REGEX,
    generateTempAdminPassword,
    validateAdminPassword
};
