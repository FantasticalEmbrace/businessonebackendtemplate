#!/usr/bin/env node
'use strict';

/**
 * One-time fix: online bookings were saved as status=pending with no confirmed_date.
 * Marks active appointments as confirmed and aligns confirmed_date/time with preferred.
 *
 * Usage: node scripts/confirm-pending-edsa-bookings.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT) || 3306,
    });

    try {
        const [result] = await pool.execute(
            `UPDATE edsa_bookings
                SET status = 'confirmed',
                    confirmed_date = preferred_date,
                    confirmed_time = preferred_time,
                    updated_at = CURRENT_TIMESTAMP
              WHERE status = 'pending'
                AND preferred_date IS NOT NULL`
        );
        console.log(`Updated ${result.affectedRows} pending EDSA booking(s) to confirmed.`);
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
