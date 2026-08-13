'use strict';
/** One-off: backfill carrier + send label tracking email for existing label_created orders. */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { inferCarrierFromTracking } = require('../utils/trackingUrl');
const { sendLabelCreatedNotificationEmail } = require('../services/shippedNotificationEmail');
const { ensureShippingSchema } = require('../utils/ensureShippingSchema');

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
    });

    await ensureShippingSchema(pool);

    const [orders] = await pool.query(
        `SELECT id, tracking_number, shipping_carrier, label_email_sent, status
           FROM orders
          WHERE status = 'label_created' AND tracking_number IS NOT NULL`
    );

    for (const order of orders) {
        if (!order.shipping_carrier && order.tracking_number) {
            const carrier = inferCarrierFromTracking(order.tracking_number).toUpperCase();
            if (carrier) {
                await pool.query('UPDATE orders SET shipping_carrier = ? WHERE id = ?', [carrier, order.id]);
                console.log(`Order ${order.id}: carrier → ${carrier}`);
            }
        }
        if (!order.label_email_sent) {
            await sendLabelCreatedNotificationEmail(pool, order.id);
            console.log(`Order ${order.id}: label tracking email queued/sent`);
        }
    }

    await pool.end();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
