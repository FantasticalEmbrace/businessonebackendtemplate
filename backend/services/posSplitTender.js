'use strict';

const {
    redeemLoyaltyCash,
    redeemLoyaltyPoints,
    pointsToDollars
} = require('./customerLoyalty');
const {
    redeemGiftCardForOrder,
    redeemGiftCardForOrderById
} = require('./giftCardCheckout');

function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
}

const TENDER_TYPES = new Set([
    'cash',
    'card_terminal',
    'check',
    'gift_card',
    'loyalty_cash',
    'loyalty_points'
]);

function buildPaymentReference(method, meta = {}) {
    if (method === 'cash') return 'pos:cash';
    if (method === 'check') {
        return `pos:check:${String(meta.checkNumber || meta.check_number || 'na').slice(0, 32)}`;
    }
    if (method === 'gift_card') return 'pos:gift_card';
    if (method === 'loyalty_cash') return 'pos:loyalty_cash';
    if (method === 'loyalty_points') return 'pos:loyalty_points';
    const auth = String(meta.terminalAuthCode || meta.terminal_auth_code || '').trim();
    const lastFour = String(meta.terminalLastFour || meta.terminal_last_four || '').replace(/\D/g, '');
    const ref = String(meta.terminalReference || meta.terminal_reference || '').trim();
    const offline = meta.terminalOfflineApproved || meta.terminal_offline_approved ? 'offline' : 'online';
    return `pos:terminal:${offline}:${lastFour}:${auth || 'na'}:${ref || 'na'}`.slice(0, 120);
}

function usesCardPricing(tenders) {
    return (tenders || []).some(
        (t) => (t.type === 'card_terminal' || t.type === 'check') && roundMoney(t.amount) > 0
    );
}

function resolvePrimaryPaymentMethod(tenders) {
    const list = tenders || [];
    const active = list.filter((t) => roundMoney(t.amount) > 0);
    if (active.length === 0) return 'cash';
    const types = new Set(active.map((t) => t.type));
    if (types.size > 1) return 'split';
    const only = [...types][0];
    if (only === 'loyalty_cash' || only === 'loyalty_points') return 'gift_card';
    return only;
}

function normalizeTenderRow(raw, loyaltySettings, options = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const type = String(raw.type || raw.tenderType || raw.tender_type || '').trim().toLowerCase();
    if (!TENDER_TYPES.has(type)) return null;

    let amount = roundMoney(raw.amount);
    let loyaltyPoints = null;

    if (type === 'loyalty_points') {
        const pts = Math.max(0, Math.floor(Number(raw.points ?? raw.loyaltyPoints ?? raw.loyalty_points) || 0));
        if (pts <= 0) return null;
        loyaltyPoints = pts;
        if (!options.trustClientAmount || amount <= 0) {
            amount = pointsToDollars(pts, loyaltySettings);
        }
    }

    if (amount <= 0) return null;

    return {
        type,
        amount,
        loyaltyPoints,
        giftCardId: raw.giftCardId != null ? Number(raw.giftCardId) : raw.gift_card_id != null ? Number(raw.gift_card_id) : null,
        code: raw.code ? String(raw.code).trim() : null,
        pin: raw.pin != null ? String(raw.pin).trim() : null,
        cashTendered: raw.cashTendered != null ? roundMoney(raw.cashTendered) : raw.cash_tendered != null ? roundMoney(raw.cash_tendered) : null,
        cashChange: raw.cashChange != null ? roundMoney(raw.cashChange) : raw.cash_change != null ? roundMoney(raw.cash_change) : null,
        checkNumber: raw.checkNumber != null ? String(raw.checkNumber).trim() : raw.check_number != null ? String(raw.check_number).trim() : null,
        terminalLastFour: String(raw.terminalLastFour || raw.terminal_last_four || '').replace(/\D/g, '').slice(-4) || null,
        terminalAuthCode: String(raw.terminalAuthCode || raw.terminal_auth_code || '').trim() || null,
        terminalReference: String(raw.terminalReference || raw.terminal_reference || '').trim() || null,
        terminalOfflineApproved: Boolean(raw.terminalOfflineApproved || raw.terminal_offline_approved),
        terminalCardBrand: String(raw.terminalCardBrand || raw.terminal_card_brand || '').trim() || null
    };
}

function normalizeTendersFromPayload(payload, loyaltySettings, saleTotal = null, options = {}) {
    const settings = loyaltySettings || { dollarPerPoint: 0.01 };

    if (Array.isArray(payload.paymentTenders) && payload.paymentTenders.length) {
        return payload.paymentTenders
            .map((t) => normalizeTenderRow(t, settings, options))
            .filter(Boolean);
    }

    const tenders = [];
    const loyaltyCash = roundMoney(payload.loyaltyCashRedeem ?? payload.loyalty_cash_redeem ?? 0);
    const loyaltyPts = Math.floor(Number(payload.loyaltyPointsRedeem ?? payload.loyalty_points_redeem ?? 0) || 0);
    if (loyaltyCash > 0) {
        tenders.push({ type: 'loyalty_cash', amount: loyaltyCash });
    }
    if (loyaltyPts > 0) {
        tenders.push({
            type: 'loyalty_points',
            amount: pointsToDollars(loyaltyPts, settings),
            loyaltyPoints: loyaltyPts
        });
    }

    const gc = payload.giftCard || payload.gift_card;
    if (gc && typeof gc === 'object') {
        const gcAmt = roundMoney(gc.amount);
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

    const payment = payload.payment || payload;
    const method = String(payment.paymentMethod || payment.payment_method || 'cash').trim().toLowerCase();
    const prelimSum = roundMoney(tenders.reduce((s, t) => s + roundMoney(t.amount), 0));
    const remaining = saleTotal != null
        ? roundMoney(Math.max(0, roundMoney(saleTotal) - prelimSum))
        : roundMoney(payload._legacyAmountDue ?? payment.amount ?? payment.amountDue ?? 0);

    if (remaining > 0.005) {
        if (method === 'cash') {
            tenders.push({
                type: 'cash',
                amount: remaining,
                cashTendered: payment.cashTendered != null ? roundMoney(payment.cashTendered) : roundMoney(payment.cash_tendered),
                cashChange: payment.cashChange != null ? roundMoney(payment.cashChange) : roundMoney(payment.cash_change)
            });
        } else if (method === 'check') {
            tenders.push({
                type: 'check',
                amount: remaining,
                checkNumber: payment.checkNumber || payment.check_number || null
            });
        } else if (method === 'card_terminal' || method === 'card') {
            tenders.push({
                type: 'card_terminal',
                amount: remaining,
                terminalLastFour: payment.terminalLastFour || payment.terminal_last_four,
                terminalAuthCode: payment.terminalAuthCode || payment.terminal_auth_code,
                terminalReference: payment.terminalReference || payment.terminal_reference,
                terminalOfflineApproved: payment.terminalOfflineApproved || payment.terminal_offline_approved,
                terminalCardBrand: payment.terminalCardBrand || payment.terminal_card_brand
            });
        }
    }

    return tenders;
}

function validateTendersForSale(tenders, saleTotal, options = {}) {
    const total = roundMoney(saleTotal);
    const sum = roundMoney((tenders || []).reduce((acc, t) => acc + roundMoney(t.amount), 0));
    if (Math.abs(sum - total) > 0.02) {
        const err = new Error('TENDER_TOTAL_MISMATCH');
        err.code = 'TENDER_TOTAL_MISMATCH';
        err.message = `Payment tenders ($${sum.toFixed(2)}) must equal sale total ($${total.toFixed(2)}).`;
        err.expected = total;
        err.received = sum;
        throw err;
    }

    for (const t of tenders || []) {
        if (t.type === 'loyalty_cash' || t.type === 'loyalty_points') {
            if (!options.customerUserId) {
                const err = new Error('CUSTOMER_REQUIRED_FOR_LOYALTY');
                err.code = 'CUSTOMER_REQUIRED_FOR_LOYALTY';
                err.message = 'Attach a customer profile to use store credit or points.';
                throw err;
            }
        }
        if (t.type === 'gift_card' && t.giftCardId && !options.customerUserId) {
            const err = new Error('CUSTOMER_REQUIRED_FOR_LOYALTY');
            err.code = 'CUSTOMER_REQUIRED_FOR_LOYALTY';
            err.message = 'Attach a customer profile to use gift cards on account.';
            throw err;
        }
        if (t.type === 'cash' && t.cashTendered != null && roundMoney(t.cashTendered) + 0.0001 < roundMoney(t.amount)) {
            const err = new Error('INSUFFICIENT_CASH_TENDER');
            err.code = 'INSUFFICIENT_CASH_TENDER';
            err.message = 'Cash tendered is less than the cash portion of this split payment.';
            throw err;
        }
        if (t.type === 'card_terminal') {
            const lastFour = String(t.terminalLastFour || '').replace(/\D/g, '');
            const auth = String(t.terminalAuthCode || '').trim();
            const approved = options.cardApprovedConfirmed;
            if (
                !options.skipCardTerminalChecks
                && !approved
                && lastFour.length > 0
                && lastFour.length !== 4
            ) {
                const err = new Error('TERMINAL_LAST_FOUR_INVALID');
                err.code = 'TERMINAL_LAST_FOUR_INVALID';
                throw err;
            }
            if (
                !options.skipCardTerminalChecks
                && !approved
                && lastFour.length !== 4
                && !auth
            ) {
                const err = new Error('TERMINAL_APPROVAL_REQUIRED');
                err.code = 'TERMINAL_APPROVAL_REQUIRED';
                err.message = 'Confirm card approval on the terminal before completing the sale.';
                throw err;
            }
        }
    }

    return true;
}

function formatTenderNotes(tenders) {
    const lines = [];
    for (const t of tenders || []) {
        if (t.type === 'loyalty_cash') lines.push(`Store credit: $${t.amount.toFixed(2)}`);
        else if (t.type === 'loyalty_points') {
            lines.push(`Points redeemed: ${t.loyaltyPoints} pts ($${t.amount.toFixed(2)})`);
        } else if (t.type === 'gift_card') lines.push(`Gift card: $${t.amount.toFixed(2)}`);
        else if (t.type === 'cash') {
            let line = `Cash: $${t.amount.toFixed(2)}`;
            if (t.cashTendered != null) {
                line += ` (tendered $${roundMoney(t.cashTendered).toFixed(2)}`;
                if (t.cashChange > 0) line += `, change $${roundMoney(t.cashChange).toFixed(2)}`;
                line += ')';
            }
            lines.push(line);
        } else if (t.type === 'card_terminal') {
            const brand = t.terminalCardBrand || 'card';
            const lastFour = String(t.terminalLastFour || '').replace(/\D/g, '');
            lines.push(
                lastFour.length === 4
                    ? `Card: $${t.amount.toFixed(2)} (${brand} •••• ${lastFour})`
                    : `Card: $${t.amount.toFixed(2)} (terminal approved)`
            );
        } else if (t.type === 'check') {
            lines.push(`Check: $${t.amount.toFixed(2)}${t.checkNumber ? ` #${t.checkNumber}` : ''}`);
        }
    }
    if (lines.length > 1) {
        return `Split payment:\n${lines.join('\n')}`;
    }
    return lines.join('\n');
}

async function applyTendersToOrder(connection, {
    tenders,
    orderId,
    customerUser,
    loyaltySettings,
    source = 'pos'
}) {
    const results = {
        loyaltyCash: null,
        loyaltyPoints: null,
        giftCards: []
    };

    for (const t of tenders) {
        if (t.type === 'loyalty_cash') {
            results.loyaltyCash = await redeemLoyaltyCash(
                connection,
                customerUser.id,
                t.amount,
                orderId,
                loyaltySettings,
                source
            );
        } else if (t.type === 'loyalty_points') {
            results.loyaltyPoints = await redeemLoyaltyPoints(
                connection,
                customerUser.id,
                t.loyaltyPoints,
                orderId,
                loyaltySettings,
                source
            );
        } else if (t.type === 'gift_card') {
            if (t.giftCardId && customerUser) {
                await redeemGiftCardForOrderById(connection, {
                    giftCardId: t.giftCardId,
                    userId: customerUser.id,
                    amount: t.amount,
                    orderId,
                    customerId: customerUser.id,
                    source
                });
            } else if (t.code) {
                await redeemGiftCardForOrder(connection, {
                    code: t.code,
                    pin: t.pin,
                    amount: t.amount,
                    orderId,
                    customerId: customerUser?.id || null,
                    source
                });
            } else {
                const err = new Error('GIFT_CARD_CODE_REQUIRED');
                err.code = 'GIFT_CARD_CODE_REQUIRED';
                throw err;
            }
            results.giftCards.push({ amount: t.amount, giftCardId: t.giftCardId || null });
        }
    }

    return results;
}

async function persistOrderTenders(connection, orderId, tenders) {
    for (const t of tenders) {
        const ref = buildPaymentReference(t.type, t);
        await connection.execute(
            `INSERT INTO order_payment_tenders (
                order_id, tender_type, amount, loyalty_points, gift_card_id,
                payment_reference, cash_tendered, cash_change, check_number,
                terminal_last_four, terminal_auth_code
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                orderId,
                t.type,
                roundMoney(t.amount),
                t.loyaltyPoints || null,
                t.giftCardId || null,
                ref,
                t.cashTendered != null ? roundMoney(t.cashTendered) : null,
                t.cashChange != null ? roundMoney(t.cashChange) : null,
                t.checkNumber || null,
                t.terminalLastFour || null,
                t.terminalAuthCode || null
            ]
        );
    }
}

async function recordTendersOnShift(pool, shiftSessionId, tenders) {
    if (!shiftSessionId) return;
    for (const t of tenders || []) {
        if (t.type !== 'cash' && t.type !== 'check' && t.type !== 'card_terminal') continue;
        const amount = roundMoney(t.amount);
        if (amount <= 0) continue;
        const col =
            t.type === 'cash'
                ? 'cash_sales_total'
                : t.type === 'check'
                  ? 'check_sales_total'
                  : 'card_sales_total';
        await pool.execute(
            `UPDATE pos_shift_sessions SET ${col} = ${col} + ? WHERE id = ? AND status = 'open'`,
            [amount, shiftSessionId]
        );
    }
}

module.exports = {
    TENDER_TYPES,
    roundMoney,
    usesCardPricing,
    resolvePrimaryPaymentMethod,
    normalizeTenderRow,
    normalizeTendersFromPayload,
    validateTendersForSale,
    formatTenderNotes,
    applyTendersToOrder,
    persistOrderTenders,
    recordTendersOnShift,
    buildPaymentReference,
    pointsToDollars
};
