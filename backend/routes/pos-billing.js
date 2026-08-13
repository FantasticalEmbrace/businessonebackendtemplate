'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const router = express.Router();
const logger = require('../utils/logger');
const { isPlatformBillingConfigured } = require('../utils/platformBillingEnv');
const { isProchargeSandbox } = require('../utils/prochargeEnv');
const { saveBillingVault, loadMerchantLicense } = require('../services/posMerchantLicense');

function isOpenBillingSetupAllowed() {
    return (
        process.env.NODE_ENV !== 'production' &&
        String(process.env.POS_BILLING_ALLOW_OPEN_SETUP || '').toLowerCase() === 'true'
    );
}

async function assertBillingSetupAuthorized(req) {
    if (isOpenBillingSetupAllowed()) return { type: 'dev_open' };

    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!bearer || !process.env.JWT_SECRET) return null;

    try {
        const decoded = jwt.verify(bearer, process.env.JWT_SECRET);
        const [rows] = await req.pool.execute(
            'SELECT id, role FROM admin_users WHERE id = ? AND is_active = 1',
            [decoded.adminId]
        );
        if (!rows.length) return null;
        const role = String(rows[0].role || '').toLowerCase();
        if (!['admin', 'developer', 'super_admin'].includes(role)) {
            return null;
        }
        return { type: 'admin', adminId: rows[0].id, role };
    } catch {
        return null;
    }
}

const setupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many billing setup attempts. Please try again later.', code: 'RATE_LIMITED' }
});

/** ProCharge billing config for admin POS license tab */
router.get('/client-config', async (_req, res) => {
    const configured = isPlatformBillingConfigured();
    return res.json({
        enabled: configured,
        configured,
        processor: 'procharge',
        sandbox: isProchargeSandbox(),
        achEnabled: true,
        cardFields: true,
        requiresSetupAuth: !isOpenBillingSetupAllowed(),
        setupHint: 'Save payment in Admin → Point of Sale → License (Admin or Developer login required).',
        message: configured
            ? 'Enter card details below — processed securely by ProCharge (EPI).'
            : 'ProCharge platform billing keys are not configured on the server yet.'
    });
});

router.post('/setup', setupLimiter, async (req, res) => {
    try {
        const auth = await assertBillingSetupAuthorized(req);
        if (!auth) {
            return res.status(401).json({
                error: 'Admin login is required to save billing.',
                code: 'ADMIN_AUTH_REQUIRED'
            });
        }

        if (!req.body?.authorized) {
            return res.status(400).json({
                error: 'You must authorize recurring monthly charges.',
                code: 'AUTHORIZATION_REQUIRED'
            });
        }

        const result = await saveBillingVault(req.pool, {
            paymentToken: req.body.payment_token,
            paymentMethodType: req.body.paymentMethodType || 'card',
            cardNumber: req.body.cardNumber,
            ccExpMonth: req.body.ccExpMonth,
            ccExpYear: req.body.ccExpYear,
            cvv: req.body.cvv,
            cardholderName: req.body.cardholderName,
            postalCode: req.body.postalCode,
            street1: req.body.street1,
            billingEmail: req.body.billingEmail || req.body.billing_email,
            businessName: req.body.businessName || req.body.business_name,
            bankAccount: req.body.bankAccount
        });

        if (req.body.licensedStationCount != null) {
            const { updateMerchantLicense } = require('../services/posMerchantLicense');
            await updateMerchantLicense(req.pool, {
                licensedStationCount: req.body.licensedStationCount,
                status: 'active'
            });
        }

        res.status(201).json({
            success: true,
            license: await loadMerchantLicense(req.pool)
        });
    } catch (e) {
        const status = e.code === 'BILLING_NOT_CONFIGURED' ? 503 : e.code ? 400 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

/** ProCharge webhook — ACH returns, chargebacks, declines */
router.post('/webhook/epi', async (req, res) => {
    try {
        const secret = String(
            process.env.PROCHARGE_WEBHOOK_SECRET || process.env.EPI_PLATFORM_WEBHOOK_SECRET || ''
        ).trim();
        if (secret) {
            const incoming = String(
                req.headers['x-procharge-webhook-secret'] ||
                    req.headers['x-epi-webhook-secret'] ||
                    ''
            ).trim();
            if (incoming !== secret) {
                return res.status(401).json({ error: 'Invalid webhook secret' });
            }
        } else if (process.env.NODE_ENV === 'production') {
            return res.status(503).json({ error: 'Webhook secret is not configured' });
        }

        const eventType = String(req.body?.event_type || req.body?.type || req.body?.event || 'unknown').toLowerCase();
        if (/ach|return|chargeback|void|decline|failed/.test(eventType)) {
            const { markPastDueFromWebhook } = require('../services/posMerchantLicense');
            const license = await markPastDueFromWebhook(req.pool, {
                reason: eventType,
                transactionId: req.body?.transaction_id || req.body?.transactionid || req.body?.id
            });
            return res.json({ received: true, handled: true, licenseStatus: license.status });
        }

        res.json({ received: true, handled: false, eventType });
    } catch (e) {
        logger.error('Platform billing webhook error', { err: e.message });
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

module.exports = router;
