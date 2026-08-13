#!/usr/bin/env node
/**
 * Fill product weights from names/descriptions and hmherbs.com product pages.
 * Only updates rows where weight IS NULL (does not overwrite existing weights).
 *
 * Usage: node scripts/sync-product-weights.js [--dry-run] [--limit=100] [--fetch]
 */
'use strict';

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { parseWeightOzFromText, stripHtml } = require('../utils/parseProductWeight');

loadBackendEnv();

const HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function hmSlugFromUrl(url) {
    const m = String(url).match(/\/products\/([^/?#]+)/i);
    return m ? m[1].toLowerCase() : null;
}

async function loadScrapedUrlIndex() {
    const index = new Map();
    try {
        const jsonPath = path.join(__dirname, '../data/scraped-products.json');
        const raw = await fs.readFile(jsonPath, 'utf8');
        const data = JSON.parse(raw);
        const list = Array.isArray(data.products) ? data.products : data;
        for (const p of list) {
            if (!p?.url) continue;
            if (p.sku) index.set(`sku:${String(p.sku).toLowerCase()}`, p.url);
            const slug = hmSlugFromUrl(p.url);
            if (slug) index.set(`slug:${slug}`, p.url);
            if (p.name) index.set(`name:${String(p.name).toLowerCase()}`, p.url);
        }
    } catch (e) {
        console.warn('scraped-products.json not loaded:', e.message);
    }
    return index;
}

function resolveProductUrl(product, urlIndex) {
    if (product.sku && urlIndex.has(`sku:${String(product.sku).toLowerCase()}`)) {
        return urlIndex.get(`sku:${String(product.sku).toLowerCase()}`);
    }
    if (product.slug && urlIndex.has(`slug:${String(product.slug).toLowerCase()}`)) {
        return urlIndex.get(`slug:${String(product.slug).toLowerCase()}`);
    }
    if (product.name && urlIndex.has(`name:${String(product.name).toLowerCase()}`)) {
        return urlIndex.get(`name:${String(product.name).toLowerCase()}`);
    }
    if (product.slug) {
        return `https://hmherbs.com/index.php/products/${product.slug}`;
    }
    return null;
}

async function fetchPageText(url) {
    const res = await axios.get(url, { headers: HEADERS, timeout: 25000 });
    return stripHtml(String(res.data || ''));
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const doFetch = args.includes('--fetch');
    const limitArg = args.find((a) => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;

    const pool = createPool({ connectionLimit: 4 });
    const urlIndex = await loadScrapedUrlIndex();

    let sql = `
        SELECT id, sku, slug, name, short_description, long_description, weight
        FROM products
        WHERE (weight IS NULL OR weight <= 0)
          AND is_active = 1
        ORDER BY id`;
    if (limit > 0) sql += ` LIMIT ${limit}`;

    const [products] = await pool.query(sql);
    console.log(`Products missing weight: ${products.length}${dryRun ? ' (dry-run)' : ''}`);

    let updated = 0;
    let fromLocal = 0;
    let fromWeb = 0;
    let skipped = 0;
    const samples = [];

    for (const product of products) {
        const localText = [product.name, product.short_description, product.long_description].filter(Boolean).join(' ');
        let oz = parseWeightOzFromText(localText);
        let source = 'catalog';

        if (!oz && doFetch) {
            const url = resolveProductUrl(product, urlIndex);
            if (url) {
                try {
                    await sleep(350);
                    const pageText = await fetchPageText(url);
                    oz = parseWeightOzFromText(pageText);
                    if (oz) source = 'hmherbs';
                } catch (e) {
                    console.warn(`fetch failed #${product.id} ${product.slug}: ${e.message}`);
                }
            }
        }

        if (!oz) {
            skipped++;
            continue;
        }

        if (source === 'catalog') fromLocal++;
        else fromWeb++;

        if (samples.length < 15) {
            samples.push({ id: product.id, name: product.name, oz, source });
        }

        if (!dryRun) {
            await pool.execute(
                'UPDATE products SET weight = ?, weight_unit = ? WHERE id = ? AND (weight IS NULL OR weight <= 0)',
                [oz, 'oz', product.id]
            );
        }
        updated++;
    }

    console.log(`Updated: ${updated} (local text: ${fromLocal}, hmherbs pages: ${fromWeb}), still missing: ${skipped}`);
    if (samples.length) {
        console.log('Samples:');
        for (const s of samples) {
            console.log(`  #${s.id} ${s.oz} oz [${s.source}] — ${s.name}`);
        }
    }

    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
