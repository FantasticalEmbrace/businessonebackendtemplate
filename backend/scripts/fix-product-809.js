const { loadBackendEnv, createPool } = require('../utils/dbConfig');
loadBackendEnv();
(async () => {
    const pool = createPool();
    await pool.execute('UPDATE products SET price = 0, updated_at = NOW() WHERE id = 809');
    const [[r]] = await pool.query('SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND price = 25');
    console.log('remaining at $25:', r.c);
    await pool.end();
})();
