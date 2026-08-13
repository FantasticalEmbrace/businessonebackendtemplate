#!/usr/bin/env node
/**
 * Sync product prices from hmherbs.com into the database.
 *
 * Phase 1 (default): match scraped-products.json + catalogOverrides by SKU/slug.
 * Phase 2 (--live): scrape live PDP HTML for products still at placeholder $25.00.
 *
 * Usage (from backend/):
 *   node scripts/sync-prices-from-hmherbs.js --dry-run
 *   node scripts/sync-prices-from-hmherbs.js
 *   node scripts/sync-prices-from-hmherbs.js --live
 *   node scripts/sync-prices-from-hmherbs.js --all --live
 */
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const cheerio = require('cheerio');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { catalogPriceForSku, canonicalSkuForCatalog } = require('../utils/catalogOverrides');

loadBackendEnv();

const BASE = process.env.CATALOG_SCRAPE_DOMAIN || 'https://hmherbs.com';
const PLACEHOLDER_PRICE = 25;
const HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

function parseArgs() {
    const args = process.argv.slice(2);
    const jsonIdx = args.indexOf('--json');
    const limitIdx = args.indexOf('--limit');
    return {
        dryRun: args.includes('--dry-run'),
        live: args.includes('--live'),
        all: args.includes('--all'),
        force: args.includes('--force'),
        limit: limitIdx >= 0 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : null,
        verbose: args.includes('--verbose'),
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

function canonicalSku(sku) {
    const fromSlug = skuFromProductSlug(sku);
    if (fromSlug) return canonicalSkuForCatalog(fromSlug);
    return canonicalSkuForCatalog(sku);
}

async function loadScrapedPriceIndex(jsonPath) {
    const bySku = new Map();
    const bySlug = new Map();
    const candidates = [
        path.join(__dirname, '../data/scraped-products.json'),
        jsonPath,
        path.join(__dirname, '../data/complete-scraped-products.json')
    ];
    const seenFiles = new Set();

    function storeEntry(entry, product) {
        const sku = String(product.sku || '').trim();
        const price = entry.price;
        if (sku) {
            const keys = [sku.toUpperCase(), normalizeSku(sku), canonicalSkuForCatalog(sku)].filter(Boolean);
            for (const key of keys) {
                const existing = bySku.get(key);
                if (existing && isPlaceholderPrice(existing.price) && !isPlaceholderPrice(price)) {
                    bySku.set(key, entry);
                } else if (!existing) {
                    bySku.set(key, entry);
                }
            }
        }
        const m = String(product.url || '').match(/\/products\/([^/?#]+)/i);
        if (m) {
            const slugKey = decodeURIComponent(m[1]).toLowerCase();
            const existing = bySlug.get(slugKey);
            if (existing && isPlaceholderPrice(existing.price) && !isPlaceholderPrice(price)) {
                bySlug.set(slugKey, entry);
            } else if (!existing) {
                bySlug.set(slugKey, entry);
            }
        }
    }

    for (const file of candidates) {
        const resolved = path.resolve(file);
        if (seenFiles.has(resolved)) continue;
        seenFiles.add(resolved);
        try {
            const raw = await fs.readFile(file, 'utf8');
            const data = JSON.parse(raw);
            for (const product of data.products || []) {
                const price = parseFloat(product.price);
                if (!Number.isFinite(price) || price <= 0) continue;
                storeEntry({ price, source: 'json', sku: product.sku }, product);
            }
        } catch (e) {
            if (e.code !== 'ENOENT') console.warn(`Could not read ${file}:`, e.message);
        }
    }
    return { bySku, bySlug };
}

function scrapedPriceForProduct(row, index) {
    const override = catalogPriceForSku(row.sku) ?? catalogPriceForSku(skuFromProductSlug(row.slug));
    if (override != null) return { price: override, source: 'override' };

    const sku = String(row.sku || '').trim();
    if (sku && index.bySku.has(sku.toUpperCase())) return index.bySku.get(sku.toUpperCase());
    const norm = normalizeSku(sku);
    if (norm && index.bySku.has(norm)) return index.bySku.get(norm);

    const slugSku = normalizeSku(skuFromProductSlug(row.slug));
    if (slugSku && index.bySku.has(slugSku)) return index.bySku.get(slugSku);
    const canon = canonicalSku(row.sku || row.slug);
    if (canon && index.bySku.has(canon)) return index.bySku.get(canon);

    const slug = String(row.slug || '').trim().toLowerCase();
    if (slug && index.bySlug.has(slug)) return index.bySlug.get(slug);
    const slugBase = slug.replace(/-sku-[a-z0-9-]+$/i, '');
    if (slugBase && index.bySlug.has(slugBase)) return index.bySlug.get(slugBase);
    return null;
}

function extractPriceFromHtml($) {
    const jsonLdScripts = $('script[type="application/ld+json"]');
    for (let i = 0; i < jsonLdScripts.length; i++) {
        try {
            const jsonData = JSON.parse($(jsonLdScripts[i]).html());
            const products = Array.isArray(jsonData) ? jsonData : jsonData['@graph'] || [jsonData];
            for (const item of products) {
                if (!item || !String(item['@type'] || '').includes('Product')) continue;
                const offers = item.offers ? (Array.isArray(item.offers) ? item.offers : [item.offers]) : [];
                for (const offer of offers) {
                    const price = parseFloat(offer.price);
                    if (Number.isFinite(price) && price > 0 && price <= 10000) return price;
                }
                const direct = parseFloat(item.price);
                if (Number.isFinite(direct) && direct > 0 && direct <= 10000) return direct;
            }
        } catch (_) {
            /* continue */
        }
    }

    const productForm = $('form.store-product, .product-details, .product-info').first();
    const searchArea = productForm.length > 0 ? productForm : $('body');
    const selectors = ['.store-product-price', '.product-price', '.price', '.current-price', '.amount'];
    for (const selector of selectors) {
        const text = searchArea.find(selector).first().text().trim();
        const match = text.match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
        if (match) {
            const price = parseFloat(match[1].replace(/,/g, ''));
            if (Number.isFinite(price) && price > 0 && price <= 10000) return price;
        }
    }
    return null;
}

function isProductPage($) {
    return (
        ($('h1').length > 0 && $('h1').text().includes('SKU:')) ||
        $('.product-details').length > 0 ||
        $('body').text().includes('Add to Cart')
    );
}

function productPageUrls(row) {
    const slug = String(row.slug || '').trim();
    const urls = [];
    const seen = new Set();
    const add = (u) => {
        if (!seen.has(u)) {
            seen.add(u);
            urls.push(u);
        }
    };
    if (slug) {
        add(`${BASE}/index.php/products/${slug}`);
        add(`${BASE}/index.php/products/${slug.replace(/-sku-[a-z0-9-]+$/i, '')}`);
    }
    const slugSku = skuFromProductSlug(slug);
    if (slugSku) add(`${BASE}/index.php/products/product-${slugSku}`);
    return urls;
}

async function scrapeLivePrice(row) {
    for (const url of productPageUrls(row)) {
        try {
            const response = await axios.get(url, { headers: HEADERS, timeout: 15000, validateStatus: (s) => s < 500 });
            if (response.status === 404) continue;
            const $ = cheerio.load(response.data);
            if (!isProductPage($)) continue;
            const price = extractPriceFromHtml($);
            if (price != null) return { price, source: 'live', url };
        } catch (_) {
            /* try next URL */
        }
    }
    return null;
}

function isPlaceholderPrice(price) {
    const n = parseFloat(price);
    return Number.isFinite(n) && Math.abs(n - PLACEHOLDER_PRICE) < 0.001;
}

function shouldUpdate(row, nextPrice, force) {
    const cur = parseFloat(row.price);
    if (!Number.isFinite(nextPrice) || nextPrice <= 0) return false;
    if (force) return Math.abs(cur - nextPrice) > 0.001;
    if (!Number.isFinite(cur) || cur === 0) return true;
    if (isPlaceholderPrice(cur)) return Math.abs(cur - nextPrice) > 0.001;
    return false;
}

async function main() {
    const { dryRun, live, all, force, limit, verbose, jsonPath } = parseArgs();
    const index = await loadScrapedPriceIndex(jsonPath);
    console.log(`Loaded ${index.bySku.size} SKU prices from scrape data`);

    const pool = createPool({ connectionLimit: 5 });
    const where = all ? 'is_active = 1' : 'is_active = 1 AND price = ?';
    const params = all ? [] : [PLACEHOLDER_PRICE];
    const limitSql = limit ? ` LIMIT ${limit}` : '';
    const [products] = await pool.query(
        `SELECT id, sku, slug, name, price FROM products WHERE ${where} ORDER BY id${limitSql}`,
        params
    );

    console.log(`Processing ${products.length} products${dryRun ? ' (dry-run)' : ''}${live ? ' + live scrape' : ''}`);

    let updated = 0;
    let jsonHits = 0;
    let liveHits = 0;
    let skipped = 0;
    let missed = 0;

    for (let i = 0; i < products.length; i++) {
        const row = products[i];
        let match = scrapedPriceForProduct(row, index);

        if (!match && live) {
            if (i > 0) await new Promise((r) => setTimeout(r, 1200));
            match = await scrapeLivePrice(row);
            if (match) liveHits++;
        } else if (match) {
            jsonHits++;
        }

        if (verbose && i < 10) {
            console.log(
                `#${row.id} ${row.sku} cur=$${parseFloat(row.price).toFixed(2)} match=${match ? `$${match.price} (${match.source})` : 'none'} update=${match ? shouldUpdate(row, match.price, force) : false}`
            );
        }

        if (!match || !shouldUpdate(row, match.price, force)) {
            skipped++;
            continue;
        }

        if (dryRun) {
            if (updated < 15) {
                console.log(
                    `[dry-run] #${row.id} ${row.sku}: $${parseFloat(row.price).toFixed(2)} → $${match.price.toFixed(2)} (${match.source})`
                );
            }
            updated++;
            continue;
        }

        await pool.execute('UPDATE products SET price = ?, updated_at = NOW() WHERE id = ?', [match.price, row.id]);
        updated++;
    }

    if (!live && !dryRun) {
        const [[remaining]] = await pool.query(
            'SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND price = ?',
            [PLACEHOLDER_PRICE]
        );
        missed = remaining.c;
    }

    await pool.end();

    console.log('\n' + '='.repeat(60));
    console.log(`Updated: ${updated}${dryRun ? ' (dry-run)' : ''}`);
    console.log(`From scrape JSON/overrides: ${jsonHits}`);
    if (live) console.log(`From live hmherbs.com: ${liveHits}`);
    console.log(`Skipped (no change needed): ${skipped}`);
    if (!live) console.log(`Still at $${PLACEHOLDER_PRICE.toFixed(2)}: ${missed} (run with --live to scrape)`);
    console.log('='.repeat(60));
}

main().catch((err) => {
    console.error('Price sync failed:', err.message);
    process.exit(1);
});
