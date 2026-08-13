#!/usr/bin/env node
'use strict';

/**
 * Removes Google Calendar events left behind when EDSA bookings were cancelled.
 * Safe to re-run; only targets events linked to cancelled/completed bookings.
 *
 * Usage: node scripts/purge-cancelled-edsa-calendar-events.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const googleCalendar = require('../services/google-calendar');

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT) || 3306,
    });

    try {
        await googleCalendar.ensureInitialized(pool);
        if (!googleCalendar.isAvailable()) {
            console.error('Google Calendar is not connected. Connect in admin settings first.');
            process.exit(1);
        }

        const [rows] = await pool.execute(
            `SELECT id, google_calendar_event_id
               FROM edsa_bookings
              WHERE status IN ('cancelled', 'completed')
                AND google_calendar_event_id IS NOT NULL`
        );

        let deleted = 0;
        for (const row of rows) {
            const eventId = row.google_calendar_event_id;
            const ok = await googleCalendar.deleteEvent(eventId, pool);
            if (ok) {
                deleted += 1;
                console.log(`Removed calendar event for cancelled booking #${row.id}`);
            } else {
                console.warn(`Calendar event already gone for booking #${row.id} — clearing DB link`);
            }
            await pool.execute(
                'UPDATE edsa_bookings SET google_calendar_event_id = NULL WHERE id = ?',
                [row.id]
            );
        }

        console.log(`Done. Removed ${deleted} orphaned calendar event(s).`);
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
