'use strict';
require('dotenv').config({ path: '/var/www/hmherbs/backend/.env' });
const mysql = require('mysql2/promise');

(async () => {
    const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl,
        multipleStatements: true
    });
    await conn.query(
        'CREATE DATABASE IF NOT EXISTS bo_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    const [rows] = await conn.query("SHOW DATABASES LIKE 'bo_platform'");
    console.log('bo_platform:', rows.length ? 'exists' : 'MISSING');
    await conn.end();
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
