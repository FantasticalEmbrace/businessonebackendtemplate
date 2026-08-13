#!/usr/bin/env node
'use strict';

/**
 * Cancel active EDSA bookings by id (for clearing test data).
 * Usage: node scripts/cancel-edsa-test-bookings.js 1 2 3 4
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const {
    deleteBookingCalendarEvent,
    loadBookingRowById,
} = require('../utils/edsaBookingOps');

async function main() {
    const ids = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) {
        console.error('Pass booking ids to cancel, e.g. node scripts/cancel-edsa-test-bookings.js 1 2 3 4');
        process.exit(1);
    }

    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT) || 3306,
    });

    try {
        for (const id of ids) {
            const row = await loadBookingRowById(pool, id);
            if (!row) {
                console.warn(`Booking #${id} not found`);
                continue;
            }
            if (row.google_calendar_event_id) {
                await deleteBookingCalendarEvent(pool, row.google_calendar_event_id);
            }
            await pool.execute(
                `UPDATE edsa_bookings
                    SET status = 'cancelled',
                        google_calendar_event_id = NULL,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
                [id]
            );
            console.log(`Cancelled booking #${id}`);
        }
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
