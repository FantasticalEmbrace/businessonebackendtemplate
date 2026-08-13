'use strict';

const { lookupZip } = require('zipcode-detail-lookup');

const TARGET_STATES = new Set(['GA', 'NC', 'IN', 'MI', 'OH']);

function normalizeZip(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length >= 5) return digits.slice(0, 5);
    return '';
}

function normalizeStateCode(raw) {
    return String(raw || '').trim().toUpperCase();
}

/**
 * Resolve US county name from ZIP (and optional state for validation).
 * @returns {string}
 */
function lookupCountyFromZip(zip, stateCode) {
    const zip5 = normalizeZip(zip);
    if (!zip5) return '';

    const info = lookupZip(zip5);
    if (!info || !info.county) return '';

    const state = normalizeStateCode(stateCode || info.stateAbbreviation);
    if (stateCode && state && normalizeStateCode(info.stateAbbreviation) !== state) {
        return String(info.county).trim();
    }
    return String(info.county).trim();
}

function resolveCounty({ orderCounty, zip, stateCode }) {
    const fromOrder = String(orderCounty || '').trim();
    if (fromOrder) return fromOrder;

    const state = normalizeStateCode(stateCode);
    if (!TARGET_STATES.has(state)) return '';

    return lookupCountyFromZip(zip, state);
}

module.exports = {
    lookupCountyFromZip,
    resolveCounty,
    normalizeZip,
    normalizeStateCode,
    TARGET_STATES
};
