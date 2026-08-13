'use strict';

const {
    loadHolidaySchedule,
    upcomingHolidayLines,
} = require('./storeHolidaySchedule');

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

function storeHourFooterLines(hours) {
    return [hours.weekdays, hours.saturday, hours.sunday].filter((line) => String(line || '').trim());
}

function publicStoreInfoPayload(hours, { holidaySchedule = [] } = {}) {
    const footerLines = storeHourFooterLines(hours);
    const upcomingHolidays = upcomingHolidayLines(holidaySchedule);
    return {
        hours: {
            weekdays: hours.weekdays,
            saturday: hours.saturday,
            sunday: hours.sunday,
        },
        footerLines,
        upcomingHolidays,
        holidayFooterLines: upcomingHolidays,
    };
}

async function loadPublicStoreInfo(pool) {
    const [hours, holidaySchedule] = await Promise.all([
        loadStoreHours(pool),
        loadHolidaySchedule(pool),
    ]);
    return publicStoreInfoPayload(hours, { holidaySchedule });
}

module.exports = {
    STORE_HOUR_KEYS,
    DEFAULT_FOOTER_HOURS,
    loadStoreHours,
    loadHolidaySchedule,
    storeHourFooterLines,
    publicStoreInfoPayload,
    loadPublicStoreInfo,
};
