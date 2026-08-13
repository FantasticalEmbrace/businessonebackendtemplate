#!/usr/bin/env node
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
loadBackendEnv();

const fixes = {
    354: '/images/products/our-father-s-healing-herbs-healing-antiseptic-salve-2oz-id1234-hmherbs-primary.jpg',
    389: '/images/products/regal-labs-candida-formula-id1550-hmherbs-primary.jpg',
    579: '/images/products/standard-enzyme-hs-formula-id1751-hmherbs-primary.jpg',
    822: '/images/products/advanced-blood-pressure-support-id1233-hmherbs-primary.jpg',
    905: '/images/products/advanced-blood-pressure-support-id1233-hmherbs-primary.jpg',
    906: '/images/products/advanced-blood-pressure-support-id1233-hmherbs-primary.jpg'
};

(async () => {
    const pool = createPool();
    for (const [id, url] of Object.entries(fixes)) {
        const [rows] = await pool.execute('SELECT name FROM products WHERE id = ?', [id]);
        if (!rows.length) continue;
        const name = rows[0].name;
        const [ex] = await pool.execute(
            'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1',
            [id]
        );
        if (ex.length) {
            await pool.execute('UPDATE product_images SET image_url = ? WHERE id = ?', [url, ex[0].id]);
        } else {
            await pool.execute(
                'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
                [id, url, name]
            );
        }
        console.log(`fixed #${id} -> ${url}`);
    }
    await pool.end();
})();
