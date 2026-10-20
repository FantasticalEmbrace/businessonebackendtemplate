'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { buildAdminAuthSuccess } = require('./adminSession');
const { beginAdminTwoFactor } = require('./adminTotp');

const COOKIE_NAME = 'bo_admin_remember';
const COOKIE_PATH = '/api/admin/auth';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_AGE_SEC = 30 * 24 * 60 * 60;

function signingSecret() {
    return String(process.env.JWT_SECRET || '').trim() || null;
}

function secretStamp(secretEnc) {
    const secret = signingSecret();
    if (!secret || !secretEnc) return '';
    return crypto
        .createHmac('sha256', secret)
        .update(`admin-remember-secret:${secretEnc}`)
        .digest('hex')
        .slice(0, 32);
}

function signPayload(payload) {
    const secret = signingSecret();
    if (!secret) return null;
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
}

function readSigned(token) {
    const secret = signingSecret();
    if (!secret || !token || typeof token !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const givenBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (givenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(givenBuf, expectedBuf)) {
        return null;
    }
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        const adminId = Number(payload.u);
        const exp = Number(payload.e);
        const stamp = String(payload.h || '');
        if (!Number.isInteger(adminId) || adminId <= 0) return null;
        if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
        if (!/^[a-f0-9]{32}$/.test(stamp)) return null;
        return { adminId, exp, stamp };
    } catch {
        return null;
    }
}

function readCookieHeader(req, name) {
    const header = req?.headers?.cookie || '';
    if (!header) return '';
    for (const part of String(header).split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        if (part.slice(0, idx).trim() !== name) continue;
        const raw = part.slice(idx + 1).trim();
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    }
    return '';
}

function cookieSecure(req) {
    if (req?.secure) return true;
    const proto = String(req?.headers?.['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim()
        .toLowerCase();
    return proto === 'https';
}

function cookieOptions(req) {
    return {
        httpOnly: true,
        secure: cookieSecure(req),
        sameSite: 'lax',
        path: COOKIE_PATH,
        maxAge: MAX_AGE_MS
    };
}

function setRememberCookie(res, req, adminId, secretEnc) {
    const stamp = secretStamp(secretEnc);
    if (!stamp) return false;
    const value = signPayload({
        u: Number(adminId),
        e: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
        h: stamp
    });
    if (!value) return false;
    res.cookie(COOKIE_NAME, value, cookieOptions(req));
    return true;
}

function clearRememberCookie(res, req) {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: cookieSecure(req),
        sameSite: 'lax',
        path: COOKIE_PATH
    });
}

function rememberChoice(body) {
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'rememberBrowser')) return null;
    const value = body.rememberBrowser;
    return value === true || value === 'true' || value === 1 || value === '1';
}

async function loadEnrolledSecret(pool, adminId) {
    const [rows] = await pool.execute(
        'SELECT secret_enc, enabled FROM admin_totp WHERE admin_user_id = ? LIMIT 1',
        [adminId]
    );
    const row = rows[0];
    if (!row || Number(row.enabled) !== 1 || !row.secret_enc) return null;
    return String(row.secret_enc);
}

async function rememberCookieAllowsSkip(req, pool, adminId) {
    try {
        const parsed = readSigned(readCookieHeader(req, COOKIE_NAME));
        if (!parsed || parsed.adminId !== Number(adminId)) return false;
        const secretEnc = await loadEnrolledSecret(pool, adminId);
        if (!secretEnc) return false;
        const expected = secretStamp(secretEnc);
        const givenBuf = Buffer.from(parsed.stamp);
        const expectedBuf = Buffer.from(expected);
        if (!expected || givenBuf.length !== expectedBuf.length) return false;
        return crypto.timingSafeEqual(givenBuf, expectedBuf);
    } catch (error) {
        logger.warn('Admin remember-browser check failed', { message: error.message });
        return false;
    }
}

async function applyRememberChoice(req, res, pool, adminId) {
    const choice = rememberChoice(req.body);
    if (choice == null) return;
    if (!choice) {
        clearRememberCookie(res, req);
        return;
    }
    try {
        const secretEnc = await loadEnrolledSecret(pool, adminId);
        if (!secretEnc) return;
        setRememberCookie(res, req, adminId, secretEnc);
    } catch (error) {
        logger.warn('Admin remember-browser cookie was not set', { message: error.message });
    }
}

async function finishPasswordOrGoogleLogin(req, pool, admin) {
    if (await rememberCookieAllowsSkip(req, pool, admin.id)) {
        return { remembered: true, session: await buildAdminAuthSuccess(pool, admin) };
    }
    const pending = await beginAdminTwoFactor(pool, admin.id);
    return { remembered: false, pending };
}

module.exports = {
    COOKIE_NAME,
    COOKIE_PATH,
    MAX_AGE_MS,
    cookieOptions,
    setRememberCookie,
    clearRememberCookie,
    readSigned,
    signPayload,
    secretStamp,
    rememberCookieAllowsSkip,
    applyRememberChoice,
    finishPasswordOrGoogleLogin
};
