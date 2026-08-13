'use strict';

/**
 * Business One platform billing — merchants pay YOU via ProCharge (EPI ISO).
 * Store customer checkout: standard merchants use EPI; high-risk merchants use NMI — not this module.
 */
const { isProchargeConfigured } = require('./prochargeEnv');
const { isPlatformBillingPaymentReady } = require('../services/platformBillingClientConfig');

function isPlatformBillingConfigured() {
    return isProchargeConfigured();
}

/** Billing UI + charges ready (API creds + hosted tokenizer when required). */
function isPlatformBillingLive() {
    return isPlatformBillingPaymentReady();
}

/** @deprecated CardPointe hosted iframe replaces a public browser key. */
function getPlatformPublicTokenizationKey() {
    return '';
}

module.exports = {
    isPlatformBillingConfigured,
    isPlatformBillingLive,
    getPlatformPublicTokenizationKey
};
