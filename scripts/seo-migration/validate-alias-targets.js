#!/usr/bin/env node
/** Ensures every redirects-slug-aliases.csv target slug exists as an active product. */

const { loadBackendEnv, createPool, createConnection } = require('../../backend/utils/dbConfig');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { parseRedirectCsv } = require('../../backend/middleware/seoRedirects');

const rootDir = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(rootDir, 'backend', '.env') });

async function main() {
    loadBackendEnv(path.join(__dirname, '..', '..', 'backend', '.env'));
    const fp = path.join(rootDir, 'redirects-slug-aliases.csv');
    if (!fs.existsSync(fp)) {
        console.error('Missing redirects-slug-aliases.csv — run npm run seo:slug-aliases');
        process.exit(1);
    }
    const map = parseRedirectCsv(fs.readFileSync(fp, 'utf8'));
    const slugs = [];
    let nonProduct = 0;
    for (const to of map.values()) {
        const m = /[?&]slug=([^&]+)/.exec(to);
        if (m) slugs.push(decodeURIComponent(m[1]));
        else nonProduct++;
    }

    if (!slugs.length) {
        console.log('No product.html?slug= targets in aliases (brand/search fallbacks only).');
        return;
    }

    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs'
    });
    const [rows] = await pool.query(
        `SELECT slug FROM products WHERE is_active = 1 AND slug IN (${slugs.map(() => '?').join(',')})`,
        slugs
    );
    await pool.end();

    const found = new Set(rows.map((r) => r.slug));
    const missing = slugs.filter((s) => !found.has(s));
    console.log('Alias targets checked:', slugs.length, `(+ ${nonProduct} brand/search/catalog/anchor fallbacks)`);
    console.log('Missing in DB:', missing.length);
    if (missing.length) {
        console.log(missing.slice(0, 15).join('\n'));
        process.exit(1);
    }
    console.log('All alias targets resolve to active products.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
