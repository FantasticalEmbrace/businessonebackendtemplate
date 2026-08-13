'use strict';

/**
 * Smoke test hosted billing client-config (no DB or ProCharge API credentials required).
 * Usage: node scripts/smoke-procharge-hosted-config.js
 */

process.env.PROCHARGE_HOSTED_TOKENIZER_HOST = process.env.PROCHARGE_HOSTED_TOKENIZER_HOST || 'fts-uat.cardconnect.com';
process.env.PROCHARGE_SANDBOX = process.env.PROCHARGE_SANDBOX || '1';
delete process.env.PROCHARGE_EMAIL;
delete process.env.PROCHARGE_PASSWORD;
delete process.env.PROCHARGE_APPLICATION_KEY;
delete process.env.PROCHARGE_MERCHANT_NUMBER;

const { getPlatformBillingClientConfig } = require('../services/platformBillingClientConfig');
const { assertNoRawPaymentData } = require('../utils/paymentPayloadValidation');

function assert(condition, message) {
    if (!condition) {
        console.error('FAIL:', message);
        process.exitCode = 1;
        throw new Error(message);
    }
    console.log('OK:', message);
}

try {
    const portal = getPlatformBillingClientConfig();
    assert(portal.hostedFields?.enabled === true, 'portal hostedFields.enabled');
    assert(portal.hostedFields.cardTokenizerUrl.includes('fts-uat.cardconnect.com'), 'portal cardTokenizerUrl');
    assert(portal.configured === false, 'portal configured false without API creds');
    assert(portal.paymentReady === false, 'portal paymentReady false without API creds');
    assert(portal.cardFields === false, 'portal cardFields false when hosted required');

    const signup = getPlatformBillingClientConfig({ signupEnabled: true });
    assert(signup.enabled === false, 'signup enabled false until paymentReady');

    assertNoRawPaymentData({ payment_token: 'tok-test' });
    let rejected = false;
    try {
        assertNoRawPaymentData({ cardNumber: '4111111111111111' });
    } catch (e) {
        rejected = e.code === 'HOSTED_FIELDS_REQUIRED';
    }
    assert(rejected, 'raw PAN rejected when hosted required');

    if (process.exitCode) {
        console.error('\nSmoke test failed.');
        process.exit(1);
    }
    console.log('\nAll hosted ProCharge config smoke checks passed.');
} catch (e) {
    console.error('\nSmoke test error:', e.message);
    process.exit(1);
}
