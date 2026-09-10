'use strict';

/**
 * Safely label unpaid checkout drafts after a payment attempt.
 * Never touches paid/refunded orders, never sets payment_reference,
 * and never changes order.status — so retries and finalizePaidOrder stay intact.
 *
 * Allowed outcomes: declined | failed
 */
async function markUnpaidPaymentOutcome(pool, orderId, paymentStatus) {
    const oid = Number(orderId);
    const next = String(paymentStatus || '')
        .trim()
        .toLowerCase();
    if (!Number.isFinite(oid) || oid < 1) return { updated: false, reason: 'invalid_order' };
    if (next !== 'declined' && next !== 'failed') {
        return { updated: false, reason: 'invalid_status' };
    }

    const [result] = await pool.execute(
        `UPDATE orders
            SET payment_status = ?
          WHERE id = ?
            AND status = 'pending'
            AND LOWER(COALESCE(payment_status, '')) IN ('pending', 'failed', 'declined')
            AND (payment_reference IS NULL OR TRIM(payment_reference) = '')`,
        [next, oid]
    );
    return { updated: Number(result.affectedRows) > 0, reason: 'ok' };
}

/**
 * NMI response=2 is an issuer/processor decline.
 * response=3 (and other non-1) are gateway/system errors → failed.
 */
function nmiUnpaidOutcomeFromSale(sale) {
    const code = String(sale?.responseCode ?? sale?.fields?.response ?? '').trim();
    if (code === '2') return 'declined';
    return 'failed';
}

module.exports = {
    markUnpaidPaymentOutcome,
    nmiUnpaidOutcomeFromSale,
};
