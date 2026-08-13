#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { catalogPrimaryImageForProduct } = require('../utils/catalogOverrides');

loadBackendEnv();

const REPO = path.join(__dirname, '..', '..');
const PRODUCTS_DIR = path.join(REPO, 'images', 'products');

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

async function setPrimary(pool, productId, name, url) {
    const [existing] = await pool.execute(
        'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1 LIMIT 1',
        [productId]
    );
    if (existing.length) {
        await pool.execute('UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?', [
            url,
            name,
            existing[0].id
        ]);
    } else {
        await pool.execute(
            'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
            [productId, url, name]
        );
    }
}

async function findImageForProduct(slug, files) {
    const base = slugify(String(slug || '').replace(/-sku-\d+$/i, ''));
    if (!base) return null;
    let best = null;
    for (const file of files) {
        const stem = slugify(path.basename(file, path.extname(file)).replace(/-id\d+.*$/i, '').replace(/-hmherbs-primary$/i, ''));
        if (stem === base || stem.startsWith(base) || base.startsWith(stem)) {
            if (!best || stem.length > slugify(path.basename(best, path.extname(best))).length) {
                best = file;
            }
        }
    }
    return best;
}

(async () => {
    const pool = createPool({ connectionLimit: 3 });
    const names = (await fs.readdir(PRODUCTS_DIR)).filter((n) => /\.(jpe?g|png|gif|webp)$/i.test(n));
    const files = names.map((n) => path.join(PRODUCTS_DIR, n));

    const manual = {
        55: '/images/BURIED TREASURE ACF EXT STRENGTH PM.jpg',
        194: null
    };

    const [rows] = await pool.execute(`
        SELECT p.id, p.sku, p.slug, p.name, pi.image_url
        FROM products p
        LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
        WHERE p.is_active = 1
    `);

    let fixed = 0;
    for (const row of rows) {
        const catalog = catalogPrimaryImageForProduct(row);
        if (catalog) {
            const full = path.join(REPO, catalog.replace(/^\//, ''));
            try {
                const st = await fs.stat(full);
                if (st.isFile() && st.size > 800) {
                    if (row.image_url !== catalog) {
                        await setPrimary(pool, row.id, row.name, catalog);
                        fixed++;
                        console.log(`catalog #${row.id} -> ${catalog}`);
                    }
                    continue;
                }
            } catch {
                /* fall through */
            }
        }

        if (manual[row.id]) {
            await setPrimary(pool, row.id, row.name, manual[row.id]);
            fixed++;
            console.log(`manual #${row.id} -> ${manual[row.id]}`);
            continue;
        }

        const match = await findImageForProduct(row.slug, files);
        if (!match) continue;
        const url = `/images/products/${encodeURIComponent(path.basename(match))}`.replace(/%20/g, '%20');
        const plainUrl = `/images/products/${path.basename(match)}`;
        const current = row.image_url || '';
        if (current === plainUrl || current === url) continue;
        await setPrimary(pool, row.id, row.name, plainUrl);
        fixed++;
        console.log(`matched #${row.id} -> ${plainUrl}`);
    }

    await pool.end();
    console.log(`Fixed ${fixed} products`);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
