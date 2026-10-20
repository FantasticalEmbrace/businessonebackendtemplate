'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'bo_dev_signup_unlock';
const PURPOSE = 'dev_signup_unlock';
const DEFAULT_TTL_SEC = 8 * 60 * 60;

function unlockSecret() {
    return String(
        process.env.DEV_SIGNUP_UNLOCK_SECRET ||
            process.env.PLATFORM_PROVISION_SECRET ||
            process.env.JWT_SECRET ||
            ''
    ).trim();
}

function cookieDomainForHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1') return '';
    if (host.endsWith('businessonecomprehensive.com')) return '.businessonecomprehensive.com';
    return '';
}

function publicSignupUrl() {
    return String(
        process.env.PUBLIC_POS_SIGNUP_URL ||
            process.env.BUSINESS_ONE_SIGNUP_URL ||
            'https://businessonecomprehensive.com/pos-signup.html'
    ).trim();
}

/**
 * Mint a short-lived unlock token (developer role only — caller must enforce).
 */
function mintDevSignupUnlock({ adminId, email, role } = {}) {
    const secret = unlockSecret();
    if (!secret) {
        const err = new Error('DEV_SIGNUP_UNLOCK_SECRET (or JWT_SECRET) is not configured');
        err.code = 'UNLOCK_MISCONFIGURED';
        throw err;
    }
    const ttl = Math.max(300, Number(process.env.DEV_SIGNUP_UNLOCK_TTL_SEC || DEFAULT_TTL_SEC) || DEFAULT_TTL_SEC);
    const payload = {
        purpose: PURPOSE,
        adminId: Number(adminId) || null,
        email: String(email || '').trim().toLowerCase(),
        role: String(role || '').toLowerCase()
    };
    const token = jwt.sign(payload, secret, { expiresIn: ttl });
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    return {
        token,
        expiresAt,
        cookieName: COOKIE_NAME,
        cookieDomain: cookieDomainForHost(
            String(process.env.SHARED_POS_PUBLIC_ORIGIN || process.env.FRONTEND_URL || '')
                .replace(/^https?:\/\//, '')
                .split('/')[0]
                .split(':')[0]
        ) || '.businessonecomprehensive.com',
        signupUrl: publicSignupUrl(),
        priceLabel: 'Developer test',
        dueTodayCents: 0,
        mode: 'zero'
    };
}

function verifyDevSignupUnlock(token) {
    const secret = unlockSecret();
    if (!secret) return null;
    const raw = String(token || '').trim();
    if (!raw) return null;
    try {
        const decoded = jwt.verify(raw, secret);
        if (!decoded || decoded.purpose !== PURPOSE) return null;
        if (String(decoded.role || '').toLowerCase() !== 'developer') return null;
        return {
            adminId: decoded.adminId || null,
            email: String(decoded.email || '').toLowerCase(),
            role: 'developer',
            mode: 'zero',
            priceLabel: 'Developer test',
            dueTodayCents: 0
        };
    } catch {
        return null;
    }
}

/** Constant-time-ish presence check for logs (never log full token). */
function unlockFingerprint(token) {
    const raw = String(token || '');
    if (!raw) return '';
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

module.exports = {
    COOKIE_NAME,
    PURPOSE,
    unlockSecret,
    cookieDomainForHost,
    publicSignupUrl,
    mintDevSignupUnlock,
    verifyDevSignupUnlock,
    unlockFingerprint
};
