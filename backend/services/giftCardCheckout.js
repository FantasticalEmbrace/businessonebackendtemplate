'use strict';

const { normalizeCode } = require('../utils/giftCardCodes');

function sqlBind(value) {
    return value === undefined ? null : value;
}

async function recordGiftCardTransaction(connection, row) {
    await connection.execute(
        `INSERT INTO gift_card_transactions
            (gift_card_id, transaction_type, amount, balance_before, balance_after,
             source, order_id, customer_id, admin_user_id,
             description, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            sqlBind(row.gift_card_id),
            sqlBind(row.transaction_type),
            sqlBind(row.amount),
            sqlBind(row.balance_before),
            sqlBind(row.balance_after),
            sqlBind(row.source || 'web'),
            sqlBind(row.order_id ?? null),
            sqlBind(row.customer_id ?? null),
            sqlBind(row.admin_user_id ?? null),
            sqlBind(row.description ?? null),
            row.metadata ? JSON.stringify(row.metadata) : null
        ]
    );
}

function assertGiftCardUsable(card) {
    if (card.status !== 'active') {
        const err = new Error('GIFT_CARD_INACTIVE');
        err.code = 'GIFT_CARD_INACTIVE';
        err.status = card.status;
        throw err;
    }
    if (card.expires_at && new Date(card.expires_at) < new Date()) {
        const err = new Error('GIFT_CARD_EXPIRED');
        err.code = 'GIFT_CARD_EXPIRED';
        throw err;
    }
}

async function applyRedeemAmount(connection, card, value, orderId, customerId, source = 'web') {
    const balanceBefore = Number(card.current_balance);
    if (balanceBefore < value) {
        const err = new Error('INSUFFICIENT_GIFT_CARD_BALANCE');
        err.code = 'INSUFFICIENT_GIFT_CARD_BALANCE';
        err.balance = balanceBefore;
        throw err;
    }

    const balanceAfter = +(balanceBefore - value).toFixed(2);
    const newStatus = balanceAfter === 0 ? 'redeemed' : card.status;

    await connection.execute(
        `UPDATE gift_cards
            SET current_balance = ?,
                last_used_at = NOW(),
                status = ?,
                redeemed_at = CASE WHEN ? = 'redeemed' THEN NOW() ELSE redeemed_at END
          WHERE id = ?`,
        [balanceAfter, newStatus, newStatus, card.id]
    );

    await recordGiftCardTransaction(connection, {
        gift_card_id: card.id,
        transaction_type: 'redeem',
        amount: -value,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        source,
        order_id: orderId,
        customer_id: customerId || card.customer_id,
        description:
            source === 'pos'
                ? `POS sale order #${orderId}`
                : `Web checkout order #${orderId}`
    });

    return { giftCardId: card.id, balanceAfter, code: card.code };
}

/**
 * Lock and load an active gift card by code + optional PIN.
 * @param {import('mysql2/promise').PoolConnection} connection
 */
async function lockGiftCardByCode(connection, code, pin, options = {}) {
    const skipPinCheck = Boolean(options.skipPinCheck);
    const cleanCode = normalizeCode(code);
    if (!cleanCode) {
        const err = new Error('GIFT_CARD_CODE_REQUIRED');
        err.code = 'GIFT_CARD_CODE_REQUIRED';
        throw err;
    }

    const [[card]] = await connection.execute(
        'SELECT * FROM gift_cards WHERE code = ? LIMIT 1 FOR UPDATE',
        [cleanCode]
    );

    if (!card) {
        const err = new Error('GIFT_CARD_NOT_FOUND');
        err.code = 'GIFT_CARD_NOT_FOUND';
        throw err;
    }

    if (card.pin && !skipPinCheck) {
        const pinTrim = pin != null ? String(pin).trim() : '';
        if (!pinTrim || pinTrim !== String(card.pin).trim()) {
            const err = new Error('GIFT_CARD_INVALID_PIN');
            err.code = 'GIFT_CARD_INVALID_PIN';
            throw err;
        }
    }

    assertGiftCardUsable(card);
    return card;
}

/**
 * Lock a gift card assigned to the signed-in customer (no PIN required).
 * @param {import('mysql2/promise').PoolConnection} connection
 */
async function lockGiftCardForUser(connection, giftCardId, userId) {
    const id = Number(giftCardId);
    const uid = Number(userId);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(uid) || uid <= 0) {
        const err = new Error('GIFT_CARD_NOT_FOUND');
        err.code = 'GIFT_CARD_NOT_FOUND';
        throw err;
    }

    const [[card]] = await connection.execute(
        `SELECT gc.*
           FROM gift_cards gc
          WHERE gc.id = ?
            AND (
                gc.customer_id = ?
                OR gc.recipient_email = (SELECT email FROM users WHERE id = ? LIMIT 1)
            )
          LIMIT 1
          FOR UPDATE`,
        [id, uid, uid]
    );

    if (!card) {
        const err = new Error('GIFT_CARD_NOT_OWNED');
        err.code = 'GIFT_CARD_NOT_OWNED';
        throw err;
    }

    assertGiftCardUsable(card);
    return card;
}

/**
 * Redeem gift card balance toward a web order (full order total required).
 * @param {import('mysql2/promise').PoolConnection} connection
 */
async function redeemGiftCardForOrder(connection, { code, pin, amount, orderId, customerId, source = 'web' }) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
        const err = new Error('INVALID_REDEEM_AMOUNT');
        err.code = 'INVALID_REDEEM_AMOUNT';
        throw err;
    }

    const card = await lockGiftCardByCode(connection, code, pin, { skipPinCheck: source === 'pos' });
    return applyRedeemAmount(connection, card, value, orderId, customerId, source);
}

/**
 * Redeem a gift card on the customer's account by id (authenticated checkout).
 * @param {import('mysql2/promise').PoolConnection} connection
 */
async function redeemGiftCardForOrderById(connection, { giftCardId, userId, amount, orderId, customerId, source = 'web' }) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
        const err = new Error('INVALID_REDEEM_AMOUNT');
        err.code = 'INVALID_REDEEM_AMOUNT';
        throw err;
    }

    const card = await lockGiftCardForUser(connection, giftCardId, userId);
    return applyRedeemAmount(connection, card, value, orderId, customerId || userId, source);
}

module.exports = {
    recordGiftCardTransaction,
    lockGiftCardByCode,
    lockGiftCardForUser,
    redeemGiftCardForOrder,
    redeemGiftCardForOrderById
};
