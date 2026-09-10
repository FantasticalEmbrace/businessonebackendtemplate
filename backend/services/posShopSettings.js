'use strict';

const { PIECE_BASE_YARDS, DEFAULT_FABRIC_WIDTH_IN, DEFAULT_WASTE_PCT } = require('./upholsteryYardage');

const SETTING_SHOP_VERTICALS = 'pos_shop_verticals';
const SETTING_ALIGNMENT_2WHEEL_PRICE = 'pos_shop_alignment_2wheel_price';
const SETTING_ALIGNMENT_4WHEEL_PRICE = 'pos_shop_alignment_4wheel_price';
const SETTING_HIDE_FREE_DIAG = 'pos_shop_hide_free_diagnostic';
const SETTING_HIDE_BILLABLE_DIAG = 'pos_shop_hide_billable_diagnostic';
const SETTING_LABOR_RATE_AUTO = 'pos_shop_labor_rate_auto';
const SETTING_LABOR_RATE_BODY = 'pos_shop_labor_rate_body';
const SETTING_LABOR_RATE_UPHOLSTERY = 'pos_shop_labor_rate_upholstery';
const SETTING_LABOR_RATE_TIRE = 'pos_shop_labor_rate_tire';
const SETTING_LABOR_RATE_CONTRACTOR = 'pos_shop_labor_rate_contractor';
const SETTING_UPHOLSTERY_DEPOSIT_PERCENT = 'pos_shop_upholstery_deposit_percent';
const SETTING_UPHOLSTERY_DEPOSIT_MIN = 'pos_shop_upholstery_deposit_min';
const SETTING_PACKAGES = 'pos_shop_packages';
const SETTING_REVIEW_URL = 'pos_shop_review_url';
const SETTING_HOURS = 'pos_shop_hours';
const SETTING_EXPRESS_MINUTES = 'pos_shop_express_target_minutes';
const SETTING_SERVICE_INTERVALS = 'pos_shop_service_intervals';
const SETTING_WARRANTY_DAYS = 'pos_shop_warranty_days';
const SETTING_STORAGE_LOCATIONS = 'pos_shop_storage_locations';
const SETTING_UPHOLSTERY_TEMPLATES = 'pos_shop_upholstery_templates';
const SETTING_TEARDOWN_PHOTO_REQUIRED = 'pos_shop_teardown_photo_required';
const SETTING_UPHOLSTERY_YARDAGE = 'pos_shop_upholstery_yardage';
const SETTING_UPHOLSTERY_VENDORS = 'pos_shop_upholstery_vendors';
const SETTING_UPHOLSTERY_DEFAULT_LEAD_DAYS = 'pos_shop_upholstery_default_lead_days';
const SETTING_UPHOLSTERY_REQUIRE_DEPOSIT = 'pos_shop_upholstery_require_deposit_before_order';
const SETTING_UPHOLSTERY_BLOCK_PRODUCTION = 'pos_shop_upholstery_block_production_until_materials';
const SETTING_BAYS = 'pos_shop_bays';
const SETTING_BAY_LABELS = 'pos_shop_bay_labels';

const SHOP_VERTICALS = Object.freeze(['auto', 'body', 'upholstery', 'tire']);

const DEFAULT_ALIGNMENT_PRICES = Object.freeze({ twoWheel: 59.99, fourWheel: 89.99 });
const DEFAULT_UPHOLSTERY_DEPOSIT = Object.freeze({ percent: 30, minAmount: 150 });
const DEFAULT_LABOR_RATES = Object.freeze({
    auto: 95,
    body: 85,
    upholstery: 95,
    tire: 89,
    contractor: 85
});
const DEFAULT_EXPRESS_MINUTES = 45;
const DEFAULT_WARRANTY_DAYS = 30;
const DEFAULT_UPHOLSTERY_LEAD_DAYS = 7;

const DEFAULT_PACKAGES = Object.freeze({
    auto: [
        {
            id: 'pkg-oil',
            name: 'Oil change package',
            lines: [
                { sku: 'LABOR-OIL', name: 'Oil change labor', qty: 1, price: 39.99 },
                { sku: 'FILTER-OIL', name: 'Oil filter', qty: 1, price: 12.99 }
            ]
        }
    ],
    tire: [
        {
            id: 'pkg-mount4',
            name: 'Mount & balance ×4',
            lines: [
                { sku: 'MOUNT-BAL', name: 'Mount & Balance (each)', qty: 4, price: 28 },
                { sku: 'DISPOSAL', name: 'Tire Disposal (each)', qty: 4, price: 4 }
            ]
        }
    ],
    body: [
        {
            id: 'pkg-bumper',
            name: 'Bumper repair starter',
            lines: [
                { sku: 'LABOR-BODY', name: 'Body Labor Hour', qty: 3, price: 85 },
                { sku: 'LABOR-PAINT', name: 'Paint Labor Hour', qty: 2, price: 95 }
            ]
        }
    ],
    upholstery: [
        {
            id: 'pkg-seat',
            name: 'Single seat recover',
            lines: [
                { sku: 'SEAT-RECOVER', name: 'Seat Recover Labor', qty: 1, price: 220 },
                { sku: 'DEPOSIT', name: 'Job Deposit', qty: 1, price: 150 }
            ]
        },
        {
            id: 'pkg-sofa',
            name: 'Sofa recover package',
            lines: [
                { sku: 'SOFA-RECOVER', name: 'Sofa Recover Labor', qty: 1, price: 680 },
                { sku: 'FABRIC-GRY', name: 'Fabric — Gray (yd)', qty: 12, price: 22 },
                { sku: 'FOAM-HD', name: 'High-Density Foam', qty: 2, price: 42 },
                { sku: 'DEPOSIT', name: 'Job Deposit', qty: 1, price: 250 }
            ]
        },
        {
            id: 'pkg-dining4',
            name: 'Dining chairs ×4',
            lines: [
                { sku: 'CHAIR-RECOVER', name: 'Chair Recover Labor', qty: 4, price: 145 },
                { sku: 'FABRIC-GRY', name: 'Fabric — Gray (yd)', qty: 6, price: 22 },
                { sku: 'DEPOSIT', name: 'Job Deposit', qty: 1, price: 150 }
            ]
        }
    ]
});

const DEFAULT_UPHOLSTERY_TEMPLATES = Object.freeze([
    { id: 'tpl-sofa', name: 'Sofa recover', yardsHint: 12, pieceKey: 'sofa', qty: 1, notes: '' },
    { id: 'tpl-dining', name: 'Dining chairs', yardsHint: 6, pieceKey: 'dining', qty: 4, notes: '' },
    { id: 'tpl-seats', name: 'Vehicle seats', yardsHint: 5, pieceKey: 'seats', qty: 2, notes: '' },
    { id: 'tpl-headliner', name: 'Headliner', yardsHint: 4, pieceKey: 'headliner', qty: 1, notes: '' },
    { id: 'tpl-custom', name: 'Custom piece', yardsHint: 8, pieceKey: 'custom', qty: 1, notes: '' }
]);

const DEFAULT_UPHOLSTERY_YARDAGE = Object.freeze({
    fabricWidthIn: DEFAULT_FABRIC_WIDTH_IN,
    wastePct: DEFAULT_WASTE_PCT,
    napDefault: false,
    pieceBaseYards: { ...PIECE_BASE_YARDS }
});

const DEFAULT_UPHOLSTERY_VENDORS = Object.freeze([
    { name: 'Fabric mill', leadDays: 7 },
    { name: 'Local supplier', leadDays: 3 }
]);

const DEFAULT_BAYS = Object.freeze({
    auto: ['Bay 1', 'Bay 2', 'Bay 3'],
    body: ['Booth A', 'Booth B', 'Prep bay'],
    tire: ['Rack 1', 'Rack 2', 'Mount bay'],
    upholstery: ['Bench 1', 'Bench 2', 'Pickup staging']
});

const DEFAULT_BAY_LABELS = Object.freeze({
    auto: 'Bay',
    body: 'Booth / bay',
    tire: 'Bay / rack',
    upholstery: 'Bench'
});

const DEFAULT_SERVICE_INTERVALS = Object.freeze([
    { id: 'oil', label: 'Oil change', miles: 5000, sku: 'LABOR-OIL', name: 'Oil change labor', price: 39.99 },
    { id: 'cabin', label: 'Cabin filter', miles: 15000, sku: 'FILTER-CABIN', name: 'Cabin air filter', price: 24.99 },
    { id: 'air', label: 'Engine air filter', miles: 30000, sku: 'AIR-FILTER', name: 'Engine air filter', price: 18.99 },
    { id: 'coolant', label: 'Coolant service', miles: 60000, sku: 'LABOR-FLUSH', name: 'Coolant flush', price: 129.99 }
]);

const DEFAULT_HOURS = Object.freeze({
    mon: { open: '08:00', close: '17:00' },
    tue: { open: '08:00', close: '17:00' },
    wed: { open: '08:00', close: '17:00' },
    thu: { open: '08:00', close: '17:00' },
    fri: { open: '08:00', close: '17:00' },
    sat: { open: '08:00', close: '14:00' },
    sun: { open: '', close: '' }
});

const LABOR_RATE_SETTING_BY_VERTICAL = Object.freeze({
    auto: SETTING_LABOR_RATE_AUTO,
    body: SETTING_LABOR_RATE_BODY,
    upholstery: SETTING_LABOR_RATE_UPHOLSTERY,
    tire: SETTING_LABOR_RATE_TIRE,
    contractor: SETTING_LABOR_RATE_CONTRACTOR
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

function parseJsonSetting(value, fallback) {
    if (value == null || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
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

function parseBool(value, fallback = false) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    return raw === 'true' || raw === '1' || raw === 'yes';
}

function parseLaborRates(map) {
    const laborRates = {};
    Object.keys(LABOR_RATE_SETTING_BY_VERTICAL).forEach((vertical) => {
        const key = LABOR_RATE_SETTING_BY_VERTICAL[vertical];
        laborRates[vertical] = parsePrice(map.get(key), DEFAULT_LABOR_RATES[vertical]);
    });
    return laborRates;
}

function normalizePackages(raw) {
    const base = JSON.parse(JSON.stringify(DEFAULT_PACKAGES));
    const parsed = parseJsonSetting(raw, null);
    if (!parsed || typeof parsed !== 'object') return base;
    SHOP_VERTICALS.forEach((v) => {
        if (Array.isArray(parsed[v])) base[v] = parsed[v];
    });
    return base;
}

function normalizeUpholsteryTemplates(raw) {
    const parsed = parseJsonSetting(raw, null);
    if (!Array.isArray(parsed) || !parsed.length) {
        return JSON.parse(JSON.stringify(DEFAULT_UPHOLSTERY_TEMPLATES));
    }
    return parsed
        .map((t, i) => {
            if (!t || typeof t !== 'object') return null;
            const id = String(t.id || `tpl-${i + 1}`).trim() || `tpl-${i + 1}`;
            const name = String(t.name || '').trim() || `Template ${i + 1}`;
            const pieceKey = String(t.pieceKey || t.furnitureType || 'custom').trim().toLowerCase() || 'custom';
            const yardsHint = Number(t.yardsHint);
            const qty = Number(t.qty);
            return {
                id,
                name,
                pieceKey,
                yardsHint: Number.isFinite(yardsHint) && yardsHint >= 0 ? yardsHint : 8,
                qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
                notes: String(t.notes || '').trim()
            };
        })
        .filter(Boolean);
}

function normalizeUpholsteryYardage(raw) {
    const parsed = parseJsonSetting(raw, null);
    const base = {
        fabricWidthIn: DEFAULT_FABRIC_WIDTH_IN,
        wastePct: DEFAULT_WASTE_PCT,
        napDefault: false,
        pieceBaseYards: { ...PIECE_BASE_YARDS }
    };
    if (!parsed || typeof parsed !== 'object') return base;
    const width = Number(parsed.fabricWidthIn);
    if (Number.isFinite(width) && width > 0) base.fabricWidthIn = Math.round(width * 10) / 10;
    const waste = Number(parsed.wastePct);
    if (Number.isFinite(waste) && waste >= 0) base.wastePct = Math.min(40, Math.round(waste * 10) / 10);
    base.napDefault = parsed.napDefault === true || parsed.napDefault === '1' || String(parsed.napDefault).toLowerCase() === 'yes';
    if (parsed.pieceBaseYards && typeof parsed.pieceBaseYards === 'object') {
        Object.keys(parsed.pieceBaseYards).forEach((key) => {
            const k = String(key || '').trim().toLowerCase();
            if (!k) return;
            const n = Number(parsed.pieceBaseYards[key]);
            if (Number.isFinite(n) && n >= 0) base.pieceBaseYards[k] = Math.round(n * 10) / 10;
        });
    }
    return base;
}

function normalizeUpholsteryVendors(raw) {
    const parsed = parseJsonSetting(raw, null);
    if (!Array.isArray(parsed)) {
        return JSON.parse(JSON.stringify(DEFAULT_UPHOLSTERY_VENDORS));
    }
    return parsed
        .map((v) => {
            if (typeof v === 'string') {
                const name = v.trim();
                return name ? { name, leadDays: DEFAULT_UPHOLSTERY_LEAD_DAYS } : null;
            }
            if (!v || typeof v !== 'object') return null;
            const name = String(v.name || '').trim();
            if (!name) return null;
            const lead = Number(v.leadDays);
            return {
                name,
                leadDays: Number.isFinite(lead) && lead >= 0 ? Math.round(lead) : DEFAULT_UPHOLSTERY_LEAD_DAYS
            };
        })
        .filter(Boolean);
}

function normalizeBays(raw) {
    const base = JSON.parse(JSON.stringify(DEFAULT_BAYS));
    const parsed = parseJsonSetting(raw, null);
    if (!parsed || typeof parsed !== 'object') return base;
    SHOP_VERTICALS.forEach((v) => {
        if (Array.isArray(parsed[v])) {
            const list = parsed[v].map((x) => String(x || '').trim()).filter(Boolean);
            if (list.length) base[v] = list;
        }
    });
    return base;
}

function normalizeBayLabels(raw) {
    const base = { ...DEFAULT_BAY_LABELS };
    const parsed = parseJsonSetting(raw, null);
    if (!parsed || typeof parsed !== 'object') return base;
    SHOP_VERTICALS.forEach((v) => {
        const label = String(parsed[v] || '').trim();
        if (label) base[v] = label;
    });
    return base;
}

async function loadPosShopSettings(pool) {
    const keys = [
        SETTING_SHOP_VERTICALS,
        SETTING_ALIGNMENT_2WHEEL_PRICE,
        SETTING_ALIGNMENT_4WHEEL_PRICE,
        SETTING_HIDE_FREE_DIAG,
        SETTING_HIDE_BILLABLE_DIAG,
        SETTING_LABOR_RATE_AUTO,
        SETTING_LABOR_RATE_BODY,
        SETTING_LABOR_RATE_UPHOLSTERY,
        SETTING_LABOR_RATE_TIRE,
        SETTING_LABOR_RATE_CONTRACTOR,
        SETTING_UPHOLSTERY_DEPOSIT_PERCENT,
        SETTING_UPHOLSTERY_DEPOSIT_MIN,
        SETTING_PACKAGES,
        SETTING_REVIEW_URL,
        SETTING_HOURS,
        SETTING_EXPRESS_MINUTES,
        SETTING_SERVICE_INTERVALS,
        SETTING_WARRANTY_DAYS,
        SETTING_STORAGE_LOCATIONS,
        SETTING_UPHOLSTERY_TEMPLATES,
        SETTING_TEARDOWN_PHOTO_REQUIRED,
        SETTING_UPHOLSTERY_YARDAGE,
        SETTING_UPHOLSTERY_VENDORS,
        SETTING_UPHOLSTERY_DEFAULT_LEAD_DAYS,
        SETTING_UPHOLSTERY_REQUIRE_DEPOSIT,
        SETTING_UPHOLSTERY_BLOCK_PRODUCTION,
        SETTING_BAYS,
        SETTING_BAY_LABELS
    ];
    const map = await loadSettingMap(pool, keys);
    const verticals = parseShopVerticals(map.get(SETTING_SHOP_VERTICALS));
    const alignment = {
        twoWheelPrice: parsePrice(map.get(SETTING_ALIGNMENT_2WHEEL_PRICE), DEFAULT_ALIGNMENT_PRICES.twoWheel),
        fourWheelPrice: parsePrice(map.get(SETTING_ALIGNMENT_4WHEEL_PRICE), DEFAULT_ALIGNMENT_PRICES.fourWheel)
    };
    const diagnostics = {
        hideFree: parseBool(map.get(SETTING_HIDE_FREE_DIAG), false),
        hideBillable: parseBool(map.get(SETTING_HIDE_BILLABLE_DIAG), false)
    };
    const upholsteryDeposit = {
        percent: parsePrice(map.get(SETTING_UPHOLSTERY_DEPOSIT_PERCENT), DEFAULT_UPHOLSTERY_DEPOSIT.percent),
        minAmount: parsePrice(map.get(SETTING_UPHOLSTERY_DEPOSIT_MIN), DEFAULT_UPHOLSTERY_DEPOSIT.minAmount)
    };
    const laborRates = parseLaborRates(map);
    const packages = normalizePackages(map.get(SETTING_PACKAGES));
    const hours = parseJsonSetting(map.get(SETTING_HOURS), DEFAULT_HOURS);
    const serviceIntervals = parseJsonSetting(map.get(SETTING_SERVICE_INTERVALS), DEFAULT_SERVICE_INTERVALS);
    const storageLocations = parseJsonSetting(map.get(SETTING_STORAGE_LOCATIONS), ['Rack A', 'Rack B', 'Back room']);
    const upholsteryTemplates = normalizeUpholsteryTemplates(map.get(SETTING_UPHOLSTERY_TEMPLATES));
    const upholsteryYardage = normalizeUpholsteryYardage(map.get(SETTING_UPHOLSTERY_YARDAGE));
    const upholsteryVendors = normalizeUpholsteryVendors(map.get(SETTING_UPHOLSTERY_VENDORS));
    const upholsteryDefaultLeadDays = Math.max(
        0,
        Math.round(parsePrice(map.get(SETTING_UPHOLSTERY_DEFAULT_LEAD_DAYS), DEFAULT_UPHOLSTERY_LEAD_DAYS))
    );
    const upholsteryRequireDepositBeforeOrder = parseBool(map.get(SETTING_UPHOLSTERY_REQUIRE_DEPOSIT), true);
    const upholsteryBlockProductionUntilMaterials = parseBool(
        map.get(SETTING_UPHOLSTERY_BLOCK_PRODUCTION),
        true
    );
    const bays = normalizeBays(map.get(SETTING_BAYS));
    const bayLabels = normalizeBayLabels(map.get(SETTING_BAY_LABELS));
    const expressTargetMinutes = parsePrice(map.get(SETTING_EXPRESS_MINUTES), DEFAULT_EXPRESS_MINUTES);
    const warrantyDays = parsePrice(map.get(SETTING_WARRANTY_DAYS), DEFAULT_WARRANTY_DAYS);
    const reviewUrl = String(map.get(SETTING_REVIEW_URL) || '').trim();
    const teardownPhotoRequired = parseBool(map.get(SETTING_TEARDOWN_PHOTO_REQUIRED), true);

    const shopExtras = {
        upholsteryYardage,
        upholsteryVendors,
        upholsteryDefaultLeadDays,
        upholsteryRequireDepositBeforeOrder,
        upholsteryBlockProductionUntilMaterials,
        bays,
        bayLabels
    };

    return {
        shopVerticals: verticals,
        shopVertical: verticals[0] || null,
        shopJobsEnabled: verticals.length > 0,
        alignment,
        upholsteryDeposit,
        laborRates,
        packages,
        hours,
        reviewUrl,
        expressTargetMinutes,
        serviceIntervals,
        warrantyDays,
        storageLocations,
        upholsteryTemplates,
        teardownPhotoRequired,
        ...shopExtras,
        shop: {
            alignment,
            diagnostics,
            laborRates,
            upholsteryDeposit,
            packages,
            hours,
            reviewUrl,
            expressTargetMinutes,
            serviceIntervals,
            warrantyDays,
            storageLocations,
            upholsteryTemplates,
            teardownPhotoRequired,
            ...shopExtras
        }
    };
}

module.exports = {
    SETTING_SHOP_VERTICALS,
    SETTING_ALIGNMENT_2WHEEL_PRICE,
    SETTING_ALIGNMENT_4WHEEL_PRICE,
    SETTING_HIDE_FREE_DIAG,
    SETTING_HIDE_BILLABLE_DIAG,
    SETTING_LABOR_RATE_AUTO,
    SETTING_LABOR_RATE_BODY,
    SETTING_LABOR_RATE_UPHOLSTERY,
    SETTING_LABOR_RATE_TIRE,
    SETTING_LABOR_RATE_CONTRACTOR,
    SETTING_UPHOLSTERY_DEPOSIT_PERCENT,
    SETTING_UPHOLSTERY_DEPOSIT_MIN,
    SETTING_PACKAGES,
    SETTING_REVIEW_URL,
    SETTING_HOURS,
    SETTING_EXPRESS_MINUTES,
    SETTING_SERVICE_INTERVALS,
    SETTING_WARRANTY_DAYS,
    SETTING_STORAGE_LOCATIONS,
    SETTING_UPHOLSTERY_TEMPLATES,
    SETTING_TEARDOWN_PHOTO_REQUIRED,
    SETTING_UPHOLSTERY_YARDAGE,
    SETTING_UPHOLSTERY_VENDORS,
    SETTING_UPHOLSTERY_DEFAULT_LEAD_DAYS,
    SETTING_UPHOLSTERY_REQUIRE_DEPOSIT,
    SETTING_UPHOLSTERY_BLOCK_PRODUCTION,
    SETTING_BAYS,
    SETTING_BAY_LABELS,
    SHOP_VERTICALS,
    DEFAULT_ALIGNMENT_PRICES,
    DEFAULT_UPHOLSTERY_DEPOSIT,
    DEFAULT_LABOR_RATES,
    DEFAULT_PACKAGES,
    DEFAULT_UPHOLSTERY_TEMPLATES,
    DEFAULT_UPHOLSTERY_YARDAGE,
    DEFAULT_UPHOLSTERY_VENDORS,
    DEFAULT_UPHOLSTERY_LEAD_DAYS,
    DEFAULT_BAYS,
    DEFAULT_BAY_LABELS,
    DEFAULT_SERVICE_INTERVALS,
    DEFAULT_HOURS,
    parseShopVerticals,
    parsePrice,
    parseLaborRates,
    loadPosShopSettings,
    normalizePackages,
    normalizeUpholsteryTemplates,
    normalizeUpholsteryYardage,
    normalizeUpholsteryVendors,
    normalizeBays,
    normalizeBayLabels
};
