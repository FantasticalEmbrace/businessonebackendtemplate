#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const googleCalendar = require('../services/google-calendar');
const { normalizeDateYmd } = require('../utils/storeTimezone');

const dateArg = process.argv[2] || '2026-05-29';

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT) || 3306,
    });

    const dateYmd = normalizeDateYmd(dateArg) || dateArg;
    console.log('Date:', dateYmd);

    const [bookings] = await pool.execute(
        `SELECT id, status, preferred_date, preferred_time, google_calendar_event_id
           FROM edsa_bookings
          WHERE preferred_date = ?
          ORDER BY preferred_time`,
        [dateYmd]
    );
    console.log('\nDB bookings on this date:');
    for (const b of bookings) {
        console.log(
            `  #${b.id} ${b.status} ${String(b.preferred_time).slice(0, 5)} cal=${b.google_calendar_event_id || '—'}`
        );
    }

    const [active] = await pool.execute(
        `SELECT preferred_time FROM edsa_bookings
          WHERE preferred_date = ? AND status IN ('pending', 'confirmed')`,
        [dateYmd]
    );
    console.log('\nActive DB times:', active.map((r) => String(r.preferred_time).slice(0, 5)).join(', ') || '(none)');

    await googleCalendar.ensureInitialized(pool);
    if (!googleCalendar.isAvailable()) {
        console.log('\nGoogle Calendar: not connected');
    } else {
        const slots = await googleCalendar.getAvailableSlots(dateYmd, pool);
        console.log('\nGoogle+logic slots:');
        for (const s of slots) {
            console.log(`  ${s.time} available=${s.available}`);
        }

        const { getStoreDayBoundsRfc3339 } = require('../utils/storeTimezone');
        const { timeMin, timeMax } = getStoreDayBoundsRfc3339(dateYmd);
        const res = await googleCalendar.calendar.events.list({
            calendarId: googleCalendar.calendarId,
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: 'startTime',
        });
        console.log('\nRaw calendar events:');
        for (const ev of res.data.items || []) {
            console.log(
                `  ${ev.id} "${ev.summary}" start=${ev.start?.dateTime || ev.start?.date}`
            );
        }
    }

    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
