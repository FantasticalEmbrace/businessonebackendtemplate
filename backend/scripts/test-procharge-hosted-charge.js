#!/usr/bin/env node
'use strict';
/**
 * Validates the production payment path: hosted-field token shape -> chargeHostedToken.
 * Uses a synthetic CardConnect-length token to verify the API accepts the request
 * (expect decline/invalid token — not mod-10 or missing-field errors).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const {
    isHostedPaymentToken,
    chargeHostedToken,
    chargeToken
} = require('../services/prochargeClient');

const SYNTH_HOSTED_TOKEN = '9417111111111111';

async function main() {
    if (!isHostedPaymentToken(SYNTH_HOSTED_TOKEN)) {
        console.log('HOSTED_DETECT_FAIL');
        process.exit(2);
    }
    console.log('HOSTED_DETECT_OK');

    const viaRouter = await chargeToken({
        amount: '0.01',
        token: SYNTH_HOSTED_TOKEN,
        orderNumber: String(Date.now()).slice(-8),
        name: 'Hosted Path Test',
        description: 'Business One hosted-field charge path test'
    });
    console.log(
        'HOSTED_CHARGE',
        viaRouter.responseCode,
        viaRouter.responseText,
        viaRouter.transactionId || ''
    );

    const direct = await chargeHostedToken({
        amount: '0.01',
        token: SYNTH_HOSTED_TOKEN,
        orderNumber: String(Date.now()).slice(-8),
        name: 'Hosted Path Test',
        description: 'Business One hosted-field charge path test'
    });
    console.log(
        'HOSTED_DIRECT',
        direct.responseCode,
        direct.responseText,
        direct.transactionId || ''
    );

    const text = String(viaRouter.responseText || '').toLowerCase();
    const reachedProcessor =
        !text.includes('mod-10') &&
        !text.includes('missing or invalid cardnumber') &&
        !text.includes('cvv is required');
    console.log('PROCESSOR_REACHED', reachedProcessor ? 'yes' : 'no');
    process.exit(reachedProcessor ? 0 : 4);
}

main().catch((e) => {
    console.error('ERR', e.message || e);
    process.exit(1);
});
