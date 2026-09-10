'use strict';

const hmBrandDefaults = require('../utils/brandColors');
const boBrandDefaults = require('../utils/businessOneBrandColors');
const { loadPosStoreConfig } = require('./posStoreConfig');
const { ensureDefaultAccount } = require('./platformBillingAccount');
const { isPrincipalAccountKey } = require('./principalBilling');

const BRANDING_KEYS = Object.freeze([
    'store_name',
    'store_phone',
    'store_email',
    'store_logo_url',
    'pos_store_logo_url',
    'store_brand_primary',
    'store_brand_primary_dark',
    'store_brand_accent',
]);

function normalizeHex(value, fallback) {
    const s = String(value || '').trim();
    return /^#[0-9A-Fa-f]{6}$/.test(s) ? s.toLowerCase() : fallback;
}

function pickSetting(map, key) {
    const raw = map.get(key);
    if (raw == null || raw === '') return '';
    return String(raw).trim();
}

async function isPrincipalStore(pool) {
    try {
        const account = await ensureDefaultAccount(pool);
        return Boolean(account && isPrincipalAccountKey(account.accountKey));
    } catch {
        return false;
    }
}

function defaultPalette(_isPrincipal) {
    return {
        primary: String(boBrandDefaults.PRIMARY).toLowerCase(),
        primaryDark: String(boBrandDefaults.PRIMARY_DARK).toLowerCase(),
        accent: String(boBrandDefaults.ACCENT).toLowerCase(),
        lightGreen: String(boBrandDefaults.LIGHT_BG).toLowerCase(),
    };
}

/**
 * Resolve storefront branding for emails and public marketing surfaces.
 * Principal and Business One ecommerce merchants use the Business One palette unless they set store_brand_* in settings.
 */
async function resolveStoreBranding(pool) {
    const principal = await isPrincipalStore(pool);
    const palette = defaultPalette(principal);
    const { storeName, storeLogoUrl: posLogo } = await loadPosStoreConfig(pool);
    const map = new Map();

    if (pool) {
        try {
            const placeholders = BRANDING_KEYS.map(() => '?').join(', ');
            const [rows] = await pool.execute(
                `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
                BRANDING_KEYS
            );
            for (const row of rows || []) {
                map.set(row.key_name, row.value != null ? String(row.value) : '');
            }
        } catch {
            /* env / defaults only */
        }
    }

    const name = pickSetting(map, 'store_name') || storeName || 'Your Store';
    const logoUrl =
        pickSetting(map, 'store_logo_url') ||
        pickSetting(map, 'pos_store_logo_url') ||
        posLogo ||
        '';
    const phone = pickSetting(map, 'store_phone') || '';
    const email = pickSetting(map, 'store_email') || '';

    const primary = normalizeHex(pickSetting(map, 'store_brand_primary'), palette.primary);
    const primaryDark = normalizeHex(pickSetting(map, 'store_brand_primary_dark'), palette.primaryDark);
    const accent = normalizeHex(pickSetting(map, 'store_brand_accent'), palette.accent);

    return {
        storeName: name,
        storePhone: phone,
        storeEmail: email,
        logoUrl,
        isPrincipalStore: principal,
        brandSource: principal ? 'principal' : 'business_one_ecommerce',
        colors: {
            primary,
            primaryDark,
            accent,
            lightGreen: palette.lightGreen,
            text: '#111827',
            textMuted: '#4b5563',
            border: '#e5e7eb',
            pageBg: '#f3f4f6',
        },
        font: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
    };
}

function brandingForPublicApi(branding) {
    return {
        storeName: branding.storeName,
        logoUrl: branding.logoUrl || null,
        colors: branding.colors,
        storePhone: branding.storePhone || null,
        storeEmail: branding.storeEmail || null,
        brandSource: branding.brandSource,
        isPrincipalStore: Boolean(branding.isPrincipalStore),
    };
}

module.exports = {
    BRANDING_KEYS,
    resolveStoreBranding,
    brandingForPublicApi,
    normalizeHex,
    isPrincipalStore,
};
