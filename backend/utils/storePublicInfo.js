'use strict';

const { loadHolidaySchedule } = require('./storeHolidaySchedule');

const STORE_HOUR_KEYS = {
    weekdays: 'store_hours_weekdays',
    saturday: 'store_hours_saturday',
    sunday: 'store_hours_sunday',
};

const DEFAULT_FOOTER_HOURS = {
    weekdays: 'Mon-Fri: 10am-5pm',
    saturday: 'Sat: 10am-1pm',
    sunday: '',
};

async function loadStoreHours(pool) {
    const keys = Object.values(STORE_HOUR_KEYS);
    const map = new Map();

    if (pool) {
        const placeholders = keys.map(() => '?').join(', ');
        const [rows] = await pool.execute(
            `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
            keys
        );
        (rows || []).forEach((row) => map.set(row.key_name, row.value));
    }

    const pick = (key, fallback) => {
        const raw = String(map.get(key) || '').trim();
        return raw || fallback;
    };

    return {
        weekdays: pick(STORE_HOUR_KEYS.weekdays, DEFAULT_FOOTER_HOURS.weekdays),
        saturday: pick(STORE_HOUR_KEYS.saturday, DEFAULT_FOOTER_HOURS.saturday),
        sunday: pick(STORE_HOUR_KEYS.sunday, DEFAULT_FOOTER_HOURS.sunday),
    };
}

/** Full weekday set for POS / internal displays (may include Sunday). */
function storeHourFooterLines(hours) {
    return [hours.weekdays, hours.saturday, hours.sunday].filter((line) => String(line || '').trim());
}

/** Storefront footers: Mon-Fri + Sat only — never Sunday or holiday lines. */
function storefrontFooterLines(hours) {
    return [hours.weekdays, hours.saturday].filter((line) => String(line || '').trim());
}

function publicStoreInfoPayload(hours) {
    return {
        hours: {
            weekdays: hours.weekdays,
            saturday: hours.saturday,
            sunday: hours.sunday,
        },
        footerLines: storefrontFooterLines(hours),
        // Kept empty so older cached site-store-info.js never paints holiday rows.
        upcomingHolidays: [],
        holidayFooterLines: [],
    };
}

async function loadPublicStoreInfo(pool) {
    const hours = await loadStoreHours(pool);
    return publicStoreInfoPayload(hours);
}

module.exports = {
    STORE_HOUR_KEYS,
    DEFAULT_FOOTER_HOURS,
    loadStoreHours,
    loadHolidaySchedule,
    storeHourFooterLines,
    storefrontFooterLines,
    publicStoreInfoPayload,
    loadPublicStoreInfo,
};
