'use strict';

const SETTING_LARGE_TOUCH = 'pos_large_touch_mode';
const SETTING_SCAN_BEEP = 'pos_scan_beep_enabled';
const SETTING_DISPLAY_HOURS_IDLE = 'pos_display_store_hours_idle';
const SETTING_PERSONNEL_MODE = 'pos_personnel_mode';

const SETTING_SHOW_COST_IN_CART = 'pos_show_cost_in_cart';
const SETTING_HARDWARE_PRINTER = 'pos_hardware_printer';
const SETTING_DISPLAY_CARD_CHECKOUT = 'pos_display_card_checkout';

const PERSONNEL_MODES = Object.freeze(['time_clock_only', 'time_clock_and_pos']);

const DEFAULTS = {
    largeTouchMode: false,
    scanBeepEnabled: true,
    displayStoreHoursIdle: false,
    personnelMode: 'time_clock_and_pos',
    showCostInCart: false,
    hardwarePrinter: 'auto',
    displayCardCheckout: true
};

function parseBool(value, fallback = false) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return fallback;
}

function normalizePersonnelMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    return PERSONNEL_MODES.includes(mode) ? mode : DEFAULTS.personnelMode;
}

async function loadPosRegisterExperienceSettings(pool) {
    const keys = [
        SETTING_LARGE_TOUCH,
        SETTING_SCAN_BEEP,
        SETTING_DISPLAY_HOURS_IDLE,
        SETTING_PERSONNEL_MODE,
        SETTING_SHOW_COST_IN_CART,
        SETTING_HARDWARE_PRINTER,
        SETTING_DISPLAY_CARD_CHECKOUT
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

    return {
        largeTouchMode: parseBool(map.get(SETTING_LARGE_TOUCH), DEFAULTS.largeTouchMode),
        scanBeepEnabled: parseBool(map.get(SETTING_SCAN_BEEP), DEFAULTS.scanBeepEnabled),
        displayStoreHoursIdle: parseBool(
            map.get(SETTING_DISPLAY_HOURS_IDLE),
            DEFAULTS.displayStoreHoursIdle
        ),
        personnelMode: normalizePersonnelMode(map.get(SETTING_PERSONNEL_MODE)),
        showCostInCart: parseBool(map.get(SETTING_SHOW_COST_IN_CART), DEFAULTS.showCostInCart),
        hardwarePrinter: String(map.get(SETTING_HARDWARE_PRINTER) || DEFAULTS.hardwarePrinter).trim() || DEFAULTS.hardwarePrinter,
        displayCardCheckout: parseBool(map.get(SETTING_DISPLAY_CARD_CHECKOUT), DEFAULTS.displayCardCheckout)
    };
}

module.exports = {
    SETTING_LARGE_TOUCH,
    SETTING_SCAN_BEEP,
    SETTING_DISPLAY_HOURS_IDLE,
    SETTING_PERSONNEL_MODE,
    SETTING_SHOW_COST_IN_CART,
    SETTING_HARDWARE_PRINTER,
    SETTING_DISPLAY_CARD_CHECKOUT,
    PERSONNEL_MODES,
    DEFAULTS,
    normalizePersonnelMode,
    loadPosRegisterExperienceSettings
};
