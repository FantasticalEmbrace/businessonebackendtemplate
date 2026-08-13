'use strict';

const SETTING_KEY = 'tax_rate';
const DEFAULT_RATE = 0.08;

function taxRateFromEnv() {
    const raw = Number(process.env.DEFAULT_TAX_RATE);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RATE;
}

function normalizeStoredTaxRate(value) {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw < 0) return null;
    // Allow admins to save either 0.08 or 8 (percent).
    if (raw > 1) return Math.min(raw, 100) / 100;
    return raw;
}

async function loadStoreTaxRate(pool) {
    if (!pool) return taxRateFromEnv();
    try {
        const [rows] = await pool.execute(
            'SELECT value FROM settings WHERE key_name = ? LIMIT 1',
            [SETTING_KEY]
        );
        const fromDb = normalizeStoredTaxRate(rows[0]?.value);
        if (fromDb != null) return fromDb;
    } catch {
        /* fall through */
    }
    return taxRateFromEnv();
}

/** @deprecated use loadStoreTaxRate(pool) */
function getDefaultTaxRate() {
    return taxRateFromEnv();
}

function formatTaxRatePercent(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0) return '0';
    return (n * 100).toFixed(2).replace(/\.?0+$/, '');
}

function parseAdminTaxRatePercentInput(percentValue) {
    const raw = Number(percentValue);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    if (raw > 100) return 1;
    return Math.round(raw * 10000) / 1000000;
}

module.exports = {
    SETTING_KEY,
    DEFAULT_RATE,
    taxRateFromEnv,
    loadStoreTaxRate,
    getDefaultTaxRate,
    normalizeStoredTaxRate,
    formatTaxRatePercent,
    parseAdminTaxRatePercentInput
};
