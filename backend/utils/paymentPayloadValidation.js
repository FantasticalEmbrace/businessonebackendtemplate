'use strict';

const { isProchargeRequireHostedFields } = require('./prochargeHostedEnv');

function hasRawCardFields(payload) {
    if (!payload || typeof payload !== 'object') return false;
    return Boolean(
        payload.cardNumber ||
            payload.ccExpMonth ||
            payload.ccExpYear ||
            payload.cvv ||
            payload.card_number
    );
}

function hasRawAchFields(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const bank = payload.bankAccount || payload.bank_account || {};
    return Boolean(
        bank.routingNumber ||
            bank.routing_number ||
            bank.accountNumber ||
            bank.account_number
    );
}

function assertNoRawPaymentData(payload, { allowLegacy = false } = {}) {
    if (allowLegacy || !isProchargeRequireHostedFields()) return;

    if (hasRawCardFields(payload) || hasRawAchFields(payload)) {
        const err = new Error(
            'Raw card or bank account data is not accepted. Use the hosted payment fields to tokenize on the browser.'
        );
        err.code = 'HOSTED_FIELDS_REQUIRED';
        throw err;
    }
}

module.exports = {
    hasRawCardFields,
    hasRawAchFields,
    assertNoRawPaymentData
};
