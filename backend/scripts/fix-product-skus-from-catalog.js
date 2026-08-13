#!/usr/bin/env node
/**
 * Replace internal HM-* product SKUs with manufacturer catalog codes from slug/name.
 * Catalog codes are the same item numbers brands use on their own websites.
 *
 * Usage:
 *   node scripts/fix-product-skus-from-catalog.js --dry-run
 *   node scripts/fix-product-skus-from-catalog.js --apply
 */
const fs = require('fs');
const path = require('path');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const {
    extractCatalogSkuFromProduct,
    isInternalHmSku,
    isReservedInternalSku,
    normalizeCatalogSku,
    slugFromHmherbsUrl,
} = require('../utils/extractCatalogSku');

loadBackendEnv();

const APPLY = process.argv.includes('--apply');
const SKIP_NAMES = new Set(['Featured Products', 'Shop']);

function loadCompleteScrapedIndex() {
    const file = path.join(__dirname, '../data/complete-scraped-products.json');
    if (!fs.existsSync(file)) return new Map();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const products = data.products || data || [];
    const bySlug = new Map();
    for (const row of products) {
        const slug = slugFromHmherbsUrl(row.url);
        const sku = normalizeCatalogSku(row.sku);
        if (slug && sku) bySlug.set(slug, sku);
    }
    return bySlug;
}

async function main() {
    const pool = createPool();
    const scrapedBySlug = loadCompleteScrapedIndex();

    const [products] = await pool.query(`
        SELECT p.id, p.sku, p.slug, p.name, b.name AS brand_name
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        ORDER BY p.id
    `);

    const planned = [];
    const skipped = [];
    const usedSkus = new Map(
        products
            .filter((p) => !isInternalHmSku(p.sku) && !isReservedInternalSku(p.sku))
            .map((p) => [normalizeCatalogSku(p.sku), p.id])
    );

    for (const row of products) {
        if (SKIP_NAMES.has(row.name)) {
            skipped.push({ id: row.id, reason: 'placeholder' });
            continue;
        }
        if (isReservedInternalSku(row.sku)) {
            skipped.push({ id: row.id, reason: 'gift-card' });
            continue;
        }
        if (!isInternalHmSku(row.sku)) {
            skipped.push({ id: row.id, reason: 'already-catalog-sku', sku: row.sku });
            continue;
        }

        let catalogSku = normalizeCatalogSku(extractCatalogSkuFromProduct(row));
        if (!catalogSku) {
            const slugKey = String(row.slug || '').toLowerCase();
            catalogSku = scrapedBySlug.get(slugKey) || '';
        }
        if (!catalogSku) {
            skipped.push({ id: row.id, name: row.name, reason: 'no-catalog-sku-found' });
            continue;
        }

        if (normalizeCatalogSku(row.sku) === catalogSku) {
            skipped.push({ id: row.id, reason: 'already-correct' });
            continue;
        }

        const conflictId = usedSkus.get(catalogSku);
        if (conflictId && conflictId !== row.id) {
            skipped.push({
                id: row.id,
                name: row.name,
                reason: 'sku-conflict',
                catalogSku,
                conflictsWith: conflictId,
            });
            continue;
        }

        planned.push({
            id: row.id,
            brand: row.brand_name,
            name: row.name,
            oldSku: row.sku,
            newSku: catalogSku,
            slug: row.slug,
        });
        usedSkus.set(catalogSku, row.id);
    }

    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`Products scanned: ${products.length}`);
    console.log(`Updates planned: ${planned.length}`);
    console.log(`Skipped: ${skipped.length}`);

    const reportPath = path.join(__dirname, '../data/sku-fix-report.json');
    fs.writeFileSync(
        reportPath,
        JSON.stringify({ planned, skipped, generatedAt: new Date().toISOString() }, null, 2)
    );
    console.log(`Report: ${reportPath}`);

    if (!APPLY) {
        console.log('\nSample updates:');
        planned.slice(0, 15).forEach((p) => {
            console.log(`  #${p.id} ${p.oldSku} -> ${p.newSku} (${p.brand || '?'})`);
        });
        await pool.end();
        return;
    }

    let updated = 0;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        for (const p of planned) {
            await conn.query('UPDATE products SET sku = ? WHERE id = ?', [p.newSku, p.id]);
            updated += 1;
        }
        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }

    console.log(`Updated ${updated} product SKUs.`);
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
