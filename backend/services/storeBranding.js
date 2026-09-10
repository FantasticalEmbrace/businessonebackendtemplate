'use strict';

const fs = require('fs');
const path = require('path');
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

const DEFAULT_CHROME_NAME = 'Business One Admin';
const BRANDING_JSON_PATH = path.join(__dirname, '..', '..', 'data', 'branding.json');

const PLATFORM_DEFAULT_NAMES = new Set([
    '',
    'business one',
    'business one admin',
    'business one merchant',
]);

const PLATFORM_DEFAULT_LOGOS = new Set([
    '',
    '/images/logo.png',
    '/images/business-one/logo-big.png',
    '/images/business-one/logo.png',
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

function normalizeLogoPath(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
        if (/^https?:\/\//i.test(raw)) {
            const u = new URL(raw);
            return `${u.pathname}${u.search || ''}`.replace(/\?.*$/, '') || raw;
        }
    } catch {
        /* keep raw */
    }
    return raw.split('?')[0];
}

function isPlatformDefaultName(name) {
    return PLATFORM_DEFAULT_NAMES.has(String(name || '').trim().toLowerCase());
}

function isPlatformDefaultLogo(url) {
    const pathOnly = normalizeLogoPath(url).toLowerCase();
    if (PLATFORM_DEFAULT_LOGOS.has(pathOnly)) return true;
    return /\/images\/business-one\/logo(-big)?\.png$/i.test(pathOnly);
}

function readFileBranding() {
    try {
        return JSON.parse(fs.readFileSync(BRANDING_JSON_PATH, 'utf8'));
    } catch {
        return null;
    }
}

function writeFileBrandingPatch(patch = {}) {
    let current = readFileBranding() || {
        storeName: 'Business One Merchant',
        tagline: 'Powered by Business One',
        logoUrl: '/images/business-one/logo-big.png',
        primaryColor: '#ff9b1f',
        accentColor: '#1f82ff',
        inkColor: '#0f172a',
        receiptFooter: 'Thank you for shopping with us',
    };
    const next = {
        ...current,
        ...(patch.storeName != null ? { storeName: String(patch.storeName).trim().slice(0, 200) } : {}),
        ...(patch.logoUrl != null ? { logoUrl: String(patch.logoUrl).trim().slice(0, 500) } : {}),
        updatedAt: new Date().toISOString(),
    };
    const dir = path.dirname(BRANDING_JSON_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BRANDING_JSON_PATH, JSON.stringify(next, null, 2), 'utf8');
    return next;
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

async function loadBrandingSettingsMap(pool) {
    const map = new Map();
    if (!pool) return map;
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
    return map;
}

async function upsertSetting(pool, keyName, value, description, type = 'string') {
    if (!pool) return;
    await pool.execute(
        `INSERT INTO settings (key_name, value, description, type)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), description = VALUES(description), type = VALUES(type)`,
        [keyName, value == null ? '' : String(value), description || keyName, type]
    );
}

/**
 * Persist merchant name/logo for admin chrome, POS, and emails.
 * Called from signup/onboarding and when admins save store branding.
 */
async function persistMerchantStoreBranding(pool, { storeName, logoUrl } = {}) {
    const name = storeName != null ? String(storeName).trim().slice(0, 200) : null;
    const logo = logoUrl != null ? String(logoUrl).trim().slice(0, 500) : null;

    if (pool && name) {
        await upsertSetting(pool, 'store_name', name, 'Store display name', 'string');
    }
    if (pool && logo != null) {
        await upsertSetting(pool, 'store_logo_url', logo, 'Store logo URL for admin chrome and storefront', 'string');
        await upsertSetting(pool, 'pos_store_logo_url', logo, 'Optional store logo URL for POS customer display', 'string');
    }

    const filePatch = {};
    if (name) filePatch.storeName = name;
    if (logo != null) filePatch.logoUrl = logo;
    if (Object.keys(filePatch).length) {
        try {
            writeFileBrandingPatch(filePatch);
        } catch {
            /* non-fatal on read-only FS */
        }
    }

    return { storeName: name, logoUrl: logo };
}

/**
 * Admin sidebar chrome: keep Business One Admin by default; adopt merchant name+logo when set.
 * Principal / platform operator always keeps the default chrome.
 */
async function resolveAdminChromeBranding(pool) {
    const principal = await isPrincipalStore(pool);
    const map = await loadBrandingSettingsMap(pool);
    const fileBrand = readFileBranding() || {};

    const customName =
        pickSetting(map, 'store_name') ||
        String(fileBrand.storeName || '').trim() ||
        '';
    const customLogo =
        pickSetting(map, 'store_logo_url') ||
        pickSetting(map, 'pos_store_logo_url') ||
        String(fileBrand.logoUrl || '').trim() ||
        '';

    const hasMerchantName = Boolean(customName) && !isPlatformDefaultName(customName);
    const hasMerchantLogo = Boolean(customLogo) && !isPlatformDefaultLogo(customLogo);
    // Merchant chrome when both a real business name and logo are configured.
    // Principal installs without custom branding keep Business One Admin.
    // (Do not force principal-only: dedicated merchant DBs still have a `default` billing account.)
    const useDefault = !(hasMerchantName && hasMerchantLogo);

    if (useDefault) {
        return {
            useDefault: true,
            displayName: DEFAULT_CHROME_NAME,
            logoUrl: null,
            isPrincipalStore: principal,
            storeName: customName || null,
        };
    }

    return {
        useDefault: false,
        displayName: customName,
        logoUrl: customLogo,
        isPrincipalStore: principal,
        storeName: customName,
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
    const map = await loadBrandingSettingsMap(pool);
    const fileBrand = readFileBranding() || {};

    const name =
        pickSetting(map, 'store_name') ||
        storeName ||
        String(fileBrand.storeName || '').trim() ||
        process.env.STORE_NAME ||
        process.env.POS_STORE_NAME ||
        'Business One';
    const logoUrl =
        pickSetting(map, 'store_logo_url') ||
        pickSetting(map, 'pos_store_logo_url') ||
        posLogo ||
        String(fileBrand.logoUrl || '').trim() ||
        '/images/logo.png';
    const phone =
        pickSetting(map, 'store_phone') ||
        process.env.STORE_PHONE ||
        '(850) 290-2084';
    const email =
        pickSetting(map, 'store_email') ||
        process.env.STORE_EMAIL ||
        process.env.SMTP_USER ||
        'info@businessonecomprehensive.com';

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
    DEFAULT_CHROME_NAME,
    resolveStoreBranding,
    resolveAdminChromeBranding,
    persistMerchantStoreBranding,
    brandingForPublicApi,
    normalizeHex,
    isPrincipalStore,
    isPlatformDefaultName,
    isPlatformDefaultLogo,
};
