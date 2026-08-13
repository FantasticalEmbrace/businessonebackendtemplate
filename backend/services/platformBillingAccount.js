'use strict';

const { isProchargeConfigured } = require('../utils/prochargeEnv');
const {
    tokenizeCard,
    achAddCustomer
} = require('./prochargeClient');

const DEFAULT_ACCOUNT_KEY = 'default';

function todayDateString(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function mapAccountRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        accountKey: row.account_key,
        storeInstanceId: row.store_instance_id,
        businessName: row.business_name || '',
        billingEmail: row.billing_email || '',
        status: row.status,
        paymentMethodType: row.payment_method_type || 'none',
        hasBillingVault: Boolean(
            (row.procharge_token && row.payment_method_type === 'card') ||
                (row.ach_customer_uuid && row.payment_method_type === 'ach')
        ),
        prochargeToken: row.procharge_token || null,
        achCustomerUuid: row.ach_customer_uuid || null,
        billingAuthorizedAt: row.billing_authorized_at,
        billingCreditBalance: Number(row.billing_credit_balance) || 0,
        serviceCompedUntil: row.service_comped_until
            ? String(row.service_comped_until).slice(0, 10)
            : null,
        pastDueSince: row.past_due_since,
        billingRetryCount: Number(row.billing_retry_count) || 0,
        nextBillingRetryAt: row.next_billing_retry_at
            ? String(row.next_billing_retry_at).slice(0, 10)
            : null,
        graceDaysOverride: row.grace_days_override != null ? Number(row.grace_days_override) : null,
        nextBillDate: row.next_bill_date ? String(row.next_bill_date).slice(0, 10) : null,
        lastBillAmount: row.last_bill_amount != null ? Number(row.last_bill_amount) : null,
        lastBillStatus: row.last_bill_status || null,
        lastBillAt: row.last_bill_at,
        notes: row.notes || ''
    };
}

async function getAccountByKey(pool, accountKey = DEFAULT_ACCOUNT_KEY) {
    const [rows] = await pool.execute(
        `SELECT * FROM billing_accounts WHERE account_key = ? LIMIT 1`,
        [accountKey]
    );
    return mapAccountRow(rows[0]);
}

async function getAccountById(pool, accountId) {
    const [rows] = await pool.execute(`SELECT * FROM billing_accounts WHERE id = ? LIMIT 1`, [
        accountId
    ]);
    return mapAccountRow(rows[0]);
}

async function ensureDefaultAccount(pool) {
    let account = await getAccountByKey(pool);
    if (account) return account;
    const [ins] = await pool.execute(
        `INSERT INTO billing_accounts (account_key, status) VALUES (?, 'trial')`,
        [DEFAULT_ACCOUNT_KEY]
    );
    return getAccountById(pool, ins.insertId);
}

/** Per-merchant billing account for public signup — never reuse principal `default`. */
async function ensureAccountForSignup(pool, { businessName, billingEmail }) {
    const email = String(billingEmail || '').trim().toLowerCase();
    if (!email) {
        const err = new Error('Billing email is required');
        err.code = 'EMAIL_REQUIRED';
        throw err;
    }

    const [byEmail] = await pool.execute(
        `SELECT * FROM billing_accounts
         WHERE LOWER(billing_email) = ? AND account_key != ?
         ORDER BY id DESC LIMIT 1`,
        [email, DEFAULT_ACCOUNT_KEY]
    );
    if (byEmail.length) {
        const existing = mapAccountRow(byEmail[0]);
        await updateAccount(pool, existing.id, {
            businessName: String(businessName || '').trim().slice(0, 200),
            billingEmail: email
        });
        return getAccountById(pool, existing.id);
    }

    const slug = email.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'merchant';
    let accountKey = `merchant-${slug}`;
    let suffix = 0;
    while (await getAccountByKey(pool, accountKey)) {
        suffix += 1;
        accountKey = `merchant-${slug}-${suffix}`;
    }

    const [ins] = await pool.execute(
        `INSERT INTO billing_accounts (account_key, business_name, billing_email, status)
         VALUES (?, ?, ?, 'trial')`,
        [accountKey, String(businessName || '').trim().slice(0, 200), email]
    );
    return getAccountById(pool, ins.insertId);
}

async function updateAccount(pool, accountId, fields) {
    const sets = [];
    const vals = [];
    const allowed = {
        businessName: 'business_name',
        billingEmail: 'billing_email',
        status: 'status',
        serviceCompedUntil: 'service_comped_until',
        graceDaysOverride: 'grace_days_override',
        nextBillDate: 'next_bill_date',
        notes: 'notes'
    };
    for (const [jsKey, col] of Object.entries(allowed)) {
        if (fields[jsKey] !== undefined) {
            sets.push(`${col} = ?`);
            vals.push(fields[jsKey]);
        }
    }
    if (!sets.length) return getAccountById(pool, accountId);
    vals.push(accountId);
    await pool.execute(
        `UPDATE billing_accounts SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        vals
    );
    return getAccountById(pool, accountId);
}

async function listSubscriptions(pool, accountId) {
    const [rows] = await pool.execute(
        `SELECT * FROM billing_subscriptions WHERE account_id = ? ORDER BY id`,
        [accountId]
    );
    return rows.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        productType: row.product_type,
        status: row.status,
        config:
            row.config_json && typeof row.config_json === 'object'
                ? row.config_json
                : row.config_json
                  ? JSON.parse(row.config_json)
                  : {},
        monthlyAmountOverride:
            row.monthly_amount_override != null ? Number(row.monthly_amount_override) : null,
        nextBillDate: row.next_bill_date ? String(row.next_bill_date).slice(0, 10) : null
    }));
}

async function upsertSubscription(
    pool,
    accountId,
    productType,
    { status = 'active', config = {}, monthlyAmountOverride = undefined } = {}
) {
    const [existing] = await pool.execute(
        `SELECT id FROM billing_subscriptions WHERE account_id = ? AND product_type = ? LIMIT 1`,
        [accountId, productType]
    );
    const configJson = JSON.stringify(config);
    if (existing.length) {
        if (monthlyAmountOverride !== undefined) {
            await pool.execute(
                `UPDATE billing_subscriptions SET status = ?, config_json = ?, monthly_amount_override = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [status, configJson, monthlyAmountOverride, existing[0].id]
            );
        } else {
            await pool.execute(
                `UPDATE billing_subscriptions SET status = ?, config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [status, configJson, existing[0].id]
            );
        }
        return existing[0].id;
    }
    const [ins] = await pool.execute(
        `INSERT INTO billing_subscriptions (account_id, product_type, status, config_json, monthly_amount_override) VALUES (?, ?, ?, ?, ?)`,
        [
            accountId,
            productType,
            status,
            configJson,
            monthlyAmountOverride !== undefined ? monthlyAmountOverride : null
        ]
    );
    return ins.insertId;
}

async function listUnbilledUsage(pool, accountId, periodMonth) {
    const [rows] = await pool.execute(
        `SELECT * FROM billing_usage_lines
         WHERE account_id = ? AND period_month = ? AND billed_charge_id IS NULL`,
        [accountId, periodMonth]
    );
    return rows;
}

async function listActiveInstallments(pool, accountId) {
    const [rows] = await pool.execute(
        `SELECT * FROM billing_installment_plans
         WHERE account_id = ? AND status = 'active' AND months_remaining > 0`,
        [accountId]
    );
    return rows;
}

async function addUsageLine(pool, accountId, { periodMonth, usageType, quantity, amount, label }) {
    await pool.execute(
        `INSERT INTO billing_usage_lines (account_id, period_month, usage_type, quantity, amount, label)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [accountId, periodMonth, usageType, quantity, amount, label || null]
    );
}

async function savePaymentMethod(pool, accountId, payload) {
    if (!isProchargeConfigured()) {
        const err = new Error('ProCharge platform billing is not configured.');
        err.code = 'BILLING_NOT_CONFIGURED';
        throw err;
    }

    const { assertNoRawPaymentData } = require('../utils/paymentPayloadValidation');
    assertNoRawPaymentData(payload);

    const paymentMethodType = payload.paymentMethodType === 'ach' ? 'ach' : 'card';

    if (paymentMethodType === 'ach') {
        const achToken = payload.paymentToken || payload.prochargeToken;
        if (achToken) {
            await pool.execute(
                `UPDATE billing_accounts SET
                    payment_method_type = 'ach',
                    procharge_token = ?,
                    ach_customer_uuid = NULL,
                    billing_authorized_at = CURRENT_TIMESTAMP,
                    status = CASE WHEN status = 'canceled' THEN 'active' ELSE status END,
                    past_due_since = NULL,
                    billing_retry_count = 0,
                    next_billing_retry_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [String(achToken), accountId]
            );
            if (payload.businessName || payload.billingEmail) {
                await updateAccount(pool, accountId, {
                    businessName: payload.businessName,
                    billingEmail: payload.billingEmail
                });
            }
            return getAccountById(pool, accountId);
        }

        const bank = payload.bankAccount || {};
        const added = await achAddCustomer({
            name: payload.businessName || payload.name || 'Business One customer',
            email: payload.billingEmail || payload.email,
            bankAccount: {
                routing_number: bank.routingNumber || bank.routing_number,
                account_number: bank.accountNumber || bank.account_number,
                account_type: bank.accountType || bank.account_type || 'checking'
            }
        });
        if (!added.ok || !added.customerUuid) {
            const err = new Error(added.responseText || 'Failed to save bank account');
            err.code = 'ACH_VAULT_FAILED';
            throw err;
        }
        await pool.execute(
            `UPDATE billing_accounts SET
                payment_method_type = 'ach',
                ach_customer_uuid = ?,
                procharge_token = NULL,
                billing_authorized_at = CURRENT_TIMESTAMP,
                status = CASE WHEN status = 'canceled' THEN 'active' ELSE status END,
                past_due_since = NULL,
                billing_retry_count = 0,
                next_billing_retry_at = NULL,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [added.customerUuid, accountId]
        );
    } else {
        let token = payload.paymentToken || payload.prochargeToken;
        if (!token && payload.cardNumber) {
            const tokenized = await tokenizeCard({
                cardNumber: payload.cardNumber,
                ccExpMonth: payload.ccExpMonth,
                ccExpYear: payload.ccExpYear,
                cvv: payload.cvv,
                name: payload.cardholderName || payload.businessName,
                postalCode: payload.postalCode,
                street1: payload.street1,
                email: payload.billingEmail
            });
            if (!tokenized.ok) {
                const err = new Error(tokenized.responseText || 'Card tokenization failed');
                err.code = 'TOKENIZE_FAILED';
                throw err;
            }
            token = tokenized.token;
        }
        if (!token) {
            const err = new Error('payment_token or card details required');
            err.code = 'PAYMENT_TOKEN_REQUIRED';
            throw err;
        }
        await pool.execute(
            `UPDATE billing_accounts SET
                payment_method_type = 'card',
                procharge_token = ?,
                ach_customer_uuid = NULL,
                billing_authorized_at = CURRENT_TIMESTAMP,
                status = CASE WHEN status = 'canceled' THEN 'active' ELSE status END,
                past_due_since = NULL,
                billing_retry_count = 0,
                next_billing_retry_at = NULL,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [String(token), accountId]
        );
    }

    if (payload.businessName || payload.billingEmail) {
        await updateAccount(pool, accountId, {
            businessName: payload.businessName,
            billingEmail: payload.billingEmail
        });
    }

    return getAccountById(pool, accountId);
}

async function listHardwareCatalog(pool, { signupOnly = false } = {}) {
    const signupFilter = signupOnly ? ' AND signup_visible = 1' : '';
    const [rows] = await pool.execute(
        `SELECT sku, name, price, description, installment_eligible, max_installment_months
         FROM billing_hardware_catalog WHERE active = 1${signupFilter} ORDER BY sort_order ASC, name ASC`
    );
    return rows.map((r) => ({
        sku: r.sku,
        name: r.name,
        price: Number(r.price),
        description: r.description || '',
        installmentEligible: Boolean(r.installment_eligible),
        maxInstallmentMonths: Number(r.max_installment_months) || 12
    }));
}

async function recordHardwareOrder(pool, accountId, {
    sku,
    quantity,
    total,
    chargeId = null,
    shipTo = {},
    itemName = ''
}) {
    const [ins] = await pool.execute(
        `INSERT INTO billing_hardware_orders
            (account_id, charge_id, sku, quantity, total_amount, ship_name, ship_street, ship_city, ship_state, ship_zip, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            accountId,
            chargeId,
            sku,
            Math.max(1, Number(quantity) || 1),
            total,
            String(shipTo.name || shipTo.shipName || '').trim().slice(0, 200) || null,
            String(shipTo.street1 || shipTo.street || '').trim().slice(0, 255) || null,
            String(shipTo.city || '').trim().slice(0, 100) || null,
            String(shipTo.state || '').trim().slice(0, 32) || null,
            String(shipTo.postalCode || shipTo.zip || '').trim().slice(0, 20) || null,
            itemName ? `Order: ${itemName}` : null
        ]
    );
    return ins.insertId;
}

async function createInstallmentPlan(pool, accountId, {
    sku,
    description,
    totalAmount,
    months,
    allowBelowMin = false
}) {
    const { computeInstallmentSchedule, isHardwareInstallmentEligible } = require('./platformBillingPricing');
    const total = Number(totalAmount);
    if (!allowBelowMin && !isHardwareInstallmentEligible(total)) {
        const err = new Error(`Installment plans require at least $${process.env.BILLING_HARDWARE_MIN_INSTALLMENT || 300}.`);
        err.code = 'INSTALLMENT_MIN_NOT_MET';
        throw err;
    }
    if (total <= 0) {
        const err = new Error('Installment total must be greater than zero');
        err.code = 'INSTALLMENT_AMOUNT_INVALID';
        throw err;
    }
    const schedule = computeInstallmentSchedule(total, months);
    const [ins] = await pool.execute(
        `INSERT INTO billing_installment_plans
            (account_id, sku, description, total_amount, months_total, months_remaining, monthly_amount, status, next_due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [
            accountId,
            sku,
            description || sku,
            schedule.total,
            schedule.months,
            schedule.months,
            schedule.monthlyAmount,
            todayDateString()
        ]
    );
    return ins.insertId;
}

module.exports = {
    DEFAULT_ACCOUNT_KEY,
    todayDateString,
    mapAccountRow,
    getAccountByKey,
    getAccountById,
    ensureDefaultAccount,
    ensureAccountForSignup,
    updateAccount,
    listSubscriptions,
    upsertSubscription,
    listUnbilledUsage,
    listActiveInstallments,
    addUsageLine,
    savePaymentMethod,
    listHardwareCatalog,
    recordHardwareOrder,
    createInstallmentPlan
};
