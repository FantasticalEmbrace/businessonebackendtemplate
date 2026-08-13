'use strict';

const SETTING_ENABLED = 'pos_payroll_email_enabled';
const SETTING_TO = 'pos_payroll_email_to';
const SETTING_FREQUENCY = 'pos_payroll_email_frequency';
const SETTING_WEEKDAY = 'pos_payroll_email_weekday';
const SETTING_HOUR = 'pos_payroll_email_hour';
const SETTING_MINUTE = 'pos_payroll_email_minute';
const SETTING_INCLUDE_PAY = 'pos_payroll_email_include_pay';
const SETTING_LAST_PERIOD_KEY = 'pos_payroll_email_last_period_key';

const FREQUENCIES = Object.freeze(['weekly', 'biweekly', 'semimonthly', 'monthly']);

const DEFAULTS = {
    payrollEmailEnabled: false,
    payrollEmailTo: '',
    payrollEmailFrequency: 'weekly',
    payrollEmailWeekday: 1, // Monday
    payrollEmailHour: 8,
    payrollEmailMinute: 0,
    payrollEmailIncludePay: true,
    payrollEmailLastPeriodKey: ''
};

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

function parseBool(value, fallback = false) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return fallback;
}

function normalizeFrequency(value) {
    const f = String(value || '').trim().toLowerCase();
    return FREQUENCIES.includes(f) ? f : DEFAULTS.payrollEmailFrequency;
}

function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function startOfLocalDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfLocalDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

/** ISO week number (UTC) for biweekly cadence. */
function isoWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Resolve the payroll period that should be emailed when a scheduled send fires "now".
 * Periods are always completed ranges ending yesterday (no partial current day).
 */
function resolvePayrollPeriod(now = new Date(), settings = {}) {
    const frequency = normalizeFrequency(settings.payrollEmailFrequency);
    const today = startOfLocalDay(now);
    const periodEndDay = addDays(today, -1);

    if (frequency === 'weekly' || frequency === 'biweekly') {
        const span = frequency === 'biweekly' ? 13 : 6;
        const periodStart = startOfLocalDay(addDays(periodEndDay, -span));
        const periodEnd = endOfLocalDay(periodEndDay);
        return {
            frequency,
            from: periodStart,
            to: periodEnd,
            fromKey: localDateKey(periodStart),
            toKey: localDateKey(periodEnd),
            periodKey: `${frequency}:${localDateKey(periodStart)}_${localDateKey(periodEnd)}`
        };
    }

    if (frequency === 'semimonthly') {
        const y = today.getFullYear();
        const m = today.getMonth();
        const day = today.getDate();
        let periodStart;
        let periodEnd;
        if (day >= 16) {
            // On/after 16th: completed half is 1–15 of this month.
            periodStart = startOfLocalDay(new Date(y, m, 1));
            periodEnd = endOfLocalDay(new Date(y, m, 15));
        } else {
            // Early month: completed half is 16–EOM of previous month.
            const prev = new Date(y, m - 1, 1);
            const py = prev.getFullYear();
            const pm = prev.getMonth();
            periodStart = startOfLocalDay(new Date(py, pm, 16));
            periodEnd = endOfLocalDay(new Date(py, pm, daysInMonth(py, pm)));
        }
        return {
            frequency,
            from: periodStart,
            to: periodEnd,
            fromKey: localDateKey(periodStart),
            toKey: localDateKey(periodEnd),
            periodKey: `semimonthly:${localDateKey(periodStart)}_${localDateKey(periodEnd)}`
        };
    }

    // monthly — previous calendar month
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const py = prevMonth.getFullYear();
    const pm = prevMonth.getMonth();
    const periodStart = startOfLocalDay(new Date(py, pm, 1));
    const periodEnd = endOfLocalDay(new Date(py, pm, daysInMonth(py, pm)));
    return {
        frequency: 'monthly',
        from: periodStart,
        to: periodEnd,
        fromKey: localDateKey(periodStart),
        toKey: localDateKey(periodEnd),
        periodKey: `monthly:${localDateKey(periodStart)}_${localDateKey(periodEnd)}`
    };
}

function shouldSendPayrollNow(now = new Date(), settings = {}) {
    if (!settings.payrollEmailEnabled) return { ok: false, reason: 'disabled' };
    if (!String(settings.payrollEmailTo || '').trim()) return { ok: false, reason: 'no_recipient' };

    const hour = clampInt(settings.payrollEmailHour, 0, 23, DEFAULTS.payrollEmailHour);
    const minute = clampInt(settings.payrollEmailMinute, 0, 59, DEFAULTS.payrollEmailMinute);
    if (now.getHours() !== hour || now.getMinutes() < minute || now.getMinutes() > minute + 1) {
        return { ok: false, reason: 'wrong_time' };
    }

    const frequency = normalizeFrequency(settings.payrollEmailFrequency);
    const weekday = clampInt(settings.payrollEmailWeekday, 0, 6, DEFAULTS.payrollEmailWeekday);

    if (frequency === 'weekly' || frequency === 'biweekly') {
        if (now.getDay() !== weekday) return { ok: false, reason: 'wrong_weekday' };
        // Biweekly: only odd ISO weeks (stable every-other-week cadence).
        if (frequency === 'biweekly' && isoWeekNumber(now) % 2 === 0) {
            return { ok: false, reason: 'wrong_biweek' };
        }
    } else if (frequency === 'semimonthly') {
        const d = now.getDate();
        // Send on the 1st (for prior 16–EOM) or 16th (for 1–15)
        if (d !== 1 && d !== 16) return { ok: false, reason: 'wrong_day' };
    } else if (frequency === 'monthly') {
        if (now.getDate() !== 1) return { ok: false, reason: 'wrong_day' };
    }

    const period = resolvePayrollPeriod(now, settings);
    if (settings.payrollEmailLastPeriodKey && settings.payrollEmailLastPeriodKey === period.periodKey) {
        return { ok: false, reason: 'already_sent', period };
    }
    return { ok: true, period };
}

async function loadPosPayrollSettings(pool) {
    const keys = [
        SETTING_ENABLED,
        SETTING_TO,
        SETTING_FREQUENCY,
        SETTING_WEEKDAY,
        SETTING_HOUR,
        SETTING_MINUTE,
        SETTING_INCLUDE_PAY,
        SETTING_LAST_PERIOD_KEY
    ];
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

    return {
        payrollEmailEnabled: parseBool(map.get(SETTING_ENABLED), DEFAULTS.payrollEmailEnabled),
        payrollEmailTo: String(map.get(SETTING_TO) || '').trim(),
        payrollEmailFrequency: normalizeFrequency(map.get(SETTING_FREQUENCY)),
        payrollEmailWeekday: clampInt(map.get(SETTING_WEEKDAY), 0, 6, DEFAULTS.payrollEmailWeekday),
        payrollEmailHour: clampInt(map.get(SETTING_HOUR), 0, 23, DEFAULTS.payrollEmailHour),
        payrollEmailMinute: clampInt(map.get(SETTING_MINUTE), 0, 59, DEFAULTS.payrollEmailMinute),
        payrollEmailIncludePay: parseBool(map.get(SETTING_INCLUDE_PAY), DEFAULTS.payrollEmailIncludePay),
        payrollEmailLastPeriodKey: String(map.get(SETTING_LAST_PERIOD_KEY) || '').trim()
    };
}

module.exports = {
    SETTING_ENABLED,
    SETTING_TO,
    SETTING_FREQUENCY,
    SETTING_WEEKDAY,
    SETTING_HOUR,
    SETTING_MINUTE,
    SETTING_INCLUDE_PAY,
    SETTING_LAST_PERIOD_KEY,
    FREQUENCIES,
    DEFAULTS,
    loadPosPayrollSettings,
    resolvePayrollPeriod,
    shouldSendPayrollNow,
    localDateKey,
    startOfLocalDay,
    endOfLocalDay
};
