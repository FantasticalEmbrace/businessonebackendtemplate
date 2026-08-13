'use strict';

/**
 * Audit live DB for junk/fake storefront data before Google GBP appeal.
 *   node scripts/audit-truthfulness.js
 */

const { loadBackendEnv, createPool } = require('../utils/dbConfig');

async function main() {
    loadBackendEnv();
    const pool = createPool({ connectionLimit: 3 });

    const checks = [];

    const [junkProducts] = await pool.query(
        `SELECT id, name, sku, show_on_web
         FROM products
         WHERE is_active = 1
           AND show_on_web = 1
           AND (
             LOWER(name) IN ('featured products', 'shop', 'products', 'home')
             OR name LIKE '%Paging%'
             OR sku LIKE 'HM-HMHERBSCOM'
             OR sku LIKE 'HM-PRODUCTS'
           )
         ORDER BY id
         LIMIT 50`
    );
    checks.push({ label: 'Junk web-visible products', count: junkProducts.length, sample: junkProducts.slice(0, 10) });

    const [unknownBrand] = await pool.query(
        `SELECT COUNT(*) n FROM products p
         JOIN brands b ON b.id = p.brand_id
         WHERE p.show_on_web = 1 AND b.slug = 'unknown'`
    );
    checks.push({ label: 'Products on Unknown/Misc brand', count: unknownBrand[0].n });

    const [storeSettings] = await pool.query(
        `SELECT key_name, value FROM settings
         WHERE key_name IN (
           'store_name','store_address_line1','store_city','store_state','store_postal_code',
           'store_phone','store_hours_weekdays','store_hours_saturday','store_hours_sunday',
           'gbp_location_name','gbp_connected_email','gbp_api_access_pending'
         )
         ORDER BY key_name`
    );
    checks.push({ label: 'Store + GBP settings', settings: storeSettings });

    const [webNoImage] = await pool.query(
        `SELECT COUNT(*) n
         FROM products p
         LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
         WHERE p.show_on_web = 1 AND p.is_active = 1
           AND (pi.image_url IS NULL OR pi.image_url = '')`
    );
    checks.push({ label: 'Web products missing primary image', count: webNoImage[0].n });

    const [posJunkBrands] = await pool.query(
        `SELECT b.name, b.slug, COUNT(p.id) web_count
         FROM brands b
         JOIN products p ON p.brand_id = b.id AND p.show_on_web = 1
         WHERE b.is_active = 1
           AND (b.logo_url IS NULL OR b.logo_url = '')
           AND b.slug <> 'unknown'
         GROUP BY b.id, b.name, b.slug
         ORDER BY web_count DESC`
    );
    checks.push({ label: 'Web brands without logos (hidden on brands page)', count: posJunkBrands.length, sample: posJunkBrands });

    console.log(JSON.stringify(checks, null, 2));
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
