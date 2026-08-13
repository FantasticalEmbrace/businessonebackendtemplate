#!/usr/bin/env node
/**
 * Ensures every active catalog slug has /index.php/products/{slug} → product.html?slug={slug}
 * (covers products whose slugs changed since the Concrete crawl export).
 */

const { loadBackendEnv, createPool, createConnection } = require('../../backend/utils/dbConfig');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const rootDir = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(rootDir, 'backend', '.env') });

function escapeCsv(cell) {
    const s = String(cell ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
    loadBackendEnv(path.join(__dirname, '..', '..', 'backend', '.env'));
    const pool = createPool({ connectionLimit: 5 });

    const [products] = await pool.query(
        'SELECT slug FROM products WHERE is_active = 1 AND TRIM(slug) <> "" ORDER BY slug'
    );
    await pool.end();

    const rows = [['from_path', 'to_path']];
    for (const { slug } of products) {
        const enc = encodeURIComponent(slug);
        rows.push([`/index.php/products/${slug}`, `/product.html?slug=${enc}`]);
    }

    const outPath = path.join(rootDir, 'redirects-products-db.csv');
    const header = [
        '# Product redirects from current MySQL slugs (regenerated when catalog changes).',
        '# node scripts/seo-migration/generate-db-product-redirects.js',
        '#'
    ].join('\n');
    fs.writeFileSync(
        outPath,
        `${header}\n${rows.map((r) => r.map(escapeCsv).join(',')).join('\n')}\n`,
        'utf8'
    );
    console.log('Wrote', outPath, `(${products.length} rules)`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
