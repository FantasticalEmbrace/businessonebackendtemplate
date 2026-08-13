const { loadBackendEnv, createPool } = require('../utils/dbConfig');
loadBackendEnv();
(async () => {
    const pool = createPool();
    const [rows] = await pool.query(
        'SELECT id, sku, slug, name, price FROM products WHERE is_active=1 AND price = 25 ORDER BY id'
    );
    console.log(JSON.stringify(rows, null, 2));
    await pool.end();
})();
