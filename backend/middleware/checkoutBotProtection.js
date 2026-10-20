'use strict';

const rateLimit = require('express-rate-limit');
const { getRequestClientIp } = require('../utils/clientIp');
const botProtection = require('../services/botProtection');

function parsePositiveInt(raw, fallback) {
    const n = parseInt(String(raw || ''), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Card-testing scammer pattern (Sep 2026): one VPN IP created ~7 unpaid drafts
 * and ~12 process-payment attempts (402 declines) in a short window.
 * Limits are tight enough to stop that burst; legitimate retries still fit.
 */
function createCheckoutOrderLimiter() {
    const max = parsePositiveInt(process.env.CHECKOUT_ORDER_RATE_LIMIT_MAX, 6);
    return rateLimit({
        windowMs: 60 * 60 * 1000,
        max,
        validate: { trustProxy: true },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => getRequestClientIp(req) || req.ip || 'unknown',
        message: {
            error: 'Too many order attempts from this connection. Please wait and try again.',
            code: 'CHECKOUT_ORDER_RATE_LIMIT',
            retryAfter: '1 hour'
        }
    });
}

function createCheckoutPaymentLimiter() {
    const max = parsePositiveInt(process.env.CHECKOUT_PAYMENT_RATE_LIMIT_MAX, 8);
    return rateLimit({
        windowMs: 60 * 60 * 1000,
        max,
        validate: { trustProxy: true },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => getRequestClientIp(req) || req.ip || 'unknown',
        message: {
            error: 'Too many payment attempts from this connection. Please wait and try again.',
            code: 'CHECKOUT_PAYMENT_RATE_LIMIT',
            retryAfter: '1 hour'
        }
    });
}

/**
 * Express middleware: honeypot + Turnstile (required only when secret is configured).
 */
async function requireBotProtection(req, res, next) {
    try {
        const result = await botProtection.assertBotProtection(req);
        if (!result.ok) {
            return res.status(result.status || 400).json({
                error: result.error || 'Unable to continue.',
                code: result.code || 'BOT_REJECTED'
            });
        }
        return next();
    } catch (err) {
        return next(err);
    }
}

/**
 * Order create: always honeypot. Turnstile is required unless this is a card draft
 * that will be charged next (awaitingNmiPayment / awaitingMxPayment) — Turnstile
 * tokens are single-use, so the charge endpoint consumes the token instead.
 */
async function requireOrderBotProtection(req, res, next) {
    try {
        if (botProtection.isHoneypotTriggered(req.body)) {
            return res.status(400).json({
                error: 'Unable to place order.',
                code: 'BOT_REJECTED'
            });
        }
        const deferCaptcha = Boolean(
            req.body?.awaitingNmiPayment || req.body?.awaitingMxPayment
        );
        if (deferCaptcha) {
            return next();
        }
        const result = await botProtection.assertBotProtection(req);
        if (!result.ok) {
            return res.status(result.status || 400).json({
                error: result.error || 'Unable to continue.',
                code: result.code || 'BOT_REJECTED'
            });
        }
        return next();
    } catch (err) {
        return next(err);
    }
}

module.exports = {
    createCheckoutOrderLimiter,
    createCheckoutPaymentLimiter,
    requireBotProtection,
    requireOrderBotProtection
};
