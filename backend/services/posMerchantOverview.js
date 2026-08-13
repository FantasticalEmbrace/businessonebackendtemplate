'use strict';

const logger = require('../utils/logger');
const { listDevices } = require('./posDeviceRegistry');
const { loadMerchantLicense } = require('./posMerchantLicense');
const { getStoreBaseUrl } = require('../utils/platformSupportEnv');

const ONLINE_WINDOW_MS = Math.max(30, Number(process.env.POS_SUPPORT_ONLINE_SECONDS) || 120) * 1000;

function startOfLocalDay(d = new Date()) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function startOfLocalWeek(d = new Date()) {
    const x = startOfLocalDay(d);
    const day = x.getDay(); // 0 Sun
    const diff = day === 0 ? 6 : day - 1; // Monday start
    x.setDate(x.getDate() - diff);
    return x;
}

function isOnline(lastSeenAt) {
    if (!lastSeenAt) return false;
    return Date.now() - new Date(lastSeenAt).getTime() <= ONLINE_WINDOW_MS;
}

async function sumSalesSince(pool, since) {
    const [rows] = await pool.execute(
        `SELECT COALESCE(sales_channel, 'online') AS channel,
                COUNT(*) AS order_count,
                COALESCE(SUM(total_amount), 0) AS total
         FROM orders
         WHERE payment_status = 'paid'
           AND created_at >= ?
         GROUP BY COALESCE(sales_channel, 'online')`,
        [since]
    );
    let inStore = 0;
    let online = 0;
    let inStoreOrders = 0;
    let onlineOrders = 0;
    for (const row of rows || []) {
        const ch = String(row.channel || 'online').toLowerCase();
        const total = Number(row.total) || 0;
        const count = Number(row.order_count) || 0;
        if (ch === 'in_store') {
            inStore += total;
            inStoreOrders += count;
        } else {
            online += total;
            onlineOrders += count;
        }
    }
    return {
        inStore: Math.round(inStore * 100) / 100,
        online: Math.round(online * 100) / 100,
        total: Math.round((inStore + online) * 100) / 100,
        inStoreOrders,
        onlineOrders,
        orders: inStoreOrders + onlineOrders
    };
}

async function countUnfulfilledOnline(pool) {
    try {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) AS c FROM orders
             WHERE payment_status = 'paid'
               AND COALESCE(sales_channel, 'online') = 'online'
               AND LOWER(COALESCE(status, '')) NOT IN (
                    'shipped', 'delivered', 'completed', 'cancelled', 'canceled',
                    'refunded', 'voided', 'returned'
               )`
        );
        return Number(rows[0]?.c) || 0;
    } catch (e) {
        logger.warn('[merchant-overview] unfulfilled count failed', e.message);
        return null;
    }
}

async function countLabelWork(pool) {
    let needsCreate = null;
    let unprinted = null;
    try {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) AS c
             FROM orders o
             WHERE o.payment_status = 'paid'
               AND COALESCE(o.sales_channel, 'online') = 'online'
               AND LOWER(COALESCE(o.status, '')) NOT IN (
                    'cancelled', 'canceled', 'refunded', 'voided', 'delivered'
               )
               AND (o.label_url IS NULL OR o.label_url = '')`
        );
        needsCreate = Number(rows[0]?.c) || 0;
    } catch {
        needsCreate = null;
    }
    try {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) AS c
             FROM orders o
             WHERE o.label_url IS NOT NULL
               AND o.label_url <> ''
               AND o.label_printed_at IS NULL
               AND LOWER(COALESCE(o.status, '')) NOT IN (
                    'cancelled', 'canceled', 'refunded', 'voided'
               )`
        );
        unprinted = Number(rows[0]?.c) || 0;
    } catch {
        unprinted = null;
    }
    return { needsCreate, unprinted };
}

async function countOpenSupportSessions(pool) {
    try {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) AS c FROM pos_register_support_sessions
             WHERE status IN ('pending', 'awaiting_consent', 'connecting', 'active')
               AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`
        );
        return Number(rows[0]?.c) || 0;
    } catch {
        return null;
    }
}

async function buildMerchantOverview(pool) {
    const storeBaseUrl = getStoreBaseUrl() || '';
    const posRegisterUrl = String(
        process.env.POS_REGISTER_URL || 'https://pos.businessonecomprehensive.com'
    ).replace(/\/+$/, '');

    const [today, week, devices, license, unfulfilled, labels, openSupport] = await Promise.all([
        sumSalesSince(pool, startOfLocalDay()),
        sumSalesSince(pool, startOfLocalWeek()),
        listDevices(pool).catch(() => []),
        loadMerchantLicense(pool).catch(() => null),
        countUnfulfilledOnline(pool),
        countLabelWork(pool),
        countOpenSupportSessions(pool)
    ]);

    const registerRows = (devices || []).map((d) => ({
        id: d.id,
        label: d.device_label,
        lastSeenAt: d.last_seen_at,
        online: isOnline(d.last_seen_at)
    }));
    const onlineCount = registerRows.filter((d) => d.online).length;

    let billing = null;
    try {
        const { ensureDefaultAccount, listSubscriptions } = require('./platformBillingAccount');
        const { computeMonthlyTotal } = require('./platformBillingRunner');
        const account = await ensureDefaultAccount(pool);
        const statement = await computeMonthlyTotal(pool, account.id);
        const subscriptions = await listSubscriptions(pool, account.id);
        billing = {
            status: account?.status || null,
            monthlyEstimate:
                statement?.subtotal != null ? Math.round(Number(statement.subtotal) * 100) / 100 : null,
            pastDue: Boolean(account?.pastDueSince),
            nextChargeAt: account?.nextBillDate || null,
            activeSubscriptions: (subscriptions || []).filter((s) => String(s.status).toLowerCase() === 'active')
                .length
        };
    } catch {
        billing = null;
    }

    return {
        ok: true,
        generatedAt: new Date().toISOString(),
        storeBaseUrl,
        sales: { today, week },
        registers: {
            active: registerRows.length,
            online: onlineCount,
            devices: registerRows
        },
        license: license
            ? {
                  status: license.status || null,
                  businessName: license.businessName || null,
                  stationsAllowed: license.licensedStationCount ?? null,
                  stationsUsed: registerRows.length,
                  expiresAt: license.licenseExpiresAt || null,
                  nextBillDate: license.nextBillDate || null,
                  serviceCompedUntil: license.serviceCompedUntil || null,
                  isComped: Boolean(license.isComped),
                  pastDueOwed: license.pastDueOwed != null ? Number(license.pastDueOwed) : 0
              }
            : null,
        billing,
        orders: {
            unfulfilledOnline: unfulfilled,
            labelsNeeded: labels.needsCreate,
            labelsUnprinted: labels.unprinted
        },
        support: {
            openSessions: openSupport
        },
        links: {
            store: storeBaseUrl || null,
            admin: storeBaseUrl ? `${storeBaseUrl}/admin.html` : null,
            pos: posRegisterUrl
        }
    };
}

module.exports = {
    buildMerchantOverview
};
