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
    const [p] = await pool.execute(
        'SELECT id, sku, name, price FROM products WHERE is_active=1 LIMIT 1'
    );
    const [emp] = await pool.execute('SELECT id FROM pos_employees WHERE is_active=1 LIMIT 1');
    const product = p[0];
    const { syncPosOrderBatch } = require('../services/posStoreOrder');
    const { loadStoreTaxRate } = require('../utils/storeTaxRate');

    const taxRate = await loadStoreTaxRate(pool);
    const subtotal = Number(product.price);
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    const sale = {
        clientTransactionId: `test-sync-${Date.now()}`,
        items: [{ productId: product.id, sku: product.sku, quantity: 1 }],
        paymentTenders: [
            {
                type: 'card_terminal',
                amount: total,
                terminalAuthCode: 'TESTAUTH',
                terminalCardBrand: 'visa'
            }
        ],
        payment: { terminalApprovedConfirmed: true },
        fromOfflineSync: true,
        shiftSessionId: null
    };

    const results = await syncPosOrderBatch(pool, [sale], 'Front counter', emp[0].id);
    console.log(JSON.stringify(results, null, 2));
    await pool.end();
})().catch((e) => {
    console.error('ERR', e.code, e.message);
    console.error(e);
    process.exit(1);
});
