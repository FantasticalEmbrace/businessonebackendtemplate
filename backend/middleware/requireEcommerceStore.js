'use strict';

const {
    resolveEcommerceAutomationAccess,
    resolveOnlineShopAccess
} = require('../services/storeEcommerceTier');

async function getEcommerceStoreAccess(pool, options = {}) {
    return resolveEcommerceAutomationAccess(pool, options);
}

async function getOnlineShopAccess(pool, options = {}) {
    return resolveOnlineShopAccess(pool, options);
}

async function isEcommerceStore(pool, options = {}) {
    const access = await getEcommerceStoreAccess(pool, options);
    return Boolean(access.enabled);
}

async function isOnlineShop(pool, options = {}) {
    const access = await getOnlineShopAccess(pool, options);
    return Boolean(access.enabled);
}

/** Express middleware — 403 unless Growth+ online shop package. */
async function requireOnlineShopAccess(req, res, next) {
    try {
        const access = await getOnlineShopAccess(req.pool, {
            merchantId: req.merchantId || null
        });
        if (!access.enabled) {
            return res.status(403).json({
                error: 'This feature requires a Growth website package or above (online shop).',
                code: 'ONLINE_SHOP_REQUIRED',
                access
            });
        }
        req.onlineShopAccess = access;
        return next();
    } catch (err) {
        return res.status(500).json({ error: 'Could not verify store plan' });
    }
}

/** Express middleware — 403 unless ecommerce automation tier (Enterprise / ecommerce build). */
async function requireEcommerceStoreAccess(req, res, next) {
    try {
        const access = await getEcommerceStoreAccess(req.pool, {
            merchantId: req.merchantId || null
        });
        if (!access.enabled) {
            return res.status(403).json({
                error: 'This feature requires an ecommerce website build tier (Business One hosting enterprise or above).',
                code: 'ECOMMERCE_TIER_REQUIRED',
                access
            });
        }
        req.ecommerceAccess = access;
        return next();
    } catch (err) {
        return res.status(500).json({ error: 'Could not verify store plan' });
    }
}

const MARKETING_SETTINGS_KEYS = new Set([
    'store_promo_banner',
    'store_brand_primary',
    'store_brand_primary_dark',
    'store_brand_accent',
    'store_logo_url'
]);

function settingsPayloadTouchesMarketing(settings) {
    return (settings || []).some((row) => MARKETING_SETTINGS_KEYS.has(String(row?.key_name || '')));
}

module.exports = {
    getEcommerceStoreAccess,
    getOnlineShopAccess,
    isEcommerceStore,
    isOnlineShop,
    requireOnlineShopAccess,
    requireEcommerceStoreAccess,
    MARKETING_SETTINGS_KEYS,
    settingsPayloadTouchesMarketing
};
