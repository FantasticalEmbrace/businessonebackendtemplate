'use strict';

const promoEngine = require('./webPromotionEngine');
const { getCardAmountDueForOrder } = require('./webCheckoutPayments');
const {
    normalizeStoreProcessor,
    resolveProcessorCredentials,
    resolvePosProcessorCredentials,
    MX_PROCESSOR_ID,
} = require('./storePaymentProcessor');
const { nmiReversePayment } = require('./nmiReversePayment');
const { voidPayment, refundPayment, getPayment } = require('./mxmerchantGateway');

const NON_GATEWAY_PREFIXES = ['gift_card:', 'pos:retry:', 'processing:', 'web:'];

function isGatewayRefundableReference(ref) {
    const r = String(ref || '').trim();
    if (!r) return false;
    return !NON_GATEWAY_PREFIXES.some((p) => r.startsWith(p));
}

function resolveScopeForOrder(order) {
    return String(order?.sales_channel || '').toLowerCase() === 'in_store' ? 'pos' : 'website';
}

function resolveProcessorForOrder(order, explicitProcessor) {
    if (explicitProcessor) return normalizeStoreProcessor(explicitProcessor);
    const stored = String(order?.payment_processor || '').trim().toLowerCase();
    if (stored) return normalizeStoreProcessor(stored);
    return 'epi';
}

function resolveCredentials(processor, scope) {
    return scope === 'pos' ? resolvePosProcessorCredentials(processor) : resolveProcessorCredentials(processor);
}

async function resolveCardRefundAmount(pool, order, requestedAmount) {
    const orderId = Number(order?.id);
    let maxRefundable = Number(order?.total_amount) || 0;
    if (pool && orderId > 0) {
        try {
            const cardDue = await getCardAmountDueForOrder(pool, orderId);
            if (cardDue > 0) maxRefundable = cardDue;
        } catch {
            /* use order total */
        }
    }
    if (requestedAmount == null || requestedAmount === '') {
        return promoEngine.roundMoney(maxRefundable);
    }
    const amt = promoEngine.roundMoney(Number(requestedAmount));
    if (!Number.isFinite(amt) || amt <= 0) {
        const err = new Error('REFUND_AMOUNT_INVALID');
        err.code = 'REFUND_AMOUNT_INVALID';
        err.message = 'Refund amount must be greater than zero.';
        throw err;
    }
    if (amt > maxRefundable + 0.02) {
        const err = new Error('REFUND_AMOUNT_EXCEEDS_CARD');
        err.code = 'REFUND_AMOUNT_EXCEEDS_CARD';
        err.message = `Refund amount cannot exceed the card portion ($${maxRefundable.toFixed(2)}).`;
        throw err;
    }
    return amt;
}

/**
 * Reverse a card payment at the processor (EPI/NMI share Direct Post; MX uses Checkout API).
 * @see https://developer.mxmerchant.com/docs/making-a-full-refund-or-void-a-transaction
 * @see https://developer.mxmerchant.com/docs/making-a-partial-refund
 * @see NMI Payment API type=void / type=refund
 */
async function reverseCardPayment({
    processor,
    scope = 'website',
    transactionId,
    paymentId,
    amount,
    operation = 'auto',
    paymentToken,
}) {
    const proc = normalizeStoreProcessor(processor);
    const txnRef = String(transactionId || paymentId || '').trim();
    const op = String(operation || 'auto').toLowerCase();
    const refundAmount = amount != null ? promoEngine.roundMoney(Number(amount)) : null;

    if (proc === MX_PROCESSOR_ID) {
        const payId = String(paymentId || transactionId || '').trim();
        if (!payId) {
            return { ok: false, responseText: 'MX payment ID required', processor: proc };
        }
        if (op === 'void') {
            const result = await voidPayment(payId, scope, { force: false });
            return { ...result, processor: proc, operation: 'void' };
        }
        const result = await refundPayment(payId, scope, {
            amount: refundAmount,
            force: true,
            paymentToken,
        });
        return {
            ...result,
            processor: proc,
            operation: result.partial ? 'refund' : result.ok ? 'refund_or_void' : 'refund',
        };
    }

    if (!txnRef) {
        return { ok: false, responseText: 'Transaction ID required', processor: proc };
    }

    const creds = resolveCredentials(proc, scope);
    const securityKey = creds.privateKey;
    if (!securityKey) {
        return { ok: false, responseText: 'Processor private API key not configured', processor: proc };
    }

    const result = await nmiReversePayment({
        securityKey,
        transactionId: txnRef,
        amount: refundAmount,
        transactUrl: creds.transactUrl,
        operation: op === 'auto' && refundAmount != null ? 'refund' : op,
    });
    return { ...result, processor: proc };
}

async function reverseOrderCardPayment(pool, order, options = {}) {
    const proc = resolveProcessorForOrder(order, options.processor);
    const scope = options.scope || resolveScopeForOrder(order);
    const payRef = String(order?.payment_reference || '').trim();
    const paymentToken = String(order?.payment_token || options.paymentToken || '').trim();

    if (!isGatewayRefundableReference(payRef)) {
        return {
            ok: true,
            skipped: true,
            responseText: payRef ? 'Payment reference is not a card gateway transaction' : 'No card payment on this order',
            processor: proc,
        };
    }

    const refundAmount = await resolveCardRefundAmount(pool, order, options.amount);
    const isPartial =
        refundAmount + 0.009 <
        (await resolveCardRefundAmount(pool, order, null));

    const operation =
        options.operation ||
        (isPartial ? 'refund' : 'auto');

    return reverseCardPayment({
        processor: proc,
        scope,
        transactionId: payRef,
        paymentId: payRef,
        amount: refundAmount,
        operation,
        paymentToken: paymentToken || undefined,
    });
}

/** Verify MX payment still exists and is refundable (admin diagnostics). */
async function inspectMxPayment(paymentId, scope = 'website') {
    return getPayment(paymentId, scope);
}

module.exports = {
    isGatewayRefundableReference,
    resolveScopeForOrder,
    resolveProcessorForOrder,
    resolveCardRefundAmount,
    reverseCardPayment,
    reverseOrderCardPayment,
    inspectMxPayment,
    MX_PROCESSOR_ID,
};
