'use strict';

const logger = require('../utils/logger');
const { earnTierRewardsForOrder, recalculateCustomerTier } = require('./loyaltyTierEngine');
const { getNonEarnTenderTotal } = require('./webCheckoutPayments');

const BACKFILL_SOURCE = 'program_enable_backfill';
const DEFAULT_LOOKBACK_DAYS = 30;

function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
}

function parseEnableAt(raw) {
    if (!raw) return null;
    const d = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Half-open window [enableAt - lookbackDays, enableAt). */
function computeBackfillWindow(enableAt, lookbackDays = DEFAULT_LOOKBACK_DAYS) {
    const end = parseEnableAt(enableAt);
    if (!end) return null;
    const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    return { start, end };
}

async function orderAlreadyEarned(pool, orderId) {
    const [[row]] = await pool.execute(
        `SELECT id FROM loyalty_transactions
          WHERE order_id = ? AND transaction_type = 'earn'
          LIMIT 1`,
        [orderId]
    );
    return Boolean(row);
}

async function findPreEnablePaidOrders(pool, windowStart, windowEnd) {
    const [rows] = await pool.execute(
        `SELECT o.id, o.user_id, o.subtotal, o.sales_channel, o.updated_at
           FROM orders o
          WHERE o.payment_status = 'paid'
            AND o.user_id IS NOT NULL
            AND o.updated_at >= ?
            AND o.updated_at < ?
          ORDER BY o.user_id ASC, o.updated_at ASC`,
        [windowStart, windowEnd]
    );
    return rows || [];
}

/**
 * One-time credit for paid orders finalized in the 30 days before program enable.
 * Uses lifetime tier qualification at backfill time; dedupes via loyalty_transactions.
 */
async function backfillPreEnableLoyaltyRewards(pool, enableAt, { lookbackDays = DEFAULT_LOOKBACK_DAYS } = {}) {
    const window = computeBackfillWindow(enableAt, lookbackDays);
    if (!window) {
        return { skipped: true, reason: 'invalid_enable_at' };
    }

    const { start: windowStart, end: windowEnd } = window;
    const orders = await findPreEnablePaidOrders(pool, windowStart, windowEnd);

    const affectedUserIds = new Set();
    const result = {
        enableAt: windowEnd.toISOString(),
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        lookbackDays,
        ordersScanned: orders.length,
        ordersCredited: 0,
        ordersSkipped: 0,
        customersAffected: 0,
        errors: [],
    };

    for (const order of orders) {
        try {
            if (await orderAlreadyEarned(pool, order.id)) {
                result.ordersSkipped++;
                continue;
            }

            const nonEarn = await getNonEarnTenderTotal(pool, order.id);
            const eligibleSubtotal = Math.max(0, roundMoney(Number(order.subtotal) - nonEarn));
            const earnResult = await earnTierRewardsForOrder(
                pool,
                order.user_id,
                order.id,
                eligibleSubtotal,
                BACKFILL_SOURCE
            );

            if (earnResult.earned) {
                result.ordersCredited++;
                affectedUserIds.add(order.user_id);
            } else {
                result.ordersSkipped++;
            }
        } catch (err) {
            result.errors.push({ orderId: order.id, message: err?.message || String(err) });
            logger.error('[loyalty-backfill] order error:', order.id, err);
        }
    }

    for (const userId of affectedUserIds) {
        try {
            await recalculateCustomerTier(pool, userId, { sendPromotionEmail: false });
        } catch (err) {
            logger.error('[loyalty-backfill] tier recalc error:', userId, err);
        }
    }

    result.customersAffected = affectedUserIds.size;
    return result;
}

module.exports = {
    BACKFILL_SOURCE,
    DEFAULT_LOOKBACK_DAYS,
    computeBackfillWindow,
    orderAlreadyEarned,
    findPreEnablePaidOrders,
    backfillPreEnableLoyaltyRewards,
};
