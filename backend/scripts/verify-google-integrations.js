#!/usr/bin/env node
/**
 * Verify Google Calendar (EDSA) and Google Business (hours/holidays) integrations.
 *
 *   cd backend && node scripts/verify-google-integrations.js
 */
'use strict';

const path = require('path');
const { loadBackendEnv } = require('../utils/dbConfig');
const GoogleCalendarOAuthService = require('../services/google-calendar-oauth');
const googleCalendarService = require('../services/google-calendar');
const GoogleBusinessProfileService = require('../services/google-business-profile');

loadBackendEnv();

const mockReq = {
    protocol: 'http',
    get: (h) => (h === 'host' ? `localhost:${process.env.PORT || 3001}` : null),
    headers: {},
};

function ok(label, detail = '') {
    console.log(`  OK  ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail = '') {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label, detail = '') {
    console.log(`  WARN ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
    const mysql = require('mysql2/promise');
    const { buildDbConfig } = require('../utils/dbConfig');
    const pool = mysql.createPool(buildDbConfig({ connectionLimit: 2 }));

    console.log('\n=== Google integrations verification ===\n');

    try {
        // --- Calendar ---
        console.log('Google Calendar (EDSA)');
        const gcalStatus = await GoogleCalendarOAuthService.getConnectionStatus(pool);
        if (!gcalStatus.clientConfigured) {
            fail('OAuth client', 'Set GCAL_CLIENT_ID / GCAL_CLIENT_SECRET (or GBP_*) in backend/.env');
        } else {
            ok('OAuth client configured');
        }
        if (!gcalStatus.connected) {
            fail('Connected', 'Use admin → Connect Google Calendar');
        } else {
            ok('Connected', gcalStatus.connectedEmail || 'email unknown');
            ok('Calendar ID', gcalStatus.calendarId || 'primary');
        }

        if (gcalStatus.readyForEdsa) {
            await googleCalendarService.ensureInitialized(pool);
            if (googleCalendarService.isAvailable()) {
                ok('Calendar API', `mode=${googleCalendarService.authMode}`);
                try {
                    const calendars = await GoogleCalendarOAuthService.listCalendars(pool, mockReq);
                    ok('List calendars', `${calendars.length} calendar(s) with write access`);
                } catch (e) {
                    fail('List calendars', e.message);
                }
            } else {
                fail('Calendar API', 'not initialized after OAuth');
            }
        }

        // --- Business Profile ---
        console.log('\nGoogle Business Profile (hours / holidays)');
        const gbpHasCreds = GoogleBusinessProfileService.hasClientCredentials();
        if (!gbpHasCreds) {
            fail('OAuth client', 'Set GBP_CLIENT_ID / GBP_CLIENT_SECRET in backend/.env');
        } else {
            ok('OAuth client configured');
        }

        const gbpCreds = await GoogleBusinessProfileService.loadCredentials(pool);
        if (!gbpCreds.refreshToken) {
            fail('Connected', 'Use admin → Connect Google Business');
        } else {
            ok('Connected', gbpCreds.connectedEmail || 'email unknown');
        }

        if (gbpCreds.refreshToken) {
            try {
                const locations = await GoogleBusinessProfileService.listLocations(pool, mockReq);
                ok('List locations', `${locations.length} location(s)`);
                locations.slice(0, 3).forEach((loc) => {
                    console.log(`       • ${loc.title || loc.name}${loc.address ? ` — ${loc.address}` : ''}`);
                });
            } catch (e) {
                fail('List locations', e.message || String(e));
                const project = GoogleBusinessProfileService.getOAuthProjectNumber();
                console.log(
                    '       → Developer: GBP API access pending — see GOOGLE_BUSINESS_PROFILE_SETUP.md' +
                        (project ? ` (project ${project})` : '')
                );
            }
        }

        if (!gbpCreds.locationName) {
            warn('Location selected', 'Pick a location in admin Settings (required to sync hours to Google)');
        } else {
            ok('Location selected', gbpCreds.locationName);
        }

        const [holidayRows] = await pool.execute(
            "SELECT value FROM settings WHERE key_name = 'store_holiday_schedule' LIMIT 1"
        );
        let holidays = [];
        try {
            holidays = JSON.parse(holidayRows[0]?.value || '[]');
        } catch {
            holidays = [];
        }
        if (!Array.isArray(holidays) || !holidays.length) {
            warn('Holiday schedule in DB', 'No holidays saved yet (admin → Store info)');
        } else {
            ok('Holiday schedule in DB', `${holidays.length} entr(ies)`);
            const sample = holidays[0];
            const built = GoogleBusinessProfileService._buildSpecialHourPeriod(sample);
            if (built) {
                ok('Holiday → Google format', JSON.stringify(built).slice(0, 80) + '…');
            } else {
                fail('Holiday → Google format', `Could not parse: ${JSON.stringify(sample)}`);
            }
        }

        const [hoursRows] = await pool.execute(
            `SELECT key_name, value FROM settings WHERE key_name IN (
                'store_hours_weekdays','store_hours_saturday','store_hours_sunday'
            )`
        );
        const hours = Object.fromEntries(hoursRows.map((r) => [r.key_name, r.value]));
        const periods = GoogleBusinessProfileService.buildRegularHoursPeriods({
            weekdays: hours.store_hours_weekdays || '',
            saturday: hours.store_hours_saturday || '',
            sunday: hours.store_hours_sunday || '',
        });
        if (!periods.length) {
            warn('Regular hours parse', 'Set weekday/sat/sun hours in Store info');
        } else {
            ok('Regular hours parse', `${periods.length} period(s) for Google`);
        }

        if (gbpCreds.refreshToken && gbpCreds.locationName && periods.length) {
            console.log('\n  (Skipping live sync-hours PATCH — run “Send hours to Google now” in admin to test.)');
        }

        console.log('\n=== Done ===\n');
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('\nVerification failed:', err.message);
    process.exit(1);
});
