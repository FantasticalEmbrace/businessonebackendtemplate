'use strict';

const creds = require('../services/integrationCredentials');

function numEnv(key, fallback) {
    const v = parseFloat(process.env[key]);
    return Number.isFinite(v) ? v : fallback;
}

/** ISO-ish codes and common labels → canonical ISO-2. */
const COUNTRY_ALIASES = Object.freeze({
    us: 'US',
    usa: 'US',
    'united states': 'US',
    'united states of america': 'US',
    ca: 'CA',
    can: 'CA',
    canada: 'CA',
    mx: 'MX',
    mex: 'MX',
    mexico: 'MX',
});

const COUNTRY_LABELS = Object.freeze({
    US: 'United States',
    CA: 'Canada',
    MX: 'Mexico',
});

/**
 * Allowed ship-to countries from STORE_SHIP_COUNTRIES (comma-separated).
 * Default: US only. Examples: "US" | "US,CA" | "United States,Canada"
 */
function parseShipCountries(raw) {
    const src = raw != null && String(raw).trim() !== '' ? String(raw) : 'US';
    const codes = [];
    for (const part of src.split(/[,;]+/)) {
        const key = String(part || '').trim().toLowerCase();
        if (!key) continue;
        const code = COUNTRY_ALIASES[key] || (/^[a-z]{2}$/i.test(key) ? key.toUpperCase() : null);
        if (code && !codes.includes(code)) codes.push(code);
    }
    return codes.length ? codes : ['US'];
}

function normalizeShipCountryCode(raw) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) return '';
    if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
    if (/^[a-z]{2}$/i.test(key)) return key.toUpperCase();
    return '';
}

function isAllowedShipCountry(raw, allowedCodes) {
    const code = normalizeShipCountryCode(raw);
    if (!code) return false;
    const list = Array.isArray(allowedCodes) && allowedCodes.length ? allowedCodes : ['US'];
    return list.includes(code);
}

function shipCountryLabel(rawOrCode) {
    const code = normalizeShipCountryCode(rawOrCode) || String(rawOrCode || '').trim().toUpperCase();
    return COUNTRY_LABELS[code] || COUNTRY_LABELS.US;
}

function isUsShipCountry(raw) {
    return normalizeShipCountryCode(raw) === 'US';
}

function getShippingConfig() {
    const firstClass = numEnv('FIRST_CLASS_SHIPPING', 9.99);
    const shipCountries = parseShipCountries(process.env.STORE_SHIP_COUNTRIES);
    return {
        FREE_SHIPPING_THRESHOLD: numEnv('FREE_SHIPPING_THRESHOLD', 50),
        FIRST_CLASS_SHIPPING: firstClass,
        /** Paid checkout options (flat or Shippo) must not undercut this amount. */
        MIN_PAID_SHIPPING_RATE: numEnv('MIN_PAID_SHIPPING_RATE', firstClass),
        SHIPPO_API_BASE: 'https://api.goshippo.com',
        SHIPPO_API_TOKEN: creds.getShippoApiToken(),
        SHIPPO_TEST_MODE: creds.isShippoTestMode(),
        STORE_ORIGIN: creds.getShippoStoreOrigin(),
        CARRIER_FILTER: creds.getShippoCarrierFilter(),
        /** Allowed destination countries (ISO-2). Default US. */
        STORE_SHIP_COUNTRIES: shipCountries,
        shipCountryOptions: shipCountries.map((code) => ({
            code,
            label: COUNTRY_LABELS[code] || code,
        })),
    };
}

const FREE_SHIPPING_THRESHOLD = numEnv('FREE_SHIPPING_THRESHOLD', 50);
const FIRST_CLASS_SHIPPING = numEnv('FIRST_CLASS_SHIPPING', 9.99);
const MIN_PAID_SHIPPING_RATE = numEnv('MIN_PAID_SHIPPING_RATE', FIRST_CLASS_SHIPPING);

module.exports = {
    FREE_SHIPPING_THRESHOLD,
    FIRST_CLASS_SHIPPING,
    MIN_PAID_SHIPPING_RATE,
    getShippingConfig,
    parseShipCountries,
    normalizeShipCountryCode,
    isAllowedShipCountry,
    shipCountryLabel,
    isUsShipCountry,
    COUNTRY_LABELS,
};
