'use strict';

const crypto = require('crypto');

const DEFAULT_TTL_DAYS = 90;

function getSecret() {
    return (
        process.env.NEWSLETTER_SUBSCRIBE_SECRET ||
        process.env.JWT_SECRET ||
        'bo-newsletter-dev-only'
    );
}

function normalizeEmail(email) {
    return String(email || '')
        .trim()
        .toLowerCase();
}

/**
 * HMAC token for one-click newsletter subscribe links (gift card recipient emails).
 */
function createNewsletterSubscribeToken(email, { source = 'gift_card_recipient', ttlDays = DEFAULT_TTL_DAYS } = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;

    const expiresAt = Date.now() + Math.max(1, Number(ttlDays) || DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000;
    const payload = `${normalized}|${String(source)}|${expiresAt}`;
    const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
    return `${expiresAt}.${sig}`;
}

function verifyNewsletterSubscribeToken(email, token, { source = 'gift_card_recipient' } = {}) {
    const normalized = normalizeEmail(email);
    const raw = String(token || '').trim();
    if (!normalized || !raw) return false;

    const dot = raw.indexOf('.');
    if (dot < 1) return false;

    const expiresAt = Number(raw.slice(0, dot));
    const sig = raw.slice(dot + 1);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !sig) return false;

    const payload = `${normalized}|${String(source)}|${expiresAt}`;
    const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        return false;
    }
}

module.exports = {
    createNewsletterSubscribeToken,
    verifyNewsletterSubscribeToken,
    DEFAULT_TTL_DAYS,
};
