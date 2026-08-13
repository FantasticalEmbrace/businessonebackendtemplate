#!/usr/bin/env node
/** Polish descriptions + deactivate non-product rows. */
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
loadBackendEnv();

const JUNK_SLUGS = ['featured-products', 'shop', 'search', 'digital-gift-card', 'physical-gift-card'];
const VISTA_CBD_SLUGS = [
    'vista-life-cbd-25mg-capsules',
    'vista-life-cbd-25mg-gummies',
    'vista-life-cbd-dead-sea-mud-mask',
    'vista-life-cbd-oil-full-spectrum'
];

(async () => {
    const pool = createPool();
    const [na] = await pool.execute(`
        UPDATE products
        SET short_description = TRIM(LEFT(long_description, 400)),
            updated_at = NOW()
        WHERE is_active = 1
          AND TRIM(COALESCE(short_description, '')) IN ('Not Available', 'N/A', 'NA')
          AND TRIM(COALESCE(long_description, '')) <> ''
    `);
    console.log('Fixed Not Available short descriptions:', na.affectedRows);

    for (const slug of [...JUNK_SLUGS, ...VISTA_CBD_SLUGS]) {
        const [r] = await pool.execute(
            'UPDATE products SET is_active = 0, show_on_web = 0, updated_at = NOW() WHERE slug = ?',
            [slug]
        );
        if (r.affectedRows) console.log('Deactivated', slug);
    }

    const [vista] = await pool.execute(`
        UPDATE products SET is_active = 0, show_on_web = 0, updated_at = NOW()
        WHERE is_active = 1 AND (name LIKE '%Vista Life CBD%' OR slug LIKE 'vista-life-cbd-%')
    `);
    if (vista.affectedRows) console.log('Deactivated Vista Life CBD products:', vista.affectedRows);

    const [[stats]] = await pool.query(`
        SELECT
            SUM(is_active=1) active,
            SUM(is_active=1 AND COALESCE(TRIM(short_description),'')<>'') with_short,
            SUM(is_active=1 AND COALESCE(TRIM(long_description),'')<>'') with_long,
            SUM(is_active=1 AND COALESCE(TRIM(coa_url),'')<>'') with_coa
        FROM products
    `);
    console.log('Stats:', stats);
    await pool.end();
})();
