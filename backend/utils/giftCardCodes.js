// Gift card code & PIN generation utilities.
// Codes are 16 chars from a "no-confusable-characters" alphabet,
// formatted as XXXX-XXXX-XXXX-XXXX for human readability.

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ALPHABET_LEN = ALPHABET.length;

function randomChar() {
    const byte = crypto.randomBytes(1)[0];
    return ALPHABET[byte % ALPHABET_LEN];
}

function generateRawCode(length = 16) {
    let out = '';
    for (let i = 0; i < length; i++) out += randomChar();
    return out;
}

function formatCode(raw) {
    return raw.match(/.{1,4}/g).join('-');
}

function generateGiftCardCode() {
    return formatCode(generateRawCode(16));
}

function generateGiftCardPin() {
    let out = '';
    for (let i = 0; i < 4; i++) {
        const b = crypto.randomBytes(1)[0];
        out += String(b % 10);
    }
    return out;
}

function normalizeCode(code) {
    if (!code) return '';
    return String(code).trim().toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');
}

module.exports = {
    generateGiftCardCode,
    generateGiftCardPin,
    normalizeCode,
};
