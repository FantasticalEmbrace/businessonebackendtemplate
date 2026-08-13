'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const router = express.Router();
const logger = require('../utils/logger');
const { isPlatformBillingConfigured } = require('../utils/platformBillingEnv');
const { getPlatformBillingClientConfig } = require('../services/platformBillingClientConfig');
const { assertNoRawPaymentData } = require('../utils/paymentPayloadValidation');
const {
    ensureDefaultAccount,
    getAccountById,
    listSubscriptions,
    listHardwareCatalog,
    savePaymentMethod,
    upsertSubscription,
    updateAccount
} = require('../services/platformBillingAccount');
const {
    computeMonthlyTotal,
    chargeAccount,
    purchaseHardware,
    payPrincipalBuildBalance,
    waivePastDue,
    isBillingDryRun
} = require('../services/platformBillingRunner');
const {
    describeMonthlyPricing,
    HOSTING_TIERS_STANDARD,
    INTERNET_PLANS,
    HARDWARE_MIN_INSTALLMENT,
    HARDWARE_MAX_INSTALLMENT_MONTHS
} = require('../services/platformBillingPricing');
const { getPrincipalDashboard } = require('../services/principalBilling');
const { getBuildContract, refundBuildIfNoWorkStarted } = require('../services/websiteBuildBilling');
const { describeBillingCycle } = require('../services/platformBillingCalendar');
const { chargeOneTimeFromAccount } = require('../services/platformBillingRunner');
const {
    describeCustomPaymentInfo,
    chargeCustomPayment,
    verifyCustomPaymentLinkSignature
} = require('../services/customPayment');

const customPaymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false
});

async function assertBillingAuth(req) {
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
        if (!['admin', 'developer', 'super_admin'].includes(role)) return null;
        return { adminId: rows[0].id, role };
    } catch {
        return null;
    }
}

const setupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false
});

router.get('/client-config', async (_req, res) => {
    res.json(getPlatformBillingClientConfig());
});

router.get('/custom-payment/info', (_req, res) => {
    res.json(describeCustomPaymentInfo());
});

router.post('/custom-payment/charge', customPaymentLimiter, async (req, res) => {
    try {
        assertNoRawPaymentData(req.body);
        const linkCheck = verifyCustomPaymentLinkSignature({
            amount: req.body.amount,
            description: req.body.description,
            expiresAt: req.body.linkExpiresAt || req.body.link_expires_at,
            signature: req.body.linkSignature || req.body.link_signature
        });
        if (!linkCheck.ok) {
            return res.status(400).json({ error: linkCheck.reason, code: 'INVALID_PAYMENT_LINK' });
        }
        const result = await chargeCustomPayment(req.pool, req.body);
        res.status(201).json({ success: true, ...result });
    } catch (e) {
        const status =
            e.code === 'CUSTOM_PAYMENT_DISABLED' || e.code === 'BILLING_NOT_CONFIGURED'
                ? 503
                : e.code
                  ? 400
                  : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.get('/account', async (req, res) => {
    try {
        const auth = await assertBillingAuth(req);
        if (!auth) return res.status(401).json({ error: 'Admin login required' });
        const account = await ensureDefaultAccount(req.pool);
        const { refreshFailoverBillingForAccount } = require('../services/posFailoverMetering');
        const { getModemBillingStatus } = require('../services/billingPrerequisites');
        await refreshFailoverBillingForAccount(req.pool, account.id);
        const subscriptions = await listSubscriptions(req.pool, account.id);
        const statement = await computeMonthlyTotal(req.pool, account.id);
        const modemBilling = await getModemBillingStatus(req.pool, account.id, account);
        const buildContract = await getBuildContract(req.pool, account.id);
        const billingCycle = describeBillingCycle();
        res.json({ account, subscriptions, statement, modemBilling, buildContract, billingCycle });
    } catch (e) {
        logger.error('Platform billing account fetch', { err: e.message });
        res.status(500).json({ error: 'Failed to load billing account' });
    }
});

router.get('/principal', async (req, res) => {
    try {
        const auth = await assertBillingAuth(req);
        if (!auth) return res.status(401).json({ error: 'Admin login required' });
        const account = await ensureDefaultAccount(req.pool);
        const dashboard = await getPrincipalDashboard(req.pool, account);
        res.json({
            ...dashboard,
            billingDryRun: isBillingDryRun()
        });
    } catch (e) {
        const status = e.code === 'NOT_PRINCIPAL_ACCOUNT' ? 403 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.post('/principal/build-balance', setupLimiter, async (req, res) => {
    try {
        const auth = await assertBillingAuth(req);
        if (!auth) return res.status(401).json({ error: 'Admin login required' });
        const account = await ensureDefaultAccount(req.pool);
        assertNoRawPaymentData(req.body.card || {});

        const result = await payPrincipalBuildBalance(req.pool, account.id, {
            mode: req.body.mode === 'installment' ? 'installment' : 'full',
            installmentMonths: req.body.installmentMonths,
            cardPayload: req.body.card
        });
        const dashboard = await getPrincipalDashboard(req.pool, account.id);
        res.json({ result, ...dashboard });
    } catch (e) {
        const status = e.code === 'NOT_PRINCIPAL_ACCOUNT' ? 403 : e.code ? 400 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.get('/pricing/pos', (req, res) => {
    const stations = Math.max(1, Number(req.query.stations) || 1);
    res.json({ quote: describeMonthlyPricing(stations) });
});

router.get('/pricing/hosting', (_req, res) => {
    res.json({ tiers: HOSTING_TIERS_STANDARD });
});

router.get('/pricing/internet', (_req, res) => {
    res.json({ plans: INTERNET_PLANS });
});

router.get('/hardware', async (req, res) => {
    try {
        const catalog = await listHardwareCatalog(req.pool);
        res.json({
            catalog,
            installmentMin: HARDWARE_MIN_INSTALLMENT,
            maxInstallmentMonths: HARDWARE_MAX_INSTALLMENT_MONTHS
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load hardware catalog' });
    }
});

router.post('/setup', setupLimiter, async (req, res) => {
    try {
        const auth = await assertBillingAuth(req);
        const openDev =
            process.env.NODE_ENV !== 'production' &&
            (String(process.env.POS_BILLING_ALLOW_OPEN_SETUP || '').toLowerCase() === 'true' ||
                String(process.env.BILLING_PORTAL_ALLOW_OPEN_SETUP || '').toLowerCase() === 'true');
        if (!auth && !openDev) {
            return res.status(401).json({ error: 'Admin login required', code: 'ADMIN_AUTH_REQUIRED' });
        }
        if (!req.body?.authorized) {
            return res.status(400).json({ error: 'Authorization required', code: 'AUTHORIZATION_REQUIRED' });
        }

        assertNoRawPaymentData(req.body);

        const account = await ensureDefaultAccount(req.pool);
        const saved = await savePaymentMethod(req.pool, account.id, {
            paymentMethodType: req.body.paymentMethodType || 'card',
            paymentToken: req.body.payment_token || req.body.paymentToken,
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

        res.status(201).json({ success: true, account: saved });
    } catch (e) {
        const status = e.code === 'BILLING_NOT_CONFIGURED' ? 503 : e.code ? 400 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.put('/subscriptions/:productType', async (req, res) => {
    try {
        const auth = await assertBillingAuth(req);
        if (!auth) return res.status(401).json({ error: 'Admin login required' });
        const account = await ensureDefaultAccount(req.pool);
        const productType = String(req.params.productType || '').toLowerCase();
        if (!['pos', 'hosting', 'internet'].includes(productType)) {
            return res.status(400).json({ error: 'Invalid product type' });
        }
        await upsertSubscription(req.pool, account.id, productType, {
            status: req.body.status || 'active',
            config: req.body.config || {},
            monthlyAmountOverride:
                req.body.monthlyAmountOverride !== undefined
                    ? req.body.monthlyAmountOverride
                    : undefined
        });
        const subscriptions = await listSubscriptions(req.pool, account.id);
        const statement = await computeMonthlyTotal(req.pool, account.id);
        res.json({ subscriptions, statement });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/run-billing', async (req, res) => {
    try {
        const auth = await assertBillingAuth(req);
        if (!auth) return res.status(401).json({ error: 'Admin login required' });
        const account = await ensureDefaultAccount(req.pool);
        const result = await chargeAccount(req.pool, account.id, { reason: 'manual', force: true });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/waive-past-due', async (req, res) => {
    try {
        const auth = await assertBillingAuth(req);
        if (!auth) return res.status(401).json({ error: 'Admin login required' });
        const account = await ensureDefaultAccount(req.pool);
        const updated = await waivePastDue(req.pool, account.id, {
            note: req.body.note,
            notify: req.body.notify !== false
        });
        res.json({ account: updated });
    } catch (e) {
        res.status(400).json({ error: e.message, code: e.code });
    }
});

router.post('/hardware/purchase', setupLimiter, async (req, res) => {
    try {
        const auth = await assertBillingAuth(req);
        if (!auth) return res.status(401).json({ error: 'Admin login required' });
        const account = await ensureDefaultAccount(req.pool);
        assertNoRawPaymentData(req.body.card || {});

        const result = await purchaseHardware(req.pool, account.id, {
            sku: req.body.sku,
            quantity: req.body.quantity,
            installmentMonths: req.body.installmentMonths,
            cardPayload: req.body.card,
            shipTo: req.body.shipTo
        });
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message, code: e.code });
    }
});

router.post('/failover/ingest', async (req, res) => {
    try {
        const secret = String(process.env.BILLING_FAILOVER_INGEST_SECRET || '').trim();
        if (!secret) {
            if (process.env.NODE_ENV === 'production') {
                return res.status(503).json({ error: 'Failover ingest is not configured' });
            }
        } else {
            const incoming = String(req.headers['x-failover-ingest-secret'] || '').trim();
            if (incoming !== secret) {
                return res.status(401).json({ error: 'Invalid ingest secret' });
            }
        }
        const { recordFailoverUsage } = require('../services/posFailoverMetering');
        const bytesTotal = req.body?.bytesUsed ?? req.body?.bytes_total ?? req.body?.bytesTotal;
        const bytesDelta = req.body?.bytesDelta ?? req.body?.bytes_delta;
        const result = await recordFailoverUsage(req.pool, {
            accountId: req.body?.accountId ?? req.body?.account_id,
            accountKey: req.body?.accountKey ?? req.body?.account_key,
            bytesTotal,
            bytesDelta,
            source: req.body?.source || 'modem'
        });
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.post('/build/refund-before-kickoff', async (req, res) => {
    try {
        const auth = await assertBillingAuth(req);
        if (!auth) return res.status(401).json({ error: 'Admin login required' });
        const account = await ensureDefaultAccount(req.pool);
        const result = await refundBuildIfNoWorkStarted(req.pool, account.id, {
            note: req.body.note
        });
        const buildContract = await getBuildContract(req.pool, account.id);
        res.json({ result, buildContract });
    } catch (e) {
        res.status(400).json({ error: e.message, code: e.code });
    }
});

router.post('/build/charge-milestone', async (req, res) => {
    try {
        const auth = await assertBillingAuth(req);
        if (!auth) return res.status(401).json({ error: 'Admin login required' });
        const account = await ensureDefaultAccount(req.pool);
        const milestoneKey = String(req.body.milestoneKey || '').trim();
        const buildContract = await getBuildContract(req.pool, account.id);
        if (!buildContract) {
            return res.status(404).json({ error: 'No build contract', code: 'NO_BUILD_CONTRACT' });
        }
        const milestone = buildContract.milestones.find((m) => m.key === milestoneKey);
        if (!milestone) {
            return res.status(404).json({ error: 'Milestone not found', code: 'MILESTONE_NOT_FOUND' });
        }
        if (milestone.status !== 'pending') {
            return res.status(400).json({ error: 'Milestone already paid or completed', code: 'MILESTONE_NOT_PENDING' });
        }
        const order = ['deposit', 'design', 'development', 'launch'];
        const targetIdx = order.indexOf(milestoneKey);
        const priorUnpaid = buildContract.milestones.filter(
            (m) => order.indexOf(m.key) < targetIdx && m.status === 'pending'
        );
        if (priorUnpaid.length) {
            return res.status(400).json({
                error: `Pay prior milestones first: ${priorUnpaid.map((m) => m.label).join(', ')}`,
                code: 'MILESTONE_ORDER'
            });
        }
        const { markMilestonePaid } = require('../services/websiteBuildBilling');
        const charge = await chargeOneTimeFromAccount(req.pool, account.id, {
            amount: milestone.amount,
            chargeType: 'build_milestone',
            lineItems: [{ code: 'build_milestone', label: milestone.label, amount: milestone.amount }],
            description: `Website build — ${milestone.label}`,
            orderPrefix: 'BUILD'
        });
        if (charge.chargeId) {
            await markMilestonePaid(req.pool, buildContract.contract.id, milestoneKey, charge.chargeId);
        }
        const updated = await getBuildContract(req.pool, account.id);
        res.json({ charge, buildContract: updated });
    } catch (e) {
        res.status(400).json({ error: e.message, code: e.code });
    }
});

router.post('/webhook/procharge', async (req, res) => {
    try {
        const secret = String(process.env.PROCHARGE_WEBHOOK_SECRET || '').trim();
        if (!secret) {
            if (process.env.NODE_ENV === 'production') {
                return res.status(503).json({ error: 'Webhook secret is not configured' });
            }
        } else {
            const incoming = String(req.headers['x-procharge-webhook-secret'] || '').trim();
            if (incoming !== secret) return res.status(401).json({ error: 'Invalid webhook secret' });
        }
        const eventType = String(req.body?.event_type || req.body?.type || 'unknown').toLowerCase();
        if (/ach|return|chargeback|void|decline|failed/.test(eventType)) {
            const { markPastDueFromWebhook } = require('../services/posMerchantLicense');
            const license = await markPastDueFromWebhook(req.pool, {
                reason: eventType,
                transactionId: req.body?.transaction_id || req.body?.transactionid
            });
            return res.json({ received: true, handled: true, licenseStatus: license.status });
        }
        res.json({ received: true, handled: false, eventType });
    } catch (e) {
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

module.exports = router;
