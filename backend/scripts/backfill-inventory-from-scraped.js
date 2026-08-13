#!/usr/bin/env node
/**
 * Backfill inventory_quantity from scraped-products.json (inventoryQuantity field).
 *
 * Usage (from backend/):
 *   node scripts/backfill-inventory-from-scraped.js --dry-run
 *   node scripts/backfill-inventory-from-scraped.js
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

function skuFromProductSlug(slug) {
    const m = String(slug || '').match(/-sku-([a-z0-9-]+)$/i);
    return m ? m[1] : '';
}

async function loadScrapedIndex(jsonPath) {
    const bySku = new Map();
    const bySlug = new Map();
    const candidates = [
        jsonPath,
        path.join(__dirname, '../data/scraped-products.json'),
        path.join(__dirname, '../data/complete-scraped-products.json')
    ];

    for (const file of candidates) {
        try {
            const raw = await fs.readFile(file, 'utf8');
            const data = JSON.parse(raw);
            for (const product of data.products || []) {
                const sku = String(product.sku || '').trim();
                const qty = product.inventoryQuantity ?? product.inventory ?? null;
                if (qty === null || qty === undefined) continue;
                const entry = { qty: Math.max(0, parseInt(qty, 10) || 0), sku };
                if (sku) {
                    bySku.set(sku.toUpperCase(), entry);
                    bySku.set(normalizeSku(sku), entry);
                }
                const m = String(product.url || '').match(/\/products\/([^/?#]+)/i);
                if (m) {
                    const slugKey = decodeURIComponent(m[1]).toLowerCase();
                    if (!bySlug.has(slugKey)) bySlug.set(slugKey, entry);
                }
            }
        } catch (e) {
            if (e.code !== 'ENOENT') console.warn(`Could not read ${file}:`, e.message);
        }
    }
    return { bySku, bySlug };
}

function scrapedEntryForProduct(row, index) {
    const sku = String(row.sku || '').trim();
    if (sku && index.bySku.has(sku.toUpperCase())) return index.bySku.get(sku.toUpperCase());
    const norm = normalizeSku(sku);
    if (norm && index.bySku.has(norm)) return index.bySku.get(norm);

    const slugSku = normalizeSku(skuFromProductSlug(row.slug));
    if (slugSku && index.bySku.has(slugSku)) return index.bySku.get(slugSku);

    const slug = String(row.slug || '').trim().toLowerCase();
    if (slug && index.bySlug.has(slug)) return index.bySlug.get(slug);
    const slugBase = slug.replace(/-sku-[a-z0-9-]+$/i, '');
    if (slugBase && index.bySlug.has(slugBase)) return index.bySlug.get(slugBase);
    return null;
}

async function main() {
    const { dryRun, force, jsonPath } = parseArgs();
    const index = await loadScrapedIndex(jsonPath);
    console.log(`Loaded inventory for ${index.bySku.size} SKUs`);

    const pool = createPool({ connectionLimit: 5 });
    const [products] = await pool.query(`
        SELECT id, sku, slug, name, inventory_quantity, track_inventory
        FROM products
        WHERE is_active = 1
        ORDER BY id
    `);

    let updated = 0;
    let skipped = 0;
    let toZero = 0;

    for (const row of products) {
        const scraped = scrapedEntryForProduct(row, index);
        if (!scraped) {
            skipped++;
            continue;
        }

        const prev = parseInt(row.inventory_quantity, 10) || 0;
        const next = scraped.qty;
        if (!force && prev === next) {
            skipped++;
            continue;
        }

        if (next === 0) toZero++;

        if (dryRun) {
            if (updated < 10) {
                console.log(`[dry-run] #${row.id} ${row.name?.slice(0, 40)}: ${prev} → ${next}`);
            }
            updated++;
            continue;
        }

        await pool.execute(
            `UPDATE products SET inventory_quantity = ?, track_inventory = 1, updated_at = NOW() WHERE id = ?`,
            [next, row.id]
        );
        updated++;
    }

    const [[low]] = await pool.query(`
        SELECT COUNT(*) c FROM products
        WHERE is_active = 1 AND track_inventory = 1
          AND inventory_quantity <= COALESCE(NULLIF(low_stock_threshold, 0), 5)
    `);
    const [[zeros]] = await pool.query(
        'SELECT COUNT(*) c FROM products WHERE is_active = 1 AND inventory_quantity = 0'
    );

    await pool.end();
    console.log(`\nUpdated: ${updated}${dryRun ? ' (dry-run)' : ''}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Set to zero: ${toZero}`);
    console.log(`After: ${zeros.c} at qty 0, ${low.c} at/below low-stock threshold`);
}

main().catch((err) => {
    console.error('Backfill failed:', err.message);
    process.exit(1);
});
