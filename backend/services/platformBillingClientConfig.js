'use strict';

const { isProchargeConfigured, isProchargeSandbox } = require('../utils/prochargeEnv');
const {
    isProchargeHostedTokenizerConfigured,
    isProchargeRequireHostedFields,
    getHostedFieldsClientConfig
} = require('../utils/prochargeHostedEnv');
const { billingPortalUrl } = require('./platformBillingEmail');

function getPlatformBillingClientConfig({ signupEnabled = false } = {}) {
    const apiConfigured = isProchargeConfigured();
    const hostedFields = getHostedFieldsClientConfig();
    const hostedRequired = isProchargeRequireHostedFields();
    const paymentFieldsReady = hostedRequired ? hostedFields.enabled : true;
    const paymentReady = apiConfigured && paymentFieldsReady;

    let message;
    if (!hostedFields.enabled && hostedRequired) {
        message =
            'Hosted payment fields are not configured yet. Set PROCHARGE_HOSTED_TOKENIZER_HOST (or PROCHARGE_HOSTED_TOKENIZER_URL) on the billing hub.';
    } else if (!apiConfigured) {
        message =
            'ProCharge platform billing is not configured on the server yet. Payment tokens can be collected in the browser once API credentials are added.';
    } else if (signupEnabled) {
        message = 'Enter card details in the secure fields below. Charges are processed by ProCharge (EPI).';
    } else {
        message = 'Enter card details in the secure fields below. Charges are processed by ProCharge (EPI).';
    }

    return {
        enabled: signupEnabled ? signupEnabled && paymentReady : paymentReady,
        configured: apiConfigured,
        paymentReady,
        processor: 'procharge',
        sandbox: isProchargeSandbox(),
        achEnabled: true,
        cardFields: !hostedRequired,
        hostedFields,
        portalUrl: billingPortalUrl(),
        message
    };
}

function isPlatformBillingPaymentReady() {
    const apiConfigured = isProchargeConfigured();
    if (!apiConfigured) return false;
    if (isProchargeRequireHostedFields()) {
        return isProchargeHostedTokenizerConfigured();
    }
    return true;
}

module.exports = {
    getPlatformBillingClientConfig,
    isPlatformBillingPaymentReady
};
