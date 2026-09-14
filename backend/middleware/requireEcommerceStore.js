'use strict';

const { resolveEcommerceStoreAccess } = require('../services/storeEcommerceTier');

async function getEcommerceStoreAccess(pool) {
    return resolveEcommerceStoreAccess(pool);
}

async function isEcommerceStore(pool) {
    const access = await getEcommerceStoreAccess(pool);
    return Boolean(access.enabled);
}

/** Express middleware — 403 when store is not on an ecommerce website tier. */
async function requireEcommerceStoreAccess(req, res, next) {
    try {
        const access = await getEcommerceStoreAccess(req.pool);
        if (!access.enabled) {
            return res.status(403).json({
                error: 'This feature requires an ecommerce website build tier (Business One hosting enterprise or above).',
                code: 'ECOMMERCE_TIER_REQUIRED',
                access,
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
    'store_logo_url',
]);

function settingsPayloadTouchesMarketing(settings) {
    return (settings || []).some((row) => MARKETING_SETTINGS_KEYS.has(String(row?.key_name || '')));
}

module.exports = {
    getEcommerceStoreAccess,
    isEcommerceStore,
    requireEcommerceStoreAccess,
    MARKETING_SETTINGS_KEYS,
    settingsPayloadTouchesMarketing,
};
