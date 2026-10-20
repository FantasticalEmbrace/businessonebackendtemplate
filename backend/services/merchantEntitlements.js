'use strict';

/**
 * Product entitlements from signup choices (verticals + website package).
 * Calendar unlocks at Standard website build ($3k / hosting tier "standard").
 * Ecommerce unlocks at Growth ($6k / hosting tier "growth") and above.
 */

const HOSTING_TO_BUILD_TIER = {
    essential: 'basic',
    standard: 'standard',
    growth: 'growth',
    enterprise: 'ecommerce'
};

const BUILD_TIER_RANK = {
    basic: 1,
    standard: 2,
    growth: 3,
    ecommerce: 4
};

function normalizeHostingTier(raw) {
    const t = String(raw || '')
        .trim()
        .toLowerCase();
    if (['essential', 'standard', 'growth', 'enterprise'].includes(t)) return t;
    return '';
}

function normalizeBuildTier(raw) {
    const t = String(raw || '')
        .trim()
        .toLowerCase();
    if (['basic', 'standard', 'growth', 'ecommerce'].includes(t)) return t;
    return '';
}

function normalizeVerticals(raw) {
    const allowed = new Set(['auto', 'body', 'upholstery', 'tire', 'contractor']);
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const item of list) {
        const v = String(item || '')
            .trim()
            .toLowerCase();
        if (allowed.has(v) && !out.includes(v)) out.push(v);
    }
    if (out.includes('contractor') && out.length > 1) return ['contractor'];
    return out;
}

function buildTierFromHosting(hostingTier) {
    const hosting = normalizeHostingTier(hostingTier);
    return hosting ? HOSTING_TO_BUILD_TIER[hosting] || '' : '';
}

function tierAtLeast(buildTier, minimum) {
    const a = BUILD_TIER_RANK[normalizeBuildTier(buildTier)] || 0;
    const b = BUILD_TIER_RANK[normalizeBuildTier(minimum)] || 0;
    return a > 0 && b > 0 && a >= b;
}

/**
 * @param {object|null} shopConfig from platform_merchants.shop_config
 * @param {{ isPrincipalStore?: boolean }} options
 */
function resolveEntitlements(shopConfig, options = {}) {
    if (options.isPrincipalStore) {
        return {
            fullAccess: true,
            storeType: 'shop',
            shopVerticals: ['auto', 'body', 'upholstery', 'tire', 'contractor'],
            hostingTier: 'growth',
            buildTier: 'growth',
            hasWebsite: true,
            hasCalendar: true,
            hasEcommerce: true,
            hasEcommerceAutomation: true,
            isRetail: false,
            isShop: true,
            showShopWorkflows: true,
            sections: null,
            posTabs: null
        };
    }

    const cfg = shopConfig && typeof shopConfig === 'object' ? shopConfig : {};
    const shopVerticals = normalizeVerticals(cfg.shopVerticals);
    const isShop = shopVerticals.length > 0;
    const storeType =
        isShop || String(cfg.storeType || '').toLowerCase() === 'shop' ? 'shop' : 'retail';
    const hostingTier = normalizeHostingTier(cfg.hostingTier);
    const buildTier =
        normalizeBuildTier(cfg.buildTier) || buildTierFromHosting(hostingTier) || '';
    const hasWebsite = Boolean(hostingTier || buildTier);
    // Standard ($3k) and above — Growth includes Standard features.
    const hasCalendar = hasWebsite && tierAtLeast(buildTier || 'basic', 'standard');
    // Growth ($6k)+ — full online shop (accounts, gift cards, loyalty, variants, search).
    const hasEcommerce = hasWebsite && tierAtLeast(buildTier || 'basic', 'growth');
    // Ecommerce ($10k)+ — subscriptions, abandoned cart, scale automation.
    const hasEcommerceAutomation = hasWebsite && tierAtLeast(buildTier || 'basic', 'ecommerce');

    /** Nav sections always available for POS merchants */
    const sections = new Set([
        'dashboard',
        'products',
        'low-stock',
        'import',
        'categories',
        'brands',
        'vendors',
        'orders',
        'customers',
        'customer-groups',
        'gift-cards',
        'pos',
        'personnel',
        'reports',
        'settings'
    ]);

    if (hasCalendar) sections.add('scheduling');
    if (hasWebsite || hasEcommerce) {
        sections.add('marketing');
        sections.add('tax-ledger');
    }

    const posTabs = new Set(['display', 'operations', 'registers', 'payments', 'equipment', 'license', 'troubleshoot']);
    if (isShop) posTabs.add('shop');

    return {
        fullAccess: false,
        storeType,
        shopVerticals,
        hostingTier: hostingTier || null,
        buildTier: buildTier || null,
        hasWebsite,
        hasCalendar,
        hasEcommerce,
        hasEcommerceAutomation,
        isRetail: !isShop,
        isShop,
        showShopWorkflows: isShop,
        sections: [...sections],
        posTabs: [...posTabs]
    };
}

async function loadMerchantShopConfig(pool, merchantId) {
    if (!pool || !merchantId) return null;
    try {
        const [rows] = await pool.execute(
            'SELECT shop_config FROM platform_merchants WHERE id = ? LIMIT 1',
            [merchantId]
        );
        const raw = rows[0]?.shop_config;
        if (raw == null) return null;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        return null;
    }
}

async function resolveEntitlementsForRequest(pool, { merchantId = null, isPrincipalStore = false } = {}) {
    if (isPrincipalStore) return resolveEntitlements(null, { isPrincipalStore: true });
    const shopConfig = merchantId ? await loadMerchantShopConfig(pool, merchantId) : null;
    // Legacy single-store / no config yet → do not strip UI
    if (!shopConfig || typeof shopConfig !== 'object') {
        return resolveEntitlements(null, { isPrincipalStore: true });
    }
    return resolveEntitlements(shopConfig, { isPrincipalStore: false });
}

module.exports = {
    HOSTING_TO_BUILD_TIER,
    normalizeHostingTier,
    normalizeBuildTier,
    normalizeVerticals,
    buildTierFromHosting,
    tierAtLeast,
    resolveEntitlements,
    loadMerchantShopConfig,
    resolveEntitlementsForRequest
};
