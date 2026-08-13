'use strict';

/** Store appointments are always in Eastern Time (Fort Oglethorpe, GA). */
const STORE_TIMEZONE = 'America/New_York';

function normalizeTimeHm(value) {
    const raw = String(value || '').trim();
    const m = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
        return null;
    }
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function normalizeDateYmd(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const y = value.getUTCFullYear();
        const m = String(value.getUTCMonth() + 1).padStart(2, '0');
        const d = String(value.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const s = String(value).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Wall-clock parts in STORE_TIMEZONE for an absolute instant. */
function storePartsFromUtcMs(utcMs) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: STORE_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
        dtf.formatToParts(new Date(utcMs)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
    );
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
    };
}

/** UTC ms for a wall-clock date/time in STORE_TIMEZONE. */
function storeWallClockToUtcMs(dateYmd, timeHm) {
    const date = normalizeDateYmd(dateYmd);
    const time = normalizeTimeHm(timeHm);
    if (!date || !time) return NaN;

    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi, 0);

    const atGuess = storePartsFromUtcMs(guess);
    const asUtc = Date.UTC(atGuess.year, atGuess.month - 1, atGuess.day, atGuess.hour, atGuess.minute, atGuess.second);
    const offset = asUtc - guess;
    return guess - offset;
}

/** Google Calendar event start/end (wall clock in store TZ — do not use toISOString). */
function buildStoreCalendarDateTime(dateYmd, timeHm) {
    const date = normalizeDateYmd(dateYmd);
    const time = normalizeTimeHm(timeHm);
    if (!date || !time) {
        throw new Error('Invalid store date/time');
    }
    return {
        dateTime: `${date}T${time}:00`,
        timeZone: STORE_TIMEZONE,
    };
}

function buildStoreCalendarEnd(dateYmd, timeHm, durationHours = 1) {
    const startMs = storeWallClockToUtcMs(dateYmd, timeHm);
    const endMs = startMs + durationHours * 60 * 60 * 1000;
    const p = storePartsFromUtcMs(endMs);
    const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    return buildStoreCalendarDateTime(date, time);
}

/** RFC3339 bounds for listing events on a store calendar day. */
function getStoreDayBoundsRfc3339(dateYmd) {
    const date = normalizeDateYmd(dateYmd);
    if (!date) throw new Error('Invalid date');
    const startMs = storeWallClockToUtcMs(date, '00:00');
    const endMs = storeWallClockToUtcMs(date, '23:59') + 59 * 1000;
    return {
        timeMin: new Date(startMs).toISOString(),
        timeMax: new Date(endMs).toISOString(),
    };
}

/** HH:MM in store TZ from a Google Calendar event start. */
function eventStartToStoreTimeHm(eventStart) {
    if (!eventStart) return null;
    if (eventStart.date) {
        return '00:00';
    }
    const raw = String(eventStart.dateTime || '');
    const m = raw.match(/T(\d{2}):(\d{2})/);
    if (m && eventStart.timeZone === STORE_TIMEZONE) {
        return `${m[1]}:${m[2]}`;
    }
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return null;
    const p = storePartsFromUtcMs(ms);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function isStoreDateTimeInFuture(dateYmd, timeHm) {
    const ms = storeWallClockToUtcMs(dateYmd, timeHm);
    return Number.isFinite(ms) && ms > Date.now();
}

/** Today's date (YYYY-MM-DD) in store timezone. */
function getStoreTodayYmd() {
    const p = storePartsFromUtcMs(Date.now());
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function isStoreDateTodayOrFuture(dateYmd) {
    const ymd = normalizeDateYmd(dateYmd);
    if (!ymd) return false;
    return ymd >= getStoreTodayYmd();
}

module.exports = {
    STORE_TIMEZONE,
    normalizeTimeHm,
    normalizeDateYmd,
    buildStoreCalendarDateTime,
    buildStoreCalendarEnd,
    getStoreDayBoundsRfc3339,
    eventStartToStoreTimeHm,
    isStoreDateTimeInFuture,
    isStoreDateTodayOrFuture,
    getStoreTodayYmd,
    storeWallClockToUtcMs,
};
