'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');

(async () => {
    const ssl = {
        ca: fs.readFileSync(process.env.DB_SSL_CA_PATH),
        rejectUnauthorized: false
    };
    const c = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl
    });
    const [r] = await c.query(
        'SELECT DATABASE() AS db, COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()'
    );
    console.log(JSON.stringify(r[0]));
    await c.end();
})().catch((e) => {
    console.error('DB_FAIL', e.message);
    process.exit(1);
});
