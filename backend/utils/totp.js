'use strict';

const crypto = require('crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += BASE32[(value << (5 - bits)) & 31];
    }
    return output;
}

function base32Decode(input) {
    const str = String(input || '').toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (let i = 0; i < str.length; i++) {
        const idx = BASE32.indexOf(str[i]);
        if (idx < 0) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

function hotp(key, counter, digits) {
    const buf = Buffer.alloc(8);
    const high = Math.floor(counter / 0x100000000);
    const low = counter >>> 0;
    buf.writeUInt32BE(high, 0);
    buf.writeUInt32BE(low, 4);
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
    const mod = 10 ** digits;
    return String(bin % mod).padStart(digits, '0');
}

function generateTotpSecret() {
    return base32Encode(crypto.randomBytes(20));
}

/** Returns the matched time step, or null. */
function matchTotp(secret, token, window = 1, nowMs = Date.now()) {
    const code = String(token || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return null;
    const key = base32Decode(secret);
    if (!key.length) return null;
    const counter = Math.floor(nowMs / 1000 / STEP_SECONDS);
    const given = Buffer.from(code);
    for (let w = -window; w <= window; w++) {
        const step = counter + w;
        const expected = Buffer.from(hotp(key, step, DIGITS));
        if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) {
            return step;
        }
    }
    return null;
}

function otpauthUrl(email, secret) {
    const account = String(email || 'admin').trim();
    const label = encodeURIComponent(`HM Herbs:${account}`);
    const issuer = encodeURIComponent('HM Herbs');
    return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

module.exports = {
    generateTotpSecret,
    matchTotp,
    otpauthUrl,
    hotp,
    base32Decode,
    STEP_SECONDS,
    DIGITS
};
