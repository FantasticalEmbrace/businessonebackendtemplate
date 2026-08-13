'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { sendBookingReceivedEmail } = require('../services/edsaAppointmentEmail');

const to = String(process.argv[2] || process.env.SMTP_USER || '').trim();
if (!to) {
    console.error('Usage: node scripts/test-smtp.js recipient@example.com');
    process.exit(1);
}

sendBookingReceivedEmail({
    bookingId: 0,
    firstName: 'Test',
    email: to,
    preferredDate: '2026-06-01',
    preferredTime: '14:00'
})
    .then(() => {
        console.log('Done — check inbox for', to);
        process.exit(0);
    })
    .catch((err) => {
        console.error('Failed:', err);
        process.exit(1);
    });
