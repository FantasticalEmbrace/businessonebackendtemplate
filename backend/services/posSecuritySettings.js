'use strict';

const SETTING_SESSION_TIMEOUT = 'pos_session_timeout_minutes';
const SETTING_PIN_MAX_ATTEMPTS = 'pos_pin_max_attempts';
const SETTING_PIN_LOCKOUT_MINUTES = 'pos_pin_lockout_minutes';
const SETTING_SIGN_OUT_AFTER_SALE = 'pos_sign_out_after_sale';
const SETTING_REQUIRE_MANAGER_PIN_DISCOUNTS = 'pos_require_manager_pin_discounts';
const SETTING_REQUIRE_MANAGER_PIN_VOID_REFUND = 'pos_require_manager_pin_void_refund';
const SETTING_MAX_LINE_DISCOUNT_PERCENT = 'pos_max_line_discount_percent';

const DEFAULTS = {
    sessionTimeoutMinutes: 30,
    pinMaxAttempts: 10,
    pinLockoutMinutes: 15,
    signOutAfterSale: false,
    requireManagerPinDiscounts: true,
    requireManagerPinVoidRefund: true,
    maxLineDiscountPercent: 10
};

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

function parseBool(value, fallback = false) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return fallback;
}

async function loadPosSecuritySettings(pool) {
    const keys = [
        SETTING_SESSION_TIMEOUT,
        SETTING_PIN_MAX_ATTEMPTS,
        SETTING_PIN_LOCKOUT_MINUTES,
        SETTING_SIGN_OUT_AFTER_SALE,
        SETTING_REQUIRE_MANAGER_PIN_DISCOUNTS,
        SETTING_REQUIRE_MANAGER_PIN_VOID_REFUND,
        SETTING_MAX_LINE_DISCOUNT_PERCENT
    ];
    const placeholders = keys.map(() => '?').join(', ');
    let map = new Map();

    try {
        const [rows] = await pool.execute(
            `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
            keys
        );
        map = new Map((rows || []).map((r) => [r.key_name, r.value]));
    } catch {
        /* defaults */
    }

    const envTimeout = Number(process.env.POS_SESSION_TIMEOUT_MINUTES);
    const sessionTimeoutMinutes = clampInt(
        map.get(SETTING_SESSION_TIMEOUT) ?? (Number.isFinite(envTimeout) ? envTimeout : DEFAULTS.sessionTimeoutMinutes),
        5,
        480,
        DEFAULTS.sessionTimeoutMinutes
    );
    const pinMaxAttempts = clampInt(
        map.get(SETTING_PIN_MAX_ATTEMPTS),
        3,
        20,
        DEFAULTS.pinMaxAttempts
    );
    const pinLockoutMinutes = clampInt(
        map.get(SETTING_PIN_LOCKOUT_MINUTES),
        5,
        120,
        DEFAULTS.pinLockoutMinutes
    );
    const signOutAfterSale = parseBool(map.get(SETTING_SIGN_OUT_AFTER_SALE), DEFAULTS.signOutAfterSale);
    const requireManagerPinDiscounts = parseBool(
        map.get(SETTING_REQUIRE_MANAGER_PIN_DISCOUNTS),
        DEFAULTS.requireManagerPinDiscounts
    );
    const requireManagerPinVoidRefund = parseBool(
        map.get(SETTING_REQUIRE_MANAGER_PIN_VOID_REFUND),
        DEFAULTS.requireManagerPinVoidRefund
    );
    const maxLineDiscountPercent = clampInt(
        map.get(SETTING_MAX_LINE_DISCOUNT_PERCENT),
        0,
        100,
        DEFAULTS.maxLineDiscountPercent
    );

    return {
        sessionTimeoutMinutes,
        pinMaxAttempts,
        pinLockoutMinutes,
        signOutAfterSale,
        requireManagerPinDiscounts,
        requireManagerPinVoidRefund,
        maxLineDiscountPercent
    };
}

function lineDiscountNeedsManagerPin(discountPercent, settings) {
    if (!settings?.requireManagerPinDiscounts) return false;
    const pct = Number(discountPercent) || 0;
    if (pct <= 0) return false;
    const max = Number(settings.maxLineDiscountPercent);
    if (!Number.isFinite(max)) return true;
    return pct > max;
}

module.exports = {
    SETTING_SESSION_TIMEOUT,
    SETTING_PIN_MAX_ATTEMPTS,
    SETTING_PIN_LOCKOUT_MINUTES,
    SETTING_SIGN_OUT_AFTER_SALE,
    SETTING_REQUIRE_MANAGER_PIN_DISCOUNTS,
    SETTING_REQUIRE_MANAGER_PIN_VOID_REFUND,
    SETTING_MAX_LINE_DISCOUNT_PERCENT,
    DEFAULTS,
    loadPosSecuritySettings,
    lineDiscountNeedsManagerPin,
    parseBool
};
