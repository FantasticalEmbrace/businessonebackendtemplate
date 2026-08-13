'use strict';

const crypto = require('crypto');

function supportEncryptionKey() {
    const secret = String(process.env.POS_SUPPORT_SECRET || process.env.JWT_SECRET || '').trim();
    if (!secret) return null;
    return crypto.scryptSync(secret, 'business-one-pos-support', 32);
}

function encryptSupportSecret(plain) {
    const text = String(plain || '');
    if (!text) return null;
    const key = supportEncryptionKey();
    if (!key) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptSupportSecret(payload) {
    if (!payload) return null;
    const key = supportEncryptionKey();
    if (!key) return null;
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

function hashAgentKey(apiKey) {
    const pepper = String(process.env.POS_SUPPORT_AGENT_PEPPER || process.env.JWT_SECRET || 'pos-support').trim();
    return crypto.createHash('sha256').update(`${pepper}:${String(apiKey || '')}`).digest('hex');
}

function generateAgentApiKey() {
    return `pss_${crypto.randomBytes(24).toString('hex')}`;
}

function keyPrefix(apiKey) {
    return String(apiKey || '').slice(0, 12);
}

module.exports = {
    encryptSupportSecret,
    decryptSupportSecret,
    hashAgentKey,
    generateAgentApiKey,
    keyPrefix
};
