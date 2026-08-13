'use strict';

const logger = require('../utils/logger');
const { voidSale, refundToken } = require('./prochargeClient');
const { getAccountById } = require('./platformBillingAccount');

function isBillingDryRun() {
    const s = String(process.env.POS_BILLING_DRY_RUN ?? process.env.BILLING_DRY_RUN ?? 'true')
        .trim()
        .toLowerCase();
    return s !== 'false' && s !== '0' && s !== 'no';
}

async function getChargeById(pool, chargeId, accountId) {
    const [rows] = await pool.execute(
        `SELECT id, account_id, charge_type, amount, status,
                procharge_transaction_id, procharge_approval_code, refund_method
         FROM billing_charges
         WHERE id = ? AND account_id = ? LIMIT 1`,
        [chargeId, accountId]
    );
    return rows[0] || null;
}

async function markChargeRefunded(pool, chargeId, { method, refundTransactionId, note }) {
    await pool.execute(
        `UPDATE billing_charges SET
            status = 'refunded',
            refund_method = ?,
            procharge_refund_transaction_id = ?,
            refunded_at = CURRENT_TIMESTAMP,
            failure_reason = ?
         WHERE id = ?`,
        [
            method,
            refundTransactionId || null,
            note ? String(note).slice(0, 255) : null,
            chargeId
        ]
    );
}

/**
 * Void (same batch) or refund (settled) a paid billing charge via ProCharge.
 */
async function refundOrVoidCharge(pool, accountId, chargeId, { description, amountOverride } = {}) {
    const charge = await getChargeById(pool, chargeId, accountId);
    if (!charge) {
        const err = new Error('Billing charge not found');
        err.code = 'CHARGE_NOT_FOUND';
        throw err;
    }
    if (charge.status === 'refunded') {
        return { ok: true, skipped: true, chargeId, method: charge.refund_method || 'refunded' };
    }
    if (charge.status !== 'paid') {
        const err = new Error(`Charge is not refundable (status: ${charge.status})`);
        err.code = 'CHARGE_NOT_REFUNDABLE';
        throw err;
    }

    const amount = Math.round(Number(amountOverride ?? charge.amount) * 100) / 100;
    if (amount <= 0) {
        return { ok: true, skipped: true, chargeId, amount: 0 };
    }

    if (isBillingDryRun()) {
        await markChargeRefunded(pool, chargeId, {
            method: 'dry_run',
            refundTransactionId: null,
            note: description || 'Dry-run refund'
        });
        return { ok: true, dryRun: true, chargeId, amount, method: 'dry_run' };
    }

    const account = await getAccountById(pool, accountId);
    if (!account) {
        const err = new Error('Billing account not found');
        err.code = 'ACCOUNT_NOT_FOUND';
        throw err;
    }

    const refundDescription =
        description || `Business One refund — ${charge.charge_type} ($${amount.toFixed(2)})`;
    const orderNumber = `RF-${accountId}-${chargeId}-${Date.now()}`;
    let result = null;
    let method = null;

    if (account.paymentMethodType === 'ach') {
        const err = new Error(
            'ACH refunds are not supported via API — contact support for a manual reversal'
        );
        err.code = 'ACH_REFUND_UNSUPPORTED';
        throw err;
    }

    const txnId = charge.procharge_transaction_id;
    const approvalCode = charge.procharge_approval_code;

    if (txnId && approvalCode) {
        result = await voidSale({ transactionId: txnId, approvalCode });
        if (result.ok) {
            method = 'void';
        } else {
            logger.info('[procharge-refund] void failed, trying token refund', {
                chargeId,
                responseText: result.responseText
            });
        }
    }

    if (!result?.ok) {
        if (!account.prochargeToken) {
            const err = new Error('No vaulted card token available for refund');
            err.code = 'REFUND_NO_TOKEN';
            throw err;
        }
        result = await refundToken({
            amount,
            token: account.prochargeToken,
            orderNumber,
            email: account.billingEmail,
            name: account.businessName,
            description: refundDescription,
            transactionId: txnId || undefined,
            approvalCode: approvalCode || undefined
        });
        if (result.ok) {
            method = 'refund';
        }
    }

    if (!result?.ok) {
        const err = new Error(result?.responseText || 'ProCharge refund failed');
        err.code = 'REFUND_FAILED';
        throw err;
    }

    await markChargeRefunded(pool, chargeId, {
        method,
        refundTransactionId: result.transactionId || null,
        note: refundDescription
    });

    return {
        ok: true,
        chargeId,
        amount,
        method,
        transactionId: result.transactionId,
        approvalCode: result.approvalCode
    };
}

async function refundCharges(pool, accountId, chargeIds, { descriptionPrefix } = {}) {
    const results = [];
    for (const chargeId of chargeIds) {
        const r = await refundOrVoidCharge(pool, accountId, chargeId, {
            description: descriptionPrefix ? `${descriptionPrefix} (charge #${chargeId})` : undefined
        });
        results.push(r);
    }
    return results;
}

/**
 * Reverse signup billing charges when a later step (e.g. hardware) fails.
 */
async function compensateSignupBilling(pool, accountId, signupBilling, { reason } = {}) {
    if (!signupBilling?.charges?.length) {
        return { refunded: [] };
    }

    const chargeIds = signupBilling.charges
        .filter((c) => c.chargeId && c.ok !== false && !c.dryRun && !c.skipped)
        .map((c) => c.chargeId);

    const prefix = reason || 'Signup rollback';
    const refunded = chargeIds.length
        ? await refundCharges(pool, accountId, chargeIds, { descriptionPrefix: prefix })
        : [];

    if (signupBilling.buildContract?.contract?.id) {
        await pool.execute(
            `UPDATE billing_build_contracts SET
                status = 'canceled',
                canceled_at = CURRENT_TIMESTAMP,
                cancel_note = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND account_id = ?`,
            [reason || 'Signup canceled — charges reversed', signupBilling.buildContract.contract.id, accountId]
        );
        await pool.execute(
            `UPDATE billing_build_milestones SET
                status = CASE WHEN status = 'paid' THEN 'refunded' ELSE status END,
                updated_at = CURRENT_TIMESTAMP
             WHERE contract_id = ?`,
            [signupBilling.buildContract.contract.id]
        );
    }

    return { refunded, chargeIds };
}

module.exports = {
    getChargeById,
    markChargeRefunded,
    refundOrVoidCharge,
    refundCharges,
    compensateSignupBilling
};
