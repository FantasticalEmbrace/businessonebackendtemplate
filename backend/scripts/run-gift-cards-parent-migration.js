'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const mysql = require('mysql2/promise');

(async () => {
    const sql = fs.readFileSync(
        require('path').join(__dirname, '..', '..', 'database', 'migrations', '20260619_pos_gift_cards_parent.sql'),
        'utf8'
    );
    const p = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
    });
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        await p.query(stmt);
    }
    const [rows] = await p.query(
        `SELECT id, name, slug, parent_id FROM product_categories
         WHERE slug IN ('supplements', 'cbd', 'gift-cards') ORDER BY slug`
    );
    console.log(JSON.stringify(rows, null, 2));
    await p.end();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
