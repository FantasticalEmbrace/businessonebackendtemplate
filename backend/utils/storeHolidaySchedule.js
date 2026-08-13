'use strict';

const { addBlockedDate, listBlockedDates } = require('../services/edsaBlockedDates');
const { normalizeDateYmd } = require('./storeTimezone');

const HOLIDAY_SETTING_KEY = 'store_holiday_schedule';

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
    const date = new Date(year, monthIndex, 1);
    let count = 0;
    while (date.getMonth() === monthIndex) {
        if (date.getDay() === weekday) {
            count += 1;
            if (count === nth) return new Date(date);
        }
        date.setDate(date.getDate() + 1);
    }
    return null;
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
    const date = new Date(year, monthIndex + 1, 0);
    while (date.getMonth() === monthIndex) {
        if (date.getDay() === weekday) return new Date(date);
        date.setDate(date.getDate() - 1);
    }
    return null;
}

function toIsoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function usHolidayDefinitions() {
    return [
        { key: 'new-year', name: "New Year's Day", dateForYear: (y) => `${y}-01-01` },
        {
            key: 'mlk',
            name: 'Martin Luther King Jr. Day',
            dateForYear: (y) => toIsoDate(nthWeekdayOfMonth(y, 0, 1, 3)),
        },
        {
            key: 'presidents',
            name: "Presidents' Day",
            dateForYear: (y) => toIsoDate(nthWeekdayOfMonth(y, 1, 1, 3)),
        },
        {
            key: 'memorial',
            name: 'Memorial Day',
            dateForYear: (y) => toIsoDate(lastWeekdayOfMonth(y, 4, 1)),
        },
        { key: 'independence', name: 'Independence Day', dateForYear: (y) => `${y}-07-04` },
        {
            key: 'labor',
            name: 'Labor Day',
            dateForYear: (y) => toIsoDate(nthWeekdayOfMonth(y, 8, 1, 1)),
        },
        {
            key: 'columbus',
            name: 'Columbus Day',
            dateForYear: (y) => toIsoDate(nthWeekdayOfMonth(y, 9, 1, 2)),
        },
        { key: 'veterans', name: 'Veterans Day', dateForYear: (y) => `${y}-11-11` },
        {
            key: 'thanksgiving',
            name: 'Thanksgiving Day',
            dateForYear: (y) => toIsoDate(nthWeekdayOfMonth(y, 10, 4, 4)),
        },
        { key: 'christmas', name: 'Christmas Day', dateForYear: (y) => `${y}-12-25` },
    ];
}

function buildUsHolidaySchedule(years) {
    const yearList = Array.isArray(years) ? years : [years];
    const defs = usHolidayDefinitions();
    const entries = [];

    yearList.forEach((year) => {
        const y = Number(year);
        if (!Number.isInteger(y) || y < 2000 || y > 2100) return;
        defs.forEach((def) => {
            const date = def.dateForYear(y);
            if (!date) return;
            entries.push({
                name: def.name,
                date,
                isClosed: true,
                openTime: null,
                closeTime: null,
                hours: 'Closed',
                note: '',
                source: 'preset',
                templateKey: def.key,
            });
        });
    });

    return entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function parseHolidaySchedule(raw) {
    if (Array.isArray(raw)) return raw;
    try {
        const parsed = JSON.parse(String(raw || '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function isHolidayClosed(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.isClosed === true) return true;
    return /closed/i.test(String(entry.hours || '').trim());
}

function formatHolidayPublicLine(entry) {
    const date = normalizeDateYmd(entry?.date);
    const name = String(entry?.name || 'Holiday').trim();
    if (!date) return '';

    if (isHolidayClosed(entry)) {
        return `${date}: Closed (${name})`;
    }

    const hours =
        String(entry?.hours || '').trim() ||
        `${entry?.openTime || ''}${entry?.closeTime ? ` - ${entry.closeTime}` : ''}`.trim();
    return hours ? `${date}: ${hours} (${name})` : `${date}: ${name}`;
}

function upcomingHolidayLines(schedule, { maxItems = 4, todayYmd = null } = {}) {
    const today = normalizeDateYmd(todayYmd) || toIsoDate(new Date());
    const items = parseHolidaySchedule(schedule)
        .filter((entry) => normalizeDateYmd(entry?.date) >= today)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .slice(0, Math.max(1, maxItems))
        .map(formatHolidayPublicLine)
        .filter(Boolean);
    return items;
}

async function loadHolidaySchedule(pool) {
    if (!pool) return [];
    const [rows] = await pool.execute(
        'SELECT value FROM settings WHERE key_name = ? LIMIT 1',
        [HOLIDAY_SETTING_KEY]
    );
    return parseHolidaySchedule(rows[0]?.value || '[]');
}

async function syncClosedHolidaysToEdsa(pool, schedule, { adminId = null } = {}) {
    const entries = parseHolidaySchedule(schedule).filter(isHolidayClosed);
    if (!entries.length) {
        return { added: 0, skipped: 0, existing: 0 };
    }

    const existing = await listBlockedDates(pool);
    const existingDates = new Set(existing.map((row) => row.date));
    let added = 0;
    let skipped = 0;

    for (const entry of entries) {
        const date = normalizeDateYmd(entry.date);
        if (!date) {
            skipped += 1;
            continue;
        }
        if (existingDates.has(date)) {
            skipped += 1;
            continue;
        }
        try {
            await addBlockedDate(pool, date, `Store closed: ${entry.name || 'Holiday'}`, adminId);
            existingDates.add(date);
            added += 1;
        } catch (err) {
            if (err.status === 409) {
                skipped += 1;
                continue;
            }
            throw err;
        }
    }

    return { added, skipped, existing: existing.length };
}

module.exports = {
    HOLIDAY_SETTING_KEY,
    buildUsHolidaySchedule,
    parseHolidaySchedule,
    isHolidayClosed,
    formatHolidayPublicLine,
    upcomingHolidayLines,
    loadHolidaySchedule,
    syncClosedHolidaysToEdsa,
};
