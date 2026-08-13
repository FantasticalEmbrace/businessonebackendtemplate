#!/usr/bin/env node
/**
 * Re-fetch hmherbs.com product pages and update long_description (and short_description when needed).
 * Uses scrape-hmherbs.js extractors (.store-product-description vs .store-product-detailed-description).
 *
 * Usage (from backend/):
 *   node scripts/fix-long-descriptions.js --dry-run
 *   node scripts/fix-long-descriptions.js --limit 10
 *   node scripts/fix-long-descriptions.js
 *   node scripts/fix-long-descriptions.js --only-duplicates   # long === short only
 *   node scripts/fix-long-descriptions.js --refresh-html        # re-fetch plain-text long descriptions as HTML
 *   node scripts/fix-long-descriptions.js --no-search           # skip slow site search fallback (use scraped URLs only)
 */
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { createPool } = require('../utils/dbConfig');
const { loadScraper } = require('../utils/businessone-scraper');
const CatalogScraper = loadScraper();
const SCRAPE_DOMAIN = process.env.CATALOG_SCRAPE_DOMAIN || 'https://hmherbs.com';

const BASE = 'https://hmherbs.com';
const DELAY_MS = 350;

const DEFAULT_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
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
        onlyDuplicates: a.includes('--only-duplicates'),
        refreshHtml: a.includes('--refresh-html'),
        noSearch: a.includes('--no-search'),
        limit
    };
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function buildProductPageCandidates(product, scrapedUrl) {
    const out = [];
    const seen = new Set();
    const add = (u) => {
        if (!u || seen.has(u)) return;
        seen.add(u);
        out.push(u);
    };

    if (scrapedUrl) add(scrapedUrl);

    const slug = (product.slug && String(product.slug).trim()) || '';
    const sku = (product.sku && String(product.sku).trim()) || '';

    const addPath = (pathPart) => {
        if (!pathPart) return;
        add(`${BASE}/index.php/products/${pathPart}`);
    };

    if (slug) {
        addPath(encodeURIComponent(slug));
        addPath(slug);
        if (slug.includes('-')) addPath(slug.replace(/-/g, '_'));
    }
    if (sku && sku !== slug) {
        addPath(encodeURIComponent(sku));
        addPath(sku);
    }
    return out;
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

function slugBase(slug) {
    return String(slug || '')
        .trim()
        .toLowerCase()
        .replace(/-sku-[a-z0-9-]+$/i, '');
}

async function loadScrapedUrlIndex() {
    const paths = [
        path.join(__dirname, '../data/complete-scraped-products.json'),
        path.join(__dirname, '../data/scraped-products.json')
    ];
    const bySku = new Map();
    const bySlug = new Map();

    for (const filePath of paths) {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            const j = JSON.parse(raw);
            for (const pr of j.products || []) {
                const sku = pr.sku != null ? String(pr.sku).trim() : '';
                const url = pr.url || '';
                if (sku && url) {
                    bySku.set(sku, url);
                    bySku.set(normalizeSku(sku), url);
                }
                const m = (url || '').match(/\/products\/([^/?#]+)/i);
                if (m) {
                    const key = decodeURIComponent(m[1]).toLowerCase();
                    if (!bySlug.has(key)) bySlug.set(key, url);
                }
            }
        } catch (e) {
            // optional file
        }
    }
    return { bySku, bySlug };
}

async function fetchProductHtml(url) {
    const res = await axios.get(url, {
        headers: DEFAULT_HEADERS,
        timeout: 45000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 300
    });
    return res.data;
}

function absolutizeHmherbsHref(href) {
    if (!href) return null;
    let h = String(href).trim().split('#')[0];
    if (h.startsWith('http://') || h.startsWith('https://')) return h;
    if (h.startsWith('//')) return `https:${h}`;
    if (h.startsWith('/')) return `${BASE}${h}`;
    return `${BASE}/${h}`;
}

function extractProductLinksFromSearchHtml(html) {
    const $ = cheerio.load(html);
    const out = [];
    $('a[href*="index.php/products/"]').each((i, el) => {
        const abs = absolutizeHmherbsHref($(el).attr('href'));
        if (abs) out.push(abs);
    });
    return out;
}

function pickBestProductUrl(links, product, queryKind) {
    const uniq = [...new Set(links)].filter((u) => /\/index\.php\/products\//i.test(u));
    if (uniq.length === 0) return null;
    if (queryKind === 'sku') return uniq[0];
    const slug = ((product.slug && String(product.slug).trim()) || '').toLowerCase();
    if (slug) {
        const hit = uniq.find((u) => u.toLowerCase().includes(slug));
        if (hit) return hit;
        const parts = slug.split('-').filter(Boolean);
        if (parts.length >= 2) {
            const needle = parts.slice(0, 5).join('-');
            const hit2 = uniq.find((u) => u.toLowerCase().includes(needle));
            if (hit2) return hit2;
        }
    }
    return uniq[0];
}

async function findProductPageViaSearch(product) {
    const sku = (product.sku && String(product.sku).trim()) || '';
    const name = (product.name && String(product.name).trim()) || '';
    const slug = (product.slug && String(product.slug).trim()) || '';
    const seenQ = new Set();
    const attempts = [];
    const add = (q, kind) => {
        const t = (q || '').trim();
        if (t.length < 2 || seenQ.has(t)) return;
        seenQ.add(t);
        attempts.push({ q: t, kind });
    };

    if (sku) add(sku, 'sku');
    const words = name ? name.split(/\s+/).filter(Boolean) : [];
    if (words.length) {
        add(words.slice(0, 12).join(' '), 'name');
        if (words.length > 6) add(words.slice(0, 6).join(' '), 'name');
        if (words.length > 3) add(words.slice(0, 4).join(' '), 'name');
    }
    const stripped = name
        .replace(/\s*-\s*free shipping/gi, '')
        .replace(/\bfree shipping\b/gi, '')
        .replace(/\s*-\s*free\b/gi, '')
        .trim();
    if (stripped && stripped !== name) {
        add(stripped.split(/\s+/).slice(0, 10).join(' '), 'name');
    }
    const clean = name.replace(/[^a-zA-Z0-9\s&]/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length > 3) add(clean.split(/\s+/).slice(0, 10).join(' '), 'name');
    if (slug) {
        add(slug.replace(/-/g, ' '), 'name');
        const parts = slug.split('-').filter((x) => x.length > 1);
        if (parts.length >= 2) add(parts.slice(0, 6).join(' '), 'name');
        if (parts.length >= 2) add(parts.slice(0, 3).join(' '), 'name');
    }

    for (const { q, kind } of attempts) {
        const searchUrl = `${BASE}/index.php/search?query=${encodeURIComponent(q)}`;
        try {
            const html = await fetchProductHtml(searchUrl);
            const links = extractProductLinksFromSearchHtml(html);
            const best = pickBestProductUrl(links, product, kind === 'sku' ? 'sku' : 'name');
            if (best) return best;
        } catch (e) {
            /* try next */
        }
        await sleep(80);
    }
    return null;
}

async function resolveDescriptions(scraper, product, urls, noSearch) {
    const tryUrl = async (url) => {
        const html = await fetchProductHtml(url);
        const $ = cheerio.load(html);
        if (!$('.store-product, .page-type-store-product').length) return null;

        const shortDescription = scraper.extractShortDescription($);
        const longDescription = scraper.extractDescription($);
        if (longDescription && longDescription.length > 50) {
            return { url, shortDescription, longDescription };
        }
        return null;
    };

    for (const url of urls) {
        try {
            const hit = await tryUrl(url);
            if (hit) return hit;
        } catch (e) {
            /* next */
        }
    }

    if (!noSearch) {
        try {
            const searchUrl = await findProductPageViaSearch(product);
            if (searchUrl && !urls.includes(searchUrl)) {
                return await tryUrl(searchUrl);
            }
        } catch (e) {
            /* no search hit */
        }
    }

    return null;
}

async function main() {
    const { dryRun, onlyDuplicates, refreshHtml, noSearch, limit } = parseArgs();
    const scraper = new CatalogScraper({ domain: SCRAPE_DOMAIN });
    const pool = createPool();
    const urlIndex = await loadScrapedUrlIndex();

    let sql = `
        SELECT id, sku, name, slug, short_description, long_description
        FROM products
        WHERE is_active = 1
        ORDER BY id
    `;
    if (onlyDuplicates) {
        sql = `
            SELECT id, sku, name, slug, short_description, long_description
            FROM products
            WHERE is_active = 1
              AND TRIM(COALESCE(short_description, '')) <> ''
              AND TRIM(COALESCE(long_description, '')) = TRIM(COALESCE(short_description, ''))
            ORDER BY id
        `;
    } else if (refreshHtml) {
        sql = `
            SELECT id, sku, name, slug, short_description, long_description
            FROM products
            WHERE is_active = 1
              AND LENGTH(TRIM(COALESCE(long_description, ''))) > 80
              AND TRIM(COALESCE(long_description, '')) NOT LIKE '%<p%'
              AND TRIM(COALESCE(long_description, '')) NOT LIKE '%<strong%'
            ORDER BY id
        `;
    }

    const [rows] = await pool.query(sql);
    const targets = limit ? rows.slice(0, limit) : rows;

    console.log(`Products to process: ${targets.length}${onlyDuplicates ? ' (duplicates only)' : ''}${refreshHtml ? ' (refresh HTML)' : ''}${dryRun ? ' [dry-run]' : ''}`);

    const stats = { updated: 0, skipped: 0, failed: 0, unchanged: 0 };

    for (let i = 0; i < targets.length; i++) {
        const row = targets[i];
        const slugKey = (row.slug && String(row.slug).trim().toLowerCase()) || '';
        const skuKey = row.sku != null ? String(row.sku).trim() : '';
        const slugSku = normalizeSku(skuFromProductSlug(row.slug));
        const scrapedUrl =
            (skuKey && urlIndex.bySku.get(skuKey)) ||
            (skuKey && urlIndex.bySku.get(normalizeSku(skuKey))) ||
            (slugSku && urlIndex.bySku.get(slugSku)) ||
            (slugKey && urlIndex.bySlug.get(slugKey)) ||
            (slugKey && urlIndex.bySlug.get(slugBase(slugKey))) ||
            null;
        const urls = buildProductPageCandidates(row, scrapedUrl);

        if (i > 0) await sleep(DELAY_MS);

        const resolved = await resolveDescriptions(scraper, row, urls, noSearch);
        if (!resolved) {
            stats.failed++;
            console.log(`[${i + 1}/${targets.length}] FAIL #${row.id} ${row.name} — no PDP`);
            continue;
        }

        const short = (resolved.shortDescription || '').trim();
        const long = (resolved.longDescription || '').trim();
        const prevShort = (row.short_description || '').trim();
        const prevLong = (row.long_description || '').trim();

        const longPlain = scraper.htmlToPlainText(long);
        const prevLongPlain = scraper.htmlToPlainText(prevLong);

        if (!longPlain || (short && scraper.descriptionsAreSame(longPlain, short))) {
            stats.skipped++;
            console.log(`[${i + 1}/${targets.length}] SKIP #${row.id} ${row.name} — no distinct long text`);
            continue;
        }

        const shortChanged = short && short !== prevShort;
        const prevHasHtml = /<\s*(p|strong|br|h2|h3)\b/i.test(prevLong);
        const newHasHtml = /<\s*(p|strong|br|h2|h3)\b/i.test(long);
        const longChanged =
            long !== prevLong ||
            (refreshHtml && newHasHtml) ||
            (newHasHtml && longPlain !== prevLongPlain);

        if (!shortChanged && !longChanged) {
            stats.unchanged++;
            continue;
        }

        if (dryRun) {
            stats.updated++;
            console.log(
                `[${i + 1}/${targets.length}] WOULD UPDATE #${row.id} ${row.name} (long ${prevLong.length} → ${long.length} chars)`
            );
            continue;
        }

        await pool.query(
            `UPDATE products SET
                short_description = CASE WHEN ? <> '' THEN ? ELSE short_description END,
                long_description = ?,
                updated_at = NOW()
             WHERE id = ?`,
            [short, short, long, row.id]
        );
        stats.updated++;
        console.log(
            `[${i + 1}/${targets.length}] OK #${row.id} ${row.name} (long ${prevLong.length} → ${long.length} chars)`
        );
    }

    await pool.end();
    console.log('\nDone:', stats);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
