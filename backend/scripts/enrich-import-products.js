'use strict';

/**
 * Non-destructive HM Herbs inventory enrichment / import.
 *
 * Purpose: load the full POS catalog CSV (Acadia export) WITHOUT undoing any
 * manual edits made in the admin (Mr. Harold's curated web catalog).
 *
 * Rules (agreed with the owner):
 *   - Match CSV rows to existing products by SKU/barcode (normalized).
 *   - De-duplicate the CSV by SKU (the export has duplicate barcode rows and the
 *     "variant_option_*" columns only hold the item code, not real variants).
 *   - PRICE + COST are refreshed on ALL matched products. For web-visible items
 *     the site price uses `web_price` when present, otherwise the store `price`.
 *   - Short/long DESCRIPTIONS are only filled where the product currently has
 *     none. Existing descriptions are never overwritten.
 *   - PHOTOS are downloaded from `image_url` and attached ONLY to products that
 *     currently have no image. Existing images are never deleted.
 *   - show_on_web is set from the CSV `web_status` (active => on web) for NEW
 *     products only. Existing products keep whatever visibility the admin set.
 *   - Inventory is set from `qty` for NEW products only; existing inventory is
 *     left untouched (POS owns it).
 *
 * Safety: dry-run by default. Pass --commit to actually write.
 *
 * Usage:
 *   node scripts/enrich-import-products.js --file=/path/to/export.csv            # dry run
 *   node scripts/enrich-import-products.js --file=/path/to/export.csv --commit   # write
 *   node scripts/enrich-import-products.js --file=... --commit --no-images       # skip photo downloads
 *   node scripts/enrich-import-products.js --file=... --limit=50                 # first 50 unique SKUs (testing)
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { createPool, loadBackendEnv } = require('../utils/dbConfig');
const { normalizeScannedSku } = require('../utils/generateProductSku');

loadBackendEnv();

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(name, def = null) {
    const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return def;
    const eq = hit.indexOf('=');
    return eq === -1 ? true : hit.slice(eq + 1);
}
const CSV_FILE = argVal('file');
const COMMIT = Boolean(argVal('commit', false));
const DO_IMAGES = !argVal('no-images', false);
const LIMIT = argVal('limit') ? parseInt(argVal('limit'), 10) : null;
const IMAGE_DIR = path.join(__dirname, '..', 'uploads', 'products');
const IMAGE_URL_PREFIX = '/uploads/products';

if (!CSV_FILE) {
    console.error('ERROR: --file=<path to csv> is required');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// CSV parsing (handles quoted fields with embedded commas / newlines)
// ---------------------------------------------------------------------------
function parseCSV(text) {
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\r') { /* ignore */ }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += ch;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
}

function parseMoney(value) {
    if (value == null || String(value).trim() === '') return null;
    const n = parseFloat(String(value).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
}

function parseIntQty(value) {
    if (value == null || String(value).trim() === '') return 0;
    const n = parseInt(String(value).replace(/[,\s]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
}

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 200) || 'product';
}

function shortFromLong(longText) {
    const t = String(longText || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (t.length <= 200) return t;
    const sentenceEnd = t.slice(0, 220).search(/[.!?]\s/);
    if (sentenceEnd > 60) return t.slice(0, sentenceEnd + 1).trim();
    const cut = t.slice(0, 197);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim() + '...';
}

// "Best" row wins when a SKU appears multiple times.
function rowScore(r) {
    let s = 0;
    if ((r.web_status || '').toLowerCase() === 'active') s += 8;
    if (r.web_price) s += 4;
    if (r.description) s += 2;
    if (r.image_url) s += 2;
    if (r.cost) s += 1;
    return s;
}

// ---------------------------------------------------------------------------
// Image download (Node 20 global fetch)
// ---------------------------------------------------------------------------
async function downloadImage(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const resp = await fetch(url, { signal: controller.signal, redirect: 'follow' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const type = (resp.headers.get('content-type') || '').toLowerCase();
        if (!/image\//.test(type) && !/\.(png|jpe?g|gif|webp)(\?|$)/i.test(url)) {
            throw new Error(`not an image (content-type ${type || 'unknown'})`);
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        if (!buf.length) throw new Error('empty body');
        let ext = (url.match(/\.(png|jpe?g|gif|webp)(?:\?|$)/i) || [])[1];
        if (!ext) {
            if (type.includes('png')) ext = 'png';
            else if (type.includes('webp')) ext = 'webp';
            else if (type.includes('gif')) ext = 'gif';
            else ext = 'jpg';
        }
        ext = ext.toLowerCase().replace('jpeg', 'jpg');
        const filename = `product-image-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
        await fsp.mkdir(IMAGE_DIR, { recursive: true });
        await fsp.writeFile(path.join(IMAGE_DIR, filename), buf);
        return `${IMAGE_URL_PREFIX}/${filename}`;
    } finally {
        clearTimeout(timeout);
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const stats = {
    csvRows: 0,
    uniqueSkus: 0,
    matchedExisting: 0,
    createdNew: 0,
    priceUpdated: 0,
    descFilled: 0,
    imagesAdded: 0,
    imageFailures: 0,
    brandsCreated: 0,
    categoriesCreated: 0,
    skippedNoName: 0,
    errors: 0,
    errorSamples: [],
};

async function main() {
    console.log(`\n=== HM Herbs enrichment import ===`);
    console.log(`File:    ${CSV_FILE}`);
    console.log(`Mode:    ${COMMIT ? 'COMMIT (writing)' : 'DRY RUN (no writes)'}`);
    console.log(`Images:  ${DO_IMAGES ? 'download enabled' : 'disabled'}`);
    if (LIMIT) console.log(`Limit:   first ${LIMIT} unique SKUs`);
    console.log('');

    const text = fs.readFileSync(CSV_FILE, 'utf8');
    const rows = parseCSV(text);
    const header = rows[0].map((h) => h.trim());
    const idx = {};
    header.forEach((h, i) => { idx[h] = i; });
    const need = (r, key) => (idx[key] != null ? (r[idx[key]] || '').trim() : '');

    // Build normalized records, de-duplicated by SKU.
    const bySku = new Map();
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length <= 1) continue;
        const name = need(r, 'name');
        const sku = normalizeScannedSku(need(r, 'sku'));
        if (!name) { stats.skippedNoName++; continue; }
        if (!sku) { stats.skippedNoName++; continue; }
        stats.csvRows++;
        const rec = {
            sku,
            name,
            description: need(r, 'description'),
            price: need(r, 'price'),
            cost: need(r, 'cost'),
            web_price: need(r, 'web_price'),
            web_status: need(r, 'web_status'),
            vendor: need(r, 'vendor'),
            category: need(r, 'category'),
            image_url: need(r, 'image_url'),
            qty: need(r, 'qty'),
            size: need(r, 'size'),
        };
        const existing = bySku.get(sku);
        if (!existing || rowScore(rec) > rowScore(existing)) bySku.set(sku, rec);
    }
    stats.uniqueSkus = bySku.size;

    let records = [...bySku.values()];
    if (LIMIT) records = records.slice(0, LIMIT);

    const pool = createPool({ connectionLimit: 5 });
    const brandCache = new Map();
    const categoryCache = new Map();

    async function getOrCreateBrand(conn, name) {
        const key = (name || 'Unknown').trim() || 'Unknown';
        if (brandCache.has(key)) return brandCache.get(key);
        const slug = slugify(key);
        // Match by name OR slug so near-identical vendor spellings reuse one brand
        // and never collide on the unique slug key.
        const [ex] = await conn.execute('SELECT id FROM brands WHERE name = ? OR slug = ? LIMIT 1', [key, slug]);
        if (ex.length) { brandCache.set(key, ex[0].id); return ex[0].id; }
        if (!COMMIT) { brandCache.set(key, -1); stats.brandsCreated++; return -1; }
        const [res] = await conn.execute('INSERT INTO brands (name, slug) VALUES (?, ?)', [key, slug]);
        stats.brandsCreated++;
        brandCache.set(key, res.insertId);
        return res.insertId;
    }
    async function getOrCreateCategory(conn, name) {
        const key = (name || 'General').trim() || 'General';
        if (categoryCache.has(key)) return categoryCache.get(key);
        const slug = slugify(key);
        const [ex] = await conn.execute('SELECT id FROM product_categories WHERE name = ? OR slug = ? LIMIT 1', [key, slug]);
        if (ex.length) { categoryCache.set(key, ex[0].id); return ex[0].id; }
        if (!COMMIT) { categoryCache.set(key, -1); stats.categoriesCreated++; return -1; }
        const [res] = await conn.execute('INSERT INTO product_categories (name, slug) VALUES (?, ?)', [key, slug]);
        stats.categoriesCreated++;
        categoryCache.set(key, res.insertId);
        return res.insertId;
    }
    async function uniqueSlug(conn, base, sku) {
        let slug = slugify(base);
        const [hit] = await conn.execute('SELECT id FROM products WHERE slug = ? LIMIT 1', [slug]);
        if (!hit.length) return slug;
        slug = slugify(`${base}-${sku}`).slice(0, 200);
        const [hit2] = await conn.execute('SELECT id FROM products WHERE slug = ? LIMIT 1', [slug]);
        if (!hit2.length) return slug;
        return slugify(`${base}-${sku}-${Date.now()}`).slice(0, 200);
    }

    let processed = 0;
    for (const rec of records) {
        processed++;
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const cost = parseMoney(rec.cost);
            const storePrice = parseMoney(rec.price);
            const webPrice = parseMoney(rec.web_price);
            const webActive = (rec.web_status || '').toLowerCase() === 'active';
            const sitePrice = (webActive && webPrice != null) ? webPrice : storePrice;

            const [existingRows] = await conn.execute(
                'SELECT id, short_description, long_description FROM products WHERE sku = ? LIMIT 1',
                [rec.sku]
            );

            if (existingRows.length) {
                // ---- EXISTING product: protect Harold, update price/cost, fill gaps ----
                const p = existingRows[0];
                stats.matchedExisting++;

                if (COMMIT && (sitePrice != null || cost != null)) {
                    await conn.execute(
                        'UPDATE products SET price = COALESCE(?, price), cost_price = COALESCE(?, cost_price), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                        [sitePrice, cost, p.id]
                    );
                }
                if (sitePrice != null || cost != null) stats.priceUpdated++;

                const hasDesc = (p.short_description && p.short_description.trim()) ||
                    (p.long_description && p.long_description.trim());
                if (!hasDesc && rec.description) {
                    stats.descFilled++;
                    if (COMMIT) {
                        await conn.execute(
                            'UPDATE products SET long_description = ?, short_description = ? WHERE id = ?',
                            [rec.description, shortFromLong(rec.description), p.id]
                        );
                    }
                }

                if (DO_IMAGES && rec.image_url) {
                    const [imgs] = await conn.execute(
                        'SELECT COUNT(*) n FROM product_images WHERE product_id = ?',
                        [p.id]
                    );
                    if (imgs[0].n === 0) {
                        await attachImage(conn, p.id, rec);
                    }
                }

                await conn.commit();
            } else {
                // ---- NEW product ----
                stats.createdNew++;
                if (!COMMIT) {
                    // Still resolve brand/category to count would-be creations.
                    await getOrCreateBrand(conn, rec.vendor);
                    await getOrCreateCategory(conn, rec.category);
                    if (rec.description) stats.descFilled++;
                    if (DO_IMAGES && rec.image_url) { /* counted on commit run */ }
                    await conn.rollback();
                    logProgress(processed, records.length);
                    conn.release();
                    continue;
                }

                const brandId = await getOrCreateBrand(conn, rec.vendor);
                const categoryId = await getOrCreateCategory(conn, rec.category);
                const slug = await uniqueSlug(conn, rec.name, rec.sku);
                const longDesc = rec.description || null;
                const shortDesc = rec.description ? shortFromLong(rec.description) : null;
                if (rec.description) stats.descFilled++;

                const [ins] = await conn.execute(
                    `INSERT INTO products (
                        sku, name, slug, short_description, long_description,
                        brand_id, category_id, price, cost_price,
                        inventory_quantity, low_stock_threshold, is_active, is_featured, show_on_web
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        rec.sku,
                        rec.name,
                        slug,
                        shortDesc,
                        longDesc,
                        brandId,
                        categoryId,
                        sitePrice,
                        cost,
                        parseIntQty(rec.qty),
                        10,
                        1,
                        0,
                        webActive ? 1 : 0,
                    ]
                );
                const productId = ins.insertId;

                if (DO_IMAGES && rec.image_url) {
                    await attachImage(conn, productId, rec);
                }

                await conn.commit();
            }
        } catch (err) {
            try { await conn.rollback(); } catch (_) { /* noop */ }
            stats.errors++;
            if (stats.errorSamples.length < 25) {
                stats.errorSamples.push({ sku: rec.sku, name: rec.name, error: err.message });
            }
        } finally {
            conn.release();
        }
        logProgress(processed, records.length);
    }

    await pool.end();
    printSummary();

    async function attachImage(conn, productId, rec) {
        if (!COMMIT) return; // never download in dry-run
        try {
            const localUrl = await downloadImage(rec.image_url);
            await conn.execute(
                'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
                [productId, localUrl, rec.name.slice(0, 200)]
            );
            stats.imagesAdded++;
        } catch (e) {
            stats.imageFailures++;
            if (stats.errorSamples.length < 25) {
                stats.errorSamples.push({ sku: rec.sku, name: rec.name, error: 'image: ' + e.message });
            }
        }
    }
}

function logProgress(done, total) {
    if (done % 250 === 0 || done === total) {
        console.log(`  processed ${done}/${total} (existing=${stats.matchedExisting}, new=${stats.createdNew}, imgs=${stats.imagesAdded})`);
    }
}

function printSummary() {
    console.log('\n=== SUMMARY ===');
    console.log(`CSV product rows (named+sku): ${stats.csvRows}`);
    console.log(`Unique SKUs:                  ${stats.uniqueSkus}`);
    console.log(`Matched existing products:    ${stats.matchedExisting}`);
    console.log(`New products created:         ${stats.createdNew}`);
    console.log(`Price/cost updated:           ${stats.priceUpdated}`);
    console.log(`Descriptions filled:          ${stats.descFilled}`);
    console.log(`Images added:                 ${stats.imagesAdded}`);
    console.log(`Image failures:               ${stats.imageFailures}`);
    console.log(`Brands created:               ${stats.brandsCreated}`);
    console.log(`Categories created:           ${stats.categoriesCreated}`);
    console.log(`Rows skipped (no name/sku):   ${stats.skippedNoName}`);
    console.log(`Errors:                       ${stats.errors}`);
    if (stats.errorSamples.length) {
        console.log('--- sample issues ---');
        stats.errorSamples.forEach((e) => console.log(`  [${e.sku}] ${e.name}: ${e.error}`));
    }
    console.log(COMMIT ? '\nDONE (committed).' : '\nDONE (dry run — no changes written). Re-run with --commit to apply.');
}

main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
