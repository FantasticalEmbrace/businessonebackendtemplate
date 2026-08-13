'use strict';

const { nmiVoid, nmiRefund } = require('./nmiGateway');

/** NMI Direct Post API — official void/refund parameters (secure.nmi.com/api/transact.php). */
async function nmiReversePayment({ securityKey, transactionId, amount, transactUrl, operation = 'auto' }) {
    const txnId = String(transactionId || '').trim();
    if (!txnId) {
        return { ok: false, responseText: 'transactionId required', fields: {} };
    }
    const op = String(operation || 'auto').toLowerCase();
    const refundAmount = amount != null && Number(amount) > 0 ? Number(amount) : null;

    if (op === 'void') {
        const result = await nmiVoid({ securityKey, transactionId: txnId, transactUrl });
        return { ...result, operation: 'void' };
    }

    if (op === 'refund') {
        const result = await nmiRefund({
            securityKey,
            transactionId: txnId,
            amount: refundAmount,
            transactUrl,
        });
        return { ...result, operation: 'refund' };
    }

    // auto: void unsettled (full only), then refund settled (full or partial)
    const voidAttempt = await nmiVoid({ securityKey, transactionId: txnId, transactUrl });
    if (voidAttempt.ok) {
        return { ...voidAttempt, operation: 'void' };
    }

    const refundAttempt = await nmiRefund({
        securityKey,
        transactionId: txnId,
        amount: refundAmount,
        transactUrl,
    });
    return {
        ...refundAttempt,
        operation: 'refund',
        voidAttemptMessage: voidAttempt.responseText || null,
    };
}

module.exports = {
    nmiReversePayment,
};
