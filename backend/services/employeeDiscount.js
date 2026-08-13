'use strict';

const TAX_RATE = 0.08;

function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const SETTING_ENABLED = 'employee_discount_enabled';
const SETTING_PERCENT = 'employee_discount_percent';

const VALID_CUSTOMER_TYPES = new Set(['retail', 'employee']);

function normalizeCustomerType(value) {
    const t = String(value || 'retail').trim().toLowerCase();
    if (t === 'employee') return 'employee';
    if (t === 'wholesale' || t === 'staff') return 'retail';
    return VALID_CUSTOMER_TYPES.has(t) ? t : 'retail';
}

async function loadEmployeeDiscountSettings(pool) {
    const [rows] = await pool.execute(
        `SELECT key_name, value FROM settings WHERE key_name IN (?, ?)`,
        [SETTING_ENABLED, SETTING_PERCENT]
    );
    const map = new Map((rows || []).map((r) => [r.key_name, r.value]));
    const enabledRaw = String(map.get(SETTING_ENABLED) ?? 'false').trim().toLowerCase();
    const enabled = enabledRaw === 'true' || enabledRaw === '1';
    let percent = Number(map.get(SETTING_PERCENT));
    if (!Number.isFinite(percent) || percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    return { enabled, percent };
}

/**
 * Applies configured employee % off remaining merchandise (after promo discounts).
 */
function applyEmployeeDiscountToTotals(totals, settings, customerType, applyTaxExemption, taxRate = TAX_RATE) {
    if (!totals) return totals;
    const type = normalizeCustomerType(customerType);
    const base = { ...totals, employeeDiscount: 0, employeeDiscountApplied: false };

    if (type !== 'employee' || !settings?.enabled || !(Number(settings.percent) > 0)) {
        return base;
    }

    const merchandiseSub = Number(totals.merchandiseSubtotal) || 0;
    const existingMerchDisc = Number(totals.merchandiseDiscount) || 0;
    const shippingDiscount = Number(totals.shippingDiscount) || 0;
    const remaining = roundMoney(Math.max(0, merchandiseSub - existingMerchDisc));
    const employeeMerchDisc = roundMoney(
        Math.min(remaining, merchandiseSub * (Number(settings.percent) / 100))
    );

    if (employeeMerchDisc <= 0) return base;

    const newMerchDiscount = roundMoney(existingMerchDisc + employeeMerchDisc);
    const taxBase = roundMoney(Math.max(0, merchandiseSub - newMerchDiscount));
    const taxAmount = applyTaxExemption ? 0 : roundMoney(taxBase * taxRate);
    const shippingAfter = Number(totals.shippingAfter) || 0;
    const totalAmount = roundMoney(taxBase + shippingAfter + taxAmount);

    return {
        ...totals,
        merchandiseDiscount: newMerchDiscount,
        taxAmount,
        totalAmount,
        totalDiscountAmount: roundMoney(newMerchDiscount + shippingDiscount),
        employeeDiscount: employeeMerchDisc,
        employeeDiscountApplied: true
    };
}

module.exports = {
    SETTING_ENABLED,
    SETTING_PERCENT,
    VALID_CUSTOMER_TYPES,
    normalizeCustomerType,
    loadEmployeeDiscountSettings,
    applyEmployeeDiscountToTotals
};
