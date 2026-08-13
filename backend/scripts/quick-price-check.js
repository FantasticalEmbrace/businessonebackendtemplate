const { loadBackendEnv, createPool } = require('../utils/dbConfig');
loadBackendEnv();

(async () => {
    const pool = createPool({ connectionLimit: 2 });
    const [rows] = await pool.query(`
        SELECT id, sku, name, price
        FROM products
        WHERE is_active = 1 AND slug LIKE '%25407%'
        LIMIT 3
    `);
    const [[stats]] = await pool.query(`
        SELECT COUNT(*) AS total,
               SUM(price = 25) AS at25,
               SUM(price != 25 AND price > 0) AS not25
        FROM products WHERE is_active = 1
    `);
    console.log(JSON.stringify({ stats, sample: rows }, null, 2));
    await pool.end();
})();
