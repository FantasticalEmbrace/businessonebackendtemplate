'use strict';

/**
 * Business One merchant product flags.
 * Default: no website face — admin + POS only.
 */
function envBool(key, fallback) {
    const raw = process.env[key];
    if (raw == null || raw === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function getProductFeatures() {
    return {
        websiteEnabled: envBool('FEATURE_WEBSITE', false),
        phonesEnabled: envBool('FEATURE_PHONES', true),
        loyaltyEnabled: envBool('FEATURE_LOYALTY', true),
        giftCardsEnabled: envBool('FEATURE_GIFT_CARDS', true),
        edsaEnabled: envBool('FEATURE_EDSA', false),
        brand: {
            platformName: process.env.BRAND_PLATFORM_NAME || 'Business One',
            storeName: process.env.BRAND_STORE_NAME || 'Business One Merchant',
            primaryColor: process.env.BRAND_PRIMARY || '#ff9b1f',
            accentColor: process.env.BRAND_ACCENT || '#1f82ff',
            inkColor: process.env.BRAND_INK || '#0f172a',
            logoUrl: process.env.BRAND_LOGO_URL || '/images/business-one/logo-big.png'
        },
        pbx: {
            apiOrigin: (process.env.PBX_API_ORIGIN || 'http://127.0.0.1:3040').replace(/\/+$/, ''),
            merchantId: process.env.PBX_MERCHANT_ID || '',
            servicePin: process.env.PBX_ADMIN_PIN || ''
        }
    };
}

/** Nav sections that require a website build */
const WEBSITE_LOCKED_SECTIONS = ['marketing', 'edsa'];

module.exports = {
    getProductFeatures,
    WEBSITE_LOCKED_SECTIONS
};
