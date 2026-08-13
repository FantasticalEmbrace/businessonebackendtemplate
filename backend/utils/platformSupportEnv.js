'use strict';

/** Admin-saved store URL (settings.pos_store_base_url); preferred over env when set. */
let storeBaseUrlOverride = '';

function normalizeStoreBaseUrl(raw) {
    const trimmed = String(raw || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    try {
        const u = new URL(trimmed);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '';
        return `${u.origin}${path}`;
    } catch {
        return '';
    }
}

function getEnvStoreBaseUrl() {
    const explicit = normalizeStoreBaseUrl(process.env.POS_PLATFORM_STORE_URL);
    if (explicit) return explicit;
    return normalizeStoreBaseUrl(process.env.FRONTEND_URL || process.env.PUBLIC_STORE_URL || '');
}

function setStoreBaseUrlOverride(url) {
    storeBaseUrlOverride = normalizeStoreBaseUrl(url);
    return storeBaseUrlOverride;
}

async function refreshStoreBaseUrlFromDb(pool) {
    if (!pool) return getStoreBaseUrl();
    try {
        const [rows] = await pool.execute(
            `SELECT value FROM settings WHERE key_name = 'pos_store_base_url' LIMIT 1`
        );
        const fromDb = normalizeStoreBaseUrl(rows?.[0]?.value);
        storeBaseUrlOverride = fromDb;
    } catch {
        /* settings table may not exist yet during early boot */
    }
    return getStoreBaseUrl();
}

function getPlatformHubSecret() {
    return String(process.env.POS_PLATFORM_HUB_SECRET || '').trim();
}

function isPlatformHubEnabled() {
    return String(process.env.POS_PLATFORM_HUB_ENABLED || '').trim().toLowerCase() === 'true';
}

function isPlatformHubSyncConfigured() {
    const url = String(process.env.POS_PLATFORM_HUB_URL || '').trim();
    const secret = getPlatformHubSecret();
    const merchantId = String(process.env.POS_PLATFORM_MERCHANT_ID || '').trim();
    return Boolean(url && secret && merchantId);
}

function getPlatformMerchantId() {
    return String(process.env.POS_PLATFORM_MERCHANT_ID || '').trim();
}

function getPlatformHubUrl() {
    return String(process.env.POS_PLATFORM_HUB_URL || '').trim().replace(/\/+$/, '');
}

function getPlatformHubPublicUrl() {
    const explicit = String(process.env.PLATFORM_SUPPORT_HUB_PUBLIC_URL || '').trim().replace(/\/+$/, '');
    if (explicit) return explicit;
    return '';
}

function getStoreBaseUrl() {
    if (storeBaseUrlOverride) return storeBaseUrlOverride;
    return getEnvStoreBaseUrl();
}

function verifyPlatformHubSecret(headerValue) {
    const secret = getPlatformHubSecret();
    if (!secret) return false;
    const provided = String(headerValue || '').trim();
    return provided.length > 0 && provided === secret;
}

module.exports = {
    getPlatformHubSecret,
    isPlatformHubEnabled,
    isPlatformHubSyncConfigured,
    getPlatformMerchantId,
    getPlatformHubUrl,
    getPlatformHubPublicUrl,
    getStoreBaseUrl,
    getEnvStoreBaseUrl,
    normalizeStoreBaseUrl,
    setStoreBaseUrlOverride,
    refreshStoreBaseUrlFromDb,
    verifyPlatformHubSecret
};
