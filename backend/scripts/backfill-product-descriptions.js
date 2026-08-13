#!/usr/bin/env node
/**
 * Backfill short_description / long_description from scraped JSON when DB fields are empty.
 *
 * Usage (from backend/):
 *   node scripts/backfill-product-descriptions.js --dry-run
 *   node scripts/backfill-product-descriptions.js
 *   node scripts/backfill-product-descriptions.js --json ./data/scraped-products.json
 */
const path = require('path');
const fs = require('fs').promises;
const { loadBackendEnv, createPool } = require('../utils/dbConfig');

loadBackendEnv();

function parseArgs() {
    const args = process.argv.slice(2);
    const jsonIdx = args.indexOf('--json');
    return {
        dryRun: args.includes('--dry-run'),
        force: args.includes('--force'),
        jsonPath:
            jsonIdx >= 0 && args[jsonIdx + 1]
                ? args[jsonIdx + 1]
                : path.join(__dirname, '../data/scraped-products.json')
    };
}

function normalizeSku(sku) {
    return String(sku || '')
        .trim()
        .toUpperCase()
        .replace(/^HM-/, '');
}

function slugFromUrl(url) {
    const m = String(url || '').match(/\/products\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]).toLowerCase() : '';
}

function mapDescriptions(jsonProduct) {
    const short = String(jsonProduct.shortDescription || jsonProduct.description || '').trim();
    const longRaw = String(jsonProduct.description || jsonProduct.longDescription || '').trim();
    let long = '';
    if (longRaw) {
        if (!short || longRaw !== short) long = longRaw;
    }
    return { short, long };
}

async function loadScrapedIndex(jsonPath) {
    const candidates = [
        jsonPath,
        path.join(__dirname, '../data/scraped-products.json'),
        path.join(__dirname, '../data/complete-scraped-products.json')
    ];
    const bySku = new Map();
    const bySlug = new Map();

    for (const file of candidates) {
        try {
            const raw = await fs.readFile(file, 'utf8');
            const data = JSON.parse(raw);
            for (const product of data.products || []) {
                const sku = normalizeSku(product.sku);
                const desc = mapDescriptions(product);
                if (!desc.short && !desc.long) continue;
                const entry = { ...desc, sku: product.sku, url: product.url };
                const rawSku = String(product.sku || '').trim();
                if (sku) bySku.set(sku, entry);
                if (rawSku) bySku.set(normalizeSku(rawSku), entry);
                const slug = slugFromUrl(product.url);
                if (slug && !bySlug.has(slug)) bySlug.set(slug, entry);
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn(`Could not read ${file}:`, err.message);
            }
        }
    }
    return { bySku, bySlug };
}

function skuFromProductSlug(slug) {
    const m = String(slug || '').match(/-sku-([a-z0-9-]+)$/i);
    return m ? m[1] : '';
}

function scrapedEntryForProduct(row, index) {
    const sku = normalizeSku(row.sku);
    if (sku && index.bySku.has(sku)) return index.bySku.get(sku);

    const slugSku = normalizeSku(skuFromProductSlug(row.sku));
    if (slugSku && index.bySku.has(slugSku)) return index.bySku.get(slugSku);

    const slugSkuFromSlug = normalizeSku(skuFromProductSlug(row.slug));
    if (slugSkuFromSlug && index.bySku.has(slugSkuFromSlug)) return index.bySku.get(slugSkuFromSlug);

    const slug = String(row.slug || '').trim().toLowerCase();
    if (slug && index.bySlug.has(slug)) return index.bySlug.get(slug);
    const slugBase = slug.replace(/-sku-[a-z0-9-]+$/i, '');
    if (slugBase && index.bySlug.has(slugBase)) return index.bySlug.get(slugBase);
    return null;
}

async function main() {
    const { dryRun, force, jsonPath } = parseArgs();
    const index = await loadScrapedIndex(jsonPath);
    console.log(`Loaded description metadata for ${index.bySku.size} SKUs`);

    const pool = createPool({ connectionLimit: 5 });
    const [products] = await pool.query(`
        SELECT id, sku, slug, name, short_description, long_description
        FROM products
        WHERE is_active = 1
        ORDER BY id
    `);

    let updated = 0;
    let skipped = 0;

    for (const row of products) {
        const scraped = scrapedEntryForProduct(row, index);
        if (!scraped) {
            skipped++;
            continue;
        }

        const prevShort = String(row.short_description || '').trim();
        const prevLong = String(row.long_description || '').trim();
        const nextShort = force || !prevShort ? scraped.short || prevShort : prevShort;
        // Never copy short into long — long copy must come from a distinct/HTML source (fix-long-descriptions.js).
        const nextLong = force || !prevLong ? scraped.long || prevLong : prevLong;

        if (nextShort === prevShort && nextLong === prevLong) {
            skipped++;
            continue;
        }

        if (dryRun) {
            console.log(`[dry-run] #${row.id} ${row.name}`);
            console.log(`  short: ${prevShort.length} -> ${nextShort.length} chars`);
            console.log(`  long:  ${prevLong.length} -> ${nextLong.length} chars`);
            updated++;
            continue;
        }

        await pool.execute(
            `UPDATE products SET short_description = ?, long_description = ?, updated_at = NOW() WHERE id = ?`,
            [nextShort || null, nextLong || null, row.id]
        );
        updated++;
    }

    const [[shortCount]] = await pool.query(
        "SELECT COUNT(*) c FROM products WHERE is_active=1 AND COALESCE(TRIM(short_description),'')<>''"
    );
    const [[longCount]] = await pool.query(
        "SELECT COUNT(*) c FROM products WHERE is_active=1 AND COALESCE(TRIM(long_description),'')<>''"
    );

    await pool.end();
    console.log(`\nUpdated: ${updated}${dryRun ? ' (dry-run)' : ''}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Coverage: short=${shortCount.c}, long=${longCount.c} / ${products.length} active`);
}

main().catch((err) => {
    console.error('Backfill failed:', err.message);
    process.exit(1);
});
