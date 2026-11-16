'use strict';

/**
 * Structured store / booking hours.
 * Canonical shape matches pos_shop_hours:
 *   { mon: { open: '10:00', close: '19:00' }, ..., sun: { open: '', close: '' } }
 * Empty open/close = closed that day.
 */

const DAY_KEYS = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const DAY_LABELS = Object.freeze({
    sun: 'Sunday',
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
});
const DAY_SHORT = Object.freeze({
    sun: 'Sun',
    mon: 'Mon',
    tue: 'Tue',
    wed: 'Wed',
    thu: 'Thu',
    fri: 'Fri',
    sat: 'Sat',
});
/** JS Date#getDay → key */
const DOW_TO_KEY = Object.freeze(DAY_KEYS);

const SETTING_SCHEDULE = 'store_hours_schedule';
const SETTING_POS_HOURS = 'pos_shop_hours';
const SETTING_WEEKDAYS = 'store_hours_weekdays';
const SETTING_SATURDAY = 'store_hours_saturday';
const SETTING_SUNDAY = 'store_hours_sunday';

const DEFAULT_SCHEDULE = Object.freeze({
    mon: { open: '10:00', close: '17:00' },
    tue: { open: '10:00', close: '17:00' },
    wed: { open: '10:00', close: '17:00' },
    thu: { open: '10:00', close: '17:00' },
    fri: { open: '10:00', close: '17:00' },
    sat: { open: '10:00', close: '13:00' },
    sun: { open: '', close: '' },
});

const DEFAULT_SLOT_DURATION = 60;

function pad2(n) {
    return String(n).padStart(2, '0');
}

function normalizeHm(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m24) {
        const h = Number(m24[1]);
        const min = Number(m24[2]);
        if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return `${pad2(h)}:${pad2(min)}`;
        return '';
    }
    const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (m12) {
        let h = Number(m12[1]);
        const min = Number(m12[2] || 0);
        const ap = m12[3].toLowerCase();
        if (h < 1 || h > 12 || min < 0 || min > 59) return '';
        if (ap === 'am') {
            if (h === 12) h = 0;
        } else if (h !== 12) {
            h += 12;
        }
        return `${pad2(h)}:${pad2(min)}`;
    }
    return '';
}

function hmToMinutes(hm) {
    const [h, m] = String(hm || '')
        .slice(0, 5)
        .split(':')
        .map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
}

function formatHmDisplay(hm) {
    const mins = hmToMinutes(hm);
    if (mins == null) return String(hm || '');
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function isDayOpen(day) {
    if (!day || typeof day !== 'object') return false;
    const open = normalizeHm(day.open);
    const close = normalizeHm(day.close);
    if (!open || !close) return false;
    const a = hmToMinutes(open);
    const b = hmToMinutes(close);
    return a != null && b != null && b > a;
}

function normalizeDay(raw) {
    if (!raw || typeof raw !== 'object') return { open: '', close: '' };
    const open = normalizeHm(raw.open);
    const close = normalizeHm(raw.close);
    if (!open || !close) return { open: '', close: '' };
    const a = hmToMinutes(open);
    const b = hmToMinutes(close);
    if (a == null || b == null || b <= a) return { open: '', close: '' };
    return { open, close };
}

function normalizeSchedule(raw) {
    const base = { ...DEFAULT_SCHEDULE };
    const src = raw && typeof raw === 'object' ? raw : {};
    DAY_KEYS.forEach((key) => {
        base[key] = normalizeDay(src[key] || src[DAY_LABELS[key]?.toLowerCase()] || {});
    });
    // Accept long-form API keys (monday…)
    const longMap = {
        sunday: 'sun',
        monday: 'mon',
        tuesday: 'tue',
        wednesday: 'wed',
        thursday: 'thu',
        friday: 'fri',
        saturday: 'sat',
    };
    Object.entries(longMap).forEach(([long, short]) => {
        if (src[long] && typeof src[long] === 'object') {
            const closed = src[long].closed === true;
            base[short] = closed
                ? { open: '', close: '' }
                : normalizeDay({ open: src[long].open, close: src[long].close });
        }
    });
    return base;
}

function parseHoursRangeFromText(text) {
    const raw = String(text || '').trim();
    if (!raw || /closed/i.test(raw)) return null;
    const twelve = raw.match(
        /(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i
    );
    if (twelve) {
        const open = normalizeHm(twelve[1]);
        const close = normalizeHm(twelve[2]);
        if (open && close) return { open, close };
    }
    const twentyFour = raw.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
    if (twentyFour) {
        const open = normalizeHm(twentyFour[1]);
        const close = normalizeHm(twentyFour[2]);
        if (open && close) return { open, close };
    }
    return null;
}

function weekdayKeysFromText(text) {
    const lower = String(text || '').toLowerCase();
    const range = lower.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*[-–]\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
    if (range) {
        const start = range[1].slice(0, 3);
        const end = range[2].slice(0, 3);
        const startIdx = DAY_KEYS.indexOf(start);
        const endIdx = DAY_KEYS.indexOf(end);
        if (startIdx >= 0 && endIdx >= 0) {
            if (startIdx <= endIdx) return DAY_KEYS.slice(startIdx, endIdx + 1);
            return DAY_KEYS.slice(startIdx).concat(DAY_KEYS.slice(0, endIdx + 1));
        }
    }
    if (/mon\s*[-–]\s*fri|weekday/i.test(lower)) return ['mon', 'tue', 'wed', 'thu', 'fri'];
    return ['mon', 'tue', 'wed', 'thu', 'fri'];
}

function scheduleFromDisplayLines({ weekdays = '', saturday = '', sunday = '' } = {}) {
    const schedule = normalizeSchedule({
        mon: { open: '', close: '' },
        tue: { open: '', close: '' },
        wed: { open: '', close: '' },
        thu: { open: '', close: '' },
        fri: { open: '', close: '' },
        sat: { open: '', close: '' },
        sun: { open: '', close: '' },
    });
    const wdRange = parseHoursRangeFromText(weekdays);
    if (wdRange) {
        weekdayKeysFromText(weekdays).forEach((key) => {
            if (key !== 'sat' && key !== 'sun') schedule[key] = { ...wdRange };
        });
    }
    const satRange = parseHoursRangeFromText(saturday);
    schedule.sat = satRange || { open: '', close: '' };
    const sunRange = parseHoursRangeFromText(sunday);
    schedule.sun = sunRange || { open: '', close: '' };
    return schedule;
}

function contiguousOpenGroups(schedule) {
    const openKeys = DAY_KEYS.filter((k) => isDayOpen(schedule[k]));
    if (!openKeys.length) return [];
    const groups = [];
    let current = [openKeys[0]];
    for (let i = 1; i < openKeys.length; i++) {
        const prevIdx = DAY_KEYS.indexOf(current[current.length - 1]);
        const nextIdx = DAY_KEYS.indexOf(openKeys[i]);
        const sameHours =
            schedule[openKeys[i]].open === schedule[current[0]].open &&
            schedule[openKeys[i]].close === schedule[current[0]].close;
        if (nextIdx === prevIdx + 1 && sameHours) {
            current.push(openKeys[i]);
        } else {
            groups.push(current);
            current = [openKeys[i]];
        }
    }
    groups.push(current);
    return groups;
}

function formatGroupLabel(keys) {
    if (keys.length === 1) return DAY_LABELS[keys[0]];
    return `${DAY_LABELS[keys[0]]} through ${DAY_LABELS[keys[keys.length - 1]]}`;
}

function scheduleToSummary(scheduleInput) {
    const schedule = normalizeSchedule(scheduleInput);
    const groups = contiguousOpenGroups(schedule);
    const closedKeys = DAY_KEYS.filter((k) => !isDayOpen(schedule[k]));
    const hoursParts = groups.map((keys) => {
        const day = schedule[keys[0]];
        return `${formatGroupLabel(keys)}, ${formatHmDisplay(day.open)}–${formatHmDisplay(day.close)}`;
    });
    const hoursSummary = hoursParts.length
        ? hoursParts.join('; ')
        : 'Hours not published';
    const closedSummary = closedKeys.length
        ? closedKeys.map((k) => DAY_LABELS[k]).join(' and ')
        : '';
    const openDays = DAY_KEYS.map((k, idx) => (isDayOpen(schedule[k]) ? idx : -1)).filter((n) => n >= 0);
    return { hoursSummary, closedSummary, openDays, schedule };
}

function scheduleToDisplayLines(scheduleInput) {
    const schedule = normalizeSchedule(scheduleInput);
    const weekdayKeys = ['mon', 'tue', 'wed', 'thu', 'fri'];
    const openWeekdays = weekdayKeys.filter((k) => isDayOpen(schedule[k]));
    let weekdays = '';
    if (openWeekdays.length) {
        const first = schedule[openWeekdays[0]];
        const same = openWeekdays.every(
            (k) => schedule[k].open === first.open && schedule[k].close === first.close
        );
        if (same && openWeekdays.length === 5) {
            weekdays = `Mon-Fri: ${formatHmDisplay(first.open)} - ${formatHmDisplay(first.close)}`;
        } else if (same && openWeekdays.length > 1) {
            const a = DAY_SHORT[openWeekdays[0]];
            const b = DAY_SHORT[openWeekdays[openWeekdays.length - 1]];
            weekdays = `${a}-${b}: ${formatHmDisplay(first.open)} - ${formatHmDisplay(first.close)}`;
        } else {
            weekdays = openWeekdays
                .map(
                    (k) =>
                        `${DAY_SHORT[k]}: ${formatHmDisplay(schedule[k].open)} - ${formatHmDisplay(schedule[k].close)}`
                )
                .join(', ');
        }
    } else {
        weekdays = 'Mon-Fri: Closed';
    }

    const saturday = isDayOpen(schedule.sat)
        ? `Sat: ${formatHmDisplay(schedule.sat.open)} - ${formatHmDisplay(schedule.sat.close)}`
        : 'Sat: Closed';
    const sunday = isDayOpen(schedule.sun)
        ? `Sun: ${formatHmDisplay(schedule.sun.open)} - ${formatHmDisplay(schedule.sun.close)}`
        : 'Sun: Closed';

    return { weekdays, saturday, sunday };
}

function scheduleToApiHours(scheduleInput) {
    const schedule = normalizeSchedule(scheduleInput);
    const long = {
        sunday: 'sun',
        monday: 'mon',
        tuesday: 'tue',
        wednesday: 'wed',
        thursday: 'thu',
        friday: 'fri',
        saturday: 'sat',
    };
    const out = {};
    Object.entries(long).forEach(([name, key]) => {
        const day = schedule[key];
        const open = isDayOpen(day);
        out[name] = {
            open: open ? day.open : '00:00',
            close: open ? day.close : '00:00',
            closed: !open,
        };
    });
    return out;
}

function dayKeyForYmd(dateYmd) {
    const [y, m, d] = String(dateYmd || '')
        .slice(0, 10)
        .split('-')
        .map(Number);
    if (!y || !m || !d) return null;
    const dt = new Date(y, m - 1, d);
    return DOW_TO_KEY[dt.getDay()] || null;
}

function generateSlotsForSchedule(scheduleInput, dateYmd, slotDuration = DEFAULT_SLOT_DURATION) {
    const schedule = normalizeSchedule(scheduleInput);
    const key = dayKeyForYmd(dateYmd);
    if (!key || !isDayOpen(schedule[key])) return [];
    const day = schedule[key];
    const start = hmToMinutes(day.open);
    const end = hmToMinutes(day.close);
    const step = Math.max(15, Number(slotDuration) || DEFAULT_SLOT_DURATION);
    if (start == null || end == null || end <= start) return [];
    const slots = [];
    for (let t = start; t < end; t += step) {
        const h = Math.floor(t / 60);
        const min = t % 60;
        slots.push({ time: `${pad2(h)}:${pad2(min)}`, available: true });
    }
    return slots;
}

function timingHintsFromSchedule(scheduleInput) {
    const { openDays, schedule } = scheduleToSummary(scheduleInput);
    if (!openDays.length) {
        return {
            morning: 'Earlier in open hours',
            afternoon: 'Later in open hours',
            either: 'Any open hour',
        };
    }
    const openKeys = openDays.map((d) => DAY_KEYS[d]);
    const opens = openKeys.map((k) => hmToMinutes(schedule[k].open)).filter((n) => n != null);
    const closes = openKeys.map((k) => hmToMinutes(schedule[k].close)).filter((n) => n != null);
    const earliest = Math.min(...opens);
    const latest = Math.max(...closes);
    const daySpan =
        openKeys.length > 1
            ? `${DAY_SHORT[openKeys[0]]}–${DAY_SHORT[openKeys[openKeys.length - 1]]}`
            : DAY_SHORT[openKeys[0]];
    return {
        morning: `${daySpan}, closer to ${formatHmDisplay(`${pad2(Math.floor(earliest / 60))}:${pad2(earliest % 60)}`)}`,
        afternoon: `${daySpan}, closer to ${formatHmDisplay(`${pad2(Math.floor(latest / 60))}:${pad2(latest % 60)}`)}`,
        either: `Any open hour ${daySpan}`,
    };
}

async function loadStoreHoursSchedule(pool) {
    const keys = [
        SETTING_SCHEDULE,
        SETTING_POS_HOURS,
        SETTING_WEEKDAYS,
        SETTING_SATURDAY,
        SETTING_SUNDAY,
    ];
    const map = new Map();
    if (pool) {
        try {
            const placeholders = keys.map(() => '?').join(', ');
            const [rows] = await pool.execute(
                `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
                keys
            );
            (rows || []).forEach((row) => map.set(row.key_name, row.value));
        } catch {
            /* ignore */
        }
    }

    const rawSchedule = map.get(SETTING_SCHEDULE);
    if (rawSchedule) {
        try {
            const parsed = typeof rawSchedule === 'string' ? JSON.parse(rawSchedule) : rawSchedule;
            if (parsed && typeof parsed === 'object') {
                return normalizeSchedule(parsed);
            }
        } catch {
            /* fall through */
        }
    }

    const posRaw = map.get(SETTING_POS_HOURS);
    if (posRaw) {
        try {
            const parsed = typeof posRaw === 'string' ? JSON.parse(posRaw) : posRaw;
            if (parsed && typeof parsed === 'object') {
                const normalized = normalizeSchedule(parsed);
                // Prefer pos hours only if at least one day is open
                if (DAY_KEYS.some((k) => isDayOpen(normalized[k]))) return normalized;
            }
        } catch {
            /* fall through */
        }
    }

    const fromDisplay = scheduleFromDisplayLines({
        weekdays: map.get(SETTING_WEEKDAYS) || '',
        saturday: map.get(SETTING_SATURDAY) || '',
        sunday: map.get(SETTING_SUNDAY) || '',
    });
    if (DAY_KEYS.some((k) => isDayOpen(fromDisplay[k]))) return fromDisplay;

    return normalizeSchedule(DEFAULT_SCHEDULE);
}

function publicHoursPayload(scheduleInput, slotDuration = DEFAULT_SLOT_DURATION) {
    const schedule = normalizeSchedule(scheduleInput);
    const summary = scheduleToSummary(schedule);
    const display = scheduleToDisplayLines(schedule);
    return {
        schedule,
        hours: scheduleToApiHours(schedule),
        hoursSummary: summary.hoursSummary,
        closedSummary: summary.closedSummary,
        openDays: summary.openDays,
        displayLines: display,
        slotDuration: Math.max(15, Number(slotDuration) || DEFAULT_SLOT_DURATION),
        footerLines: [display.weekdays, display.saturday, display.sunday].filter(Boolean),
    };
}

module.exports = {
    DAY_KEYS,
    DAY_LABELS,
    DAY_SHORT,
    DOW_TO_KEY,
    SETTING_SCHEDULE,
    SETTING_POS_HOURS,
    SETTING_WEEKDAYS,
    SETTING_SATURDAY,
    SETTING_SUNDAY,
    DEFAULT_SCHEDULE,
    DEFAULT_SLOT_DURATION,
    normalizeHm,
    normalizeSchedule,
    isDayOpen,
    scheduleFromDisplayLines,
    scheduleToSummary,
    scheduleToDisplayLines,
    scheduleToApiHours,
    dayKeyForYmd,
    generateSlotsForSchedule,
    timingHintsFromSchedule,
    loadStoreHoursSchedule,
    publicHoursPayload,
    formatHmDisplay,
};
