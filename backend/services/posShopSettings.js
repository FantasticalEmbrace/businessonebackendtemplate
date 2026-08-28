'use strict';

const SETTING_SHOP_VERTICALS = 'pos_shop_verticals';
const SETTING_ALIGNMENT_2WHEEL_PRICE = 'pos_shop_alignment_2wheel_price';
const SETTING_ALIGNMENT_4WHEEL_PRICE = 'pos_shop_alignment_4wheel_price';

const SHOP_VERTICALS = Object.freeze(['auto', 'body', 'upholstery', 'tire']);

const DEFAULT_ALIGNMENT_PRICES = Object.freeze({
    twoWheel: 59.99,
    fourWheel: 89.99
});

function parseShopVerticals(value) {
    if (Array.isArray(value)) {
        return value
            .map((v) => String(v || '').trim().toLowerCase())
            .filter((v) => SHOP_VERTICALS.includes(v));
    }
    const raw = String(value || '').trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parseShopVerticals(parsed);
    } catch {
        /* comma list */
    }
    return raw
        .split(/[,+|]/)
        .map((s) => s.trim().toLowerCase())
        .filter((v) => SHOP_VERTICALS.includes(v));
}

function parsePrice(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.round(n * 100) / 100;
}

async function loadSettingMap(pool, keys) {
    if (!keys.length) return new Map();
    try {
        const placeholders = keys.map(() => '?').join(', ');
        const [rows] = await pool.execute(
            `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
            keys
        );
        return new Map((rows || []).map((r) => [r.key_name, r.value]));
    } catch {
        return new Map();
    }
}

async function loadPosShopSettings(pool) {
    const keys = [SETTING_SHOP_VERTICALS, SETTING_ALIGNMENT_2WHEEL_PRICE, SETTING_ALIGNMENT_4WHEEL_PRICE];
    const map = await loadSettingMap(pool, keys);
    const verticals = parseShopVerticals(map.get(SETTING_SHOP_VERTICALS));
    const alignment = {
        twoWheelPrice: parsePrice(map.get(SETTING_ALIGNMENT_2WHEEL_PRICE), DEFAULT_ALIGNMENT_PRICES.twoWheel),
        fourWheelPrice: parsePrice(map.get(SETTING_ALIGNMENT_4WHEEL_PRICE), DEFAULT_ALIGNMENT_PRICES.fourWheel)
    };
    return {
        shopVerticals: verticals,
        shopVertical: verticals[0] || null,
        shopJobsEnabled: verticals.length > 0,
        alignment,
        shop: { alignment }
    };
}

module.exports = {
    SETTING_SHOP_VERTICALS,
    SETTING_ALIGNMENT_2WHEEL_PRICE,
    SETTING_ALIGNMENT_4WHEEL_PRICE,
    SHOP_VERTICALS,
    DEFAULT_ALIGNMENT_PRICES,
    parseShopVerticals,
    parsePrice,
    loadPosShopSettings
};
