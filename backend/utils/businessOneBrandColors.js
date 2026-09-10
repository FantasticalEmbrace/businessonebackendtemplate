'use strict';

/**
 * Business One platform palette for ecommerce merchant stores.
 * NOT HM Herbs storefront colors — use for non-principal billing accounts / future signups.
 * Override via BO_BRAND_PRIMARY, BO_BRAND_PRIMARY_DARK, BO_BRAND_ACCENT in backend/.env.
 */
module.exports = {
    PRIMARY: String(process.env.BO_BRAND_PRIMARY || '#1e3a5f').trim(),
    PRIMARY_DARK: String(process.env.BO_BRAND_PRIMARY_DARK || '#152a45').trim(),
    ACCENT: String(process.env.BO_BRAND_ACCENT || '#2563eb').trim(),
    LIGHT_BG: '#eef2ff',
};
