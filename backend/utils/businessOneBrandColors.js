'use strict';

/**
 * Business One platform palette (marketing + merchant defaults).
 * Matches css/brand-tokens.css and business-one-webpage styles.
 * Override via BO_BRAND_PRIMARY, BO_BRAND_PRIMARY_DARK, BO_BRAND_ACCENT in backend/.env.
 */
module.exports = {
    PRIMARY: String(process.env.BO_BRAND_PRIMARY || '#ff9b1f').trim(),
    PRIMARY_DARK: String(process.env.BO_BRAND_PRIMARY_DARK || '#e8890f').trim(),
    ACCENT: String(process.env.BO_BRAND_ACCENT || '#1f82ff').trim(),
    LIGHT_BG: '#fff7ed',
};
