#!/usr/bin/env node
/**
 * Pull product photos from the live site **https://hmherbs.com** (store catalog imagery — same assets shown on hmherbs.com).
 * For each DB product: resolve the product page (direct slug URL and/or site search by SKU/name), then extract images (scrape-hmherbs.js).
 * Image file URLs are usually hmherbs.com/application/files/... or i0.wp.com/hmherbs.com/... (their CDN).
 * Downloads the primary image into images/products/ and sets product_images to /images/products/...
 *
 * Usage (from backend/):
 *   node scripts/fetch-hmherbs-product-images.js --dry-run
 *   node scripts/fetch-hmherbs-product-images.js --limit 20
 *   node scripts/fetch-hmherbs-product-images.js
 *   node scripts/fetch-hmherbs-product-images.js --force   # re-download even if file exists
 *   node scripts/fetch-hmherbs-product-images.js --try-json-first   # try local scrape JSON before loading PDP HTML
 *   node scripts/fetch-hmherbs-product-images.js --json-only   # only URLs from data/complete-scraped-products.json (fast; skips HTML)
 *   node scripts/fetch-hmherbs-product-images.js --only-missing   # rows with no primary image
 *   node scripts/fetch-hmherbs-product-images.js --only-remote   # primary image still http(s) — good for migrating to local files
 *   node scripts/fetch-hmherbs-product-images.js --no-manufacturer-fallback   # skip manufacturer-site fallback (see manufacturer-site-images.js)
 *
 * Full catalog (may take hours; be polite to hmherbs.com): npm run fetch-live-images
 *
 * Env: DB_* from backend/.env
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
const { getManufacturerImageUrls, resolveBrandWebsite } = require('./manufacturer-site-images');

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
        force: a.includes('--force'),
        limit,
        tryJsonFirst: a.includes('--try-json-first'),
        jsonOnly: a.includes('--json-only'),
        onlyMissing: a.includes('--only-missing'),
        onlyRemote: a.includes('--only-remote'),
        manufacturerFallback: !a.includes('--no-manufacturer-fallback')
    };
}

function safeSlugSegment(s) {
    return String(s || '')
        .replace(/[/\\?*:|"<>]/g, '-')
        .replace(/\s+/g, '-')
        .substring(0, 120);
}

function buildProductPageCandidates(product) {
    const slug = (product.slug && String(product.slug).trim()) || '';
    const sku = (product.sku && String(product.sku).trim()) || '';
    const out = [];
    const seen = new Set();

    const add = (pathPart) => {
        if (!pathPart) return;
        const u = `${BASE}/index.php/products/${pathPart}`;
        if (!seen.has(u)) {
            seen.add(u);
            out.push(u);
        }
    };

    if (slug) {
        add(encodeURIComponent(slug));
        add(slug);
        if (slug.includes('-')) {
            add(slug.replace(/-/g, '_'));
        }
    }
    if (sku && sku !== slug) {
        add(encodeURIComponent(sku));
        add(sku);
    }
    return out;
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

/**
 * When search returns multiple hits, prefer URL containing our slug; for SKU searches the first hit is usually correct.
 */
function pickBestProductUrl(links, product, queryKind) {
    const uniq = [...new Set(links)].filter((u) => /\/index\.php\/products\//i.test(u));
    if (uniq.length === 0) return null;
    if (queryKind === 'sku') {
        return uniq[0];
    }
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

/**
 * hmherbs.com often uses longer slugs than our DB (e.g. ...-aloe-2oz-1). Site search by SKU finds the real PDP.
 */
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
            const html = await fetchHtml(searchUrl);
            const links = extractProductLinksFromSearchHtml(html);
            const best = pickBestProductUrl(links, product, kind === 'sku' ? 'sku' : 'name');
            if (best) return best;
        } catch {
            /* try next */
        }
        await new Promise((r) => setTimeout(r, 80));
    }
    return null;
}

async function fetchHtml(url) {
    const res = await axios.get(url, {
        headers: DEFAULT_HEADERS,
        timeout: 30000,
        maxRedirects: 5,
        // IMPORTANT: do not accept 404 — body is still HTML but is an error page (trust badges, etc.)
        validateStatus: (s) => s >= 200 && s < 300
    });
    return res.data;
}

function isValidImageBuffer(buf) {
    if (!buf || buf.length < 800) return false;
    const probe = buf.slice(0, 64).toString('ascii');
    if (/^<!DOCTYPE/i.test(probe) || /^<html/i.test(probe) || /^<\?xml/i.test(probe)) return false;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return true;
    return false;
}

function extFromMagic(buf) {
    if (!buf || buf.length < 12) return 'jpg';
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
    if (buf[0] === 0x47 && buf[1] === 0x49) return 'gif';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
    return 'jpg';
}

function isLikelyIngredientsOrFacts(u, alt) {
    const s = `${String(u)} ${String(alt || '')}`.toLowerCase();
    return /ingredients|supplement[-\s]?facts|nutrition[-\s]?facts|facts[-\s]?panel|\bfacts\b|directions|dosage|warning/.test(
        s
    );
}

function scoreImageCandidate(im) {
    if (!im || !im.url) return -999;
    if (CatalogScraper.isJunkProductImageUrl(im.url)) return -999;
    let s = 0;
    const u = im.url.toLowerCase();
    if (isLikelyIngredientsOrFacts(im.url, im.alt)) s -= 80;
    const thumbRe = /thumbnails|\/cache\/thumb/i;
    if (!thumbRe.test(u)) s += 12;
    else s += 4;
    if (/\/application\/files\//i.test(u) && !thumbRe.test(u)) s += 8;
    if (u.includes('product') && !u.includes('by-product')) s += 2;
    return s;
}

function mergeImageCandidates(pageList, jsonList) {
    const seen = new Set();
    const out = [];
    const pushAll = (list) => {
        for (const im of list) {
            if (!im || !im.url) continue;
            const u = String(im.url).trim().replace(/&amp;/g, '&');
            if (seen.has(u)) continue;
            if (CatalogScraper.isJunkProductImageUrl(u)) continue;
            seen.add(u);
            out.push({ url: u, alt: im.alt || '' });
        }
    };
    pushAll(pageList || []);
    pushAll(jsonList || []);
    out.sort((a, b) => scoreImageCandidate(b) - scoreImageCandidate(a));
    return out;
}

async function loadScrapedImageIndex() {
    const filePath = path.join(__dirname, '../data/complete-scraped-products.json');
    try {
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
    } catch (e) {
        console.warn('Could not load complete-scraped-products.json:', e.message);
        return { bySku: new Map(), bySlug: new Map() };
    }
}

function lookupScrapedImages(index, product) {
    const sku = product.sku != null ? String(product.sku).trim() : '';
    const slug = product.slug != null ? String(product.slug).trim().toLowerCase() : '';
    let pr = sku ? index.bySku.get(sku) : null;
    if (!pr && slug) pr = index.bySlug.get(slug);
    if (!pr || !Array.isArray(pr.images)) return [];
    return pr.images.filter((im) => im && im.url && !CatalogScraper.isJunkProductImageUrl(im.url));
}

function extFromUrl(u) {
    const clean = String(u).split('?')[0];
    const m = clean.match(/\.(jpe?g|png|gif|webp)$/i);
    return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
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
    const buf = Buffer.from(res.data);
    if (buf.length < 100) {
        throw new Error(`Response too small (${buf.length} bytes)`);
    }
    return buf;
}

async function downloadFirstValidImage(urls, options = {}) {
    const referer = options.referer != null ? options.referer : `${BASE}/`;
    if (!urls || urls.length === 0) {
        return { buf: null, url: null, lastError: 'no candidate URLs' };
    }
    let lastError = '';
    for (const url of urls) {
        try {
            const buf = await downloadBinary(url, referer);
            if (!isValidImageBuffer(buf)) {
                lastError = `not a valid image (${buf.length} b)`;
                continue;
            }
            return { buf, url, lastError: null };
        } catch (e) {
            lastError = e.message || String(e);
        }
    }
    return { buf: null, url: null, lastError };
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

async function findExistingHmherbsPrimary(stem, productId) {
    let names;
    try {
        names = await fs.readdir(IMAGES_DIR);
    } catch {
        return null;
    }
    const prefix = `${stem}-id${productId}-hmherbs-primary.`;
    for (const name of names) {
        if (!name.startsWith(prefix)) continue;
        const full = path.join(IMAGES_DIR, name);
        try {
            const st = await fs.stat(full);
            if (!st.isFile() || st.size < 500) continue;
            const buf = await fs.readFile(full);
            if (!isValidImageBuffer(buf)) continue;
            return {
                name,
                publicUrl: `/images/products/${encodeURIComponent(name)}`
            };
        } catch {
            /* ignore */
        }
    }
    return null;
}

async function savePrimaryFromBuffer({
    label,
    buf,
    winningUrl,
    stem,
    productId,
    productName,
    urlDedup,
    pool,
    dryRun
}) {
    let ext = extFromMagic(buf);
    if (ext === 'jpg') {
        const fromUrl = extFromUrl(winningUrl);
        if (fromUrl !== 'jpg') ext = fromUrl;
    }
    const filename2 = `${stem}-id${productId}-hmherbs-primary.${ext}`;
    const fsPath2 = path.join(IMAGES_DIR, filename2);
    const publicUrl2 = `/images/products/${encodeURIComponent(filename2)}`;

    if (urlDedup.has(winningUrl)) {
        const existingPath = urlDedup.get(winningUrl);
        if (!dryRun) {
            await fs.copyFile(existingPath, fsPath2);
            await setPrimaryImage(pool, productId, productName, publicUrl2, dryRun);
        }
        console.log(`[dedupe] ${label} -> ${filename2}`);
        return;
    }

    if (dryRun) {
        console.log(
            `[dry-run] ${label} -> ${filename2} (${buf.length} bytes) <- ${String(winningUrl).substring(0, 80)}...`
        );
    } else {
        await fs.writeFile(fsPath2, buf);
        urlDedup.set(winningUrl, fsPath2);
        await setPrimaryImage(pool, productId, productName, publicUrl2, dryRun);
        console.log(`OK ${label} -> ${filename2} (${buf.length} b)`);
    }
}

(async () => {
    loadBackendEnv();
    const { dryRun, force, limit, tryJsonFirst, jsonOnly, onlyMissing, onlyRemote, manufacturerFallback } =
        parseArgs();

    if (onlyMissing && onlyRemote) {
        console.error('Use only one of --only-missing and --only-remote');
        process.exit(1);
    }

    const scrapedIndex = await loadScrapedImageIndex();
    console.log(
        `Scrape JSON index: ${scrapedIndex.bySku.size} SKU keys, ${scrapedIndex.bySlug.size} slug keys`
    );

    const scraper = new CatalogScraper({ domain: SCRAPE_DOMAIN });
    await fs.mkdir(IMAGES_DIR, { recursive: true });

    const pool = createPool({ connectionLimit: 5 });

    let sql =
        'SELECT p.id, p.slug, p.sku, p.name, b.name AS brand_name, b.website_url AS brand_website_url FROM products p LEFT JOIN brands b ON p.brand_id = b.id';
    const whereParts = ['p.is_active = 1'];
    if (onlyMissing) {
        sql +=
            ' LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1';
        whereParts.push(
            '(pi.id IS NULL OR pi.image_url IS NULL OR TRIM(pi.image_url) = \'\')'
        );
    } else if (onlyRemote) {
        sql +=
            ' INNER JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1';
        whereParts.push(
            '(pi.image_url LIKE \'http://%\' OR pi.image_url LIKE \'https://%\' OR pi.image_url LIKE \'//%\')'
        );
    }
    sql += ` WHERE ${whereParts.join(' AND ')} ORDER BY p.id`;
    if (limit != null && limit > 0) {
        const lim = Math.min(50000, Math.max(1, Math.floor(Number(limit))));
        sql += ` LIMIT ${lim}`;
    }

    const [rows] = await pool.execute(sql);
    console.log(`Products to process: ${rows.length}${dryRun ? ' (dry-run)' : ''}`);
    if (jsonOnly) console.log('Mode: --json-only');
    else if (tryJsonFirst) console.log('Mode: --try-json-first');
    console.log(
        manufacturerFallback
            ? 'Manufacturer fallback: ON (hmherbs + JSON fail -> brand site)'
            : 'Manufacturer fallback: OFF'
    );
    console.log('');

    const urlDedup = new Map();
    let ok = 0;
    let skipped = 0;
    let failed = 0;
    let manufacturerOk = 0;

    for (let i = 0; i < rows.length; i++) {
        const p = rows[i];
        const label = `${i + 1}/${rows.length} #${p.id} ${(p.name || '').substring(0, 50)}`;

        const stem = safeSlugSegment(p.slug || p.sku || `product-${p.id}`);
        const jsonIms = lookupScrapedImages(scrapedIndex, p);

        const trySaveMerged = async (pageList, jsonList, delayAfter) => {
            const merged = mergeImageCandidates(pageList, jsonList);
            if (merged.length === 0) return false;
            const { buf, url: winningUrl, lastError } = await downloadFirstValidImage(
                merged.map((m) => m.url)
            );
            if (!buf || !winningUrl) {
                console.error(`FAIL ${label} no valid image (${merged.length} URLs). ${lastError || ''}`);
                return false;
            }
            await savePrimaryFromBuffer({
                label,
                buf,
                winningUrl,
                stem,
                productId: p.id,
                productName: p.name,
                urlDedup,
                pool,
                dryRun
            });
            if (delayAfter) await new Promise((r) => setTimeout(r, 350));
            return true;
        };

        const tryManufacturerSave = async () => {
            if (!manufacturerFallback) return false;
            const origin = resolveBrandWebsite(p.brand_name || '', p.brand_website_url);
            if (!origin) {
                console.error(`FAIL ${label} manufacturer: no brand website (set brands.website_url or known brand name)`);
                return false;
            }
            const referer = origin.endsWith('/') ? origin : `${origin}/`;
            console.log(`[mfr] ${label} ${origin}`);
            let urls;
            try {
                urls = await getManufacturerImageUrls({
                    productName: p.name,
                    brandName: p.brand_name || '',
                    websiteUrl: p.brand_website_url
                });
            } catch (e) {
                console.error(`FAIL ${label} manufacturer: ${e.message || e}`);
                return false;
            }
            if (!urls.length) {
                console.error(`FAIL ${label} manufacturer: no image URLs from brand pages`);
                return false;
            }
            const { buf, url: winningUrl, lastError } = await downloadFirstValidImage(urls, { referer });
            if (!buf || !winningUrl) {
                console.error(`FAIL ${label} manufacturer: download ${lastError || ''}`);
                return false;
            }
            await savePrimaryFromBuffer({
                label,
                buf,
                winningUrl,
                stem,
                productId: p.id,
                productName: p.name,
                urlDedup,
                pool,
                dryRun
            });
            manufacturerOk++;
            await new Promise((r) => setTimeout(r, 500));
            return true;
        };

        if (jsonOnly) {
            if (await trySaveMerged([], jsonIms, true)) ok++;
            else if (await tryManufacturerSave()) ok++;
            else failed++;
            continue;
        }

        if (tryJsonFirst && jsonIms.length) {
            if (await trySaveMerged([], jsonIms, true)) {
                ok++;
                continue;
            }
        }

        if (!force) {
            const existing = await findExistingHmherbsPrimary(stem, p.id);
            if (existing) {
                console.log(`skip ${label} file exists: ${existing.name}`);
                await setPrimaryImage(pool, p.id, p.name, existing.publicUrl, dryRun);
                skipped++;
                continue;
            }
        }

        let html = null;
        let pageUrl = null;
        const candidates = [];
        let lastFetchErr = null;

        try {
            const fromSearch = await findProductPageViaSearch(p);
            if (fromSearch) candidates.push(fromSearch);
        } catch (e) {
            lastFetchErr = e;
        }
        for (const u of buildProductPageCandidates(p)) {
            if (!candidates.includes(u)) candidates.push(u);
        }

        for (const u of candidates) {
            try {
                html = await fetchHtml(u);
                pageUrl = u;
                break;
            } catch (e) {
                lastFetchErr = e;
            }
        }

        let images = [];
        if (html) {
            try {
                const $ = cheerio.load(html);
                images = scraper.extractImages($);
            } catch (e) {
                console.error(`FAIL ${label} extractImages: ${e.message}`);
            }
        }

        if ((!html || images.length === 0) && jsonIms.length) {
            if (await trySaveMerged([], jsonIms, true)) {
                ok++;
                continue;
            }
        }

        if (!html) {
            if (await tryManufacturerSave()) {
                ok++;
                continue;
            }
            const hint = lastFetchErr ? lastFetchErr.message : 'unknown error';
            console.error(`FAIL ${label} no product page (${candidates.length} URLs). ${hint}`);
            failed++;
            continue;
        }

        if (images.length === 0) {
            if (await tryManufacturerSave()) {
                ok++;
                continue;
            }
            console.error(`FAIL ${label} no images on ${pageUrl}`);
            failed++;
            continue;
        }

        if (await trySaveMerged(images, jsonIms, true)) ok++;
        else if (await tryManufacturerSave()) ok++;
        else failed++;
    }

    await pool.end();

    console.log('\n---');
    console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed} manufacturer_ok=${manufacturerOk}`);
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
