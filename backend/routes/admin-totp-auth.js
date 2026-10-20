'use strict';

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { buildAdminAuthSuccess } = require('../services/adminSession');
const { applyRememberChoice } = require('../services/adminRememberBrowser');
const {
    setupAdminTwoFactor,
    confirmAdminTwoFactor,
    verifyAdminTwoFactor
} = require('../services/adminTotp');

function adminTwoFactorLimiter() {
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max: process.env.NODE_ENV === 'production' ? 20 : 10000,
        skipSuccessfulRequests: true,
        validate: { trustProxy: true },
        standardHeaders: true,
        legacyHeaders: false,
        skip: () => process.env.NODE_ENV !== 'production',
        message: {
            error: 'Too many incorrect codes. Wait 15 minutes, then try again.',
            code: 'TWO_FACTOR_LOCKED'
        }
    });
}

function sendTotpError(res, error) {
    const status = Number(error.status) || 500;
    if (status >= 500) {
        logger.error('Admin 2FA error', { message: error.message, code: error.code });
    }
    return res.status(status).json({
        error: status >= 500 ? 'Two-factor authentication is unavailable. Try again shortly.' : error.message,
        code: error.code || 'TWO_FACTOR_ERROR'
    });
}

function registerAdminTotpRoutes(router) {
    const limiter = adminTwoFactorLimiter();

    router.post('/auth/2fa/setup', limiter, async (req, res) => {
        try {
            if (!req.pool) return res.status(500).json({ error: 'Database connection not available.' });
            const result = await setupAdminTwoFactor(req.pool, req.body?.challengeToken);
            res.json(result);
        } catch (error) {
            sendTotpError(res, error);
        }
    });

    router.post('/auth/2fa/confirm', limiter, async (req, res) => {
        try {
            if (!req.pool) return res.status(500).json({ error: 'Database connection not available.' });
            const result = await confirmAdminTwoFactor(req.pool, req.body?.challengeToken, req.body?.code);
            const session = await buildAdminAuthSuccess(req.pool, result.admin);
            res.json({
                ...session,
                message: 'Two-factor authentication is on. Save your backup codes.',
                backupCodes: result.backupCodes
            });
        } catch (error) {
            sendTotpError(res, error);
        }
    });

    router.post('/auth/2fa/verify', limiter, async (req, res) => {
        try {
            if (!req.pool) return res.status(500).json({ error: 'Database connection not available.' });
            const admin = await verifyAdminTwoFactor(req.pool, req.body?.challengeToken, req.body?.code);
            await applyRememberChoice(req, res, req.pool, admin.id);
            const session = await buildAdminAuthSuccess(req.pool, admin);
            res.json(session);
        } catch (error) {
            sendTotpError(res, error);
        }
    });
}

module.exports = { registerAdminTotpRoutes };
