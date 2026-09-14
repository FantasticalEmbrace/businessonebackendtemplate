'use strict';

const validator = require('validator');

/** Common typo TLDs / domain mistakes that pass validator.isEmail but are not deliverable. */
const TYPO_TLDS = new Set([
    'coml',
    'con',
    'comm',
    'cmo',
    'ocm',
    'coom',
    'gom',
    'gmial',
    'gmal',
    'gnail',
    'yaho',
    'hotnail',
    'outlok',
]);

function hasTypoTld(email) {
    const domain = String(email || '').split('@')[1] || '';
    const tld = domain.split('.').pop() || '';
    return TYPO_TLDS.has(tld.toLowerCase());
}

function isValidCustomerEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !validator.isEmail(e)) return false;
    if (hasTypoTld(e)) return false;
    return true;
}

function normalizeCustomerEmail(email) {
    if (!isValidCustomerEmail(email)) return '';
    return String(email).trim().toLowerCase();
}

module.exports = {
    TYPO_TLDS,
    hasTypoTld,
    isValidCustomerEmail,
    normalizeCustomerEmail,
};
