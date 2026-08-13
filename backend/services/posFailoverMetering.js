'use strict';

const logger = require('../utils/logger');
const { calculateFailoverOverage, FAILOVER_INCLUDED_GB, FAILOVER_OVERAGE_PER_GB } = require('./posBillingPricing');

const BYTES_PER_GB = 1024 ** 3;

function currentPeriodMonth(date = new Date()) {
    return date.toISOString().slice(0, 7);
}

function bytesToGb(bytes) {
    return Math.round((Math.max(0, Number(bytes) || 0) / BYTES_PER_GB) * 100) / 100;
}

async function resolveBillingAccountId(pool, { accountId, accountKey } = {}) {
    if (accountId != null && Number(accountId) > 0) {
        return Number(accountId);
    }
    const key = String(accountKey || '').trim();
    if (key) {
        const { getAccountByKey } = require('./platformBillingAccount');
        const account = await getAccountByKey(pool, key);
        if (account?.id) return account.id;
    }
    try {
        const [licenseRows] = await pool.execute(
            `SELECT billing_account_id FROM pos_merchant_license WHERE id = 1 LIMIT 1`
        );
        const linked = licenseRows[0]?.billing_account_id;
        if (linked) return Number(linked);
    } catch {
        /* optional */
    }
    const { ensureDefaultAccount } = require('./platformBillingAccount');
    const account = await ensureDefaultAccount(pool);
    return account.id;
}

async function getPeriodBytes(pool, accountId, periodMonth = currentPeriodMonth()) {
    const [rows] = await pool.execute(
        `SELECT bytes_used FROM pos_failover_usage_period
         WHERE account_id = ? AND period_month = ? LIMIT 1`,
        [accountId, periodMonth]
    );
    return Number(rows[0]?.bytes_used) || 0;
}

async function getMeteredFailoverGb(pool, accountId, periodMonth = currentPeriodMonth()) {
    const id = await resolveBillingAccountId(pool, { accountId });
    return bytesToGb(await getPeriodBytes(pool, id, periodMonth));
}

async function syncLicenseFailoverDisplay(pool, accountId, gbUsed) {
    try {
        const [licenseRows] = await pool.execute(
            `SELECT id, billing_account_id FROM pos_merchant_license WHERE id = 1 LIMIT 1`
        );
        const lic = licenseRows[0];
        if (!lic) return;
        if (lic.billing_account_id && Number(lic.billing_account_id) !== Number(accountId)) return;
        await pool.execute(`UPDATE pos_merchant_license SET failover_gb_used = ? WHERE id = 1`, [gbUsed]);
    } catch {
        /* optional */
    }
}

async function recordFailoverUsage(pool, { accountId, accountKey, bytesDelta, bytesTotal, source = 'register' } = {}) {
    const resolvedAccountId = await resolveBillingAccountId(pool, { accountId, accountKey });
    const periodMonth = currentPeriodMonth();
    const delta = Math.max(0, Math.floor(Number(bytesDelta) || 0));
    const total = bytesTotal != null ? Math.max(0, Math.floor(Number(bytesTotal))) : null;

    if (total == null && delta <= 0) {
        const bytesUsed = await getPeriodBytes(pool, resolvedAccountId, periodMonth);
        return {
            accountId: resolvedAccountId,
            periodMonth,
            bytesUsed,
            gbUsed: bytesToGb(bytesUsed)
        };
    }

    if (total != null) {
        await pool.execute(
            `INSERT INTO pos_failover_usage_period (account_id, period_month, bytes_used, last_source, last_reported_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE
                bytes_used = GREATEST(bytes_used, VALUES(bytes_used)),
                last_source = VALUES(last_source),
                last_reported_at = CURRENT_TIMESTAMP`,
            [resolvedAccountId, periodMonth, total, String(source).slice(0, 32)]
        );
    } else {
        await pool.execute(
            `INSERT INTO pos_failover_usage_period (account_id, period_month, bytes_used, last_source, last_reported_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE
                bytes_used = bytes_used + VALUES(bytes_used),
                last_source = VALUES(last_source),
                last_reported_at = CURRENT_TIMESTAMP`,
            [resolvedAccountId, periodMonth, delta, String(source).slice(0, 32)]
        );
    }

    const bytesUsed = await getPeriodBytes(pool, resolvedAccountId, periodMonth);
    const gbUsed = bytesToGb(bytesUsed);
    await syncFailoverToBilling(pool, resolvedAccountId, periodMonth, { gbUsed, bytesUsed });
    await syncLicenseFailoverDisplay(pool, resolvedAccountId, gbUsed);

    return { accountId: resolvedAccountId, periodMonth, bytesUsed, gbUsed };
}

async function syncFailoverToBilling(pool, accountId, periodMonth = currentPeriodMonth(), precomputed) {
    const gbUsed = precomputed?.gbUsed ?? bytesToGb(await getPeriodBytes(pool, accountId, periodMonth));
    const overage = calculateFailoverOverage(gbUsed);

    await pool.execute(
        `DELETE FROM billing_usage_lines
         WHERE account_id = ? AND period_month = ? AND usage_type = 'failover_overage' AND billed_charge_id IS NULL`,
        [accountId, periodMonth]
    );

    if (overage > 0) {
        const label = `Failover data over ${FAILOVER_INCLUDED_GB} GB (${gbUsed.toFixed(1)} GB used @ $${FAILOVER_OVERAGE_PER_GB}/GB)`;
        await pool.execute(
            `INSERT INTO billing_usage_lines (account_id, period_month, usage_type, quantity, amount, label)
             VALUES (?, ?, 'failover_overage', ?, ?, ?)`,
            [accountId, periodMonth, gbUsed, overage, label]
        );
    }

    await syncLicenseFailoverDisplay(pool, accountId, gbUsed);
    return { gbUsed, overage };
}

async function refreshFailoverBillingForAccount(pool, accountId, periodMonth = currentPeriodMonth()) {
    const id = await resolveBillingAccountId(pool, { accountId });
    return syncFailoverToBilling(pool, id, periodMonth);
}

async function refreshFailoverBillingForAllAccounts(pool, periodMonth = currentPeriodMonth()) {
    const [rows] = await pool.execute(`SELECT id FROM billing_accounts WHERE status != 'canceled'`);
    const results = [];
    for (const row of rows) {
        try {
            const r = await syncFailoverToBilling(pool, row.id, periodMonth);
            results.push({ accountId: row.id, ...r });
        } catch (e) {
            logger.warn('[failover-metering] account sync failed', { accountId: row.id, message: e.message });
            results.push({ accountId: row.id, error: e.message });
        }
    }
    return results;
}

async function resetFailoverPeriodAfterBilling(pool, accountId, periodMonth = currentPeriodMonth()) {
    const id = await resolveBillingAccountId(pool, { accountId });
    await pool.execute(
        `DELETE FROM pos_failover_usage_period WHERE account_id = ? AND period_month = ?`,
        [id, periodMonth]
    );
    await syncLicenseFailoverDisplay(pool, id, 0);
}

module.exports = {
    currentPeriodMonth,
    bytesToGb,
    resolveBillingAccountId,
    getPeriodBytes,
    getMeteredFailoverGb,
    recordFailoverUsage,
    syncFailoverToBilling,
    refreshFailoverBillingForAccount,
    refreshFailoverBillingForAllAccounts,
    resetFailoverPeriodAfterBilling
};
