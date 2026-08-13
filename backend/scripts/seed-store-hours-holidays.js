#!/usr/bin/env node
/**
 * Seed store hours + U.S. holiday schedule and sync closed holidays to EDSA blocked dates.
 *
 *   cd backend && node scripts/seed-store-hours-holidays.js
 *   cd backend && node scripts/seed-store-hours-holidays.js --years=2026,2027
 */
'use strict';

const { loadBackendEnv } = require('../utils/dbConfig');
const {
    buildUsHolidaySchedule,
    syncClosedHolidaysToEdsa,
} = require('../utils/storeHolidaySchedule');

loadBackendEnv();

const DEFAULT_HOURS = {
    store_hours_weekdays: 'Mon-Fri: 10:00 AM - 5:00 PM',
    store_hours_saturday: 'Sat: 10:00 AM - 1:00 PM',
    store_hours_sunday: 'Sun: Closed',
    store_address_line1: '1140 Battlefield Pkwy',
    store_city: 'Fort Oglethorpe',
    store_state: 'GA',
    store_zip: '30742',
};

function parseYearsArg() {
    const arg = process.argv.find((a) => a.startsWith('--years='));
    if (!arg) {
        const y = new Date().getFullYear();
        return [y, y + 1];
    }
    return arg
        .slice('--years='.length)
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((y) => Number.isInteger(y) && y >= 2000);
}

async function upsertSetting(pool, keyName, value, description, type = 'string') {
    await pool.execute(
        `INSERT INTO settings (key_name, value, description, type)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP`,
        [keyName, value, description, type]
    );
}

async function main() {
    const mysql = require('mysql2/promise');
    const { buildDbConfig } = require('../utils/dbConfig');
    const pool = mysql.createPool(buildDbConfig({ connectionLimit: 2 }));
    const years = parseYearsArg();
    const holidays = buildUsHolidaySchedule(years);

    try {
        console.log(`Seeding store hours and ${holidays.length} holiday(s) for ${years.join(', ')}…`);

        for (const [key, value] of Object.entries(DEFAULT_HOURS)) {
            await upsertSetting(pool, key, value, key.replace(/_/g, ' '), 'string');
        }

        await upsertSetting(
            pool,
            'store_holiday_schedule',
            JSON.stringify(holidays),
            'Structured holiday schedule for closures/special hours',
            'json'
        );

        const edsaSync = await syncClosedHolidaysToEdsa(pool, holidays);
        console.log('Store hours saved.');
        console.log(`Holiday schedule saved (${holidays.length} entries).`);
        console.log(
            `EDSA blocked dates: ${edsaSync.added} added, ${edsaSync.skipped} skipped (${edsaSync.existing} already in DB before sync).`
        );
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});
