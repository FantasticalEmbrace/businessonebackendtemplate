'use strict';

/**
 * Re-sync Google Calendar events to match DB preferred_date/time (America/New_York).
 * Usage: node scripts/fix-edsa-calendar-times.js [bookingId]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const googleCalendar = require('../services/google-calendar');
const { normalizeDateYmd } = require('../utils/storeTimezone');

async function main() {
    const onlyId = process.argv[2] ? Number(process.argv[2]) : null;

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

    const sql = onlyId
        ? `SELECT id, first_name, last_name, email, phone, notes,
                  preferred_date, preferred_time, google_calendar_event_id
             FROM edsa_bookings
            WHERE id = ? AND google_calendar_event_id IS NOT NULL`
        : `SELECT id, first_name, last_name, email, phone, notes,
                  preferred_date, preferred_time, google_calendar_event_id
             FROM edsa_bookings
            WHERE google_calendar_event_id IS NOT NULL
              AND status IN ('pending', 'confirmed')
            ORDER BY id DESC`;

    const [rows] = await pool.execute(sql, onlyId ? [onlyId] : []);

    for (const b of rows) {
        const date = normalizeDateYmd(b.preferred_date);
        const time = String(b.preferred_time || '').slice(0, 5);
        console.log(`Booking #${b.id}: ${date} ${time} → updating event ${b.google_calendar_event_id}`);

        await googleCalendar.updateEvent(
            b.google_calendar_event_id,
            {
                firstName: b.first_name,
                lastName: b.last_name,
                email: b.email,
                phone: b.phone,
                notes: b.notes,
                preferredDate: date,
                preferredTime: time,
                bookingId: b.id,
            },
            pool
        );
    }

    await pool.end();
    console.log('Done.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
