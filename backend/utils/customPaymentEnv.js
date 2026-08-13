'use strict';

const { isPlatformBillingLive } = require('./platformBillingEnv');

function isCustomPaymentEnabled() {
    const flag = String(process.env.CUSTOM_PAYMENT_ENABLED ?? 'true').trim().toLowerCase();
    if (flag === 'false' || flag === '0' || flag === 'no') return false;
    return isPlatformBillingLive();
}

function getCustomPaymentMinAmount() {
    const n = Number(process.env.CUSTOM_PAYMENT_MIN_AMOUNT);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

function getCustomPaymentMaxAmount() {
    const n = Number(process.env.CUSTOM_PAYMENT_MAX_AMOUNT);
    return Number.isFinite(n) && n > 0 ? n : 25000;
}

function getCustomPaymentAccessKey() {
    return String(process.env.CUSTOM_PAYMENT_ACCESS_KEY || '').trim();
}

function assertCustomPaymentAccess(providedKey) {
    const required = getCustomPaymentAccessKey();
    if (!required) return;
    const given = String(providedKey || '').trim();
    if (!given || given !== required) {
        const err = new Error('This payment page requires an access key. Contact Business One for a payment link.');
        err.code = 'ACCESS_DENIED';
        throw err;
    }
}

module.exports = {
    isCustomPaymentEnabled,
    getCustomPaymentMinAmount,
    getCustomPaymentMaxAmount,
    getCustomPaymentAccessKey,
    assertCustomPaymentAccess
};
