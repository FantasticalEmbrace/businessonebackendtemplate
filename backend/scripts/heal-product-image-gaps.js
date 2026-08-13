#!/usr/bin/env node
/**
 * Automated repair for storefront image gaps (effective URL invalid, remote-only, tiny/corrupt
 * local file, or no image). Uses complete-scraped-products.json first (fast), then optional
 * live hmherbs PDP fetch for remaining rows.
 *
 * Usage (from backend/):
 *   node scripts/heal-product-image-gaps.js --dry-run
 *   node scripts/heal-product-image-gaps.js --limit 50
 *   node scripts/heal-product-image-gaps.js --json-only # JSON candidates only (no HTML)
 *   node scripts/heal-product-image-gaps.js # JSON + hmherbs HTML when needed
 *
 * Run `npm run report-image-gaps` before/after to see effective gaps.
 */
const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { loadScraper } = require('../utils/businessone-scraper');
const CatalogScraper = loadScraper();
const SCRAPE_DOMAIN = process.env.CATALOG_SCRAPE_DOMAIN || 'https://hmherbs.com';
const {
    effectivePrimaryImageUrl,
    catalogPrimaryImageForProduct,
    canonicalSkuForCatalog
} = require('../utils/catalogOverrides');

const BASE = 'https://hmherbs.com';
const REPO_ROOT = path.join(__dirname, '..', '..');
const IMAGES_DIR = path.join(REPO_ROOT, 'images', 'products');

const DEFAULT_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache'
};

function parseArgs() {
    const a = process.argv.slice(2);
    let limit = null;
    const li = a.indexOf('--limit');
    if (li >= 0 && a[li + 1]) {
        limit = parseInt(a[li + 1], 10);
        if (Number.isNaN(limit)) limit = null;
    }
    return {
        dryRun: a.includes('--dry-run'),
        limit,
        jsonOnly: a.includes('--json-only')
    };
}

function isValidImageBuffer(buf) {
    if (!buf || buf.length < 800) return false;
    const probe = buf.slice(0, 64).toString('ascii');
    if (/^<!DOCTYPE/i.test(probe) || /^<html/i.test(probe) || /^<\?xml/i.test(probe)) return false;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
        return true;
    }
    return false;
}

function extFromMagic(buf) {
    if (!buf || buf.length < 12) return 'jpg';
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
    if (buf[0] === 0x47 && buf[1] === 0x49) return 'gif';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
        return 'webp';
    }
    return 'jpg';
}

async function loadScrapedIndex() {
    const filePath = path.join(__dirname, '../data/complete-scraped-products.json');
    const raw = await fs.readFile(filePath, 'utf8');
    const j = JSON.parse(raw);
    const bySku = new Map();
    const bySlug = new Map();
    for (const pr of j.products || []) {
        const sku = pr.sku != null ? String(pr.sku).trim() : '';
        if (sku) bySku.set(sku, pr);
        const m = (pr.url || '').match(/\/products\/([^/?#]+)/i);
        if (m) {
            const key = decodeURIComponent(m[1]).toLowerCase();
            bySlug.set(key, pr);
        }
    }
    return { bySku, bySlug };
}

function scrapedImagesForProduct(index, row) {
    const skuRaw = row.sku != null ? String(row.sku).trim() : '';
    const skuKey = canonicalSkuForCatalog(row.sku);
    const slug = row.slug != null ? String(row.slug).trim().toLowerCase() : '';
    let pr = skuRaw ? index.bySku.get(skuRaw) : null;
    if (!pr && skuKey && skuKey !== skuRaw) pr = index.bySku.get(skuKey);
    if (!pr && slug) pr = index.bySlug.get(slug);
    if (!pr || !Array.isArray(pr.images)) return [];
    return pr.images.filter((im) => im && im.url && !CatalogScraper.isJunkProductImageUrl(im.url));
}

function safeSlugSegment(s) {
    return String(s || '')
        .replace(/[/\\?*:|"<>]/g, '-')
        .replace(/\s+/g, '-')
        .substring(0, 80);
}

async function downloadBinary(url, referer = `${BASE}/`) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 45000,
        maxRedirects: 5,
        headers: {
            ...DEFAULT_HEADERS,
            Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
            Referer: referer
        },
        validateStatus: (s) => s === 200
    });
    return Buffer.from(res.data);
}

async function setPrimaryImage(pool, productId, productName, publicUrl, isDryRun) {
    if (isDryRun) return;
    const [existing] = await pool.execute(
        'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1 LIMIT 1',
        [productId]
    );
    const alt = (productName || '').substring(0, 500);
    if (existing.length > 0) {
        await pool.execute('UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?', [
            publicUrl,
            alt,
            existing[0].id
        ]);
    } else {
        await pool.execute(
            'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
            [productId, publicUrl, alt]
        );
    }
}

async function effectiveImageNeedsHeal(row) {
    const effective = effectivePrimaryImageUrl(row);
    if (effective == null || String(effective).trim() === '') return true;
    if (/^https?:\/\//i.test(String(effective).trim())) return true;
    if (!String(effective).startsWith('/')) return true;
    const full = path.join(REPO_ROOT, String(effective).replace(/^\//, ''));
    try {
        const st = await fs.stat(full);
        if (!st.isFile() || st.size < 800) return true;
        const buf = await fs.readFile(full);
        return !isValidImageBuffer(buf);
    } catch {
        return true;
    }
}

async function fetchHtml(url) {
    const res = await axios.get(url, {
        headers: DEFAULT_HEADERS,
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 300
    });
    return res.data;
}

function buildPdpUrl(slug) {
    const s = String(slug || '').trim();
    if (!s) return null;
    return `${BASE}/index.php/products/${encodeURIComponent(s)}`;
}

(async () => {
    loadBackendEnv();
    const { dryRun, limit, jsonOnly } = parseArgs();

    const pool = createPool({ connectionLimit: 5 });

    const [rows] = await pool.execute(`
        SELECT p.id, p.sku, p.slug, p.name, pi.image_url AS primary_image_url
        FROM products p
        LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
        WHERE p.is_active = 1
        ORDER BY p.id
    `);

    const index = await loadScrapedIndex();
    await fs.mkdir(IMAGES_DIR, { recursive: true });

    let healed = 0;
    let skippedOk = 0;
    let failed = 0;
    let processed = 0;

    for (const row of rows) {
        if (limit != null && processed >= limit) break;

        if (!(await effectiveImageNeedsHeal(row))) {
            skippedOk++;
            continue;
        }
        processed++;

        const candidates = [];
        for (const im of scrapedImagesForProduct(index, row)) {
            candidates.push(im.url);
        }

        let buf = null;
        let sourceUrl = null;
        for (const url of candidates) {
            try {
                const b = await downloadBinary(url);
                if (isValidImageBuffer(b)) {
                    buf = b;
                    sourceUrl = url;
                    break;
                }
            } catch {
                /* next */
            }
        }

        if (!buf && !jsonOnly && row.slug) {
            const pdp = buildPdpUrl(row.slug);
            try {
                const html = await fetchHtml(pdp);
                const $ = cheerio.load(html);
                const scraper = new CatalogScraper({ domain: SCRAPE_DOMAIN });
                const imgs = scraper.extractImages($);
                for (const im of imgs) {
                    if (!im || !im.url || CatalogScraper.isJunkProductImageUrl(im.url)) continue;
                    try {
                        const b = await downloadBinary(im.url);
                        if (isValidImageBuffer(b)) {
                            buf = b;
                            sourceUrl = im.url;
                            break;
                        }
                    } catch {
                        /* next */
                    }
                }
            } catch {
                /* no PDP */
            }
        }

        if (!buf) {
            failed++;
            console.warn(`Could not heal #${row.id} sku=${row.sku} slug=${row.slug}`);
            continue;
        }

        const ext = extFromMagic(buf);
        const stem = safeSlugSegment(row.slug || row.sku || `id-${row.id}`);
        const filename = `healed-${stem}-id${row.id}.${ext}`;
        const diskPath = path.join(IMAGES_DIR, filename);
        const publicUrl = `/images/products/${filename}`;

        if (!dryRun) {
            await fs.writeFile(diskPath, buf);
            await setPrimaryImage(pool, row.id, row.name, publicUrl, false);
        }

        healed++;
        console.log(
            dryRun ? `[dry-run] Would heal #${row.id} -> ${publicUrl} (${sourceUrl})` : `Healed #${row.id} -> ${publicUrl}`
        );

        if (catalogPrimaryImageForProduct(row)) {
            console.warn(
                `  Note: catalog override still maps this SKU/slug to ${catalogPrimaryImageForProduct(
                    row
                )} — restore that file or remove the catalog entry if the new file should show.`
            );
        }
    }

    await pool.end();
    console.log('\nSummary:', { healed, skippedOk, failed, dryRun, jsonOnly, limit });
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
