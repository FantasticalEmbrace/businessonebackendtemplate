'use strict';

const SETTING_DAILY_EMAIL_ENABLED = 'pos_daily_sales_email_enabled';
const SETTING_DAILY_EMAIL_TO = 'pos_daily_sales_email_to';
const SETTING_DAILY_EMAIL_HOUR = 'pos_daily_sales_email_hour';
const SETTING_DAILY_EMAIL_MINUTE = 'pos_daily_sales_email_minute';
const SETTING_DAILY_EMAIL_LAST_SENT = 'pos_daily_sales_email_last_sent';
const SETTING_EOD_REMINDER_ENABLED = 'pos_eod_reminder_enabled';
const SETTING_EOD_REMINDER_HOUR = 'pos_eod_reminder_hour';
const SETTING_EOD_REMINDER_MINUTE = 'pos_eod_reminder_minute';
const SETTING_SUPPORT_PHONE = 'pos_support_phone';
const SETTING_HELP_URL = 'pos_help_url';
const SETTING_CATALOG_REFRESH_MINUTES = 'pos_catalog_refresh_minutes';

const DEFAULTS = {
    dailySalesEmailEnabled: false,
    dailySalesEmailTo: '',
    dailySalesEmailHour: 21,
    dailySalesEmailMinute: 0,
    eodReminderEnabled: true,
    eodReminderHour: 20,
    eodReminderMinute: 0,
    supportPhone: '',
    helpUrl: '',
    catalogRefreshMinutes: 60
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

async function loadPosOperationsSettings(pool) {
    const keys = [
        SETTING_DAILY_EMAIL_ENABLED,
        SETTING_DAILY_EMAIL_TO,
        SETTING_DAILY_EMAIL_HOUR,
        SETTING_DAILY_EMAIL_MINUTE,
        SETTING_DAILY_EMAIL_LAST_SENT,
        SETTING_EOD_REMINDER_ENABLED,
        SETTING_EOD_REMINDER_HOUR,
        SETTING_EOD_REMINDER_MINUTE,
        SETTING_SUPPORT_PHONE,
        SETTING_HELP_URL,
        SETTING_CATALOG_REFRESH_MINUTES
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

    let dailySalesEmailTo = String(map.get(SETTING_DAILY_EMAIL_TO) || '').trim();
    if (!dailySalesEmailTo && pool) {
        try {
            const [storeRows] = await pool.execute(
                `SELECT value FROM settings WHERE key_name = 'store_email' LIMIT 1`
            );
            dailySalesEmailTo = String(storeRows[0]?.value || '').trim();
        } catch {
            /* ignore */
        }
    }

    return {
        dailySalesEmailEnabled: parseBool(map.get(SETTING_DAILY_EMAIL_ENABLED), DEFAULTS.dailySalesEmailEnabled),
        dailySalesEmailTo,
        dailySalesEmailHour: clampInt(map.get(SETTING_DAILY_EMAIL_HOUR), 0, 23, DEFAULTS.dailySalesEmailHour),
        dailySalesEmailMinute: clampInt(map.get(SETTING_DAILY_EMAIL_MINUTE), 0, 59, DEFAULTS.dailySalesEmailMinute),
        dailySalesEmailLastSent: String(map.get(SETTING_DAILY_EMAIL_LAST_SENT) || '').trim(),
        eodReminderEnabled: parseBool(map.get(SETTING_EOD_REMINDER_ENABLED), DEFAULTS.eodReminderEnabled),
        eodReminderHour: clampInt(map.get(SETTING_EOD_REMINDER_HOUR), 0, 23, DEFAULTS.eodReminderHour),
        eodReminderMinute: clampInt(map.get(SETTING_EOD_REMINDER_MINUTE), 0, 59, DEFAULTS.eodReminderMinute),
        supportPhone: String(map.get(SETTING_SUPPORT_PHONE) || '').trim(),
        helpUrl: String(map.get(SETTING_HELP_URL) || '').trim(),
        catalogRefreshMinutes: clampInt(
            map.get(SETTING_CATALOG_REFRESH_MINUTES),
            15,
            1440,
            DEFAULTS.catalogRefreshMinutes
        )
    };
}

module.exports = {
    SETTING_DAILY_EMAIL_ENABLED,
    SETTING_DAILY_EMAIL_TO,
    SETTING_DAILY_EMAIL_HOUR,
    SETTING_DAILY_EMAIL_MINUTE,
    SETTING_DAILY_EMAIL_LAST_SENT,
    SETTING_EOD_REMINDER_ENABLED,
    SETTING_EOD_REMINDER_HOUR,
    SETTING_EOD_REMINDER_MINUTE,
    SETTING_SUPPORT_PHONE,
    SETTING_HELP_URL,
    SETTING_CATALOG_REFRESH_MINUTES,
    DEFAULTS,
    loadPosOperationsSettings
};
