#!/usr/bin/env node
/**
 * 301 rules for URLs that appeared in the old sitemap.xml (pre-2026) but not in Concrete /index.php paths.
 * Writes repo-root redirects-legacy-sitemap.csv (loaded with redirects-301.csv by the server).
 */

const { loadBackendEnv, createPool, createConnection } = require('../../backend/utils/dbConfig');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const rootDir = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(rootDir, 'backend', '.env') });

/** Old marketing sitemap paths → best match on the new static site */
const STATIC_LEGACY = [
    ['/categories/herbs', '/categories.html'],
    ['/categories/vitamins', '/categories.html'],
    ['/categories/supplements', '/categories.html'],
    ['/categories/minerals', '/categories.html'],
    ['/categories/essential-oils', '/categories.html'],
    ['/categories/probiotics', '/categories.html'],
    ['/brands', '/brands.html'],
    ['/products', '/products.html'],
    ['/about', '/about.html'],
    ['/privacy-policy', '/privacy-policy.html'],
    ['/shipping-returns', '/shipping-returns.html'],
    ['/terms-of-service', '/privacy-policy.html'],
    ['/faq', '/'],
    ['/customer-reviews', '/'],
    ['/search', '/products.html'],
    ['/account/login', '/account.html'],
    ['/account/register', '/account.html'],
    ['/account', '/account.html'],
    ['/checkout', '/checkout.html'],
    ['/cart', '/products.html']
];

function escapeCsv(cell) {
    const s = String(cell ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
    loadBackendEnv(path.join(__dirname, '..', '..', 'backend', '.env'));
    const rows = [['from_path', 'to_path']];
    const seen = new Set();

    const add = (from, to) => {
        const key = from.replace(/\/+$/, '') || '/';
        if (key === '/' || seen.has(key)) return;
        seen.add(key);
        rows.push([key, to]);
    };

    for (const [from, to] of STATIC_LEGACY) add(from, to);

    const pool = createPool({ connectionLimit: 5 });

    try {
        const [brands] = await pool.query(
            'SELECT slug FROM brands WHERE is_active = 1 AND TRIM(slug) <> ""'
        );
        for (const { slug } of brands) {
            add(`/brands/${slug}`, `/products.html?brand=${encodeURIComponent(slug)}`);
        }

        const [health] = await pool.query(
            'SELECT slug FROM health_categories WHERE is_active = 1 AND TRIM(slug) <> ""'
        );
        for (const { slug } of health) {
            add(`/health-conditions/${slug}`, `/products.html?category=${encodeURIComponent(slug)}`);
        }

        const [pc] = await pool.query(
            'SELECT slug FROM product_categories WHERE is_active = 1 AND TRIM(slug) <> ""'
        );
        for (const { slug } of pc) {
            add(`/categories/${slug}`, `/products.html?category=${encodeURIComponent(slug)}`);
        }
    } finally {
        await pool.end();
    }

    const outPath = path.join(rootDir, 'redirects-legacy-sitemap.csv');
    const header = [
        '# Legacy clean URLs from the old hmherbs.com sitemap (not covered by Concrete /index.php rules).',
        '# Loaded automatically with redirects-301.csv. Regenerate:',
        '#   node scripts/seo-migration/generate-legacy-sitemap-redirects.js',
        '#'
    ].join('\n');
    const body = rows.map((r) => r.map(escapeCsv).join(',')).join('\n');
    fs.writeFileSync(outPath, `${header}\n${body}\n`, 'utf8');
    console.log('Wrote', outPath, `(${rows.length - 1} rules)`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
