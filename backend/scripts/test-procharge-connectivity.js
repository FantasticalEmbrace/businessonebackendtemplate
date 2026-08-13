#!/usr/bin/env node
'use strict';
/**
 * Smoke test ProCharge API login (platform billing hub).
 * Usage: node scripts/test-procharge-connectivity.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { isProchargeConfigured, isProchargeSandbox } = require('../utils/prochargeEnv');
const { getAuthToken } = require('../services/prochargeClient');
const { getPlatformBillingClientConfig } = require('../services/platformBillingClientConfig');

async function main() {
    if (!isProchargeConfigured()) {
        console.error(
            'Missing ProCharge credentials. Set PROCHARGE_USERNAME (or PROCHARGE_EMAIL), PROCHARGE_PASSWORD, PROCHARGE_PIN (6-digit Reg Key), PROCHARGE_APPLICATION_KEY, PROCHARGE_MERCHANT_NUMBER in backend/.env'
        );
        process.exit(3);
    }
    console.log('Sandbox mode:', isProchargeSandbox());
    const cfg = getPlatformBillingClientConfig();
    console.log('Hosted fields:', cfg.hostedFields?.enabled ? 'yes' : 'no');
    console.log('Payment ready (client-config):', cfg.paymentReady);

    const token = await getAuthToken();
    if (!token) {
        console.error('FAIL: no access token');
        process.exit(2);
    }
    console.log('OK: ProCharge authentication succeeded.');
    process.exit(0);
}

main().catch((e) => {
    console.error('FAIL:', e.message || e);
    process.exit(e.code === 'PROCHARGE_NOT_CONFIGURED' ? 3 : 2);
});
