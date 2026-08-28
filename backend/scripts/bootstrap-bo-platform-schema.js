'use strict';
/**
 * Copy table structure (no data) from hmherbs -> bo_platform for shared tenancy.
 * Safe: never writes into hmherbs; only CREATE TABLE IF NOT EXISTS into bo_platform.
 */
require('dotenv').config({ path: '/var/www/hmherbs/backend/.env' });
const mysql = require('mysql2/promise');

const TABLES = [
    'brands',
    'product_categories',
    'admin_users',
    'users',
    'products',
    'product_variants',
    'product_images',
    'orders',
    'order_items',
    'pos_devices',
    'pos_equipment',
    'pos_employees',
    'store_settings',
    'settings'
];

(async () => {
    const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
    const base = {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl
    };
    const src = await mysql.createConnection({ ...base, database: 'hmherbs' });
    const dst = await mysql.createConnection({ ...base, database: 'bo_platform' });
    await dst.query('SET FOREIGN_KEY_CHECKS=0');

    for (const table of TABLES) {
        const [rows] = await src.query('SHOW TABLES LIKE ?', [table]);
        if (!rows.length) {
            console.log('skip missing', table);
            continue;
        }
        const [createRows] = await src.query(`SHOW CREATE TABLE \`${table}\``);
        let ddl = createRows[0]['Create Table'];
        ddl = ddl.replace(/^CREATE TABLE/, 'CREATE TABLE IF NOT EXISTS');
        await dst.query(ddl);
        console.log('ok', table);
    }

    await dst.query('SET FOREIGN_KEY_CHECKS=1');
    await src.end();
    await dst.end();
    console.log('schema bootstrap done');
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
