'use strict';

const logger = require('../utils/logger');
const { chargeToken, achChargeToken, chargeCard } = require('./prochargeClient');
const { buildMonthlyLineItems } = require('./platformBillingPricing');
const {
    getAccountById,
    listSubscriptions,
    listUnbilledUsage,
    listActiveInstallments,
    todayDateString
} = require('./platformBillingAccount');
const {
    sendPaymentFailedEmail,
    sendPaymentSucceededEmail,
    sendPastDueWaivedEmail
} = require('./platformBillingEmail');
const {
    todayDateString: calendarToday,
    firstOfNextMonth,
    computeProration
} = require('./platformBillingCalendar');
const {
    createBuildContract,
    markMilestonePaid,
    markAllMilestonesPaid,
    markMilestonesForPrepay,
    markRemainingMilestonesFinanced,
    describeBuildFromHosting,
    normalizeBuildPayMode,
    computeBuildSignupAmount,
    computeBuildRemainderFinance,
    ONE_TIME_FINANCE_MONTHS
} = require('./websiteBuildBilling');
const { describeMonthlyPricing, hostingMonthlyAmount } = require('./platformBillingPricing');

function isBillingDryRun() {
    const s = String(process.env.POS_BILLING_DRY_RUN ?? process.env.BILLING_DRY_RUN ?? 'true')
        .trim()
        .toLowerCase();
    return s !== 'false' && s !== '0' && s !== 'no';
}

function getMaxBillingRetries() {
    return Math.max(0, Number(process.env.POS_BILLING_MAX_RETRIES || process.env.BILLING_MAX_RETRIES) || 3);
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function isCompedActive(account) {
    if (!account?.serviceCompedUntil) return false;
    return account.serviceCompedUntil >= todayDateString();
}

async function computeMonthlyTotal(pool, accountId, { periodMonth } = {}) {
    const month = periodMonth || todayDateString().slice(0, 7);
    const subscriptions = await listSubscriptions(pool, accountId);
    const usageLines = await listUnbilledUsage(pool, accountId, month);
    const installmentPlans = await listActiveInstallments(pool, accountId);
    return buildMonthlyLineItems({
        subscriptions: subscriptions.map((s) => ({
            ...s,
            product_type: s.productType,
            config_json: s.config
        })),
        usageLines,
        installmentPlans
    });
}

async function recordCharge(
    pool,
    accountId,
    { amount, chargeType, lineItems, status, transactionId, approvalCode, failureReason }
) {
    const [ins] = await pool.execute(
        `INSERT INTO billing_charges (account_id, charge_type, amount, status, procharge_transaction_id, procharge_approval_code, line_items_json, failure_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            accountId,
            chargeType,
            amount,
            status,
            transactionId || null,
            approvalCode || null,
            JSON.stringify(lineItems || []),
            failureReason || null
        ]
    );
    return ins.insertId;
}

async function setAccountNextBillDate(pool, accountId, date = new Date()) {
    const nextBill = calendarToday(firstOfNextMonth(date));
    await pool.execute(
        `UPDATE billing_accounts SET next_bill_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nextBill, accountId]
    );
    return nextBill;
}

async function recordChargeSuccess(pool, accountId, { grossAmount, billingAnchorDate } = {}) {
    const nextBill = calendarToday(firstOfNextMonth(billingAnchorDate || new Date()));
    await pool.execute(
        `UPDATE billing_accounts SET
            status = 'active',
            last_bill_amount = ?,
            last_bill_status = 'paid',
            last_bill_at = CURRENT_TIMESTAMP,
            next_bill_date = ?,
            past_due_since = NULL,
            billing_retry_count = 0,
            next_billing_retry_at = NULL,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [grossAmount, nextBill, accountId]
    );
}

async function recordChargeFailure(pool, accountId, account, { grossAmount }) {
    const retryCount = (Number(account.billingRetryCount) || 0) + 1;
    await pool.execute(
        `UPDATE billing_accounts SET
            status = 'past_due',
            last_bill_amount = ?,
            last_bill_status = 'failed',
            last_bill_at = CURRENT_TIMESTAMP,
            past_due_since = COALESCE(past_due_since, CURRENT_TIMESTAMP),
            billing_retry_count = ?,
            next_billing_retry_at = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [grossAmount, retryCount, todayDateString(addDays(new Date(), 1)), accountId]
    );
}

async function advanceInstallmentPlans(pool, accountId, lineItems) {
    const ids = lineItems
        .filter((l) => l.installmentPlanId)
        .map((l) => l.installmentPlanId);
    for (const id of ids) {
        await pool.execute(
            `UPDATE billing_installment_plans SET
                months_remaining = GREATEST(0, months_remaining - 1),
                status = CASE WHEN months_remaining <= 1 THEN 'completed' ELSE status END,
                next_due_date = DATE_FORMAT(DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH), '%Y-%m-%d'),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND account_id = ?`,
            [id, accountId]
        );
    }
}

async function markUsageBilled(pool, accountId, periodMonth, chargeId) {
    await pool.execute(
        `UPDATE billing_usage_lines SET billed_charge_id = ?
         WHERE account_id = ? AND period_month = ? AND billed_charge_id IS NULL`,
        [chargeId, accountId, periodMonth]
    );
}

async function executeProchargeCharge(account, amount, { orderNumber, description, isRecurring }) {
    if (account.paymentMethodType === 'ach' && account.achCustomerUuid) {
        return achChargeToken({
            customerUuid: account.achCustomerUuid,
            amount,
            description
        });
    }
    if (account.prochargeToken) {
        return chargeToken({
            amount,
            token: account.prochargeToken,
            orderNumber,
            email: account.billingEmail,
            name: account.businessName,
            isRecurring: Boolean(isRecurring),
            description
        });
    }
    return { ok: false, responseText: 'No payment method on file' };
}

async function chargeAccount(pool, accountId, { reason = 'monthly', force = false } = {}) {
    const account = await getAccountById(pool, accountId);
    if (!account) {
        const err = new Error('Billing account not found');
        err.code = 'ACCOUNT_NOT_FOUND';
        throw err;
    }

    const periodMonth = todayDateString().slice(0, 7);
    try {
        const { refreshFailoverBillingForAccount } = require('./posFailoverMetering');
        await refreshFailoverBillingForAccount(pool, accountId, periodMonth);
    } catch (e) {
        logger.warn('[platform-billing] failover usage sync failed', { message: e.message });
    }
    const { lines, subtotal } = await computeMonthlyTotal(pool, accountId, { periodMonth });
    const credit = Math.max(0, Number(account.billingCreditBalance) || 0);
    const chargeAmount = Math.max(0, Math.round((subtotal - credit) * 100) / 100);
    const dryRun = isBillingDryRun();

    if (isCompedActive(account)) {
        return { skipped: true, reason: 'comped', amount: subtotal, lines, dryRun };
    }

    const today = todayDateString();
    if (!force && account.nextBillDate && account.nextBillDate > today) {
        return { skipped: true, reason: 'not_due', amount: subtotal, nextBillDate: account.nextBillDate, lines, dryRun };
    }

    if (chargeAmount <= 0) {
        const chargeId = await recordCharge(pool, accountId, {
            amount: 0,
            chargeType: 'monthly_consolidated',
            lineItems: lines,
            status: 'paid',
            transactionId: null
        });
        await recordChargeSuccess(pool, accountId, { grossAmount: 0 });
        await markUsageBilled(pool, accountId, periodMonth, chargeId);
        await advanceInstallmentPlans(pool, accountId, lines);
        try {
            const { resetFailoverPeriodAfterBilling } = require('./posFailoverMetering');
            await resetFailoverPeriodAfterBilling(pool, accountId, periodMonth);
        } catch (e) {
            logger.warn('[platform-billing] failover reset after zero billing failed', {
                message: e.message
            });
        }
        if (credit > 0) {
            await pool.execute(
                `UPDATE billing_accounts SET billing_credit_balance = GREATEST(0, billing_credit_balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [Math.min(credit, subtotal), accountId]
            );
        }
        return { ok: true, skipped: true, reason: 'zero_balance', amount: 0, lines, dryRun };
    }

    if (!account.hasBillingVault) {
        return { skipped: true, reason: 'no_vault', amount: chargeAmount, lines, dryRun };
    }

    const { getMonthlyBillingBlocker } = require('./billingPrerequisites');
    const modemBlocker = await getMonthlyBillingBlocker(pool, accountId, account);
    if (modemBlocker) {
        return {
            skipped: true,
            reason: modemBlocker.reason,
            code: modemBlocker.code,
            message: modemBlocker.message,
            amount: chargeAmount,
            lines,
            dryRun
        };
    }

    if (dryRun) {
        return {
            skipped: true,
            reason: 'dry_run',
            amount: chargeAmount,
            lines,
            dryRun: true,
            message: `Would charge $${chargeAmount.toFixed(2)} (${reason})`
        };
    }

    const orderNumber = `BO-${accountId}-${Date.now()}`;
    const sale = await executeProchargeCharge(account, chargeAmount, {
        orderNumber,
        description: `Business One ${reason}`,
        isRecurring: reason === 'monthly' || reason === 'retry'
    });

    if (sale.ok) {
        const chargeId = await recordCharge(pool, accountId, {
            amount: chargeAmount,
            chargeType: reason === 'installment' ? 'installment' : 'monthly_consolidated',
            lineItems: lines,
            status: 'paid',
            transactionId: sale.transactionId,
            approvalCode: sale.approvalCode
        });
        await recordChargeSuccess(pool, accountId, { grossAmount: chargeAmount });
        if (credit > 0) {
            await pool.execute(
                `UPDATE billing_accounts SET billing_credit_balance = GREATEST(0, billing_credit_balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [Math.min(credit, subtotal), accountId]
            );
        }
        await markUsageBilled(pool, accountId, periodMonth, chargeId);
        await advanceInstallmentPlans(pool, accountId, lines);
        try {
            const { resetFailoverPeriodAfterBilling } = require('./posFailoverMetering');
            await resetFailoverPeriodAfterBilling(pool, accountId, periodMonth);
        } catch (e) {
            logger.warn('[platform-billing] failover reset after billing failed', { message: e.message });
        }
        const updated = await getAccountById(pool, accountId);
        await sendPaymentSucceededEmail(updated, { amount: chargeAmount, lines });
        return {
            ok: true,
            amount: chargeAmount,
            chargedAmount: chargeAmount,
            lines,
            transactionId: sale.transactionId,
            account: updated
        };
    }

    await recordCharge(pool, accountId, {
        amount: chargeAmount,
        chargeType: 'monthly_consolidated',
        lineItems: lines,
        status: 'failed',
        failureReason: sale.responseText
    });
    await recordChargeFailure(pool, accountId, account, { grossAmount: chargeAmount });
    const failed = await getAccountById(pool, accountId);
    await sendPaymentFailedEmail(failed, { amount: chargeAmount, lines });
    return {
        ok: false,
        amount: chargeAmount,
        lines,
        responseText: sale.responseText,
        code: 'CHARGE_FAILED',
        account: failed
    };
}

async function purchaseHardware(pool, accountId, {
    sku,
    quantity = 1,
    installmentMonths = 0,
    cardPayload,
    shipTo
}) {
    const { listHardwareCatalog, recordHardwareOrder } = require('./platformBillingAccount');
    const { computeInstallmentSchedule, isHardwareInstallmentEligible } = require('./platformBillingPricing');
    const catalog = await listHardwareCatalog(pool);
    const item = catalog.find((c) => c.sku === sku);
    if (!item) {
        const err = new Error('Hardware SKU not found');
        err.code = 'SKU_NOT_FOUND';
        throw err;
    }
    const qty = Math.max(1, Number(quantity) || 1);
    const subtotal = Math.round(item.price * qty * 100) / 100;
    const { computeHardwareCheckout } = require('./platformBillingPricing');
    const checkout = computeHardwareCheckout(subtotal);
    const total = checkout.total;
    const account = await getAccountById(pool, accountId);
    const months = Math.floor(Number(installmentMonths) || 0);

    if (months > 0 && item.installmentEligible && isHardwareInstallmentEligible(total)) {
        const { createInstallmentPlan } = require('./platformBillingAccount');
        const schedule = computeInstallmentSchedule(total, Math.min(months, item.maxInstallmentMonths));
        const planId = await createInstallmentPlan(pool, accountId, {
            sku,
            description: `${item.name} × ${qty}`,
            totalAmount: total,
            months: schedule.months
        });
        return { type: 'installment', planId, schedule, total };
    }

    if (isBillingDryRun()) {
        return { type: 'onetime', dryRun: true, subtotal, taxAmount: checkout.taxAmount, total, message: `Would charge $${total.toFixed(2)}` };
    }

    let sale;
    if (account?.hasBillingVault) {
        sale = await executeProchargeCharge(account, total, {
            orderNumber: `HW-${sku}-${Date.now()}`,
            description: `${item.name} × ${qty}`
        });
    } else if (cardPayload?.paymentToken || cardPayload?.payment_token) {
        sale = await chargeToken({
            amount: total,
            token: cardPayload.paymentToken || cardPayload.payment_token,
            orderNumber: `HW-${sku}-${Date.now()}`,
            description: `${item.name} × ${qty}`,
            email: cardPayload.billingEmail || cardPayload.email,
            name: cardPayload.cardholderName || cardPayload.name
        });
    } else if (cardPayload?.cardNumber) {
        sale = await chargeCard({
            amount: total,
            ...cardPayload,
            orderNumber: `HW-${sku}-${Date.now()}`,
            description: `${item.name} × ${qty}`
        });
    } else {
        const err = new Error('Payment method required for hardware purchase');
        err.code = 'PAYMENT_REQUIRED';
        throw err;
    }

    if (!sale.ok) {
        const err = new Error(sale.responseText || 'Hardware charge failed');
        err.code = 'CHARGE_FAILED';
        throw err;
    }

    const chargeId = await recordCharge(pool, accountId, {
        amount: total,
        chargeType: 'hardware_onetime',
        lineItems: [
            { code: 'hardware', label: `${item.name} × ${qty}`, amount: checkout.subtotal },
            { code: 'sales_tax', label: `Sales tax (${(checkout.taxRate * 100).toFixed(2)}%)`, amount: checkout.taxAmount }
        ],
        status: 'paid',
        transactionId: sale.transactionId,
        approvalCode: sale.approvalCode
    });

    if (shipTo && (shipTo.street1 || shipTo.street)) {
        await recordHardwareOrder(pool, accountId, {
            sku,
            quantity: qty,
            total,
            chargeId,
            shipTo,
            itemName: item.name
        });
    }

    return { type: 'onetime', ok: true, subtotal: checkout.subtotal, taxAmount: checkout.taxAmount, total, transactionId: sale.transactionId };
}

async function processAllAccountsMaintenance(pool) {
    const periodMonth = todayDateString().slice(0, 7);
    try {
        const { refreshFailoverBillingForAllAccounts } = require('./posFailoverMetering');
        await refreshFailoverBillingForAllAccounts(pool, periodMonth);
    } catch (e) {
        logger.warn('[platform-billing] failover pre-sync failed', { message: e.message });
    }

    const [rows] = await pool.execute(`SELECT id FROM billing_accounts WHERE status != 'canceled'`);
    const results = [];
    for (const row of rows) {
        try {
            const r = await chargeAccount(pool, row.id, { reason: 'monthly' });
            results.push({ accountId: row.id, ...r });
        } catch (e) {
            logger.error('[platform-billing] account maintenance failed', {
                accountId: row.id,
                message: e.message
            });
            results.push({ accountId: row.id, error: e.message });
        }
    }
    return { accounts: results.length, results };
}

async function waivePastDue(pool, accountId, { note, notify = true } = {}) {
    const account = await getAccountById(pool, accountId);
    if (!account || account.status !== 'past_due') {
        const err = new Error('Account is not past due');
        err.code = 'NOT_PAST_DUE';
        throw err;
    }
    const owed = Number(account.lastBillAmount) || 0;
    const nextBill = calendarToday(firstOfNextMonth());
    await pool.execute(
        `UPDATE billing_accounts SET
            status = 'active',
            last_bill_status = 'waived',
            last_bill_at = CURRENT_TIMESTAMP,
            next_bill_date = ?,
            past_due_since = NULL,
            billing_retry_count = 0,
            next_billing_retry_at = NULL,
            notes = CONCAT(COALESCE(notes, ''), ?),
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            todayDateString(nextBill),
            `\n[${new Date().toISOString().slice(0, 16)}] Waived $${owed.toFixed(2)}${note ? `: ${note}` : ''}`,
            accountId
        ]
    );
    const updated = await getAccountById(pool, accountId);
    if (notify) await sendPastDueWaivedEmail(updated, { amount: owed, reason: note });
    return updated;
}

async function payPrincipalBuildBalance(pool, accountId, { mode = 'full', installmentMonths, cardPayload } = {}) {
    const {
        getPrincipalMeta,
        updatePrincipalMeta,
        assertPrincipalAccount
    } = require('./principalBilling');
    const { createInstallmentPlan } = require('./platformBillingAccount');
    const { computeInstallmentSchedule } = require('./platformBillingPricing');

    const account = await getAccountById(pool, accountId);
    await assertPrincipalAccount(pool, account);

    const meta = await getPrincipalMeta(pool, accountId);
    const remaining = Number(meta.buildBalanceRemaining) || 0;
    if (remaining <= 0) {
        const err = new Error('Build balance already paid');
        err.code = 'BUILD_BALANCE_PAID';
        throw err;
    }

    const label = meta.buildLabel || 'Website build balance';

    if (mode === 'installment') {
        const months = Math.min(12, Math.max(3, Math.floor(Number(installmentMonths) || 6)));
        const schedule = computeInstallmentSchedule(remaining, months);
        const planId = await createInstallmentPlan(pool, accountId, {
            sku: 'principal-build-balance',
            description: label,
            totalAmount: remaining,
            months: schedule.months
        });
        await updatePrincipalMeta(pool, accountId, {
            buildBalanceRemaining: 0,
            buildPaidOffAt: todayDateString(),
            buildPayMode: 'installment',
            buildInstallmentPlanId: planId
        });
        return { type: 'installment', planId, schedule, total: remaining };
    }

    if (isBillingDryRun()) {
        return {
            type: 'onetime',
            dryRun: true,
            total: remaining,
            message: `Would charge $${remaining.toFixed(2)} for build balance`
        };
    }

    let sale;
    if (account?.hasBillingVault) {
        sale = await executeProchargeCharge(account, remaining, {
            orderNumber: `BUILD-${accountId}-${Date.now()}`,
            description: label
        });
    } else if (cardPayload?.paymentToken || cardPayload?.payment_token) {
        sale = await chargeToken({
            amount: remaining,
            token: cardPayload.paymentToken || cardPayload.payment_token,
            orderNumber: `BUILD-${accountId}-${Date.now()}`,
            description: label,
            email: cardPayload.billingEmail || cardPayload.email,
            name: cardPayload.cardholderName || cardPayload.name
        });
    } else if (cardPayload?.cardNumber) {
        sale = await chargeCard({
            amount: remaining,
            ...cardPayload,
            orderNumber: `BUILD-${accountId}-${Date.now()}`,
            description: label
        });
    } else {
        const err = new Error('Payment method required for build balance');
        err.code = 'PAYMENT_REQUIRED';
        throw err;
    }

    if (!sale.ok) {
        const err = new Error(sale.responseText || 'Build balance charge failed');
        err.code = 'CHARGE_FAILED';
        throw err;
    }

    await recordCharge(pool, accountId, {
        amount: remaining,
        chargeType: 'principal_build_balance',
        lineItems: [{ code: 'build_balance', label, amount: remaining }],
        status: 'paid',
        transactionId: sale.transactionId,
        approvalCode: sale.approvalCode
    });

    await updatePrincipalMeta(pool, accountId, {
        buildBalanceRemaining: 0,
        buildPaidOffAt: todayDateString(),
        buildPayMode: 'full',
        buildTransactionId: sale.transactionId
    });

    return { type: 'onetime', ok: true, total: remaining, transactionId: sale.transactionId };
}

async function chargeOneTimeFromAccount(pool, accountId, {
    amount,
    chargeType,
    lineItems,
    description,
    orderPrefix = 'BO'
}) {
    const total = Math.round(Number(amount) * 100) / 100;
    if (total <= 0) {
        return { ok: true, skipped: true, amount: 0, dryRun: isBillingDryRun() };
    }

    const account = await getAccountById(pool, accountId);
    if (!account) {
        const err = new Error('Billing account not found');
        err.code = 'ACCOUNT_NOT_FOUND';
        throw err;
    }

    if (isBillingDryRun()) {
        return {
            ok: true,
            dryRun: true,
            amount: total,
            message: `Would charge $${total.toFixed(2)} (${description || chargeType})`
        };
    }

    if (!account.hasBillingVault) {
        const err = new Error('Payment method required');
        err.code = 'PAYMENT_REQUIRED';
        throw err;
    }

    const orderNumber = `${orderPrefix}-${accountId}-${Date.now()}`;
    const sale = await executeProchargeCharge(account, total, {
        orderNumber,
        description: description || chargeType
    });

    if (!sale.ok) {
        const err = new Error(sale.responseText || 'Charge failed');
        err.code = 'CHARGE_FAILED';
        throw err;
    }

    const chargeId = await recordCharge(pool, accountId, {
        amount: total,
        chargeType,
        lineItems: lineItems || [{ code: chargeType, label: description || chargeType, amount: total }],
        status: 'paid',
        transactionId: sale.transactionId,
        approvalCode: sale.approvalCode
    });

    return {
        ok: true,
        amount: total,
        chargeId,
        transactionId: sale.transactionId,
        approvalCode: sale.approvalCode
    };
}

/**
 * At signup: prorated monthly (POS + hosting) through end of month + optional build prepay.
 * Sets next_bill_date to the 1st of the next calendar month.
 */
async function chargeSignupMonthlyAndBuild(pool, accountId, {
    licensedStationCount,
    hostingTier,
    includeBuild = false,
    buildPayMode = 'deposit',
    signupDate = new Date()
} = {}) {
    const posPricing = describeMonthlyPricing(licensedStationCount);
    const hostingAmount = hostingTier ? hostingMonthlyAmount(hostingTier) : 0;
    const fullMonthly = Math.round((posPricing.monthlyAmount + hostingAmount) * 100) / 100;
    const proration = computeProration(fullMonthly, signupDate);
    const charges = [];

    if (proration.proratedAmount > 0) {
        const proratedTotal = proration.proratedAmount;
        const lineItems = [];
        if (posPricing.monthlyAmount > 0 && fullMonthly > 0) {
            const posShare = Math.round((proratedTotal * (posPricing.monthlyAmount / fullMonthly)) * 100) / 100;
            if (posShare > 0) {
                lineItems.push({
                    code: 'pos_proration',
                    label: `POS — prorated ${proration.remainingDays}/${proration.daysInMonth} days`,
                    amount: posShare
                });
            }
        }
        if (hostingAmount > 0 && fullMonthly > 0) {
            const allocated = lineItems.reduce((s, l) => s + l.amount, 0);
            const hostShare = Math.round((proratedTotal - allocated) * 100) / 100;
            if (hostShare > 0) {
                lineItems.push({
                    code: 'hosting_proration',
                    label: `Web hosting — prorated ${proration.remainingDays}/${proration.daysInMonth} days`,
                    amount: hostShare
                });
            }
        }
        if (!lineItems.length) {
            lineItems.push({
                code: 'signup_proration',
                label: `Subscription — prorated ${proration.remainingDays}/${proration.daysInMonth} days`,
                amount: proratedTotal
            });
        }

        const monthlyCharge = await chargeOneTimeFromAccount(pool, accountId, {
            amount: proratedTotal,
            chargeType: 'signup_proration',
            lineItems,
            description: `Business One prorated subscription (${proration.remainingDays} days)`,
            orderPrefix: 'PROR'
        });
        charges.push({ type: 'proration', ...monthlyCharge, proration });
    }

    let buildContract = null;
    if (includeBuild && hostingTier) {
        const buildInfo = describeBuildFromHosting(hostingTier);
        const payMode = normalizeBuildPayMode(buildPayMode);
        const signupPlan = computeBuildSignupAmount(buildInfo.buildAmount, payMode);
        const buildChargeAmount = signupPlan.amount;
        if (buildChargeAmount > 0) {
            const isFullPay = payMode === 'full';
            const buildCharge = await chargeOneTimeFromAccount(pool, accountId, {
                amount: buildChargeAmount,
                chargeType: signupPlan.chargeType,
                lineItems: [
                    {
                        code: signupPlan.chargeType,
                        label: isFullPay
                            ? `${buildInfo.buildTier} website — paid in full at signup`
                            : `${buildInfo.buildTier} website — ${signupPlan.shortLabel}`,
                        amount: buildChargeAmount
                    }
                ],
                description: isFullPay
                    ? `Website build paid in full — ${buildInfo.formattedBuild}`
                    : `Website build ${signupPlan.pct}% upfront — ${buildInfo.formattedBuild}`,
                orderPrefix: 'BUILD'
            });
            if (!buildCharge.ok && !buildCharge.dryRun) {
                const err = new Error(
                    buildCharge.message ||
                        (isFullPay ? 'Full website build charge failed' : 'Website build upfront charge failed')
                );
                err.code = 'CHARGE_FAILED';
                throw err;
            }
            buildContract = await createBuildContract(pool, accountId, { hostingTier });
            if (buildContract?.contract?.id) {
                if (isFullPay) {
                    if (buildCharge.chargeId) {
                        await markAllMilestonesPaid(pool, buildContract.contract.id, buildCharge.chargeId);
                    }
                } else {
                    if (buildCharge.chargeId) {
                        await markMilestonesForPrepay(
                            pool,
                            buildContract.contract.id,
                            buildChargeAmount,
                            buildCharge.chargeId
                        );
                    }
                    const remainderFinance = computeBuildRemainderFinance(
                        buildInfo.buildAmount,
                        payMode,
                        ONE_TIME_FINANCE_MONTHS
                    );
                    if (remainderFinance.remaining > 0) {
                        await markRemainingMilestonesFinanced(pool, buildContract.contract.id);
                        const { createInstallmentPlan } = require('./platformBillingAccount');
                        const planId = await createInstallmentPlan(pool, accountId, {
                            sku: `build-${buildInfo.buildTier || hostingTier}`,
                            description: `${buildInfo.buildTier || 'Website'} build remaining balance`,
                            totalAmount: remainderFinance.remaining,
                            months: remainderFinance.months,
                            allowBelowMin: true
                        });
                        charges.push({
                            type: 'build_installment',
                            payMode,
                            planId,
                            remaining: remainderFinance.remaining,
                            months: remainderFinance.months,
                            monthlyAmount: remainderFinance.monthlyAmount
                        });
                    }
                }
            }
            charges.push({
                type: signupPlan.chargeType,
                payMode,
                payPct: signupPlan.pct,
                ...buildCharge,
                buildInfo
            });
        }
    }

    const nextBillDate = await setAccountNextBillDate(pool, accountId, signupDate);

    try {
        const { syncLicenseFromAccount } = require('./posMerchantLicense');
        await syncLicenseFromAccount(pool, accountId);
    } catch (e) {
        logger.warn('[platform-billing] syncLicenseFromAccount after signup failed', {
            message: e.message
        });
    }

    return {
        nextBillDate,
        fullMonthly,
        proration,
        charges,
        buildContract
    };
}

module.exports = {
    isBillingDryRun,
    computeMonthlyTotal,
    chargeAccount,
    purchaseHardware,
    payPrincipalBuildBalance,
    processAllAccountsMaintenance,
    waivePastDue,
    chargeOneTimeFromAccount,
    chargeSignupMonthlyAndBuild,
    setAccountNextBillDate
};
