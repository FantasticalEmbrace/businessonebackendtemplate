'use strict';

const { getAccountById, todayDateString } = require('./platformBillingAccount');

function principalAccountKey() {
    return String(process.env.BILLING_PRINCIPAL_ACCOUNT_KEY || 'default').trim();
}

function isPrincipalAccountKey(accountKey) {
    return String(accountKey || '').trim() === principalAccountKey();
}

function parsePrincipalMeta(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function defaultPrincipalContact() {
    return {
        businessName: String(process.env.BILLING_PRINCIPAL_BUSINESS_NAME || 'H&M Herbs & Vitamins').trim(),
        billingEmail: String(process.env.BILLING_PRINCIPAL_BILLING_EMAIL || 'hmherbs1@gmail.com').trim()
    };
}

function defaultBuildMeta() {
    const buildFull = Number(process.env.BILLING_PRINCIPAL_BUILD_FULL || 10000);
    const buildPaid = Number(process.env.BILLING_PRINCIPAL_BUILD_PAID || 5000);
    const remainingEnv = process.env.BILLING_PRINCIPAL_BUILD_REMAINING;
    const remaining =
        remainingEnv != null && String(remainingEnv).trim() !== ''
            ? Number(remainingEnv)
            : Math.max(0, buildFull - buildPaid);
    return {
        buildFullAmount: buildFull,
        buildPaidAmount: buildPaid,
        buildBalanceRemaining: remaining,
        buildLabel:
            process.env.BILLING_PRINCIPAL_BUILD_LABEL ||
            'E-commerce website build balance (50% courtesy discount already applied)',
        buildTier: 'ecommerce'
    };
}

async function getPrincipalMeta(pool, accountId) {
    const [rows] = await pool.execute(
        `SELECT principal_meta_json FROM billing_accounts WHERE id = ? LIMIT 1`,
        [accountId]
    );
    return parsePrincipalMeta(rows[0]?.principal_meta_json);
}

async function updatePrincipalMeta(pool, accountId, patch) {
    const existing = await getPrincipalMeta(pool, accountId);
    const merged = { ...existing, ...patch };
    await pool.execute(`UPDATE billing_accounts SET principal_meta_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
        JSON.stringify(merged),
        accountId
    ]);
    return merged;
}

/** Seed HM Herbs business name + billing email when missing. */
async function syncPrincipalContact(pool, accountId) {
    const { getAccountById, updateAccount } = require('./platformBillingAccount');
    const account = await getAccountById(pool, accountId);
    if (!account || !isPrincipalAccountKey(account.accountKey)) return;

    const defaults = defaultPrincipalContact();
    const accountPatch = {};
    if (!String(account.businessName || '').trim()) accountPatch.businessName = defaults.businessName;
    if (!String(account.billingEmail || '').trim()) accountPatch.billingEmail = defaults.billingEmail;
    if (Object.keys(accountPatch).length) {
        await updateAccount(pool, accountId, accountPatch);
    }

    const [licRows] = await pool.execute(
        `SELECT business_name, billing_email FROM pos_merchant_license WHERE id = 1 LIMIT 1`
    );
    const lic = licRows[0] || {};
    const licSets = [];
    const licVals = [];
    if (!String(lic.business_name || '').trim()) {
        licSets.push('business_name = ?');
        licVals.push(defaults.businessName);
    }
    if (!String(lic.billing_email || '').trim()) {
        licSets.push('billing_email = ?');
        licVals.push(defaults.billingEmail);
    }
    if (licSets.length) {
        await pool.execute(`UPDATE pos_merchant_license SET ${licSets.join(', ')} WHERE id = 1`, licVals);
    }
}

/** Seed build-balance metadata once for the principal merchant (HM Herbs). */
async function syncPrincipalMeta(pool, accountId) {
    await syncPrincipalContact(pool, accountId);
    const [rows] = await pool.execute(
        `SELECT account_key, principal_meta_json FROM billing_accounts WHERE id = ? LIMIT 1`,
        [accountId]
    );
    if (!rows.length || !isPrincipalAccountKey(rows[0].account_key)) return;

    const existing = parsePrincipalMeta(rows[0].principal_meta_json);
    if (existing.buildPaidOffAt) return;
    if (existing.buildBalanceRemaining != null && existing.buildFullAmount != null) return;

    await updatePrincipalMeta(pool, accountId, defaultBuildMeta());
}

async function assertPrincipalAccount(pool, account) {
    if (!account || !isPrincipalAccountKey(account.accountKey)) {
        const err = new Error('Principal billing is only available for the designated merchant account');
        err.code = 'NOT_PRINCIPAL_ACCOUNT';
        throw err;
    }
}

async function getPrincipalDashboard(pool, account) {
    await assertPrincipalAccount(pool, account);
    const { listSubscriptions, listHardwareCatalog } = require('./platformBillingAccount');
    const { computeMonthlyTotal } = require('./platformBillingRunner');
    const { computeHardwareCheckout } = require('./platformBillingPricing');
    const { refreshFailoverBillingForAccount, getMeteredFailoverGb } = require('./posFailoverMetering');
    const { FAILOVER_INCLUDED_GB, FAILOVER_OVERAGE_PER_GB } = require('./posBillingPricing');
    const { isPlatformBillingConfigured } = require('../utils/platformBillingEnv');
    const { isProchargeSandbox } = require('../utils/prochargeEnv');
    const { getModemBillingStatus } = require('./billingPrerequisites');

    await refreshFailoverBillingForAccount(pool, account.id);
    const failoverGbUsed = await getMeteredFailoverGb(pool, account.id);
    const modemBilling = await getModemBillingStatus(pool, account.id, account);

    const subscriptions = await listSubscriptions(pool, account.id);
    const statement = await computeMonthlyTotal(pool, account.id);
    const catalog = await listHardwareCatalog(pool);
    const principalMeta = await getPrincipalMeta(pool, account.id);

    const hardware = catalog.map((item) => {
        const checkout = computeHardwareCheckout(item.price);
        return {
            ...item,
            subtotal: item.price,
            taxAmount: checkout.taxAmount,
            total: checkout.total,
            taxRate: checkout.taxRate
        };
    });

    return {
        isPrincipal: true,
        configured: isPlatformBillingConfigured(),
        sandbox: isProchargeSandbox(),
        account,
        subscriptions,
        statement,
        hardware,
        principalMeta,
        failover: {
            gbUsed: failoverGbUsed,
            includedGb: FAILOVER_INCLUDED_GB,
            overagePerGb: FAILOVER_OVERAGE_PER_GB
        },
        modemBilling,
        buildBalance: {
            remaining: Number(principalMeta.buildBalanceRemaining) || 0,
            fullAmount: Number(principalMeta.buildFullAmount) || 0,
            paidAmount: Number(principalMeta.buildPaidAmount) || 0,
            label: principalMeta.buildLabel || defaultBuildMeta().buildLabel,
            paidOffAt: principalMeta.buildPaidOffAt || null,
            payMode: principalMeta.buildPayMode || null
        }
    };
}

module.exports = {
    principalAccountKey,
    isPrincipalAccountKey,
    parsePrincipalMeta,
    getPrincipalMeta,
    updatePrincipalMeta,
    syncPrincipalMeta,
    syncPrincipalContact,
    assertPrincipalAccount,
    getPrincipalDashboard,
    todayDateString
};
