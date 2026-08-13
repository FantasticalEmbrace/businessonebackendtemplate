'use strict';

const RECEIPT_KEYS = {
    headerText: 'pos_receipt_header_text',
    footerText: 'pos_receipt_footer_text',
    showAddress: 'pos_receipt_show_address',
    showPhone: 'pos_receipt_show_phone',
    showLogo: 'pos_receipt_show_logo',
    showSku: 'pos_receipt_show_sku',
    showPlatformLine: 'pos_receipt_show_platform_line',
    showCashier: 'pos_receipt_show_cashier',
    showCashSavings: 'pos_receipt_show_cash_savings',
    autoPrint: 'pos_receipt_auto_print',
    copyCount: 'pos_receipt_copy_count',
    showOrderBarcode: 'pos_receipt_show_order_barcode',
    returnPolicy: 'pos_receipt_return_policy'
};

const STORE_INFO_KEYS = [
    'store_phone',
    'store_address_line1',
    'store_address_line2',
    'store_city',
    'store_state',
    'store_postal_code'
];

const DEFAULTS = {
    headerText: '',
    footerText: 'Thank you for your purchase!',
    showAddress: true,
    showPhone: true,
    showLogo: true,
    showSku: true,
    showPlatformLine: true,
    showCashier: true,
    showCashSavings: true,
    autoPrint: true,
    copyCount: 2,
    showOrderBarcode: true,
    returnPolicy: ''
};

function parseBool(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const s = String(value).trim().toLowerCase();
    return s === 'true' || s === '1';
}

function formatStoreAddress(map) {
    const line1 = String(map.get('store_address_line1') || '').trim();
    const line2 = String(map.get('store_address_line2') || '').trim();
    const city = String(map.get('store_city') || '').trim();
    const state = String(map.get('store_state') || '').trim();
    const zip = String(map.get('store_postal_code') || '').trim();
    const parts = [];
    if (line1) parts.push(line1);
    if (line2) parts.push(line2);
    const cityLine = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
    if (cityLine.trim()) parts.push(cityLine.trim());
    return parts.length ? parts.join('\n') : null;
}

function parseIntSetting(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

async function loadPosReceiptSettings(pool, storeLogoUrl = null) {
    const keys = [...Object.values(RECEIPT_KEYS), ...STORE_INFO_KEYS];
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

    const headerText = String(map.get(RECEIPT_KEYS.headerText) || DEFAULTS.headerText).trim();
    let footerText = String(map.get(RECEIPT_KEYS.footerText) || DEFAULTS.footerText).trim();
    if (!footerText) footerText = DEFAULTS.footerText;

    return {
        headerText,
        footerText,
        showAddress: parseBool(map.get(RECEIPT_KEYS.showAddress), DEFAULTS.showAddress),
        showPhone: parseBool(map.get(RECEIPT_KEYS.showPhone), DEFAULTS.showPhone),
        showLogo: parseBool(map.get(RECEIPT_KEYS.showLogo), DEFAULTS.showLogo),
        showSku: parseBool(map.get(RECEIPT_KEYS.showSku), DEFAULTS.showSku),
        showPlatformLine: parseBool(map.get(RECEIPT_KEYS.showPlatformLine), DEFAULTS.showPlatformLine),
        showCashier: parseBool(map.get(RECEIPT_KEYS.showCashier), DEFAULTS.showCashier),
        showCashSavings: parseBool(map.get(RECEIPT_KEYS.showCashSavings), DEFAULTS.showCashSavings),
        autoPrint: parseBool(map.get(RECEIPT_KEYS.autoPrint), DEFAULTS.autoPrint),
        copyCount: Math.min(3, Math.max(1, parseIntSetting(map.get(RECEIPT_KEYS.copyCount), DEFAULTS.copyCount))),
        showOrderBarcode: parseBool(map.get(RECEIPT_KEYS.showOrderBarcode), DEFAULTS.showOrderBarcode),
        returnPolicy: String(map.get(RECEIPT_KEYS.returnPolicy) || DEFAULTS.returnPolicy).trim(),
        storeAddress: formatStoreAddress(map),
        storePhone: String(map.get('store_phone') || '').trim() || null,
        storeLogoUrl: storeLogoUrl || null
    };
}

module.exports = {
    RECEIPT_KEYS,
    DEFAULTS,
    loadPosReceiptSettings
};
