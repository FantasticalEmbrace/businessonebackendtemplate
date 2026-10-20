'use strict';

/**
 * Website package gates:
 * - Online shop (Growth+): cart/checkout shop tools — loyalty admin, gift cards, accounts, etc.
 * - Ecommerce automation (Enterprise / ecommerce build): subscriptions, abandoned cart, heavy marketing automation.
 */

const { ensureDefaultAccount, listSubscriptions } = require('./platformBillingAccount');
const { isPrincipalAccountKey } = require('./principalBilling');
const { buildTierFromHosting } = require('./websiteBuildBilling');
const { normalizeHostingTier } = require('./platformBillingPricing');
const {
    normalizeBuildTier,
    tierAtLeast,
    loadMerchantShopConfig
} = require('./merchantEntitlements');

const ACTIVE_SUB_STATUSES = new Set(['active', 'trial', 'past_due']);

/**
 * Resolve hosting/build tier from billing subscription and optional merchant shop_config.
 * When merchantId is set (shared tenancy), shop_config from signup is the source of truth —
 * do not treat the platform principal billing account as that merchant's package.
 */
async function resolveWebsiteBuildContext(pool, { merchantId = null } = {}) {
    if (merchantId) {
        const cfg = await loadMerchantShopConfig(pool, merchantId);
        if (cfg && typeof cfg === 'object') {
            const rawCfgHosting = String(cfg.hostingTier || '').trim();
            const cfgHosting = rawCfgHosting ? normalizeHostingTier(rawCfgHosting) : '';
            const cfgBuild =
                normalizeBuildTier(cfg.buildTier) ||
                (cfgHosting ? buildTierFromHosting(cfgHosting) : '') ||
                '';
            if (cfgBuild || cfgHosting) {
                return {
                    accountKey: null,
                    hostingTier: cfgHosting || '',
                    buildTier: normalizeBuildTier(cfgBuild) || '',
                    principal: false,
                    source: 'shop_config'
                };
            }
        }
    }

    const account = await ensureDefaultAccount(pool);
    if (!account) {
        return {
            accountKey: null,
            hostingTier: '',
            buildTier: '',
            principal: false,
            source: 'none'
        };
    }

    // Only the unscoped / default store uses principal billing as full ecommerce.
    if (!merchantId && isPrincipalAccountKey(account.accountKey)) {
        return {
            accountKey: account.accountKey,
            hostingTier: 'enterprise',
            buildTier: 'ecommerce',
            principal: true,
            source: 'principal'
        };
    }

    const subs = await listSubscriptions(pool, account.id);
    const hosting = subs.find(
        (s) => s.productType === 'hosting' && ACTIVE_SUB_STATUSES.has(String(s.status || '').toLowerCase())
    );
    const rawHosting = hosting?.config?.tier;
    const hostingTier = rawHosting ? normalizeHostingTier(rawHosting) : '';
    const buildTier = hostingTier ? buildTierFromHosting(hostingTier) || '' : '';

    return {
        accountKey: account.accountKey,
        hostingTier: hostingTier || '',
        buildTier: normalizeBuildTier(buildTier) || '',
        principal: false,
        source: 'billing_subscription'
    };
}

/** Growth+ — real online shop (loyalty, gift cards, accounts, variants, search). */
async function resolveOnlineShopAccess(pool, options = {}) {
    const ctx = await resolveWebsiteBuildContext(pool, options);
    if (ctx.principal) {
        return {
            enabled: true,
            reason: 'principal_online_shop',
            ...ctx
        };
    }
    if (tierAtLeast(ctx.buildTier, 'growth')) {
        return {
            enabled: true,
            reason: 'hosting_growth_or_above',
            ...ctx
        };
    }
    return {
        enabled: false,
        reason: 'hosting_tier_below_growth',
        ...ctx
    };
}

/**
 * Ecommerce automation only — product subscriptions, abandoned cart, advanced marketing automation.
 * Requires enterprise hosting / ecommerce build (or principal).
 */
async function resolveEcommerceAutomationAccess(pool, options = {}) {
    const ctx = await resolveWebsiteBuildContext(pool, options);
    if (ctx.principal) {
        return {
            enabled: true,
            reason: 'principal_ecommerce',
            ...ctx
        };
    }
    if (tierAtLeast(ctx.buildTier, 'ecommerce')) {
        return {
            enabled: true,
            reason: 'hosting_ecommerce',
            ...ctx
        };
    }
    return {
        enabled: false,
        reason: 'hosting_tier_not_ecommerce',
        ...ctx
    };
}

async function assertOnlineShopEnabled(pool, options = {}) {
    const access = await resolveOnlineShopAccess(pool, options);
    if (!access.enabled) {
        const err = new Error(
            'This feature requires a Growth website package or above (online shop).'
        );
        err.code = 'ONLINE_SHOP_REQUIRED';
        err.status = 403;
        err.access = access;
        throw err;
    }
    return access;
}

async function assertStoreProductSubscriptionsEnabled(pool, options = {}) {
    const access = await resolveEcommerceAutomationAccess(pool, options);
    if (!access.enabled) {
        const err = new Error(
            'Product subscriptions require an ecommerce website build tier (Business One hosting enterprise or above).'
        );
        err.code = 'ECOMMERCE_TIER_REQUIRED';
        err.status = 403;
        err.access = access;
        throw err;
    }
    return access;
}

/** @deprecated Prefer resolveEcommerceAutomationAccess — kept for abandoned-cart / legacy callers. */
const resolveStoreProductSubscriptionsAccess = resolveEcommerceAutomationAccess;
const resolveEcommerceStoreAccess = resolveEcommerceAutomationAccess;

module.exports = {
    resolveWebsiteBuildContext,
    resolveOnlineShopAccess,
    resolveEcommerceAutomationAccess,
    resolveStoreProductSubscriptionsAccess,
    resolveEcommerceStoreAccess,
    assertOnlineShopEnabled,
    assertStoreProductSubscriptionsEnabled
};
