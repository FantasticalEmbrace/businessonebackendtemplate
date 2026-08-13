'use strict';

const { createTerminalTransaction } = require('./mxmerchantTerminal');
const {
    reverseCardPayment,
    reverseOrderCardPayment,
    resolveScopeForOrder,
    resolveProcessorForOrder,
    isGatewayRefundableReference,
    resolveCardRefundAmount,
} = require('./orderPaymentReversal');

const { NMI_PROCESSOR_ID, MX_PROCESSOR_ID } = require('./storePaymentProcessor');

/**
 * Void or refund a captured payment at the gateway.
 * @see orderPaymentReversal.reverseCardPayment
 */
async function reversePayment(opts) {
    return reverseCardPayment({
        processor: opts.processor,
        scope: opts.scope === 'pos' ? 'pos' : 'website',
        transactionId: opts.transactionId,
        paymentId: opts.paymentId,
        amount: opts.amount,
        operation: opts.operation || 'auto',
        paymentToken: opts.paymentToken,
    });
}

/**
 * Reverse card payment for an order row (website or POS).
 * @param {object} order
 * @param {{ amount?, operation?, processor?, paymentToken? }} options
 * @param {import('mysql2/promise').Pool|null} pool
 */
async function reverseOrderPayment(order, options = {}, pool = null) {
    return reverseOrderCardPayment(pool, order, options);
}

/** Charge a physical MX terminal (chip/swipe). */
async function chargeMxTerminal({ amount, scope = 'pos', terminalId, replayId, type = 'Sale' }) {
    return createTerminalTransaction({ scope, terminalId, amount, type, replayId });
}

module.exports = {
    resolveScopeForOrder,
    resolveProcessorForOrder,
    isGatewayRefundableReference,
    resolveCardRefundAmount,
    reversePayment,
    reverseOrderPayment,
    chargeMxTerminal,
    NMI_PROCESSOR_ID,
    MX_PROCESSOR_ID,
};
