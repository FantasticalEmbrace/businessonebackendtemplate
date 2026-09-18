'use strict';

const logger = require('../utils/logger');
const InventoryService = require('./inventory');
const { sendOrderConfirmationEmail } = require('./orderConfirmationEmail');
const { loadLoyaltyProgramSettings, earnLoyaltyForOrder } = require('./customerLoyalty');
const { fulfillGiftCardsForOrder } = require('./giftCardFulfillment');
const { getNonEarnTenderTotal } = require('./webCheckoutPayments');

async function recalcUserOrderAggregates(connection, userId) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) return;
    const [[agg]] = await connection.execute(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(total_amount), 0) AS spent,
                MAX(updated_at) AS last_done
           FROM orders
          WHERE user_id = ? AND payment_status = 'paid'`,
        [uid]
    );
    const n = Number(agg.n) || 0;
    const spent = Number(agg.spent) || 0;
    const avg = n > 0 ? spent / n : 0;
    await connection.execute(
        `UPDATE users
            SET total_orders = ?,
                lifetime_value = ?,
                last_order_at = ?,
                avg_order_value = ?
          WHERE id = ?`,
        [n, spent, agg.last_done, avg, uid]
    );
}

/**
 * Resolve loyalty/account user for an order: prefer orders.user_id, else match users.email.
 * Guest checkout with a known account email still earns store credit / points.
 */
async function resolveOrderCustomerUserId(connectionOrPool, orderRow) {
    const direct = Number(orderRow?.user_id);
    if (Number.isFinite(direct) && direct > 0) return direct;

    const email = String(orderRow?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return null;

    const [[user]] = await connectionOrPool.execute(
        `SELECT id FROM users
          WHERE LOWER(email) = ?
            AND COALESCE(customer_status, '') != 'deleted'
          LIMIT 1`,
        [email]
    );
    const uid = Number(user?.id);
    return Number.isFinite(uid) && uid > 0 ? uid : null;
}

/**
 * Completes a pending order: set paid, deduct inventory, update user aggregates.
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ orderId: number, paymentId: string, paymentStatus: string, skipConfirmationEmail?: boolean }} opts
 */
async function finalizePaidOrder(
    pool,
    {
        orderId,
        paymentId,
        paymentStatus,
        paymentProcessor,
        paymentToken,
        skipConfirmationEmail = false,
        allowOversell = false,
        orderStatus = 'processing'
    }
) {
    const oid = Number(orderId);
    if (!Number.isFinite(oid) || oid < 1) {
        const err = new Error('INVALID_ORDER');
        err.code = 'INVALID_ORDER';
        throw err;
    }

    const [orders] = await pool.execute('SELECT * FROM orders WHERE id = ? AND status = ?', [oid, 'pending']);

    if (orders.length === 0) {
        const err = new Error('ORDER_NOT_PENDING');
        err.code = 'ORDER_NOT_PENDING';
        throw err;
    }

    const orderRow = orders[0];
    const orderHadUserId = Boolean(Number(orderRow.user_id) > 0);
    // Email match is best-effort — never block payment finalize / cart checkout.
    let loyaltyUserId = null;
    try {
        loyaltyUserId = await resolveOrderCustomerUserId(pool, orderRow);
    } catch (resolveErr) {
        logger.error(`Order ${oid} loyalty user resolve error:`, resolveErr);
        loyaltyUserId = Number(orderRow.user_id) > 0 ? Number(orderRow.user_id) : null;
    }

    const [orderItems] = await pool.execute(
        `
            SELECT oi.*, p.name as product_name, p.sku, p.track_inventory
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        `,
        [oid]
    );

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        const paidStatus = paymentStatus || 'paid';
        const nextOrderStatus = String(orderStatus || 'processing').trim() || 'processing';
        let statusUpdated = false;
        if (paymentId) {
            const proc = paymentProcessor ? String(paymentProcessor).trim() : null;
            const token = paymentToken ? String(paymentToken).trim() : null;
            const [upd] = await connection.execute(
                `UPDATE orders
                    SET status = ?,
                        payment_status = ?,
                        payment_reference = ?,
                        payment_processor = COALESCE(?, payment_processor),
                        payment_token = COALESCE(?, payment_token)
                  WHERE id = ? AND status = 'pending'`,
                [nextOrderStatus, paidStatus, String(paymentId).trim(), proc, token, oid]
            );
            statusUpdated = upd.affectedRows > 0;
        } else {
            const [upd] = await connection.execute(
                `UPDATE orders
                    SET status = ?,
                        payment_status = ?
                  WHERE id = ? AND status = 'pending'`,
                [nextOrderStatus, paidStatus, oid]
            );
            statusUpdated = upd.affectedRows > 0;
        }

        if (!statusUpdated) {
            const err = new Error('ORDER_NOT_PENDING');
            err.code = 'ORDER_NOT_PENDING';
            throw err;
        }

        if (loyaltyUserId && !orderRow.user_id) {
            await connection.execute(
                `UPDATE orders SET user_id = ? WHERE id = ? AND user_id IS NULL`,
                [loyaltyUserId, oid]
            );
            orderRow.user_id = loyaltyUserId;
            logger.info(`Order ${oid} linked to user ${loyaltyUserId} by checkout email`);
        }

        const inventoryService = new InventoryService(pool);
        const inventoryItems = orderItems.map((item) => ({
            productId: item.product_id,
            variantId: item.variant_id,
            quantity: item.quantity
        }));

        await inventoryService.deductInventoryForOrder(
            inventoryItems,
            oid,
            `Order #${oid} completed - Payment ID: ${paymentId}`,
            { allowOversell }
        );

        if (loyaltyUserId) {
            await recalcUserOrderAggregates(connection, loyaltyUserId);
        }

        await connection.commit();
        logger.info(`Order ${oid} finalized (payment ${paymentId})`);

        if (loyaltyUserId) {
            try {
                const loyaltySettings = await loadLoyaltyProgramSettings(pool);
                if (loyaltySettings.enabled) {
                    const [[alreadyEarned]] = await pool.execute(
                        `SELECT id FROM loyalty_transactions
                          WHERE order_id = ? AND transaction_type = 'earn'
                          LIMIT 1`,
                        [oid]
                    );
                    if (!alreadyEarned) {
                        const channel = String(orderRow.sales_channel || '').toLowerCase();
                        const source = channel === 'in_store' ? 'pos' : 'web';
                        const nonEarn = await getNonEarnTenderTotal(pool, oid);
                        const eligibleSubtotal = Math.max(
                            0,
                            Math.round((Number(orderRow.subtotal) - nonEarn) * 100) / 100
                        );
                        // When tiers are enabled, earn % comes from the customer's tier
                        // (base + frequency bonus). No flat loyalty_cashback_percent fallback.
                        const earnResult = await earnLoyaltyForOrder(
                            pool,
                            loyaltyUserId,
                            oid,
                            eligibleSubtotal,
                            loyaltySettings,
                            source
                        );
                        logger.info(`Order ${oid} loyalty earn applied`, {
                            userId: loyaltyUserId,
                            matchedByEmail: !orderHadUserId,
                            eligibleSubtotal,
                            cashEarned: earnResult?.cashEarned || 0,
                            pointsEarned: earnResult?.pointsEarned || 0,
                            cashbackPercent: earnResult?.cashbackPercent,
                            earnRateSource: earnResult?.earnRateSource,
                            earnTierKey: earnResult?.earnTierKey,
                            source
                        });
                    }
                }
            } catch (loyaltyErr) {
                logger.error(`Order ${oid} loyalty earn error:`, loyaltyErr);
            }
        }

        void fulfillGiftCardsForOrder(pool, oid).catch((giftErr) => {
            logger.error(`Order ${oid} gift card fulfillment error:`, giftErr);
        });

        if (orderRow.email) {
            try {
                const { markSnapshotsConvertedForEmail } = require('./abandonedCartEngine');
                void markSnapshotsConvertedForEmail(pool, orderRow.email).catch((err) => {
                    logger.warn(`Order ${oid} abandoned-cart convert mark failed:`, err.message);
                });
            } catch (acRequireErr) {
                // Abandoned cart module optional if not deployed yet
            }
        }

        if (!skipConfirmationEmail) {
            void sendOrderConfirmationEmail(pool, oid).catch((emailErr) => {
                logger.error(`Order ${oid} confirmation email error:`, emailErr);
            });
        }

        return {
            orderId: oid,
            orderNumber: orderRow.order_number,
            userId: loyaltyUserId || null,
        };
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
}

module.exports = {
    finalizePaidOrder,
    recalcUserOrderAggregates,
    resolveOrderCustomerUserId,
};
