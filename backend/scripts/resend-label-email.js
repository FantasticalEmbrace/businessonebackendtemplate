'use strict';
/** Resend label tracking email for a specific order (bypasses label_email_sent guard). */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { sendLabelCreatedNotificationEmail } = require('../services/shippedNotificationEmail');

const orderId = Number(process.argv[2]) || 15;

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
    });

    const [[order]] = await pool.query(
        'SELECT id, order_number, email, label_email_sent FROM orders WHERE id = ? LIMIT 1',
        [orderId]
    );
    if (!order) {
        console.error(`Order ${orderId} not found`);
        process.exit(1);
    }

    await pool.query('UPDATE orders SET label_email_sent = 0 WHERE id = ?', [orderId]);
    await sendLabelCreatedNotificationEmail(pool, orderId);

    console.log(`Label tracking email resent for order ${order.order_number} → ${order.email}`);
    await pool.end();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
