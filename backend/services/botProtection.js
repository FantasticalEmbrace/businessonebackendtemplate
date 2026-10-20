'use strict';

/**
 * Cloudflare Turnstile verification + honeypot helpers for checkout / register.
 * When TURNSTILE_SECRET_KEY is unset, captcha is not required (rate limits still apply).
 * Site key is public; secret must never leave the server.
 */

const logger = require('../utils/logger');
const { getRequestClientIp } = require('../utils/clientIp');

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

let missingKeysWarned = false;

function getTurnstileSiteKey() {
    return String(process.env.TURNSTILE_SITE_KEY || '').trim();
}

function getTurnstileSecretKey() {
    return String(process.env.TURNSTILE_SECRET_KEY || '').trim();
}

/** True when server can and should require a Turnstile token. */
function isCaptchaRequired() {
    return Boolean(getTurnstileSecretKey());
}

function getPublicCaptchaConfig() {
    const siteKey = getTurnstileSiteKey();
    const required = isCaptchaRequired();
    return {
        provider: 'turnstile',
        captchaRequired: required,
        turnstileSiteKey: required && siteKey ? siteKey : '',
        // Client should still render honeypot always
        honeypotEnabled: true
    };
}

/** Log once at startup / first use when production has no Turnstile secret. */
function warnIfCaptchaNotConfigured() {
    if (missingKeysWarned) return;
    if (isCaptchaRequired()) return;
    missingKeysWarned = true;
    const msg =
        'BOT PROTECTION: TURNSTILE_SECRET_KEY is not set — checkout captcha is DISABLED. ' +
        'Set TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY in backend/.env and restart PM2. ' +
        'IP rate limits + honeypot still apply.';
    if (process.env.NODE_ENV === 'production') {
        console.error(msg);
        logger.error(msg);
    } else {
        console.warn(msg);
        logger.warn(msg);
    }
}

function extractCaptchaToken(body) {
    const b = body && typeof body === 'object' ? body : {};
    return String(
        b.captchaToken ||
            b.turnstileToken ||
            b['cf-turnstile-response'] ||
            b.cf_turnstile_response ||
            ''
    ).trim();
}

/**
 * Honeypot fields bots often autofill. Humans never see these.
 * Non-empty => reject.
 */
function isHoneypotTriggered(body) {
    const b = body && typeof body === 'object' ? body : {};
    const fields = [
        b.company_website,
        b.companyWebsite,
        b.website_url,
        b.websiteUrl,
        b.honeypot,
        b.hp_field
    ];
    return fields.some((v) => String(v || '').trim().length > 0);
}

/**
 * Verify Turnstile token with Cloudflare.
 * @returns {{ ok: true } | { ok: false, status: number, error: string, code: string }}
 */
async function verifyTurnstileToken(token, remoteip) {
    const secret = getTurnstileSecretKey();
    if (!secret) {
        warnIfCaptchaNotConfigured();
        return { ok: true, skipped: true };
    }
    if (!token) {
        return {
            ok: false,
            status: 400,
            error: 'Please complete the security check and try again.',
            code: 'CAPTCHA_REQUIRED'
        };
    }

    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    if (remoteip) form.set('remoteip', String(remoteip));

    let data = null;
    try {
        const res = await fetch(TURNSTILE_VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
            signal: AbortSignal.timeout(8000)
        });
        data = await res.json().catch(() => null);
    } catch (err) {
        logger.error('Turnstile siteverify request failed', { err: err && err.message });
        return {
            ok: false,
            status: 503,
            error: 'Security check temporarily unavailable. Please try again.',
            code: 'CAPTCHA_UNAVAILABLE'
        };
    }

    if (data && data.success === true) {
        return { ok: true };
    }

    logger.warn('Turnstile verification failed', {
        'error-codes': data && data['error-codes'],
        hostname: data && data.hostname
    });
    return {
        ok: false,
        status: 400,
        error: 'Security check failed. Please refresh and try again.',
        code: 'CAPTCHA_INVALID'
    };
}

/**
 * Combined honeypot + Turnstile gate for checkout / register bodies.
 */
async function assertBotProtection(req) {
    if (isHoneypotTriggered(req.body)) {
        logger.warn('Checkout honeypot triggered', { ip: getRequestClientIp(req) });
        return {
            ok: false,
            status: 400,
            error: 'Unable to place order.',
            code: 'BOT_REJECTED'
        };
    }
    const token = extractCaptchaToken(req.body);
    return verifyTurnstileToken(token, getRequestClientIp(req));
}

module.exports = {
    getTurnstileSiteKey,
    getTurnstileSecretKey,
    isCaptchaRequired,
    getPublicCaptchaConfig,
    warnIfCaptchaNotConfigured,
    extractCaptchaToken,
    isHoneypotTriggered,
    verifyTurnstileToken,
    assertBotProtection
};
