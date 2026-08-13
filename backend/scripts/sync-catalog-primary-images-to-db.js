#!/usr/bin/env node
/**
 * Writes catalog override primary image paths into product_images so the database matches
 * what the API already returns (catalog wins in server.js). Helps backups, admin UIs, and
 * report scripts stay aligned — and makes missing files obvious in one place.
 *
 * Usage (from backend/):
 *   node scripts/sync-catalog-primary-images-to-db.js --dry-run
 *   node scripts/sync-catalog-primary-images-to-db.js
 */
const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
const path = require('path');
const fs = require('fs').promises;
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { catalogPrimaryImageForProduct } = require('../utils/catalogOverrides');

const REPO_ROOT = path.join(__dirname, '..', '..');

function parseArgs() {
    const a = process.argv.slice(2);
    return { dryRun: a.includes('--dry-run') };
}

async function setPrimaryImage(pool, productId, productName, publicUrl, isDryRun) {
    if (isDryRun) return;
    const [existing] = await pool.execute(
        'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1 LIMIT 1',
        [productId]
    );
    const alt = (productName || '').substring(0, 500);
    if (existing.length > 0) {
        await pool.execute('UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?', [
            publicUrl,
            alt,
            existing[0].id
        ]);
    } else {
        await pool.execute(
            'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
            [productId, publicUrl, alt]
        );
    }
}

async function fileExists(rel) {
    const full = path.join(REPO_ROOT, rel.replace(/^\//, ''));
    try {
        const st = await fs.stat(full);
        return st.isFile() && st.size > 500;
    } catch {
        return false;
    }
}

(async () => {
    loadBackendEnv();
    const { dryRun } = parseArgs();
    const pool = createPool({ connectionLimit: 5 });

    const [rows] = await pool.execute(`
        SELECT p.id, p.sku, p.slug, p.name
        FROM products p
        WHERE p.is_active = 1
        ORDER BY p.id
    `);

    let updated = 0;
    let skippedNoCatalog = 0;
    let skippedMissingFile = 0;

    for (const row of rows) {
        const catalog = catalogPrimaryImageForProduct(row);
        if (!catalog) {
            skippedNoCatalog++;
            continue;
        }
        const rel = catalog.replace(/^\//, '');
        if (!(await fileExists(rel))) {
            skippedMissingFile++;
            console.warn(`Missing file for catalog entry: ${catalog} (product #${row.id} ${row.slug})`);
            continue;
        }
        await setPrimaryImage(pool, row.id, row.name, catalog, dryRun);
        updated++;
    }

    await pool.end();

    console.log(
        dryRun ? '[dry-run] Would update rows: ' : 'Updated primary image rows: ',
        updated
    );
    console.log('No catalog mapping:', skippedNoCatalog);
    console.log('Catalog path file missing / tiny:', skippedMissingFile);
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
