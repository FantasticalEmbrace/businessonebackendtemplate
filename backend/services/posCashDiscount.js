'use strict';

const SETTING_ENABLED = 'pos_cash_discount_enabled';
const SETTING_PERCENT = 'pos_cash_discount_percent';

function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
}

async function loadCashDiscountSettings(pool) {
    try {
        const [rows] = await pool.execute(
            `SELECT key_name, value FROM settings WHERE key_name IN (?, ?)`,
            [SETTING_ENABLED, SETTING_PERCENT]
        );
        const map = new Map((rows || []).map((r) => [r.key_name, r.value]));
        const enabledRaw = String(map.get(SETTING_ENABLED) ?? 'false').trim().toLowerCase();
        const enabled = enabledRaw === 'true' || enabledRaw === '1';
        let percent = Number(map.get(SETTING_PERCENT));
        if (!Number.isFinite(percent) || percent < 0) percent = 0;
        if (percent > 15) percent = 15;
        return { enabled: enabled && percent > 0, percent };
    } catch {
        const envPct = Number(process.env.POS_CASH_DISCOUNT_PERCENT);
        return {
            enabled: Number.isFinite(envPct) && envPct > 0,
            percent: Number.isFinite(envPct) ? Math.min(envPct, 15) : 0
        };
    }
}

function applyCartDiscountToEnriched(enriched, cartDiscountPercent) {
    const pct = Math.min(100, Math.max(0, Number(cartDiscountPercent) || 0));
    if (pct <= 0) return enriched;
    const mult = 1 - pct / 100;
    return enriched.map((line) => ({
        ...line,
        lineTotal: roundMoney(line.lineTotal * mult)
    }));
}

function merchandiseSubtotal(enriched) {
    return roundMoney(enriched.reduce((sum, line) => sum + line.lineTotal, 0));
}

/**
 * Card/check/terminal price = catalog + tax on full subtotal.
 * Cash price = discounted merchandise subtotal + tax on discounted taxable lines.
 */
function computeDualPricing(enriched, taxRate, discountPercent) {
    const card = computeLineTotals(enriched, taxRate, 0);
    const pct = Number(discountPercent) || 0;
    if (pct <= 0) {
        return {
            card,
            cash: { ...card, cashDiscountAmount: 0, cashDiscountPercent: 0 },
            cashDiscountPercent: 0,
            cashDiscountEnabled: false
        };
    }
    const cash = computeLineTotals(enriched, taxRate, pct);
    const cashDiscountAmount = roundMoney(card.totalAmount - cash.totalAmount);
    return {
        card,
        cash: { ...cash, cashDiscountAmount, cashDiscountPercent: pct },
        cashDiscountPercent: pct,
        cashDiscountEnabled: true
    };
}

function computeLineTotals(enriched, taxRate, discountPercent) {
    const rate = Math.max(0, Math.min(15, Number(discountPercent) || 0)) / 100;
    const multiplier = 1 - rate;
    let subtotal = 0;
    let taxableSubtotal = 0;
    for (const line of enriched) {
        const lineTotal = roundMoney(line.lineTotal * multiplier);
        subtotal += lineTotal;
        if (line.is_taxable) taxableSubtotal += lineTotal;
    }
    subtotal = roundMoney(subtotal);
    taxableSubtotal = roundMoney(taxableSubtotal);
    const taxAmount = roundMoney(taxableSubtotal * taxRate);
    const totalAmount = roundMoney(subtotal + taxAmount);
    return { subtotal, taxAmount, totalAmount };
}

function resolveTotalsForPayment(pricing, paymentMethod, cartDiscountAmount = 0) {
    const cartOff = roundMoney(Number(cartDiscountAmount) || 0);
    if (paymentMethod === 'cash' && pricing.cashDiscountEnabled) {
        return {
            subtotal: pricing.card.subtotal,
            taxAmount: pricing.cash.taxAmount,
            totalAmount: pricing.cash.totalAmount,
            discountAmount: roundMoney(cartOff + pricing.cash.cashDiscountAmount),
            pricingMode: 'cash_discount'
        };
    }
    return {
        subtotal: pricing.card.subtotal,
        taxAmount: pricing.card.taxAmount,
        totalAmount: pricing.card.totalAmount,
        discountAmount: cartOff,
        pricingMode: 'standard'
    };
}

function snapshotForDisplay(cartSnapshot, settings) {
    const lines = (cartSnapshot.lines || []).map((l) => ({
        name: l.name,
        sku: l.sku,
        quantity: l.quantity,
        price: l.price,
        lineTotal: roundMoney(l.price * l.quantity),
        isTaxable: l.isTaxable !== false
    }));
    const enriched = lines.map((l) => ({ ...l, lineTotal: l.lineTotal }));
    const taxRate = cartSnapshot.taxExempt ? 0 : (cartSnapshot.taxRate ?? 0.08);
    const cartPct = Number(cartSnapshot.cartDiscountPercent) || 0;
    const withCart = applyCartDiscountToEnriched(enriched, cartPct);
    const pricing = computeDualPricing(
        withCart,
        taxRate,
        settings.enabled ? settings.percent : 0
    );
    const preCartSubtotal = merchandiseSubtotal(enriched);
    const cartDiscountAmount = roundMoney(preCartSubtotal - pricing.card.subtotal);
    return {
        lines,
        card: pricing.card,
        cash: pricing.cash,
        cashDiscountEnabled: pricing.cashDiscountEnabled,
        cashDiscountPercent: pricing.cashDiscountPercent,
        cartDiscountPercent: cartPct,
        cartDiscountAmount,
        updatedAt: new Date().toISOString(),
        status: lines.length ? 'active' : 'idle'
    };
}

module.exports = {
    SETTING_ENABLED,
    SETTING_PERCENT,
    loadCashDiscountSettings,
    applyCartDiscountToEnriched,
    merchandiseSubtotal,
    computeDualPricing,
    resolveTotalsForPayment,
    snapshotForDisplay,
    roundMoney
};
