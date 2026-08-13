'use strict';

/** Settings keys owned by the Point of Sale admin section (not general Settings). */
const POS_SETTING_KEYS = Object.freeze([
    'pos_cash_discount_enabled',
    'pos_cash_discount_percent',
    'pos_payment_cash_enabled',
    'pos_payment_check_enabled',
    'pos_payment_card_enabled',
    'pos_store_logo_url',
    'store_card_payment_processor',
    'pos_card_payment_processor',
    'pos_card_payment_adapter',
    'pos_custom_payment_driver_url',
    'pos_receipt_header_text',
    'pos_receipt_footer_text',
    'pos_receipt_show_address',
    'pos_receipt_show_phone',
    'pos_receipt_show_logo',
    'pos_receipt_show_sku',
    'pos_receipt_show_platform_line',
    'pos_receipt_show_cashier',
    'pos_receipt_show_cash_savings',
    'pos_receipt_auto_print',
    'pos_receipt_copy_count',
    'pos_receipt_show_order_barcode',
    'pos_session_timeout_minutes',
    'pos_pin_max_attempts',
    'pos_pin_lockout_minutes',
    'pos_sign_out_after_sale',
    'pos_require_manager_pin_discounts',
    'pos_require_manager_pin_void_refund',
    'pos_max_line_discount_percent',
    'pos_daily_sales_email_enabled',
    'pos_daily_sales_email_to',
    'pos_daily_sales_email_hour',
    'pos_daily_sales_email_minute',
    'pos_payroll_email_enabled',
    'pos_payroll_email_to',
    'pos_payroll_email_frequency',
    'pos_payroll_email_weekday',
    'pos_payroll_email_hour',
    'pos_payroll_email_minute',
    'pos_payroll_email_include_pay',
    'pos_eod_reminder_enabled',
    'pos_eod_reminder_hour',
    'pos_eod_reminder_minute',
    'pos_support_phone',
    'pos_help_url',
    'pos_store_base_url',
    'pos_catalog_refresh_minutes',
    'pos_large_touch_mode',
    'pos_scan_beep_enabled',
    'pos_display_store_hours_idle',
    'pos_personnel_mode',
    'pos_receipt_return_policy',
    'pos_show_cost_in_cart',
    'pos_hardware_printer',
    'pos_display_card_checkout',
    'pos_poi_device_id',
    'pos_card_display_mode'
]);

const POS_SETTING_META = Object.freeze({
    pos_cash_discount_enabled: { description: 'Enable in-store cash discount', type: 'boolean' },
    pos_cash_discount_percent: { description: 'Cash discount percent (max 15)', type: 'number' },
    pos_payment_cash_enabled: { description: 'Allow cash on POS', type: 'boolean' },
    pos_payment_check_enabled: { description: 'Allow checks on POS', type: 'boolean' },
    pos_payment_card_enabled: { description: 'Allow card terminal on POS', type: 'boolean' },
    pos_store_logo_url: { description: 'Store logo URL for POS customer display', type: 'string' },
    store_card_payment_processor: { description: 'Website card processor: epi, nmi, or mxmerchant', type: 'string' },
    pos_card_payment_processor: { description: 'In-store POS processor: inherit, epi, nmi, or mxmerchant', type: 'string' },
    pos_card_payment_adapter: { description: 'POS card payment mode (semi-integrated NMI terminal)', type: 'string' },
    pos_custom_payment_driver_url: { description: 'Custom POS payment driver script URL', type: 'string' },
    pos_receipt_header_text: { description: 'POS receipt header line', type: 'string' },
    pos_receipt_footer_text: { description: 'POS receipt footer message', type: 'string' },
    pos_receipt_show_address: { description: 'Show address on POS receipts', type: 'boolean' },
    pos_receipt_show_phone: { description: 'Show phone on POS receipts', type: 'boolean' },
    pos_receipt_show_logo: { description: 'Show logo on POS receipts', type: 'boolean' },
    pos_receipt_show_sku: { description: 'Show SKU on POS receipts', type: 'boolean' },
    pos_receipt_show_platform_line: { description: 'Show Business One line on receipts', type: 'boolean' },
    pos_receipt_show_cashier: { description: 'Show cashier name on POS receipts', type: 'boolean' },
    pos_receipt_show_cash_savings: { description: 'Show cash savings line on POS receipts', type: 'boolean' },
    pos_receipt_auto_print: { description: 'Auto-open print dialog after each sale', type: 'boolean' },
    pos_receipt_copy_count: { description: 'Number of receipt copies to print (1–3)', type: 'number' },
    pos_receipt_show_order_barcode: { description: 'Show order number as barcode on receipts', type: 'boolean' },
    pos_session_timeout_minutes: { description: 'POS PIN session timeout minutes', type: 'number' },
    pos_pin_max_attempts: { description: 'Max failed PIN attempts', type: 'number' },
    pos_pin_lockout_minutes: { description: 'PIN lockout minutes', type: 'number' },
    pos_sign_out_after_sale: { description: 'Sign out cashier after each sale', type: 'boolean' },
    pos_require_manager_pin_discounts: { description: 'Require manager PIN for large line discounts', type: 'boolean' },
    pos_require_manager_pin_void_refund: { description: 'Require manager PIN for voids and refunds', type: 'boolean' },
    pos_max_line_discount_percent: { description: 'Max line discount without manager PIN', type: 'number' },
    pos_daily_sales_email_enabled: { description: 'Email daily POS sales summary', type: 'boolean' },
    pos_daily_sales_email_to: { description: 'Daily sales email recipient', type: 'string' },
    pos_daily_sales_email_hour: { description: 'Daily sales email hour (0-23)', type: 'number' },
    pos_daily_sales_email_minute: { description: 'Daily sales email minute', type: 'number' },
    pos_payroll_email_enabled: { description: 'Email payroll hours to accountant', type: 'boolean' },
    pos_payroll_email_to: { description: 'Payroll hours email recipient', type: 'string' },
    pos_payroll_email_frequency: { description: 'Payroll email frequency', type: 'string' },
    pos_payroll_email_weekday: { description: 'Weekday to send weekly/biweekly payroll email', type: 'number' },
    pos_payroll_email_hour: { description: 'Payroll email hour (0-23)', type: 'number' },
    pos_payroll_email_minute: { description: 'Payroll email minute', type: 'number' },
    pos_payroll_email_include_pay: { description: 'Include estimated pay from hourly rates', type: 'boolean' },
    pos_eod_reminder_enabled: { description: 'End-of-day open shift reminder', type: 'boolean' },
    pos_eod_reminder_hour: { description: 'End-of-day reminder hour', type: 'number' },
    pos_eod_reminder_minute: { description: 'End-of-day reminder minute', type: 'number' },
    pos_support_phone: { description: 'POS support phone', type: 'string' },
    pos_help_url: { description: 'POS help URL', type: 'string' },
    pos_store_base_url: {
        description: 'Public HTTPS store URL for Web POS registers and platform support sync',
        type: 'string'
    },
    pos_catalog_refresh_minutes: { description: 'POS catalog auto-refresh minutes', type: 'number' },
    pos_large_touch_mode: { description: 'Large touch mode on POS register', type: 'boolean' },
    pos_scan_beep_enabled: { description: 'Beep on barcode scan match', type: 'boolean' },
    pos_display_store_hours_idle: { description: 'Store hours on idle customer display', type: 'boolean' },
    pos_personnel_mode: { description: 'POS personnel mode', type: 'string' },
    pos_receipt_return_policy: { description: 'Return policy on POS receipts', type: 'string' },
    pos_show_cost_in_cart: { description: 'Show product cost in POS cart', type: 'boolean' },
    pos_hardware_printer: { description: 'POS receipt printer: auto, elo_star, or browser', type: 'string' },
    pos_display_card_checkout: { description: 'NMI terminal card checkout enabled', type: 'boolean' },
    pos_poi_device_id: { description: 'NMI POI device ID for A3700', type: 'string' },
    pos_card_display_mode: { description: 'Card checkout mode (NMI NMI terminal)', type: 'string' }
});

async function loadPosSettings(pool) {
    if (!pool || !POS_SETTING_KEYS.length) return {};
    const placeholders = POS_SETTING_KEYS.map(() => '?').join(', ');
    const [rows] = await pool.execute(
        `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
        [...POS_SETTING_KEYS]
    );
    const out = {};
    for (const row of rows || []) {
        out[row.key_name] = row.value != null ? String(row.value) : '';
    }
    return out;
}

module.exports = {
    POS_SETTING_KEYS,
    POS_SETTING_META,
    loadPosSettings
};
