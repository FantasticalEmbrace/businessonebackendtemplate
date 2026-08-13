'use strict';

const {
    normalizeTenderRow,
    applyTendersToOrder,
    persistOrderTenders,
    formatTenderNotes
} = require('./posSplitTender');
const { loadLoyaltyProgramSettings, pointsToDollars } = require('./customerLoyalty');

const WEB_STORE_TENDER_TYPES = new Set(['loyalty_cash', 'loyalty_points', 'gift_card']);

function fixRoundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeWebStoreTenders(body, loyaltySettings) {
    if (Array.isArray(body.paymentTenders) && body.paymentTenders.length) {
        return body.paymentTenders
            .map((t) => normalizeTenderRow(t, loyaltySettings))
            .filter((t) => t && WEB_STORE_TENDER_TYPES.has(t.type));
    }

    const tenders = [];
    const loyaltyCash = fixRoundMoney(body.loyaltyCashRedeem ?? body.loyalty_cash_redeem ?? 0);
    const loyaltyPts = Math.floor(Number(body.loyaltyPointsRedeem ?? body.loyalty_points_redeem ?? 0) || 0);
    if (loyaltyCash > 0) {
        tenders.push({ type: 'loyalty_cash', amount: loyaltyCash });
    }
    if (loyaltyPts > 0) {
        tenders.push({
            type: 'loyalty_points',
            amount: pointsToDollars(loyaltyPts, loyaltySettings),
            loyaltyPoints: loyaltyPts
        });
    }

    const gc = body.giftCard || body.gift_card;
    if (gc && typeof gc === 'object') {
        const gcAmt = fixRoundMoney(gc.amount);
        if (gcAmt > 0) {
            tenders.push({
                type: 'gift_card',
                amount: gcAmt,
                giftCardId: gc.giftCardId != null ? Number(gc.giftCardId) : gc.id != null ? Number(gc.id) : null,
                code: gc.code ? String(gc.code).trim() : null,
                pin: gc.pin != null ? String(gc.pin).trim() : null
            });
        }
    }

    return tenders;
}

function splitWebCheckoutPayment(storeTenders, saleTotal) {
    const total = fixRoundMoney(saleTotal);
    const sum = fixRoundMoney((storeTenders || []).reduce((acc, t) => acc + fixRoundMoney(t.amount), 0));
    if (sum > total + 0.02) {
        const err = new Error('TENDER_TOTAL_MISMATCH');
        err.code = 'TENDER_TOTAL_MISMATCH';
        err.message = `Rewards and gift cards ($${sum.toFixed(2)}) cannot exceed order total ($${total.toFixed(2)}).`;
        throw err;
    }
    const cardDue = fixRoundMoney(Math.max(0, total - sum));
    return { storeTenders: storeTenders || [], storeApplied: sum, cardDue };
}

function validateWebStoreTenders(storeTenders, userId) {
    for (const t of storeTenders || []) {
        if (!userId) {
            if (t.type === 'gift_card' && t.code && !t.giftCardId) {
                continue;
            }
            const err = new Error('CUSTOMER_REQUIRED_FOR_LOYALTY');
            err.code = 'CUSTOMER_REQUIRED_FOR_LOYALTY';
            err.message = 'Sign in to use store credit, points, or gift cards on your account.';
            throw err;
        }
    }
}

async function applyWebStoreTenders(connection, { storeTenders, orderId, user, loyaltySettings }) {
    if (!storeTenders?.length) return null;
    return applyTendersToOrder(connection, {
        tenders: storeTenders,
        orderId,
        customerUser: user,
        loyaltySettings,
        source: 'web'
    });
}

async function getCardAmountDueForOrder(pool, orderId) {
    const oid = Number(orderId);
    const [[order]] = await pool.execute(
        'SELECT total_amount, pending_store_tenders FROM orders WHERE id = ? LIMIT 1',
        [oid]
    );
    if (!order) return 0;
    const total = fixRoundMoney(order.total_amount);
    try {
        const [rows] = await pool.execute(
            `SELECT COALESCE(SUM(amount), 0) AS applied
               FROM order_payment_tenders
              WHERE order_id = ?`,
            [oid]
        );
        const applied = fixRoundMoney(rows[0]?.applied || 0);
        if (applied > 0) {
            return fixRoundMoney(Math.max(0, total - applied));
        }
    } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }

    const pending = parsePendingStoreTenders(order.pending_store_tenders);
    if (pending.length) {
        const pendingSum = fixRoundMoney(pending.reduce((acc, t) => acc + fixRoundMoney(t.amount), 0));
        return fixRoundMoney(Math.max(0, total - pendingSum));
    }
    return total;
}

function parsePendingStoreTenders(raw) {
    if (!raw) return [];
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.tenders)) return parsed.tenders;
        return [];
    } catch {
        return [];
    }
}

async function savePendingStoreTenders(connection, orderId, tenders) {
    const json = tenders?.length ? JSON.stringify(tenders) : null;
    try {
        await connection.execute('UPDATE orders SET pending_store_tenders = ? WHERE id = ?', [
            json,
            orderId
        ]);
    } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
            const err = new Error('PENDING_TENDERS_UNSUPPORTED');
            err.code = 'PENDING_TENDERS_UNSUPPORTED';
            throw err;
        }
        throw e;
    }
}

async function clearPendingStoreTenders(connection, orderId) {
    try {
        await connection.execute('UPDATE orders SET pending_store_tenders = NULL WHERE id = ?', [orderId]);
    } catch (e) {
        if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    }
}

async function loadPendingStoreTenders(pool, orderId) {
    const [[order]] = await pool.execute(
        'SELECT pending_store_tenders FROM orders WHERE id = ? LIMIT 1',
        [orderId]
    );
    return parsePendingStoreTenders(order?.pending_store_tenders);
}

async function applyPendingStoreTendersAtCapture(connection, pool, {
    orderId,
    user,
    loyaltySettings
}) {
    const [existingRows] = await connection.execute(
        `SELECT id FROM order_payment_tenders
          WHERE order_id = ?
            AND tender_type IN ('loyalty_cash', 'loyalty_points', 'gift_card')
          LIMIT 1`,
        [orderId]
    );
    if (existingRows.length) {
        await clearPendingStoreTenders(connection, orderId);
        return null;
    }

    const tenders = await loadPendingStoreTenders(pool, orderId);
    if (!tenders.length) return null;

    const redeemResult = await applyWebStoreTenders(connection, {
        storeTenders: tenders,
        orderId,
        user,
        loyaltySettings
    });
    await persistOrderTenders(connection, orderId, tenders);
    await clearPendingStoreTenders(connection, orderId);
    return redeemResult;
}

async function getNonEarnTenderTotal(pool, orderId) {
    const oid = Number(orderId);
    try {
        const [rows] = await pool.execute(
            `SELECT COALESCE(SUM(amount), 0) AS s
               FROM order_payment_tenders
              WHERE order_id = ?
                AND tender_type IN ('loyalty_cash', 'loyalty_points', 'gift_card')`,
            [oid]
        );
        let sum = fixRoundMoney(rows[0]?.s || 0);
        if (sum > 0) return sum;
    } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }
    const [[gc]] = await pool.execute(
        `SELECT COALESCE(SUM(ABS(amount)), 0) AS s
           FROM gift_card_transactions
          WHERE order_id = ? AND transaction_type = 'redeem'`,
        [oid]
    );
    return fixRoundMoney(gc?.s || 0);
}

module.exports = {
    WEB_STORE_TENDER_TYPES,
    normalizeWebStoreTenders,
    splitWebCheckoutPayment,
    validateWebStoreTenders,
    applyWebStoreTenders,
    persistOrderTenders,
    formatTenderNotes,
    getCardAmountDueForOrder,
    getNonEarnTenderTotal,
    loadLoyaltyProgramSettings,
    parsePendingStoreTenders,
    savePendingStoreTenders,
    clearPendingStoreTenders,
    loadPendingStoreTenders,
    applyPendingStoreTendersAtCapture
};
