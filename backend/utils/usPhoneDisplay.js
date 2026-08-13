'use strict';

/** Display format: (555) 555-0100 */
const US_PHONE_DISPLAY_RE = /^\(\d{3}\) \d{3}-\d{4}$/;

function digitsOnly(value) {
    return String(value == null ? '' : value).replace(/\D/g, '');
}

function formatDigitsToDisplay(digits) {
    const d = digitsOnly(digits).slice(0, 10);
    if (!d.length) return '';
    const area = d.slice(0, 3);
    const prefix = d.slice(3, 6);
    const line = d.slice(6, 10);
    if (d.length <= 3) return `(${area}`;
    if (d.length <= 6) return `(${area}) ${prefix}`;
    return `(${area}) ${prefix}-${line}`;
}

function isUsPhoneDisplay(value) {
    return US_PHONE_DISPLAY_RE.test(String(value || '').trim());
}

/** Optional field: empty OK; otherwise must match display format. */
function isUsPhoneDisplayOrEmpty(value) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return true;
    return isUsPhoneDisplay(s);
}

/** Normalize any phone input to (555) 555-0100 for storage, or null if not a full US number. */
function formatPhoneForStorage(value) {
    let digits = digitsOnly(value);
    if (!digits.length) return null;
    if (digits.length === 11 && digits.startsWith('1')) {
        digits = digits.slice(1);
    }
    if (digits.length !== 10) return null;
    return formatDigitsToDisplay(digits);
}

/** Partial phone typing for search — same mask as the register UI. */
function formatPhoneSearchQuery(value) {
    const digits = phoneSearchDigits(value);
    if (digits.length < 3) return '';
    return formatDigitsToDisplay(digits);
}

/** Ten-digit US core used for reliable DB matching across storage formats. */
function phoneSearchDigits(value) {
    let digits = digitsOnly(value);
    if (digits.length === 11 && digits.startsWith('1')) {
        digits = digits.slice(1);
    }
    return digits;
}

/** SQL expression that strips punctuation from a phone column for digit comparisons. */
function phoneDigitsSql(columnExpr) {
    const chars = [' ', '-', '(', ')', '+', '.'];
    return chars.reduce((sql, ch) => `REPLACE(${sql}, '${ch}', '')`, columnExpr);
}

function usPhoneDigitsSql(columnExpr) {
    const stripped = phoneDigitsSql(columnExpr);
    return `IF(CHAR_LENGTH(${stripped}) = 11 AND LEFT(${stripped}, 1) = '1', SUBSTRING(${stripped}, 2), ${stripped})`;
}

module.exports = {
    US_PHONE_DISPLAY_RE,
    digitsOnly,
    formatDigitsToDisplay,
    isUsPhoneDisplay,
    isUsPhoneDisplayOrEmpty,
    formatPhoneForStorage,
    formatPhoneSearchQuery,
    phoneSearchDigits,
    phoneDigitsSql,
    usPhoneDigitsSql
};
