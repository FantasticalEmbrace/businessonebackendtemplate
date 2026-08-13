'use strict';

const crypto = require('crypto');
const { chargeHostedToken } = require('./prochargeClient');
const { ensureAccountForSignup } = require('./platformBillingAccount');
const { isBillingDryRun } = require('./platformBillingRunner');
const {
    isCustomPaymentEnabled,
    getCustomPaymentMinAmount,
    getCustomPaymentMaxAmount,
    getCustomPaymentAccessKey,
    assertCustomPaymentAccess
} = require('../utils/customPaymentEnv');

function roundMoney(amount) {
    return Math.round(Number(amount) * 100) / 100;
}

function validateAmount(amount) {
    const total = roundMoney(amount);
    const min = getCustomPaymentMinAmount();
    const max = getCustomPaymentMaxAmount();
    if (!Number.isFinite(total) || total < min) {
        const err = new Error(`Amount must be at least $${min.toFixed(2)}.`);
        err.code = 'AMOUNT_TOO_LOW';
        throw err;
    }
    if (total > max) {
        const err = new Error(`Amount cannot exceed $${max.toFixed(2)}. Contact us for larger invoices.`);
        err.code = 'AMOUNT_TOO_HIGH';
        throw err;
    }
    return total;
}

function validateDescription(description) {
    const desc = String(description || '').trim().replace(/\s+/g, ' ');
    if (desc.length < 3) {
        const err = new Error('Please describe what this payment is for.');
        err.code = 'DESCRIPTION_REQUIRED';
        throw err;
    }
    if (desc.length > 240) {
        const err = new Error('Description is too long (240 characters max).');
        err.code = 'DESCRIPTION_TOO_LONG';
        throw err;
    }
    return desc;
}

function describeCustomPaymentInfo() {
    return {
        enabled: isCustomPaymentEnabled(),
        minAmount: getCustomPaymentMinAmount(),
        maxAmount: getCustomPaymentMaxAmount(),
        requiresAccessKey: Boolean(getCustomPaymentAccessKey()),
        paymentReady: isCustomPaymentEnabled()
    };
}

async function recordCustomCharge(pool, accountId, {
    amount,
    description,
    reference,
    transactionId,
    approvalCode
}) {
    const lineItems = [
        {
            code: 'custom_payment',
            label: description,
            amount,
            reference: reference || null
        }
    ];
    const [ins] = await pool.execute(
        `INSERT INTO billing_charges (account_id, charge_type, amount, status, procharge_transaction_id, procharge_approval_code, line_items_json)
         VALUES (?, 'custom_payment', ?, 'paid', ?, ?, ?)`,
        [accountId, amount, transactionId || null, approvalCode || null, JSON.stringify(lineItems)]
    );
    return ins.insertId;
}

async function chargeCustomPayment(pool, body = {}) {
    if (!isCustomPaymentEnabled()) {
        const err = new Error('Custom payments are not available right now. Call (850) 290-2084.');
        err.code = 'CUSTOM_PAYMENT_DISABLED';
        throw err;
    }

    assertCustomPaymentAccess(body.accessKey || body.access_key);

    if (!body?.authorized) {
        const err = new Error('Authorization required');
        err.code = 'AUTHORIZATION_REQUIRED';
        throw err;
    }

    const amount = validateAmount(body.amount);
    const description = validateDescription(body.description);
    const reference = String(body.reference || body.invoiceRef || '').trim().slice(0, 64);
    const businessName = String(body.businessName || body.business_name || '').trim().slice(0, 200);
    const billingEmail = String(body.billingEmail || body.billing_email || '').trim();
    const cardholderName = String(body.cardholderName || body.cardholder_name || businessName || '').trim();
    const phone = String(body.phone || '').trim().slice(0, 32);
    const paymentToken = String(body.payment_token || body.paymentToken || '').trim();

    if (!billingEmail) {
        const err = new Error('Billing email is required.');
        err.code = 'EMAIL_REQUIRED';
        throw err;
    }
    if (!businessName) {
        const err = new Error('Business or customer name is required.');
        err.code = 'NAME_REQUIRED';
        throw err;
    }
    if (!paymentToken) {
        const err = new Error('Complete the secure payment fields before submitting.');
        err.code = 'PAYMENT_TOKEN_REQUIRED';
        throw err;
    }
    if (body.paymentMethodType === 'ach') {
        const err = new Error('Bank payments for custom invoices are not available online yet. Use card or call (850) 290-2084.');
        err.code = 'ACH_NOT_SUPPORTED';
        throw err;
    }

    if (isBillingDryRun()) {
        return {
            ok: true,
            dryRun: true,
            amount,
            description,
            reference: reference || null,
            message: `Would charge $${amount.toFixed(2)} for “${description}”.`
        };
    }

    const account = await ensureAccountForSignup(pool, { businessName, billingEmail });
    const orderNumber = `CUSTOM-${account.id}-${Date.now()}`;
    const chargeDescription = reference ? `${description} (ref ${reference})` : description;

    let sale;
    sale = await chargeHostedToken({
        amount,
        token: paymentToken,
        orderNumber,
        email: billingEmail,
        name: cardholderName || businessName,
        description: chargeDescription,
        postalCode: body.postalCode || body.postal_code
    });

    if (!sale?.ok) {
        const err = new Error(sale?.responseText || 'Payment was declined.');
        err.code = 'CHARGE_FAILED';
        throw err;
    }

    const chargeId = await recordCustomCharge(pool, account.id, {
        amount,
        description: chargeDescription,
        reference,
        transactionId: sale.transactionId,
        approvalCode: sale.approvalCode
    });

    return {
        ok: true,
        amount,
        description: chargeDescription,
        reference: reference || null,
        chargeId,
        transactionId: sale.transactionId,
        approvalCode: sale.approvalCode,
        accountId: account.id,
        businessName: account.businessName,
        billingEmail: account.billingEmail,
        phone: phone || null,
        message: `Payment of $${amount.toFixed(2)} was approved.`
    };
}

function buildCustomPaymentLinkSignature({ amount, description, expiresAt }) {
    const secret = String(process.env.CUSTOM_PAYMENT_LINK_SECRET || '').trim();
    if (!secret) return null;
    const payload = `${roundMoney(amount)}|${validateDescription(description)}|${Number(expiresAt) || 0}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyCustomPaymentLinkSignature({ amount, description, expiresAt, signature }) {
    const secret = String(process.env.CUSTOM_PAYMENT_LINK_SECRET || '').trim();
    if (!secret) return { ok: true, locked: false };
    const sig = String(signature || '').trim();
    if (!sig) {
        return { ok: false, locked: true, reason: 'Signed payment link required.' };
    }
    const exp = Number(expiresAt) || 0;
    if (exp && Date.now() > exp) {
        return { ok: false, locked: true, reason: 'This payment link has expired.' };
    }
    const expected = buildCustomPaymentLinkSignature({ amount, description, expiresAt: exp });
    const a = Buffer.from(sig);
    const b = Buffer.from(expected || '');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { ok: false, locked: true, reason: 'Invalid payment link signature.' };
    }
    return { ok: true, locked: true };
}

module.exports = {
    describeCustomPaymentInfo,
    chargeCustomPayment,
    validateAmount,
    validateDescription,
    buildCustomPaymentLinkSignature,
    verifyCustomPaymentLinkSignature
};
