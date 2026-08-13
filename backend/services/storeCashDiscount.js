'use strict';

const SETTING_ENABLED = 'store_cash_discount_enabled';
const SETTING_PERCENT = 'store_cash_discount_percent';

function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
}

async function loadStoreCashDiscountSettings(pool) {
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
        return { enabled: false, percent: 0 };
    }
}

/**
 * Website/host dual pricing — card price is catalog; cash price discounts merchandise then tax.
 */
function computeDualPricing(subtotal, taxableSubtotal, taxRate, discountPercent) {
    const cardSubtotal = roundMoney(subtotal);
    const cardTax = roundMoney(taxableSubtotal * taxRate);
    const cardTotal = roundMoney(cardSubtotal + cardTax);

    const pct = Number(discountPercent) || 0;
    if (pct <= 0) {
        return {
            card: { subtotal: cardSubtotal, taxAmount: cardTax, totalAmount: cardTotal },
            cash: { subtotal: cardSubtotal, taxAmount: cardTax, totalAmount: cardTotal, cashDiscountAmount: 0 },
            cashDiscountEnabled: false,
            cashDiscountPercent: 0
        };
    }

    const rate = Math.max(0, Math.min(15, pct)) / 100;
    const multiplier = 1 - rate;
    const cashSubtotal = roundMoney(cardSubtotal * multiplier);
    const cashTaxable = roundMoney(taxableSubtotal * multiplier);
    const cashTax = roundMoney(cashTaxable * taxRate);
    const cashTotal = roundMoney(cashSubtotal + cashTax);
    const cashDiscountAmount = roundMoney(cardTotal - cashTotal);

    return {
        card: { subtotal: cardSubtotal, taxAmount: cardTax, totalAmount: cardTotal },
        cash: {
            subtotal: cashSubtotal,
            taxAmount: cashTax,
            totalAmount: cashTotal,
            cashDiscountAmount,
            cashDiscountPercent: pct
        },
        cashDiscountEnabled: true,
        cashDiscountPercent: pct
    };
}

module.exports = {
    SETTING_ENABLED,
    SETTING_PERCENT,
    loadStoreCashDiscountSettings,
    computeDualPricing,
    roundMoney
};
