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
    'pos_shop_hide_free_diagnostic',
    'pos_shop_hide_billable_diagnostic',
    'pos_hardware_printer',
    'pos_display_card_checkout',
    'pos_poi_device_id',
    'pos_card_display_mode',
    'pos_shop_verticals',
    'pos_shop_contractor',
    'pos_shop_alignment_2wheel_price',
    'pos_shop_alignment_4wheel_price',
    'pos_addon_warehouse',
    'pos_addon_vin_fitment',
    'pos_addon_tire_pro',
    'pos_addon_extra_distributors'
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
    pos_receipt_auto_print: { description: 'Automatically print a paper receipt after each sale', type: 'boolean' },
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
    pos_shop_hide_free_diagnostic: {
        description: 'Hide complimentary diagnostic cards on shop repair estimates',
        type: 'boolean'
    },
    pos_shop_hide_billable_diagnostic: {
        description: 'Hide billable diagnostic cards on shop repair estimates',
        type: 'boolean'
    },
    pos_hardware_printer: { description: 'POS receipt printer: auto, elo_star, star_android, or browser', type: 'string' },
    pos_display_card_checkout: { description: 'NMI terminal card checkout enabled', type: 'boolean' },
    pos_poi_device_id: { description: 'NMI POI device ID for A3700', type: 'string' },
    pos_card_display_mode: { description: 'Card checkout mode (NMI NMI terminal)', type: 'string' },
    pos_shop_verticals: {
        description: 'JSON array of shop verticals: contractor, auto, body, upholstery, tire',
        type: 'string'
    },
    pos_shop_contractor: { description: 'Contractor / estimate mode enabled', type: 'boolean' },
    pos_shop_alignment_2wheel_price: { description: '2-wheel alignment price', type: 'number' },
    pos_shop_alignment_4wheel_price: { description: '4-wheel alignment price', type: 'number' },
    pos_addon_warehouse: { description: 'POS add-on: live warehouse inventory', type: 'boolean' },
    pos_addon_vin_fitment: { description: 'POS add-on: VIN & vehicle fitment', type: 'boolean' },
    pos_addon_tire_pro: { description: 'POS add-on: Tire Pro bundle', type: 'boolean' },
    pos_addon_extra_distributors: { description: 'POS add-on: extra wholesale distributors', type: 'number' }
});

async function loadPosSettings(pool, options = {}) {
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

    const merchantId = options.merchantId || null;
    if (merchantId) {
        try {
            const [mrows] = await pool.execute(
                'SELECT shop_config FROM platform_merchants WHERE id = ? LIMIT 1',
                [merchantId]
            );
            const raw = mrows[0]?.shop_config;
            const cfg = raw == null ? null : typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (cfg && typeof cfg === 'object') {
                if (Array.isArray(cfg.shopVerticals)) {
                    out.pos_shop_verticals = JSON.stringify(cfg.shopVerticals);
                    out.pos_shop_contractor = cfg.shopVerticals.includes('contractor')
                        ? 'true'
                        : 'false';
                }
                if (cfg.addons && typeof cfg.addons === 'object') {
                    const a = cfg.addons;
                    const tirePro = Boolean(a.tirePro);
                    out.pos_addon_warehouse = a.warehouse || tirePro ? 'true' : 'false';
                    out.pos_addon_vin_fitment = a.vinFitment || tirePro ? 'true' : 'false';
                    out.pos_addon_tire_pro = tirePro ? 'true' : 'false';
                    out.pos_addon_extra_distributors = String(
                        Math.max(0, Math.floor(Number(a.extraDistributors) || 0))
                    );
                }
            }
        } catch {
            /* shop_config optional */
        }
    }

    try {
        let verts = [];
        try {
            verts = JSON.parse(out.pos_shop_verticals || '[]');
            if (!Array.isArray(verts)) verts = [];
        } catch {
            verts = [];
        }
        if (
            String(out.pos_shop_contractor || '').toLowerCase() === 'true' &&
            !verts.includes('contractor')
        ) {
            verts = verts.concat(['contractor']);
            out.pos_shop_verticals = JSON.stringify(verts);
        }
    } catch {
        /* ignore */
    }

    return out;
}

async function syncMerchantShopConfigFromSettings(pool, merchantId, settingsRows = []) {
    if (!pool || !merchantId) return null;
    const map = new Map(
        (settingsRows || []).filter((s) => s?.key_name).map((s) => [s.key_name, s.value])
    );
    let verticals = [];
    try {
        verticals = JSON.parse(String(map.get('pos_shop_verticals') || '[]'));
        if (!Array.isArray(verticals)) verticals = [];
    } catch {
        verticals = [];
    }
    verticals = verticals.map((v) => String(v).toLowerCase().trim()).filter(Boolean);
    if (
        String(map.get('pos_shop_contractor') || '').toLowerCase() === 'true' &&
        !verticals.includes('contractor')
    ) {
        verticals.push('contractor');
    }
    const tirePro = String(map.get('pos_addon_tire_pro') || '').toLowerCase() === 'true';
    const shopConfig = {
        storeType: verticals.length ? 'shop' : 'retail',
        shopVerticals: verticals,
        addons: {
            warehouse:
                String(map.get('pos_addon_warehouse') || '').toLowerCase() === 'true' || tirePro,
            vinFitment:
                String(map.get('pos_addon_vin_fitment') || '').toLowerCase() === 'true' || tirePro,
            tirePro,
            extraDistributors: Math.max(
                0,
                Math.floor(Number(map.get('pos_addon_extra_distributors')) || 0)
            )
        },
        updatedAt: new Date().toISOString()
    };
    // Preserve website package entitlements when admin saves POS settings
    try {
        const [rows] = await pool.execute(
            'SELECT shop_config FROM platform_merchants WHERE id = ? LIMIT 1',
            [merchantId]
        );
        const raw = rows[0]?.shop_config;
        const prev = raw == null ? null : typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (prev && typeof prev === 'object') {
            if (prev.hostingTier) shopConfig.hostingTier = prev.hostingTier;
            if (prev.buildTier) shopConfig.buildTier = prev.buildTier;
        }
    } catch {
        /* ignore */
    }
    try {
        await pool.execute(`UPDATE platform_merchants SET shop_config = ? WHERE id = ?`, [
            JSON.stringify(shopConfig),
            merchantId
        ]);
    } catch (e) {
        if (!String(e.message || '').includes('shop_config')) throw e;
    }
    return shopConfig;
}

module.exports = {
    POS_SETTING_KEYS,
    POS_SETTING_META,
    loadPosSettings,
    syncMerchantShopConfigFromSettings
};
