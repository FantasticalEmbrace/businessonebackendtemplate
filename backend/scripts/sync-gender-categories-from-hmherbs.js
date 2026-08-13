#!/usr/bin/env node
'use strict';

/**
 * Sync Male / Female health categories from hmherbs.com category pages (men / women).
 * - Renames Men Products -> Male, Women Products -> Female
 * - Deactivates duplicate Mens Health / Womens Health after merging links
 * - Links every product listed on hmherbs.com men/women categories
 * - Updates prices from live product pages
 *
 * Usage (from backend/):
 *   node scripts/sync-gender-categories-from-hmherbs.js --dry-run
 *   node scripts/sync-gender-categories-from-hmherbs.js
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { catalogPriceForSku, canonicalSkuForCatalog } = require('../utils/catalogOverrides');

loadBackendEnv();

const BASE = process.env.CATALOG_SCRAPE_DOMAIN || 'https://hmherbs.com';
const HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

const GENDER_SOURCES = [
    { path: 'men', label: 'Male', slug: 'male', legacySlugs: ['men-products', 'mens-health'] },
    { path: 'women', label: 'Female', slug: 'female', legacySlugs: ['women-products', 'womens-health'] }
];

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 900;

/** Known hmherbs.com category listing slug -> catalog product id */
const LISTING_PRODUCT_IDS = {
    '5-day-forecast-men': 44,
    '5-day-forecast-men-1': 44,
    'big-bang': 52,
    'regalabs-legend-bottle': 146,
    'regalabs-legend-bottle-1': 146,
    'md-science-max-load': 163,
    'md-science-max-load-1': 163,
    'md-science-swiss-navy-max-hard': 165,
    'md-science-swiss-navy-max-size': 165,
    'me-72-extreme-male-enhancement-free-shipping': 413,
    'regalabs-me-72': 413,
    'regalabs-me-72-1': 413,
    'natures-plus-ght-male': 220,
    'passion-enhancement-pills-free-shipping': 361,
    'poseidon-platinum-3500': 367,
    'doctors-blend-blood-sugar': 74,
    'hm-eves-generational-formula-1': 109,
    'hm-happy-pms-cream-jar-1': 121,
    'hm-happy-pms-cream': 121,
    'hm-happy-pms-cream-jar-2': 122,
    'michaels-health-female-reproductive': 167,
    'michaels-health-women-change': 171,
    'michaels-women-change-1': 171,
    'natures-p-ageloss-womens-multi': 190,
    'natures-sunshine-5-w': 198,
    'naturesplus-gi-natural-probiotic-women': 221,
    'perrins-creme-complete-scent-of-rose': 41,
    'standard-enzyme-female-balance': 538,
    'womens-touch-natural-progesterone-cream': 75,
    'womens-touch-progesterone-cream-women': 821
};

/** hmherbs.com lists some variant URLs separately; map to canonical listing slug */
const LISTING_SLUG_ALIASES = {
    '5-day-forecast-men-1': '5-day-forecast-men',
    'regalabs-legend-bottle-1': 'regalabs-legend-bottle',
    'regalabs-me-72-1': 'regalabs-me-72',
    'hm-happy-pms-cream': 'hm-happy-pms-cream-jar',
    'michaels-women-change-1': 'michaels-health-women-change',
    'womens-touch-progesterone-cream-women': 'women-s-touch-natural-progesterone-cream'
};

function listingSlugVariants(slug) {
    const base = String(slug || '').toLowerCase().trim();
    const out = new Set();
    if (!base) return [];
    out.add(base);
    if (LISTING_SLUG_ALIASES[base]) out.add(LISTING_SLUG_ALIASES[base]);
    out.add(base.replace(/-\d+$/, ''));
    out.add(base.replace(/-jar-\d+$/, '-jar'));
    out.add(base.replace(/-jar$/, ''));
    return [...out].filter(Boolean);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function slugFromUrl(url) {
    const m = String(url || '').match(/\/products\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]).toLowerCase() : '';
}

function skuDigits(sku) {
    return String(sku || '').replace(/\D/g, '');
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
                    if (Number.isFinite(price) && price >= 0 && price <= 10000) return price;
                }
            }
        } catch (_) {
            /* continue */
        }
    }
    const selectors = ['.store-product-price', '.product-price', '.price', '.current-price', '.amount'];
    for (const selector of selectors) {
        const text = $(selector).first().text().trim();
        const match = text.match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
        if (match) {
            const price = parseFloat(match[1].replace(/,/g, ''));
            if (Number.isFinite(price) && price >= 0 && price <= 10000) return price;
        }
    }
    return null;
}

function parseProductPage($, url) {
    const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
    const skuMatch = h1.match(/\bSKU:\s*([A-Za-z0-9-]+)/i);
    const sku = skuMatch ? skuMatch[1].trim() : '';
    const name = h1.replace(/\s*SKU:.*$/i, '').trim();
    const price = extractPriceFromHtml($);
    const slug = slugFromUrl(url);
    let shortDescription = '';
    const descHeading = $('h2, h3, h4').filter((i, el) => /product description/i.test($(el).text())).first();
    if (descHeading.length) {
        const parts = [];
        descHeading.nextUntil('h1, h2, h3').each((i, el) => {
            const t = $(el).text().replace(/\s+/g, ' ').trim();
            if (t) parts.push(t);
        });
        shortDescription = parts.join('\n\n').slice(0, 2000);
    }
    return { name, sku, slug, price, shortDescription, url };
}

async function scrapeCategoryProductUrls(categoryPath) {
    const seen = new Set();
    const urls = [];
    for (let page = 1; page <= 20; page++) {
        const pageUrl =
            page === 1
                ? `${BASE}/index.php/category/${categoryPath}`
                : `${BASE}/index.php/category/${categoryPath}?ccm_paging_p=${page}`;
        const res = await axios.get(pageUrl, { headers: HEADERS, timeout: 30000, validateStatus: (s) => s < 500 });
        if (res.status >= 400) break;
        const $ = cheerio.load(res.data);
        const before = seen.size;
        $('a[href*="/products/"]').each((i, el) => {
            const href = $(el).attr('href');
            if (!href) return;
            const abs = href.startsWith('http') ? href.split('?')[0] : `${BASE}${href.split('?')[0]}`;
            if (!seen.has(abs)) {
                seen.add(abs);
                urls.push(abs);
            }
        });
        if (seen.size === before) break;
        await sleep(400);
    }
    return urls;
}

async function scrapeProduct(url) {
    const res = await axios.get(url, { headers: HEADERS, timeout: 20000, validateStatus: (s) => s < 500 });
    if (res.status === 404) return null;
    const $ = cheerio.load(res.data);
    if (!$('h1').length) return null;
    return parseProductPage($, url);
}

async function findProductId(pool, item) {
    const slug = String(item.slug || '').toLowerCase();
    if (LISTING_PRODUCT_IDS[slug]) {
        const [[row]] = await pool.query(
            'SELECT id FROM products WHERE id = ? AND is_active = 1 LIMIT 1',
            [LISTING_PRODUCT_IDS[slug]]
        );
        if (row?.id) return row.id;
    }

    const slugVariants = listingSlugVariants(item.slug);

    for (const s of slugVariants) {
        const [rows] = await pool.execute(
            `SELECT id FROM products
             WHERE is_active = 1 AND (slug = ? OR slug LIKE ? OR slug LIKE ?)
             ORDER BY (slug = ?) DESC, LENGTH(slug) ASC
             LIMIT 1`,
            [s, `${s}%`, `%${s.replace(/-/g, '%')}%`, s]
        );
        if (rows.length) return rows[0].id;
    }

    const digits = skuDigits(item.sku);
    if (digits.length >= 3) {
        const [bySku] = await pool.execute(
            `SELECT id FROM products
             WHERE is_active = 1 AND (sku LIKE ? OR REPLACE(sku, 'HM-', '') LIKE ? OR name LIKE ?)
             ORDER BY (sku LIKE ?) DESC
             LIMIT 1`,
            [`%${digits}%`, `%${digits}%`, `%${digits}%`, `%${digits}%`]
        );
        if (bySku.length) return bySku[0].id;
    }

    const namePrefix = String(item.name || '')
        .replace(/\s*SKU:.*$/i, '')
        .trim()
        .slice(0, 40);
    if (namePrefix.length >= 8) {
        const [byName] = await pool.execute(
            `SELECT id FROM products WHERE is_active = 1 AND name LIKE ? ORDER BY LENGTH(name) ASC LIMIT 1`,
            [`${namePrefix}%`]
        );
        if (byName.length) return byName[0].id;
    }

    return null;
}

async function ensureGenderCategory(pool, spec) {
    const [[existing]] = await pool.query('SELECT id, slug, name FROM health_categories WHERE slug = ? LIMIT 1', [
        spec.slug
    ]);

    let categoryId = existing?.id || null;

    if (!categoryId) {
        const legacyIdRows = await pool.query(
            `SELECT id FROM health_categories WHERE slug IN (${spec.legacySlugs.map(() => '?').join(',')}) ORDER BY id ASC LIMIT 1`,
            spec.legacySlugs
        );
        const legacyId = legacyIdRows[0]?.[0]?.id;
        if (legacyId) {
            if (!DRY_RUN) {
                await pool.execute(
                    `UPDATE health_categories
                     SET name = ?, slug = ?, description = ?, is_active = 1
                     WHERE id = ?`,
                    [
                        spec.label,
                        spec.slug,
                        `Specialized supplements for ${spec.label.toLowerCase()} health needs`,
                        legacyId
                    ]
                );
            }
            categoryId = legacyId;
            console.log(`Renamed legacy category id ${legacyId} -> ${spec.label} (${spec.slug})`);
        } else if (!DRY_RUN) {
            const [ins] = await pool.execute(
                `INSERT INTO health_categories (name, slug, description, sort_order, is_active)
                 VALUES (?, ?, ?, 0, 1)`,
                [spec.label, spec.slug, `Specialized supplements for ${spec.label.toLowerCase()} health needs`]
            );
            categoryId = ins.insertId;
            console.log(`Created health category ${spec.label} (${spec.slug}) id ${categoryId}`);
        } else {
            console.log(`[dry-run] Would create ${spec.label} (${spec.slug})`);
        }
    } else if (existing.name !== spec.label && !DRY_RUN) {
        await pool.execute('UPDATE health_categories SET name = ?, is_active = 1 WHERE id = ?', [
            spec.label,
            categoryId
        ]);
        console.log(`Updated category name id ${categoryId} -> ${spec.label}`);
    }

    if (categoryId && !DRY_RUN) {
        const placeholders = spec.legacySlugs.map(() => '?').join(',');
        const [legacyRows] = await pool.query(
            `SELECT id, slug FROM health_categories WHERE slug IN (${placeholders}) AND id <> ?`,
            [...spec.legacySlugs, categoryId]
        );
        for (const row of legacyRows) {
            await pool.execute(
                `INSERT IGNORE INTO product_health_categories (product_id, health_category_id)
                 SELECT product_id, ? FROM product_health_categories WHERE health_category_id = ?`,
                [categoryId, row.id]
            );
            await pool.execute('UPDATE health_categories SET is_active = 0 WHERE id = ?', [row.id]);
            console.log(`Merged and deactivated legacy category ${row.slug} (id ${row.id})`);
        }
        for (const legacySlug of spec.legacySlugs) {
            if (legacySlug === spec.slug) continue;
            const [[dup]] = await pool.query('SELECT id FROM health_categories WHERE slug = ? AND id <> ? LIMIT 1', [
                legacySlug,
                categoryId
            ]);
            if (dup?.id) {
                await pool.execute(
                    `INSERT IGNORE INTO product_health_categories (product_id, health_category_id)
                     SELECT product_id, ? FROM product_health_categories WHERE health_category_id = ?`,
                    [categoryId, dup.id]
                );
                await pool.execute('UPDATE health_categories SET is_active = 0 WHERE id = ?', [dup.id]);
            }
        }
    }

    return categoryId;
}

async function linkProductToCategory(pool, productId, categoryId) {
    if (!productId || !categoryId) return false;
    if (DRY_RUN) return true;
    const [result] = await pool.execute(
        'INSERT IGNORE INTO product_health_categories (product_id, health_category_id) VALUES (?, ?)',
        [productId, categoryId]
    );
    return result.affectedRows > 0;
}

async function updateProductPrice(pool, productId, price, sku) {
    const override = catalogPriceForSku(sku);
    const finalPrice = override != null ? override : price;
    if (finalPrice == null || !Number.isFinite(finalPrice)) return false;
    if (DRY_RUN) return true;
    await pool.execute('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
        finalPrice,
        productId
    ]);
    return true;
}

async function main() {
    const pool = createPool({ connectionLimit: 4 });
    const summary = {
        dryRun: DRY_RUN,
        categories: {},
        missing: [],
        linked: 0,
        pricesUpdated: 0
    };

    try {
        for (const spec of GENDER_SOURCES) {
            const categoryId = await ensureGenderCategory(pool, spec);
            const urls = await scrapeCategoryProductUrls(spec.path);
            console.log(`\n${spec.label}: ${urls.length} products on hmherbs.com/${spec.path}`);

            const catSummary = { listed: urls.length, matched: 0, linked: 0, pricesUpdated: 0, missing: [] };

            for (const url of urls) {
                await sleep(DELAY_MS);
                let item;
                try {
                    item = await scrapeProduct(url);
                } catch (err) {
                    console.warn(`Scrape failed ${url}: ${err.message}`);
                    continue;
                }
                if (!item || !item.slug) {
                    console.warn(`No product data ${url}`);
                    continue;
                }

                const productId = await findProductId(pool, item);
                if (!productId) {
                    catSummary.missing.push({ url, name: item.name, sku: item.sku, price: item.price });
                    summary.missing.push({ gender: spec.label, ...item });
                    console.warn(`MISSING in DB: ${item.name} (${item.sku}) ${url}`);
                    continue;
                }

                catSummary.matched++;
                const linked = await linkProductToCategory(pool, productId, categoryId);
                if (linked) {
                    catSummary.linked++;
                    summary.linked++;
                }

                const priceOk = await updateProductPrice(pool, productId, item.price, item.sku);
                if (priceOk) {
                    catSummary.pricesUpdated++;
                    summary.pricesUpdated++;
                    console.log(
                        `OK #${productId} ${item.name.slice(0, 50)} -> ${spec.label} $${Number(item.price).toFixed(2)}`
                    );
                } else {
                    console.log(`OK #${productId} ${item.name.slice(0, 50)} -> ${spec.label} (price unchanged)`);
                }
            }

            summary.categories[spec.slug] = catSummary;
        }

        console.log('\n' + JSON.stringify(summary, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
