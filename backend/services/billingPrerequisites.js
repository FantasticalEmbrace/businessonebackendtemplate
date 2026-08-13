'use strict';

const { getPrincipalMeta, isPrincipalAccountKey } = require('./principalBilling');

function isModemRequiredBeforeMonthly() {
    const s = String(process.env.BILLING_REQUIRE_MODEM_BEFORE_MONTHLY ?? 'true')
        .trim()
        .toLowerCase();
    return s !== 'false' && s !== '0' && s !== 'no';
}

async function accountHasWtiModemOrder(pool, accountId) {
    const [rows] = await pool.execute(
        `SELECT id, sku, status, created_at FROM billing_hardware_orders
         WHERE account_id = ? AND sku LIKE 'wti-%'
         ORDER BY id DESC LIMIT 1`,
        [accountId]
    );
    return rows[0] || null;
}

async function isModemRequirementWaived(pool, accountId, account) {
    if (
        String(process.env.BILLING_PRINCIPAL_MODEM_WAIVED || '').trim().toLowerCase() === 'true' &&
        account &&
        isPrincipalAccountKey(account.accountKey)
    ) {
        return true;
    }
    if (!account || !isPrincipalAccountKey(account.accountKey)) return false;
    try {
        const meta = await getPrincipalMeta(pool, accountId);
        return Boolean(meta.modemRequirementWaived);
    } catch {
        return false;
    }
}

async function getModemBillingStatus(pool, accountId, account) {
    const required = isModemRequiredBeforeMonthly();
    if (!required) {
        return { required: false, ordered: true, waived: false, order: null, monthlyBillingAllowed: true };
    }
    const waived = await isModemRequirementWaived(pool, accountId, account);
    if (waived) {
        return { required: true, ordered: false, waived: true, order: null, monthlyBillingAllowed: true };
    }
    const order = await accountHasWtiModemOrder(pool, accountId);
    const ordered = Boolean(order);
    return {
        required: true,
        ordered,
        waived: false,
        order: order
            ? {
                  id: order.id,
                  sku: order.sku,
                  status: order.status,
                  orderedAt: order.created_at
              }
            : null,
        monthlyBillingAllowed: ordered
    };
}

async function getMonthlyBillingBlocker(pool, accountId, account) {
    const status = await getModemBillingStatus(pool, accountId, account);
    if (status.monthlyBillingAllowed) return null;
    return {
        code: 'MODEM_REQUIRED',
        reason: 'modem_required',
        message:
            'Monthly billing starts after a WTI failover modem is ordered. Place the modem order in billing first.'
    };
}

module.exports = {
    isModemRequiredBeforeMonthly,
    accountHasWtiModemOrder,
    getModemBillingStatus,
    getMonthlyBillingBlocker
};
