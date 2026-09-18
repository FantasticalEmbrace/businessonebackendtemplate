'use strict';

const logger = require('../utils/logger');
const { getProgramSettings } = require('./loyaltyTierProgram');
const { recalculateCustomerTier } = require('./loyaltyTierEngine');
const { loadLoyaltyProgramSettings, earnLoyaltyForOrder } = require('./customerLoyalty');
const { getNonEarnTenderTotal } = require('./webCheckoutPayments');

const BACKFILL_SOURCE = 'system';

function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
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

async function resolveUserIdForOrder(pool, order) {
    const direct = Number(order?.user_id);
    if (Number.isFinite(direct) && direct > 0) return direct;

    const email = String(order?.email || '').trim().toLowerCase();
    if (!email) return null;

    const [[user]] = await pool.execute(
        `SELECT id FROM users
          WHERE LOWER(email) = ? AND COALESCE(customer_status, '') != 'deleted'
          LIMIT 1`,
        [email]
    );
    return user?.id ? Number(user.id) : null;
}

async function linkPaidOrdersToUsersByEmail(pool, { dryRun = false } = {}) {
    if (dryRun) {
        const [[row]] = await pool.execute(
            `SELECT COUNT(*) AS cnt
               FROM orders o
               JOIN users u ON LOWER(u.email) = LOWER(o.email)
              WHERE o.payment_status = 'paid'
                AND o.user_id IS NULL
                AND COALESCE(u.customer_status, '') != 'deleted'`
        );
        return { linked: Number(row?.cnt) || 0, dryRun: true };
    }

    const [result] = await pool.execute(
        `UPDATE orders o
           JOIN users u ON LOWER(u.email) = LOWER(o.email)
            SET o.user_id = u.id
          WHERE o.payment_status = 'paid'
            AND o.user_id IS NULL
            AND COALESCE(u.customer_status, '') != 'deleted'`
    );
    return { linked: Number(result.affectedRows) || 0, dryRun: false };
}

async function findPaidOrdersMissingEarn(pool, limit = 5000) {
    const lim = Math.min(10000, Math.max(1, Number(limit) || 5000));
    const [rows] = await pool.execute(
        `SELECT o.id, o.user_id, o.email, o.subtotal, o.sales_channel, o.created_at
           FROM orders o
          WHERE o.payment_status = 'paid'
            AND NOT EXISTS (
                SELECT 1 FROM loyalty_transactions lt
                 WHERE lt.order_id = o.id AND lt.transaction_type = 'earn'
            )
          ORDER BY o.created_at ASC
          LIMIT ${lim}`
    );
    return rows || [];
}

async function hasLifetimeSpendBackfill(pool, userId) {
    const [[row]] = await pool.execute(
        `SELECT id FROM loyalty_transactions
          WHERE user_id = ? AND transaction_type = 'earn' AND order_id IS NULL
            AND description LIKE ?
          LIMIT 1`,
        [userId, '%on lifetime spend%']
    );
    return Boolean(row);
}

/**
 * Credit paid orders that never got a loyalty earn row.
 * Uses the same earnLoyaltyForOrder path as checkout finalize (tier rates when enabled).
 * Resolves guest checkouts by matching order email → customer account.
 */
async function backfillMissingOrderEarns(pool, { dryRun = false, limit = 5000 } = {}) {
    const loyaltySettings = await loadLoyaltyProgramSettings(pool);
    if (!loyaltySettings.enabled) {
        return { skipped: true, reason: 'disabled', ordersCredited: 0, ordersSkipped: 0, errors: [] };
    }

    const orders = await findPaidOrdersMissingEarn(pool, limit);
    const byUser = new Map();

    for (const order of orders) {
        const userId = await resolveUserIdForOrder(pool, order);
        if (!userId) {
            continue;
        }
        if (!byUser.has(userId)) byUser.set(userId, []);
        byUser.get(userId).push(order);
    }

    const result = {
        ordersScanned: orders.length,
        ordersMatchedToUser: [...byUser.values()].reduce((n, list) => n + list.length, 0),
        ordersCredited: 0,
        ordersSkipped: 0,
        cashCredited: 0,
        pointsCredited: 0,
        customersAffected: 0,
        errors: [],
        dryRun: Boolean(dryRun),
    };

    for (const [userId, userOrders] of byUser.entries()) {
        let touched = false;
        for (const order of userOrders) {
            try {
                if (await orderAlreadyEarned(pool, order.id)) {
                    result.ordersSkipped++;
                    continue;
                }

                const nonEarn = await getNonEarnTenderTotal(pool, order.id);
                const eligibleSubtotal = Math.max(0, roundMoney(Number(order.subtotal) - nonEarn));
                if (eligibleSubtotal <= 0) {
                    result.ordersSkipped++;
                    continue;
                }

                if (dryRun) {
                    result.ordersCredited++;
                    touched = true;
                    continue;
                }

                if (!order.user_id) {
                    await pool.execute('UPDATE orders SET user_id = ? WHERE id = ? AND user_id IS NULL', [
                        userId,
                        order.id,
                    ]);
                }

                const channel = String(order.sales_channel || '').toLowerCase();
                const source = channel === 'in_store' ? 'pos' : BACKFILL_SOURCE;
                const earnResult = await earnLoyaltyForOrder(
                    pool,
                    userId,
                    order.id,
                    eligibleSubtotal,
                    loyaltySettings,
                    source
                );

                const cashEarned = Number(earnResult?.cashEarned) || 0;
                const pointsEarned = Number(earnResult?.pointsEarned) || 0;
                if (cashEarned > 0 || pointsEarned > 0) {
                    result.ordersCredited++;
                    result.cashCredited = roundMoney(result.cashCredited + cashEarned);
                    result.pointsCredited += pointsEarned;
                    touched = true;
                } else {
                    result.ordersSkipped++;
                }

                try {
                    await recalculateCustomerTier(pool, userId, { sendPromotionEmail: false });
                } catch (tierErr) {
                    logger.warn('[loyalty-earn-backfill] tier recalc skipped:', userId, tierErr.message);
                }
            } catch (err) {
                result.errors.push({
                    orderId: order.id,
                    userId,
                    message: err?.message || String(err),
                });
                logger.error('[loyalty-earn-backfill] order error:', order.id, err);
            }
        }
        if (touched) result.customersAffected++;
    }

    return result;
}

/**
 * Credit imported lifetime spend when there are no (or insufficient) paid orders in DB.
 */
async function backfillImportedLifetimeSpend(pool, { dryRun = false } = {}) {
    const { earnTierRewardsForOrder } = require('./loyaltyTierEngine');
    const settings = await getProgramSettings(pool);
    if (!settings.enabled) {
        return { skipped: true, reason: 'disabled', credited: 0, skippedUsers: 0, errors: [] };
    }

    const [users] = await pool.execute(
        `SELECT u.id, u.lifetime_value, cl.cash_balance, cl.points_balance, cl.tier
           FROM users u
           JOIN customer_loyalty cl ON cl.user_id = u.id
          WHERE u.customer_status != 'deleted'
            AND COALESCE(u.lifetime_value, 0) >= 250
            AND COALESCE(cl.cash_balance, 0) <= 0
            AND COALESCE(cl.points_balance, 0) <= 0`
    );

    const result = { credited: 0, skippedUsers: 0, errors: [], dryRun: Boolean(dryRun) };

    for (const user of users || []) {
        const userId = Number(user.id);
        try {
            if (await hasLifetimeSpendBackfill(pool, userId)) {
                result.skippedUsers++;
                continue;
            }

            const [[paidAgg]] = await pool.execute(
                `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal), 0) AS subtotal_sum
                   FROM orders
                  WHERE payment_status = 'paid'
                    AND (user_id = ? OR LOWER(email) = (SELECT LOWER(email) FROM users WHERE id = ? LIMIT 1))`,
                [userId, userId]
            );
            const paidCount = Number(paidAgg?.n) || 0;

            const [[earnAgg]] = await pool.execute(
                `SELECT COUNT(*) AS n FROM loyalty_transactions
                  WHERE user_id = ? AND transaction_type = 'earn'`,
                [userId]
            );
            const earnCount = Number(earnAgg?.n) || 0;

            const lifetime = roundMoney(user.lifetime_value);
            if (lifetime < 250) {
                result.skippedUsers++;
                continue;
            }

            if (earnCount > 0 && paidCount > 0) {
                result.skippedUsers++;
                continue;
            }

            if (dryRun) {
                result.credited++;
                continue;
            }

            await recalculateCustomerTier(pool, userId, { sendPromotionEmail: false });
            const earnResult = await earnTierRewardsForOrder(pool, userId, null, lifetime, 'system');

            if (earnResult.earned) {
                result.credited++;
            } else {
                result.skippedUsers++;
            }
        } catch (err) {
            result.errors.push({ userId, message: err?.message || String(err) });
            logger.error('[loyalty-earn-backfill] lifetime user error:', userId, err);
        }
    }

    return result;
}

async function runFullLoyaltyEarnBackfill(pool, options = {}) {
    // Default: do NOT run lifetime import credit (avoids surprise balances).
    // Pass includeLifetime: true only when intentionally importing lifetime spend.
    const includeLifetime = options.includeLifetime === true;
    const linkResult = await linkPaidOrdersToUsersByEmail(pool, options);
    const orderResult = await backfillMissingOrderEarns(pool, options);
    const lifetimeResult = includeLifetime
        ? await backfillImportedLifetimeSpend(pool, options)
        : { skipped: true, reason: 'includeLifetime_false' };
    return { linkResult, orderResult, lifetimeResult };
}

module.exports = {
    BACKFILL_SOURCE,
    resolveUserIdForOrder,
    linkPaidOrdersToUsersByEmail,
    backfillMissingOrderEarns,
    backfillImportedLifetimeSpend,
    runFullLoyaltyEarnBackfill,
};
