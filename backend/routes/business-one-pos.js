'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const logger = require('../utils/logger');
const { isPlatformBillingConfigured } = require('../utils/platformBillingEnv');
const { getPlatformBillingClientConfig } = require('../services/platformBillingClientConfig');
const { assertNoRawPaymentData } = require('../utils/paymentPayloadValidation');
const { describeMonthlyPricing, computeHardwareCheckout, hardwareSalesTaxRate, hostingMonthlyAmount } = require('../services/platformBillingPricing');
const { computeProration, describeBillingCycle } = require('../services/platformBillingCalendar');
const {
    describeBuildFromHosting,
    normalizeBuildPayMode,
    computeBuildRemainderFinance,
    ONE_TIME_FINANCE_MONTHS
} = require('../services/websiteBuildBilling');
const { saveBillingVault, updateMerchantLicense } = require('../services/posMerchantLicense');
const {
    upsertSubscription,
    ensureAccountForSignup,
    listHardwareCatalog
} = require('../services/platformBillingAccount');
const { purchaseHardware, chargeSignupMonthlyAndBuild } = require('../services/platformBillingRunner');
const { compensateSignupBilling } = require('../services/prochargeRefunds');

function isSignupEnabled() {
    return String(process.env.BUSINESS_ONE_POS_SIGNUP_ENABLED || 'false').toLowerCase() === 'true';
}

const signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false
});

router.get('/info', (_req, res) => {
    res.json({
        enabled: isSignupEnabled(),
        configured: isPlatformBillingConfigured(),
        processor: 'procharge'
    });
});

router.get('/client-config', (_req, res) => {
    res.json(
        getPlatformBillingClientConfig({
            signupEnabled: isSignupEnabled()
        })
    );
});

router.get('/pricing', (req, res) => {
    const stations = Math.max(1, Number(req.query.stations) || 1);
    const quote = describeMonthlyPricing(stations);
    const hostingTier = req.query.hostingTier ? String(req.query.hostingTier).trim() : null;
    const includeHosting = req.query.includeHosting === '1' || req.query.includeHosting === 'true';

    const buildPayMode = normalizeBuildPayMode(req.query.buildPayMode);
    let hostingQuote = null;
    let buildQuote = null;
    let buildFinance = null;
    let subscriptionMonthly = quote.monthlyAmount;
    let financeMonthly = 0;

    if (includeHosting && hostingTier) {
        const hostingAmount = hostingMonthlyAmount(hostingTier);
        hostingQuote = {
            tier: hostingTier,
            monthlyAmount: hostingAmount,
            formatted: `$${hostingAmount.toFixed(2)}/mo`
        };
        buildQuote = describeBuildFromHosting(hostingTier);
        subscriptionMonthly = Math.round((quote.monthlyAmount + hostingAmount) * 100) / 100;
        buildFinance = computeBuildRemainderFinance(
            buildQuote.buildAmount,
            buildPayMode,
            ONE_TIME_FINANCE_MONTHS
        );
        financeMonthly = Number(buildFinance.monthlyAmount) || 0;
    }

    financeMonthly = Math.round(financeMonthly * 100) / 100;
    const combinedMonthly = Math.round((subscriptionMonthly + financeMonthly) * 100) / 100;
    // Prorate subscription only; financed build balance starts on the 1st.
    const proration = computeProration(subscriptionMonthly);
    const billingCycle = describeBillingCycle();

    res.json({
        quote,
        failover: quote.failover,
        hosting: hostingQuote,
        build: buildQuote,
        buildPayMode: includeHosting ? buildPayMode : null,
        buildFinance,
        financeMonthly,
        subscriptionMonthly,
        combinedMonthly,
        proration,
        billingCycle
    });
});

router.get('/hardware', async (req, res) => {
    try {
        const catalog = await listHardwareCatalog(req.pool, { signupOnly: true });
        const taxRate = hardwareSalesTaxRate();
        res.json({
            catalog: catalog.map((item) => ({
                ...item,
                ...computeHardwareCheckout(item.price)
            })),
            taxRate,
            requiredWithPos: true
        });
    } catch (e) {
        logger.error('[business-one-pos] hardware catalog', { err: e.message });
        res.status(500).json({ error: 'Failed to load hardware catalog' });
    }
});

function validateHardwareShipTo(shipTo) {
    const street = String(shipTo?.street1 || shipTo?.street || '').trim();
    const city = String(shipTo?.city || '').trim();
    const state = String(shipTo?.state || '').trim();
    const postalCode = String(shipTo?.postalCode || shipTo?.zip || '').trim();
    if (!street || !city || !state || !postalCode) {
        return null;
    }
    return {
        name: String(shipTo?.name || shipTo?.shipName || '').trim(),
        street1: street,
        city,
        state,
        postalCode
    };
}

router.post('/signup', signupLimiter, async (req, res) => {
    let account = null;
    let signupBilling = null;
    try {
        if (!isSignupEnabled()) {
            return res.status(503).json({
                error: 'Online signup is not open yet. Call (850) 290-2084.',
                code: 'SIGNUP_DISABLED'
            });
        }
        if (!req.body?.authorized) {
            return res.status(400).json({ error: 'Authorization required', code: 'AUTHORIZATION_REQUIRED' });
        }

        assertNoRawPaymentData(req.body);

        const businessName = String(req.body.businessName || '').trim();
        const billingEmail = String(req.body.billingEmail || '').trim();
        const licensedStationCount = Math.max(1, Number(req.body.licensedStationCount) || 1);
        const hardware = req.body.hardware || {};
        const hardwareSku = String(hardware.sku || '').trim();
        const hardwareQty = Math.max(1, Math.min(10, Number(hardware.quantity) || 1));

        if (!businessName || !billingEmail) {
            return res.status(400).json({ error: 'Business name and billing email are required.' });
        }

        if (!hardwareSku) {
            return res.status(400).json({
                error: 'Choose a setup modem — one is included with every POS signup.',
                code: 'ROUTER_REQUIRED'
            });
        }

        const shipTo = validateHardwareShipTo(hardware.shipTo || {});
        if (!shipTo) {
            return res.status(400).json({
                error: 'Shipping address is required for your setup modem.',
                code: 'SHIPPING_REQUIRED'
            });
        }

        const isAch = req.body.paymentMethodType === 'ach';
        const cardPayload = isAch
            ? null
            : {
                  cardNumber: req.body.cardNumber,
                  ccExpMonth: req.body.ccExpMonth,
                  ccExpYear: req.body.ccExpYear,
                  cvv: req.body.cvv,
                  cardholderName: req.body.cardholderName || businessName,
                  postalCode: req.body.postalCode
              };

        account = await ensureAccountForSignup(req.pool, { businessName, billingEmail });

        await saveBillingVault(req.pool, {
            accountId: account.id,
            paymentMethodType: req.body.paymentMethodType || 'card',
            paymentToken: req.body.payment_token || req.body.paymentToken,
            cardNumber: req.body.cardNumber,
            ccExpMonth: req.body.ccExpMonth,
            ccExpYear: req.body.ccExpYear,
            cvv: req.body.cvv,
            cardholderName: req.body.cardholderName || businessName,
            postalCode: req.body.postalCode,
            street1: req.body.street1,
            billingEmail,
            businessName,
            bankAccount: req.body.bankAccount
        });

        await updateMerchantLicense(req.pool, {
            businessName,
            billingEmail,
            licensedStationCount,
            status: 'active'
        });

        await upsertSubscription(req.pool, account.id, 'pos', {
            status: 'active',
            config: {
                stationCount: licensedStationCount,
                licensedStationCount
            }
        });

        if (req.body.hostingTier) {
            await upsertSubscription(req.pool, account.id, 'hosting', {
                status: 'active',
                config: {
                    tier: req.body.hostingTier
                }
            });
        }

        const includeBuild = Boolean(req.body.hostingTier);
        const buildPayMode = includeBuild ? normalizeBuildPayMode(req.body.buildPayMode) : 'deposit';
        signupBilling = await chargeSignupMonthlyAndBuild(req.pool, account.id, {
            licensedStationCount,
            hostingTier: req.body.hostingTier || null,
            includeBuild,
            buildPayMode: includeBuild ? buildPayMode : 'deposit',
            signupDate: new Date()
        });

        let hardwareResult = null;
        try {
            hardwareResult = await purchaseHardware(req.pool, account.id, {
                sku: hardwareSku,
                quantity: hardwareQty,
                installmentMonths: 0,
                shipTo,
                cardPayload
            });
        } catch (hardwareErr) {
            try {
                const rollback = await compensateSignupBilling(req.pool, account.id, signupBilling, {
                    reason: `Hardware charge failed: ${hardwareErr.message}`
                });
                logger.warn('[business-one-pos] signup rolled back after hardware failure', {
                    accountId: account.id,
                    rollback
                });
            } catch (rollbackErr) {
                logger.error('[business-one-pos] signup rollback failed', {
                    accountId: account.id,
                    message: rollbackErr.message
                });
            }
            throw hardwareErr;
        }

        logger.info('[business-one-pos] New signup', {
            businessName,
            billingEmail,
            licensedStationCount,
            hardwareSku: hardwareSku || null,
            accountId: account.id,
            nextBillDate: signupBilling?.nextBillDate || null
        });

        const hardwareMsg = hardwareResult?.total
            ? ` Your setup modem was charged $${Number(hardwareResult.total).toFixed(2)} (includes sales tax) — we will program and ship it shortly.`
            : '';

        const prorationMsg = signupBilling?.proration?.proratedAmount
            ? ` Prorated subscription $${signupBilling.proration.proratedAmount.toFixed(2)} through month-end; full billing begins ${signupBilling.nextBillDate}.`
            : signupBilling?.nextBillDate
              ? ` Monthly billing begins ${signupBilling.nextBillDate}.`
              : '';

        const buildCharge = signupBilling?.charges?.find(
            (c) => c.type === 'build_deposit' || c.type === 'build_full' || c.type === 'build_prepay'
        );
        const buildMsg = includeBuild && buildCharge?.amount
            ? buildCharge.type === 'build_full'
                ? ` Website build paid in full at signup — no milestone charges later.`
                : buildCharge.payPct && buildCharge.payPct > 25
                  ? ` Website build ${buildCharge.payPct}% charged upfront — remaining milestones billed as work progresses.`
                  : ` Website build deposit charged — remaining milestones billed as work progresses.`
            : '';

        res.status(201).json({
            success: true,
            message: `Welcome to Business One! We will email your store access shortly.${hardwareMsg}${prorationMsg}${buildMsg}`,
            hardware: hardwareResult,
            signupBilling
        });
    } catch (e) {
        const status = e.code === 'BILLING_NOT_CONFIGURED' ? 503 : e.code ? 400 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

module.exports = router;
