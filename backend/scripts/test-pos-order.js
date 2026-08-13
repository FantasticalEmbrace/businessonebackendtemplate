'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'hmherbs',
        port: Number(process.env.DB_PORT) || 3306
    });
    const [cols] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
         AND (COLUMN_NAME LIKE 'pos%' OR COLUMN_NAME IN ('payment_method','payment_reference','sales_channel'))`
    );
    console.log('order cols:', cols.map((c) => c.COLUMN_NAME).sort().join(', '));
    const [p] = await pool.execute('SELECT id, sku, name FROM products WHERE is_active=1 LIMIT 1');
    console.log('sample product:', p[0]);
    const [emp] = await pool.execute('SELECT id FROM pos_employees WHERE is_active=1 LIMIT 1');
    console.log('sample employee:', emp[0]);
    const { createInStorePosOrder } = require('../services/posStoreOrder');
    try {
        const r = await createInStorePosOrder(
            pool,
            {
                clientTransactionId: `test-${Date.now()}`,
                items: [{ productId: p[0]?.id, sku: p[0]?.sku, quantity: 1 }],
                payment: { paymentMethod: 'cash', label: 'Cash' },
                shiftSessionId: null
            },
            'Front counter',
            emp[0]?.id
        );
        console.log('OK', r);
    } catch (e) {
        console.error('FAIL', e.code, e.message);
        console.error(e);
    }
    await pool.end();
})();
