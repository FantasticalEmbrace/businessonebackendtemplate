'use strict';

const { loadHolidaySchedule } = require('./storeHolidaySchedule');
const {
    loadStoreHoursSchedule,
    scheduleToDisplayLines,
    publicHoursPayload,
} = require('./storeHoursSchedule');

const STORE_HOUR_KEYS = {
    weekdays: 'store_hours_weekdays',
    saturday: 'store_hours_saturday',
    sunday: 'store_hours_sunday',
    schedule: 'store_hours_schedule',
};

const DEFAULT_FOOTER_HOURS = {
    weekdays: 'Mon-Fri: 10am-5pm',
    saturday: 'Sat: 10am-1pm',
    sunday: '',
};

async function loadStoreHours(pool) {
    const schedule = await loadStoreHoursSchedule(pool);
    const derived = scheduleToDisplayLines(schedule);
    return {
        weekdays: derived.weekdays || DEFAULT_FOOTER_HOURS.weekdays,
        saturday: derived.saturday || DEFAULT_FOOTER_HOURS.saturday,
        sunday: derived.sunday || DEFAULT_FOOTER_HOURS.sunday,
        schedule,
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
    const schedulePayload = hours.schedule ? publicHoursPayload(hours.schedule) : null;
    return {
        hours: {
            weekdays: hours.weekdays,
            saturday: hours.saturday,
            sunday: hours.sunday,
        },
        schedule: schedulePayload?.schedule || null,
        hoursSummary: schedulePayload?.hoursSummary || null,
        closedSummary: schedulePayload?.closedSummary || null,
        openDays: schedulePayload?.openDays || null,
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
