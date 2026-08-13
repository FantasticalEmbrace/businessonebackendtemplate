require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });

    const [rows] = await pool.query(
        `SELECT pv.id, pv.product_id, pv.sku, pv.name, pv.is_active,
                p.sku AS product_sku, p.name AS product_name
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         WHERE pv.sku = ?
         LIMIT 5`,
        ['N029 L01']
    );
    console.log(JSON.stringify(rows, null, 2));
    await pool.end();
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
