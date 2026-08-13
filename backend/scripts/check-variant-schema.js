require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    try {
        const pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'hmherbs',
        });
        const [cols] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants'
             ORDER BY ORDINAL_POSITION`
        );
        console.log('product_variants columns:', cols.map((c) => c.COLUMN_NAME).join(', '));
        const [pcols] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'variant_option_groups'`
        );
        console.log('variant_option_groups exists:', pcols.length > 0);

        const [dupes] = await pool.query(
            `SELECT sku, COUNT(*) AS c FROM product_variants GROUP BY sku HAVING c > 1 LIMIT 5`
        );
        console.log('duplicate variant SKUs:', dupes.length ? dupes : 'none');

        await pool.end();
    } catch (e) {
        console.error('DB error:', e.message);
        process.exit(1);
    }
})();
