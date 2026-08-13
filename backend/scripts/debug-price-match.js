const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const path = require('path');
const fs = require('fs').promises;

loadBackendEnv();

(async () => {
    const pool = createPool({ connectionLimit: 2 });
    const [rows] = await pool.query(
        `SELECT id, sku, slug, name, price FROM products WHERE is_active=1 AND price=25 ORDER BY id LIMIT 5`
    );
    const raw = await fs.readFile(path.join(__dirname, '../data/scraped-products.json'), 'utf8');
    const data = JSON.parse(raw);
    const bySku = new Map();
    for (const p of data.products || []) {
        if (p.sku) bySku.set(String(p.sku).toUpperCase(), p.price);
    }
    for (const row of rows) {
        const m = String(row.slug || '').match(/-sku-([a-z0-9-]+)$/i);
        const slugSku = m ? m[1] : '';
        console.log({
            id: row.id,
            sku: row.sku,
            slug: row.slug,
            dbPrice: row.price,
            slugSku,
            jsonPrice: slugSku ? bySku.get(slugSku.toUpperCase()) : null
        });
    }
    const [[stats]] = await pool.query(
        'SELECT COUNT(*) total, SUM(price=25) at25 FROM products WHERE is_active=1'
    );
    console.log('stats', stats);
    await pool.end();
})();
