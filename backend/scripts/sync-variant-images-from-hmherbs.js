#!/usr/bin/env node
/**
 * Download and assign per-variant images from scraped hmherbs gallery + live variationData.
 */
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { ensureProductVariantSchema } = require('../utils/ensureProductVariantSchema');
const { indexVariationDataBySku, normalizeSku } = require('../utils/extractHmherbsVariationData');
const {
    saveRemoteProductImage,
    pickImageFromProductGallery,
    repoImagesDir,
} = require('../utils/productImageDownload');
const {
    pickBestScrapedImageForVariant,
    findScrapedProduct,
} = require('../utils/matchVariantImage');

loadBackendEnv();

const HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const dryRun = !process.argv.includes('--apply');
const force = process.argv.includes('--force');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;

const EXCLUDE_PRODUCT_PATTERNS = [/newton\s*labs.*bladder.*kidney/i, /bladder.*kidney.*newton/i];

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isExcludedProduct(name) {
    return EXCLUDE_PRODUCT_PATTERNS.some((re) => re.test(String(name || '')));
}

async function loadScrapedProducts() {
    const products = [];
    const files = [
        path.join(__dirname, '../data/scraped-products.json'),
        path.join(__dirname, '../data/complete-scraped-products.json'),
    ];
    for (const file of files) {
        try {
            const raw = await fs.readFile(file, 'utf8');
            const data = JSON.parse(raw);
            for (const row of data.products || []) {
                if (row.url || (row.images && row.images.length)) products.push(row);
            }
        } catch {
            /* optional */
        }
    }
    return products;
}

function matchVariationRow(variant, variationIndex) {
    const sku = normalizeSku(variant.sku);
    if (sku && variationIndex.bySku.has(sku)) return variationIndex.bySku.get(sku);

    const hint = String(variant.name || '').match(/#([A-Za-z0-9-]+)/);
    if (hint) {
        const h = normalizeSku(hint[1]);
        if (variationIndex.bySku.has(h)) return variationIndex.bySku.get(h);
    }

    for (const [vSku, row] of variationIndex.bySku.entries()) {
        if (!vSku || !sku) continue;
        if (sku.includes(vSku) || vSku.includes(sku)) return row;
    }
    return null;
}

async function fetchHtml(url) {
    const res = await axios.get(url, { headers: HEADERS, timeout: 25000, validateStatus: (s) => s < 500 });
    if (res.status >= 400) return null;
    return res.data;
}

async function main() {
    const pool = createPool({ connectionLimit: 4 });
    await ensureProductVariantSchema(pool);
    const scrapedList = await loadScrapedProducts();
    const imagesDir = repoImagesDir();

    const [products] = await pool.query(`
        SELECT p.id, p.sku, p.slug, p.name,
               COUNT(pv.id) AS variant_count
        FROM products p
        INNER JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1
        WHERE p.is_active = 1
        GROUP BY p.id, p.sku, p.slug, p.name
        HAVING variant_count > 0
        ORDER BY p.id
    `);

    let rows = products.filter((p) => !isExcludedProduct(p.name));
    if (limit > 0) rows = rows.slice(0, limit);

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += 1) {
        const product = rows[i];
        const label = `[${i + 1}/${rows.length}] #${product.id} ${product.name.slice(0, 50)}`;
        process.stdout.write(`${label} … `);

        const [variants] = await pool.query(
            `SELECT id, sku, name, image_url, sort_order
             FROM product_variants
             WHERE product_id = ? AND is_active = 1
             ORDER BY sort_order, id`,
            [product.id]
        );
        const [images] = await pool.query(
            `SELECT image_url, alt_text, is_primary, sort_order
             FROM product_images WHERE product_id = ? ORDER BY sort_order`,
            [product.id]
        );

        const needWork = force
            ? variants
            : variants.filter((v) => !String(v.image_url || '').trim());
        if (!needWork.length) {
            console.log('all have images');
            skipped += 1;
            continue;
        }

        const scraped = findScrapedProduct(product, scrapedList);
        const scrapedImages = scraped?.images || [];

        let variationIndex = { bySku: new Map(), byOptionKey: new Map(), all: [] };
        const pageUrl = scraped?.url || null;
        if (pageUrl) {
            try {
                const pageHtml = await fetchHtml(pageUrl);
                if (pageHtml) variationIndex = indexVariationDataBySku(pageHtml);
            } catch {
                /* scraped gallery fallback */
            }
        }

        let productUpdated = 0;
        for (const variant of needWork) {
            let sourceUrl = null;

            const matched = matchVariationRow(variant, variationIndex);
            if (matched?.imageUrl) sourceUrl = matched.imageUrl;

            if (!sourceUrl && scrapedImages.length) {
                sourceUrl = pickBestScrapedImageForVariant(variant.name, scrapedImages);
            }

            if (!sourceUrl) {
                sourceUrl = pickImageFromProductGallery(images, variant.sku, variant.name);
            }

            if (!sourceUrl && scrapedImages.length === variants.length) {
                const idx = variants.findIndex((v) => v.id === variant.id);
                const im = scrapedImages[idx];
                sourceUrl = im?.url || im?.image_url || null;
            }

            if (!sourceUrl) continue;

            const basename = `${product.slug || product.sku || product.id}-${variant.id}-${variant.sku || 'v'}`;
            try {
                const saved = await saveRemoteProductImage({
                    sourceUrl,
                    basename,
                    imagesDir,
                    referer: pageUrl || 'https://hmherbs.com/',
                    dryRun,
                });
                if (!saved?.publicUrl) {
                    failed += 1;
                    continue;
                }
                if (!dryRun) {
                    await pool.query('UPDATE product_variants SET image_url = ? WHERE id = ?', [
                        saved.publicUrl,
                        variant.id,
                    ]);
                }
                productUpdated += 1;
                updated += 1;
            } catch {
                failed += 1;
            }
        }

        console.log(productUpdated ? `updated ${productUpdated} variant image(s)` : 'no matches');
        await sleep(250);
    }

    console.log(`\n${dryRun ? 'Would update' : 'Updated'}: ${updated}, skipped products: ${skipped}, failures: ${failed}`);
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
