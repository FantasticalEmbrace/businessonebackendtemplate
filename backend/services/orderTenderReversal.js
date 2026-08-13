'use strict';

const { recordGiftCardTransaction } = require('./giftCardCheckout');
const { ensureLoyaltyRow, insertLoyaltyTransaction, loadLoyaltyProgramSettings } = require('./customerLoyalty');

function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

async function hasGiftCardRefund(connection, orderId, giftCardId) {
    const [rows] = await connection.execute(
        `SELECT id FROM gift_card_transactions
          WHERE order_id = ? AND gift_card_id = ? AND transaction_type = 'refund'
          LIMIT 1`,
        [orderId, giftCardId]
    );
    return rows.length > 0;
}

async function reverseGiftCardRedemptions(connection, orderId, source = 'refund') {
    const [rows] = await connection.execute(
        `SELECT * FROM gift_card_transactions
          WHERE order_id = ? AND transaction_type = 'redeem'`,
        [orderId]
    );
    for (const row of rows) {
        if (await hasGiftCardRefund(connection, orderId, row.gift_card_id)) continue;
        const credit = roundMoney(Math.abs(Number(row.amount)));
        if (credit <= 0) continue;

        const [[card]] = await connection.execute(
            'SELECT * FROM gift_cards WHERE id = ? FOR UPDATE',
            [row.gift_card_id]
        );
        if (!card) continue;

        const balanceBefore = roundMoney(card.current_balance);
        const balanceAfter = roundMoney(balanceBefore + credit);
        const newStatus = card.status === 'redeemed' ? 'active' : card.status;

        await connection.execute(
            `UPDATE gift_cards
                SET current_balance = ?, status = ?, redeemed_at = NULL
              WHERE id = ?`,
            [balanceAfter, newStatus, card.id]
        );

        await recordGiftCardTransaction(connection, {
            gift_card_id: card.id,
            transaction_type: 'refund',
            amount: credit,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            source,
            order_id: orderId,
            customer_id: row.customer_id,
            description: `Reversed gift card redemption for order #${orderId}`
        });
    }
}

async function hasLoyaltyReversal(connection, orderId, rewardType, redeemRowId) {
    const [rows] = await connection.execute(
        `SELECT id FROM loyalty_transactions
          WHERE order_id = ? AND transaction_type = 'adjust'
            AND reward_type = ? AND metadata LIKE ?
          LIMIT 1`,
        [orderId, rewardType, `%"redeemId":${redeemRowId}%`]
    );
    return rows.length > 0;
}

async function reverseLoyaltyRedemptions(connection, orderId, source = 'refund') {
    const [rows] = await connection.execute(
        `SELECT * FROM loyalty_transactions
          WHERE order_id = ? AND transaction_type = 'redeem'`,
        [orderId]
    );

    for (const row of rows) {
        if (await hasLoyaltyReversal(connection, orderId, row.reward_type, row.id)) continue;

        const userId = row.user_id;
        const fresh = await ensureLoyaltyRow(connection, userId);
        const meta = { redeemId: row.id, reversal: true };

        if (row.reward_type === 'cash') {
            const amount = roundMoney(Math.abs(Number(row.cash_change)));
            if (amount <= 0) continue;
            const newBalance = roundMoney(roundMoney(fresh.cash_balance || 0) + amount);
            await connection.execute(
                `UPDATE customer_loyalty
                    SET cash_balance = ?,
                        lifetime_cash_redeemed = GREATEST(0, lifetime_cash_redeemed - ?),
                        last_synced_at = CURRENT_TIMESTAMP,
                        sync_status = 'synced'
                  WHERE user_id = ?`,
                [newBalance, amount, userId]
            );
            await insertLoyaltyTransaction(connection, {
                userId,
                transactionType: 'adjust',
                rewardType: 'cash',
                pointsChange: 0,
                pointsBalanceAfter: fresh.points_balance || 0,
                cashChange: amount,
                cashBalanceAfter: newBalance,
                source,
                orderId,
                description: `Reversed store credit redemption for order #${orderId}`,
                metadata: meta
            });
        } else if (row.reward_type === 'points') {
            const pts = Math.abs(Math.floor(Number(row.points_change)));
            if (pts <= 0) continue;
            const newBalance = (Number(fresh.points_balance) || 0) + pts;
            await connection.execute(
                `UPDATE customer_loyalty
                    SET points_balance = ?,
                        lifetime_points_redeemed = GREATEST(0, lifetime_points_redeemed - ?),
                        last_synced_at = CURRENT_TIMESTAMP,
                        sync_status = 'synced'
                  WHERE user_id = ?`,
                [newBalance, pts, userId]
            );
            await insertLoyaltyTransaction(connection, {
                userId,
                transactionType: 'adjust',
                rewardType: 'points',
                pointsChange: pts,
                pointsBalanceAfter: newBalance,
                cashChange: 0,
                cashBalanceAfter: roundMoney(fresh.cash_balance || 0),
                source,
                orderId,
                description: `Reversed points redemption for order #${orderId}`,
                metadata: meta
            });
        }
    }
}

async function clawBackLoyaltyEarn(connection, orderId, source = 'refund') {
    const [rows] = await connection.execute(
        `SELECT * FROM loyalty_transactions
          WHERE order_id = ? AND transaction_type = 'earn'`,
        [orderId]
    );

    for (const row of rows) {
        const [[existing]] = await connection.execute(
            `SELECT id FROM loyalty_transactions
              WHERE order_id = ? AND transaction_type = 'adjust'
                AND metadata LIKE ? LIMIT 1`,
            [orderId, `%"earnId":${row.id}%`]
        );
        if (existing) continue;

        const userId = row.user_id;
        const fresh = await ensureLoyaltyRow(connection, userId);
        const meta = { earnId: row.id, clawback: true };

        if (row.reward_type === 'cash') {
            const amount = roundMoney(Number(row.cash_change));
            if (amount <= 0) continue;
            const newBalance = roundMoney(Math.max(0, roundMoney(fresh.cash_balance || 0) - amount));
            await connection.execute(
                `UPDATE customer_loyalty
                    SET cash_balance = ?,
                        lifetime_cash_earned = GREATEST(0, lifetime_cash_earned - ?),
                        last_synced_at = CURRENT_TIMESTAMP,
                        sync_status = 'synced'
                  WHERE user_id = ?`,
                [newBalance, amount, userId]
            );
            await insertLoyaltyTransaction(connection, {
                userId,
                transactionType: 'adjust',
                rewardType: 'cash',
                pointsChange: 0,
                pointsBalanceAfter: fresh.points_balance || 0,
                cashChange: -amount,
                cashBalanceAfter: newBalance,
                source,
                orderId,
                description: `Clawed back store credit earned on order #${orderId}`,
                metadata: meta
            });
        } else if (row.reward_type === 'points') {
            const pts = Math.floor(Number(row.points_change));
            if (pts <= 0) continue;
            const newBalance = Math.max(0, (Number(fresh.points_balance) || 0) - pts);
            await connection.execute(
                `UPDATE customer_loyalty
                    SET points_balance = ?,
                        lifetime_points_earned = GREATEST(0, lifetime_points_earned - ?),
                        last_synced_at = CURRENT_TIMESTAMP,
                        sync_status = 'synced'
                  WHERE user_id = ?`,
                [newBalance, pts, userId]
            );
            await insertLoyaltyTransaction(connection, {
                userId,
                transactionType: 'adjust',
                rewardType: 'points',
                pointsChange: -pts,
                pointsBalanceAfter: newBalance,
                cashChange: 0,
                cashBalanceAfter: roundMoney(fresh.cash_balance || 0),
                source,
                orderId,
                description: `Clawed back points earned on order #${orderId}`,
                metadata: meta
            });
        }
    }
}

async function reversePromoRedemption(connection, orderId) {
    await connection.execute('DELETE FROM web_promotion_redemptions WHERE order_id = ?', [orderId]);
}

/**
 * Reverse wallet tenders (gift card, loyalty) for an order.
 */
async function reverseOrderWalletTenders(connection, orderId, { source = 'refund' } = {}) {
    await reverseGiftCardRedemptions(connection, orderId, source);
    await reverseLoyaltyRedemptions(connection, orderId, source);
}

/**
 * Full reversal for cancel/refund: wallet redemptions, earn clawback, promo usage.
 */
async function reverseOrderFinancials(connection, orderId, orderRow, { clawbackEarn = false, reversePromo = true } = {}) {
    await reverseOrderWalletTenders(connection, orderId, { source: 'refund' });
    if (clawbackEarn && orderRow?.user_id) {
        await clawBackLoyaltyEarn(connection, orderId, 'refund');
    }
    if (reversePromo) {
        await reversePromoRedemption(connection, orderId);
    }
}

module.exports = {
    reverseOrderWalletTenders,
    clawBackLoyaltyEarn,
    reversePromoRedemption,
    reverseOrderFinancials
};
