'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { resolveStoreProductSubscriptionsAccess } = require('../services/storeEcommerceTier');
const {
    listUserSubscriptions,
    cancelUserSubscription,
    ALLOWED_INTERVALS,
} = require('../services/storeSubscriptionService');
const { getAuthenticatedUserFromRequest } = require('../utils/orderAccess');
const { resolveStoreBranding, brandingForPublicApi } = require('../services/storeBranding');
const { getProgramSettings, listTiers } = require('../services/loyaltyTierProgram');
const { evaluateCustomerTier, nextTier, progressTowardTier } = require('../services/loyaltyTierEngine');
const { getLoyaltyBenefitsForUser } = require('../services/loyaltyCheckout');

/** Public — whether this store offers product subscriptions (ecommerce tier). */
router.get('/capabilities', async (req, res) => {
    try {
        const access = await resolveStoreProductSubscriptionsAccess(req.pool);
        res.json({
            productSubscriptions: Boolean(access.enabled),
            ecommerceStore: Boolean(access.enabled),
            abandonedCartEmails: Boolean(access.enabled),
            loyaltyProgram: Boolean(access.enabled),
            subscriptionIntervals: ALLOWED_INTERVALS,
            reason: access.reason,
        });
    } catch (e) {
        logger.error('Store capabilities error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/** Public — merchant branding for storefront marketing surfaces (promo bar, emails). */
router.get('/branding', async (req, res) => {
    try {
        const branding = await resolveStoreBranding(req.pool);
        res.json({ branding: brandingForPublicApi(branding) });
    } catch (e) {
        logger.error('Store branding error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/** Customer subscriptions list */
router.get('/subscriptions', async (req, res) => {
    try {
        const user = await getAuthenticatedUserFromRequest(req);
        if (!user) return res.status(401).json({ error: 'Sign in required' });

        const access = await resolveStoreProductSubscriptionsAccess(req.pool);
        if (!access.enabled) {
            return res.status(403).json({
                error: 'Subscriptions are not available on this store plan.',
                code: 'ECOMMERCE_TIER_REQUIRED',
            });
        }

        const subscriptions = await listUserSubscriptions(req.pool, user.id);
        res.json({ subscriptions });
    } catch (e) {
        logger.error('List subscriptions error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/** Cancel a subscription */
router.post('/subscriptions/:id/cancel', async (req, res) => {
    try {
        const user = await getAuthenticatedUserFromRequest(req);
        if (!user) return res.status(401).json({ error: 'Sign in required' });

        const subId = Number(req.params.id);
        if (!Number.isFinite(subId) || subId < 1) {
            return res.status(400).json({ error: 'Invalid subscription id' });
        }

        const access = await resolveStoreProductSubscriptionsAccess(req.pool);
        if (!access.enabled) {
            return res.status(403).json({
                error: 'Subscriptions are not available on this store plan.',
                code: 'ECOMMERCE_TIER_REQUIRED',
            });
        }

        const ok = await cancelUserSubscription(req.pool, user.id, subId);
        if (!ok) return res.status(404).json({ error: 'Subscription not found' });
        res.json({ ok: true });
    } catch (e) {
        logger.error('Cancel subscription error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/** Customer loyalty tier status (account page) */
router.get('/loyalty/me', async (req, res) => {
    try {
        const user = await getAuthenticatedUserFromRequest(req);
        if (!user) return res.status(401).json({ error: 'Sign in required' });

        const programSettings = await getProgramSettings(req.pool);
        if (!programSettings?.enabled) {
            return res.json({ enabled: false, loyalty: null });
        }

        const { tier, metrics } = await evaluateCustomerTier(req.pool, user.id);
        const tiers = await listTiers(req.pool, { activeOnly: true });
        const nxt = tier ? nextTier(tiers, tier.tierKey) : null;
        const progress = nxt && metrics ? progressTowardTier(metrics, nxt, programSettings.mode) : null;
        const benefits = await getLoyaltyBenefitsForUser(req.pool, user.id, 0);

        const [history] = await req.pool.execute(
            `SELECT from_tier, to_tier, reason, lifetime_spend, order_count, created_at
               FROM loyalty_tier_history
              WHERE user_id = ?
              ORDER BY created_at DESC
              LIMIT 10`,
            [user.id]
        );

        res.json({
            enabled: true,
            settings: {
                mode: programSettings.programMode ?? programSettings.mode,
                pointsPerDollar: programSettings.pointsPerDollar,
                dollarPerPoint: programSettings.dollarPerPoint,
            },
            loyalty: { tier, metrics, benefits, progress },
            tiers: tiers.map((t) => ({
                tierKey: t.tierKey,
                displayName: t.displayName,
                minLifetimeSpend: t.minLifetimeSpend,
                minOrderCount: t.minOrderCount,
                minPoints: t.minPoints,
                cashBackPercent: t.cashBackPercent,
                pointsMultiplierPercent: t.pointsMultiplierPercent,
                freeShipping: t.freeShipping,
            })),
            history,
        });
    } catch (e) {
        logger.error('Store loyalty/me error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/** Checkout loyalty tier benefits for signed-in customer */
router.get('/loyalty/checkout-benefits', async (req, res) => {
    try {
        const user = await getAuthenticatedUserFromRequest(req);
        if (!user) return res.status(401).json({ error: 'Sign in required' });

        const subtotal = Number(req.query.subtotal) || 0;
        const benefits = await getLoyaltyBenefitsForUser(req.pool, user.id, subtotal);
        res.json({ benefits });
    } catch (e) {
        logger.error('Store loyalty checkout-benefits error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
