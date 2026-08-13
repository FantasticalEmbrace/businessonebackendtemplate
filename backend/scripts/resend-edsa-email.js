'use strict';

/**
 * Resend EDSA booking confirmation (correct links after STOREFRONT_PUBLIC_URL / PORT changes).
 * Usage: node scripts/resend-edsa-email.js <bookingId>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { sendBookingReceivedEmail } = require('../services/edsaAppointmentEmail');
const { getStorefrontPublicBaseUrl } = require('../utils/storefrontUrl');

async function main() {
    const bookingId = Number(process.argv[2]);
    if (!Number.isFinite(bookingId) || bookingId < 1) {
        console.error('Usage: node scripts/resend-edsa-email.js <bookingId>');
        process.exit(1);
    }

    const pool = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
        port: Number(process.env.DB_PORT) || 3306
    });

    const [rows] = await pool.execute(
        `SELECT id, first_name, email, preferred_date, preferred_time
           FROM edsa_bookings WHERE id = ? LIMIT 1`,
        [bookingId]
    );
    await pool.end();

    if (!rows.length) {
        console.error('No booking found for id', bookingId);
        process.exit(1);
    }

    const b = rows[0];
    console.log('Storefront base:', getStorefrontPublicBaseUrl());
    console.log('Resending to:', b.email);

    await sendBookingReceivedEmail({
        bookingId: b.id,
        firstName: b.first_name,
        email: b.email,
        preferredDate: b.preferred_date,
        preferredTime: b.preferred_time
    });

    console.log('Done. Check inbox for updated links (127.0.0.1:3001).');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
