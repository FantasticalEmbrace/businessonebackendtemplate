'use strict';

/**
 * mysql2 can return JavaScript BigInt for BIGINT columns (e.g. COUNT(*)).
 * Express JSON serialization throws on BigInt — normalize for API responses.
 */
function jsonSafeDeep(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'bigint') {
        const n = Number(v);
        return Number.isSafeInteger(n) ? n : v.toString();
    }
    if (v instanceof Date) return v;
    if (Array.isArray(v)) return v.map(jsonSafeDeep);
    if (typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v)) {
            out[k] = jsonSafeDeep(v[k]);
        }
        return out;
    }
    return v;
}

module.exports = { jsonSafeDeep };
