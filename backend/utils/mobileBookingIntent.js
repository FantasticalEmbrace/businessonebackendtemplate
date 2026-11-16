'use strict';

/**
 * Mobile Sales and Service booking-intent options.
 *
 * Platform identity is generic (any trade). Model / concern catalogs are
 * shop-defined. Rainbow vacuum SKUs live only as an optional example pack —
 * never as the default for every MSS shop.
 */

const SETTING_MOBILE_BOOKING_INTENT = 'pos_mobile_booking_intent_options';

/** Optional example pack — shops opt in via admin; not applied as platform defaults. */
const EXAMPLE_RAINBOW_MODELS = Object.freeze([
    { id: 'srx', label: 'SRX' },
    { id: 'e-series', label: 'E2 or E-series' },
    { id: 'd-series', label: 'D-series or older' },
    { id: 'not-sure', label: 'Not sure' },
]);

/** Optional example pack — shops opt in via admin; not applied as platform defaults. */
const EXAMPLE_RAINBOW_CONCERNS = Object.freeze([
    { id: 'weak-suction', label: 'Weak suction' },
    { id: 'leaking-water', label: 'Leaking water' },
    { id: 'will-not-start', label: 'Will not start' },
    { id: 'brush-will-not-turn', label: 'Brush will not turn' },
    { id: 'noise-or-hot-smell', label: 'Noise or a hot smell' },
    { id: 'hose-or-cord', label: 'Hose or cord' },
    { id: 'hepa-neutralizer', label: 'HEPA neutralizer' },
    { id: 'full-service', label: 'Full Service' },
    { id: 'something-else', label: 'Something else' },
]);

/** Generic timing chips shared by all MSS shops. */
const TIMING_CATALOG = Object.freeze([
    { id: 'morning', label: 'Morning' },
    { id: 'afternoon', label: 'Afternoon' },
    { id: 'either', label: 'Either' },
]);

/** Generic visit purposes — shop websites may override copy locally. */
const PURPOSE_CATALOG = Object.freeze([
    {
        id: 'demo',
        title: 'Sales / demo visit',
        body: 'See the product or service in person at the customer location.',
    },
    {
        id: 'service',
        title: 'Service / repair visit',
        body: 'Repair, parts, or a checkup for something the customer already has.',
    },
    {
        id: 'question',
        title: 'Ask a question',
        body: 'A trade-in, a part, or something that is not a full visit yet.',
    },
]);

/** Empty models/concerns by default — shops configure for their trade. */
const DEFAULT_INTENT_OPTIONS = Object.freeze({
    models: [],
    concerns: [],
    timing: TIMING_CATALOG.map((o) => o.id),
    purposes: PURPOSE_CATALOG.map((o) => o.id),
});

/** @deprecated Use shop-defined options; kept for older admin/API imports. */
const MODEL_CATALOG = EXAMPLE_RAINBOW_MODELS;
/** @deprecated Use shop-defined options; kept for older admin/API imports. */
const CONCERN_CATALOG = EXAMPLE_RAINBOW_CONCERNS;

const KNOWN_OPTION_LABELS = Object.freeze(
    Object.fromEntries(
        [...EXAMPLE_RAINBOW_MODELS, ...EXAMPLE_RAINBOW_CONCERNS, ...TIMING_CATALOG].map((o) => [
            o.id,
            o.label,
        ])
    )
);

function slugifyLabel(label) {
    return String(label || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

function coerceOptionEntry(item, fallbackLabelMap = KNOWN_OPTION_LABELS) {
    if (item == null) return null;
    if (typeof item === 'string' || typeof item === 'number') {
        const id = String(item).trim().toLowerCase();
        if (!id) return null;
        const label = fallbackLabelMap[id] || String(item).trim();
        return { id, label };
    }
    if (typeof item !== 'object') return null;
    const label = String(item.label || item.title || item.name || '').trim();
    let id = String(item.id || item.value || '')
        .trim()
        .toLowerCase();
    if (!id && label) id = slugifyLabel(label);
    if (!id) return null;
    return { id, label: label || fallbackLabelMap[id] || id };
}

function parseOptionList(raw) {
    let list = [];
    if (Array.isArray(raw)) list = raw;
    else if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) list = parsed;
            else list = raw.split(/[,|]/);
        } catch {
            list = raw.split(/[,|]/);
        }
    }
    const out = [];
    const seen = new Set();
    list.forEach((item) => {
        const opt = coerceOptionEntry(item);
        if (!opt || seen.has(opt.id)) return;
        seen.add(opt.id);
        out.push(opt);
    });
    return out;
}

function parseIdList(raw, allowedIds) {
    const allow = allowedIds ? new Set(allowedIds) : null;
    let list = [];
    if (Array.isArray(raw)) list = raw;
    else if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) list = parsed;
            else list = raw.split(/[,|]/);
        } catch {
            list = raw.split(/[,|]/);
        }
    }
    const out = [];
    const seen = new Set();
    list.forEach((item) => {
        const id =
            typeof item === 'object' && item
                ? String(item.id || '')
                      .trim()
                      .toLowerCase()
                : String(item || '')
                      .trim()
                      .toLowerCase();
        if (!id || seen.has(id)) return;
        if (allow && !allow.has(id)) return;
        seen.add(id);
        out.push(id);
    });
    return out;
}

/**
 * Normalize stored setting JSON.
 * Accepts legacy id-only arrays (resolves known labels, including prior Rainbow seeds)
 * and new { id, label } arrays. Empty models/concerns are valid.
 */
function normalizeIntentOptions(raw) {
    let obj = raw;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            obj = JSON.parse(raw);
        } catch {
            obj = null;
        }
    }
    if (!obj || typeof obj !== 'object') {
        return {
            models: [],
            concerns: [],
            timing: [...DEFAULT_INTENT_OPTIONS.timing],
            purposes: [...DEFAULT_INTENT_OPTIONS.purposes],
        };
    }

    const models = parseOptionList(obj.models);
    const concerns = parseOptionList(obj.concerns);
    const timing = parseIdList(
        obj.timing,
        TIMING_CATALOG.map((o) => o.id)
    );
    const purposes = parseIdList(
        obj.purposes,
        PURPOSE_CATALOG.map((o) => o.id)
    );

    return {
        models,
        concerns,
        timing: timing.length ? timing : [...DEFAULT_INTENT_OPTIONS.timing],
        purposes: purposes.length ? purposes : [...DEFAULT_INTENT_OPTIONS.purposes],
    };
}

function resolveCatalog(ids, catalog) {
    const map = new Map(catalog.map((o) => [o.id, o]));
    return ids.map((id) => map.get(id)).filter(Boolean);
}

function publicBookingIntent(optionsInput, timingHints = {}) {
    const options = normalizeIntentOptions(optionsInput);
    const timing = resolveCatalog(options.timing, TIMING_CATALOG).map((opt) => ({
        ...opt,
        hint: timingHints[opt.id] || '',
    }));
    return {
        models: options.models.map((o) => ({ id: o.id, label: o.label })),
        concerns: options.concerns.map((o) => ({ id: o.id, label: o.label })),
        timing,
        purposes: resolveCatalog(options.purposes, PURPOSE_CATALOG),
        selected: {
            models: options.models.map((o) => o.id),
            concerns: options.concerns.map((o) => o.id),
            timing: options.timing,
            purposes: options.purposes,
        },
        catalogs: {
            models: options.models.map((o) => ({ id: o.id, label: o.label })),
            concerns: options.concerns.map((o) => ({ id: o.id, label: o.label })),
            timing: [...TIMING_CATALOG],
            purposes: [...PURPOSE_CATALOG],
            examples: {
                rainbow: {
                    models: [...EXAMPLE_RAINBOW_MODELS],
                    concerns: [...EXAMPLE_RAINBOW_CONCERNS],
                },
            },
        },
    };
}

async function loadMobileBookingIntent(pool) {
    if (!pool) return normalizeIntentOptions(null);
    try {
        const [rows] = await pool.execute(
            `SELECT value FROM settings WHERE key_name = ? LIMIT 1`,
            [SETTING_MOBILE_BOOKING_INTENT]
        );
        return normalizeIntentOptions(rows?.[0]?.value || null);
    } catch {
        return normalizeIntentOptions(null);
    }
}

module.exports = {
    SETTING_MOBILE_BOOKING_INTENT,
    EXAMPLE_RAINBOW_MODELS,
    EXAMPLE_RAINBOW_CONCERNS,
    MODEL_CATALOG,
    CONCERN_CATALOG,
    TIMING_CATALOG,
    PURPOSE_CATALOG,
    DEFAULT_INTENT_OPTIONS,
    KNOWN_OPTION_LABELS,
    normalizeIntentOptions,
    publicBookingIntent,
    loadMobileBookingIntent,
};
