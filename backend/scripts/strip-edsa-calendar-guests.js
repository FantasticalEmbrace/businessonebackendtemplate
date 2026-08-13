'use strict';

/**
 * One-time: remove customer guests from existing EDSA Google Calendar events
 * so Google stops sending invite/cancel emails (branded SMTP emails are used instead).
 *
 * Usage: node scripts/strip-edsa-calendar-guests.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const googleCalendar = require('../services/google-calendar');

async function main() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
        port: Number(process.env.DB_PORT) || 3306,
    });

    await googleCalendar.ensureInitialized(pool);
    if (!googleCalendar.isAvailable()) {
        console.error('Google Calendar not connected.');
        process.exit(1);
    }

    const [rows] = await pool.execute(
        `SELECT id, google_calendar_event_id
           FROM edsa_bookings
          WHERE google_calendar_event_id IS NOT NULL
            AND google_calendar_event_id <> ''`
    );

    let fixed = 0;
    for (const row of rows) {
        const eventId = row.google_calendar_event_id;
        try {
            await googleCalendar.stripEventAttendees(eventId);
            fixed += 1;
            console.log(`Booking #${row.id}: stripped guests from ${eventId}`);
        } catch (err) {
            console.warn(`Booking #${row.id}: ${err.message}`);
        }
    }

    await pool.end();
    console.log(`Done. Updated ${fixed} calendar event(s).`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
