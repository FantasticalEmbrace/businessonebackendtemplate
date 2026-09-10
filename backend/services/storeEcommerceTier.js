'use strict';

const { ensureDefaultAccount, listSubscriptions } = require('./platformBillingAccount');
const { isPrincipalAccountKey } = require('./principalBilling');
const { buildTierFromHosting } = require('./websiteBuildBilling');
const { normalizeHostingTier } = require('./platformBillingPricing');

const ACTIVE_SUB_STATUSES = new Set(['active', 'trial', 'past_due']);

/**
 * Whether this store may offer customer product subscriptions.
 * Ecommerce build tier only — Business One principal account is always ecommerce.
 */
async function resolveStoreProductSubscriptionsAccess(pool) {
    const account = await ensureDefaultAccount(pool);
    if (!account) {
        return { enabled: false, reason: 'no_billing_account' };
    }

    if (isPrincipalAccountKey(account.accountKey)) {
        return {
            enabled: true,
            reason: 'principal_ecommerce',
            accountKey: account.accountKey,
            buildTier: 'ecommerce',
        };
    }

    const subs = await listSubscriptions(pool, account.id);
    const hosting = subs.find(
        (s) => s.productType === 'hosting' && ACTIVE_SUB_STATUSES.has(String(s.status || '').toLowerCase())
    );
    const hostingTier = normalizeHostingTier(hosting?.config?.tier);
    const buildTier = buildTierFromHosting(hostingTier);

    if (buildTier === 'ecommerce') {
        return {
            enabled: true,
            reason: 'hosting_ecommerce',
            accountKey: account.accountKey,
            hostingTier,
            buildTier,
        };
    }

    return {
        enabled: false,
        reason: 'hosting_tier_not_ecommerce',
        accountKey: account.accountKey,
        hostingTier,
        buildTier,
    };
}

async function assertStoreProductSubscriptionsEnabled(pool) {
    const access = await resolveStoreProductSubscriptionsAccess(pool);
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

/** Alias — same gate for subscriptions, abandoned cart, and marketing hub. */
const resolveEcommerceStoreAccess = resolveStoreProductSubscriptionsAccess;

module.exports = {
    resolveStoreProductSubscriptionsAccess,
    resolveEcommerceStoreAccess,
    assertStoreProductSubscriptionsEnabled,
};