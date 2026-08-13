#!/usr/bin/env node
/**
 * Sync Newton Labs prices + primary images from live hmherbs.com (search by numeric SKU).
 *
 * Usage (from backend/):
 *   node scripts/sync-newton-from-hmherbs.js --dry-run
 *   node scripts/sync-newton-from-hmherbs.js --limit 5
 *   node scripts/sync-newton-from-hmherbs.js --force
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { loadScraper } = require('../utils/businessone-scraper');

loadBackendEnv();

const envFile = path.join(__dirname, '../../deploy/db-connection.env');
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) process.env[m[1]] = m[2];
    }
    process.env.DB_SSL_CA = path.join(__dirname, '../../deploy/hmherbs-miami-ca-certificate.crt');
}

const CatalogScraper = loadScraper();
const BASE = process.env.CATALOG_SCRAPE_DOMAIN || 'https://hmherbs.com';
const REPO_ROOT = path.join(__dirname, '..', '..');
const IMAGES_DIR = path.join(REPO_ROOT, 'images', 'products');

const HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

function parseArgs() {
    const a = process.argv.slice(2);
    const li = a.indexOf('--limit');
    return {
        dryRun: a.includes('--dry-run'),
        force: a.includes('--force'),
        pricesOnly: a.includes('--prices-only'),
        imagesOnly: a.includes('--images-only'),
        limit: li >= 0 && a[li + 1] ? parseInt(a[li + 1], 10) : null
    };
}

function catalogSku(row) {
    const fromSlug = String(row.slug || '').match(/-sku-([a-z0-9]+)$/i);
    if (fromSlug) return fromSlug[1].toUpperCase();
    const fromName = String(row.name || '').match(/sku\s*:\s*([a-z0-9]+)/i);
    if (fromName) return fromName[1].toUpperCase();
    return null;
}

function absolutizeHmherbsPath(href) {
    if (!href) return null;
    const h = String(href).trim();
    if (h.startsWith('http://') || h.startsWith('https://')) return h;
    if (h.startsWith('//')) return `https:${h}`;
    if (h.startsWith('/')) return `${BASE}${h}`;
    return `${BASE}/${h}`;
}

/** hmherbs.com multi-variant PDPs embed per-SKU price + image in window.variationData */
function extractVariantBySku(html, targetSku) {
    const want = String(targetSku || '').toUpperCase();
    if (!want) return null;
    const re = /\(window\.variationData[^)]*\)\[\d+\]\s*=\s*(\{[\s\S]*?\});/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        try {
            const blob = JSON.parse(m[1]);
            for (const key of Object.keys(blob)) {
                const v = blob[key];
                if (!v || String(v.sku || '').toUpperCase() !== want) continue;
                const price = parseFloat(v.price);
                const image = absolutizeHmherbsPath(v.image);
                const imageThumb = v.imageThumb || null;
                return {
                    price: Number.isFinite(price) && price > 0 ? price : null,
                    imageUrl: image || imageThumb,
                    imageCandidates: [image, imageThumb].filter(Boolean)
                };
            }
        } catch (_) {}
    }
    return null;
}

function extractPrice($) {
    const dataPrice = $('.store-product-price').first().attr('data-price');
    if (dataPrice) {
        const p = parseFloat(dataPrice);
        if (Number.isFinite(p) && p > 0) return p;
    }
    let found = null;
    $('script[type="application/ld+json"]').each((_, el) => {
        if (found != null) return;
        try {
            const j = JSON.parse($(el).html());
            const items = Array.isArray(j) ? j : j['@graph'] || [j];
            for (const item of items) {
                if (!String(item['@type'] || '').includes('Product')) continue;
                const offers = item.offers ? (Array.isArray(item.offers) ? item.offers : [item.offers]) : [];
                for (const o of offers) {
                    const p = parseFloat(o.price);
                    if (Number.isFinite(p) && p > 0 && p < 10000) {
                        found = p;
                        return false;
                    }
                }
            }
        } catch (_) {}
    });
    if (found != null) return found;
    const text = $('.store-product-price, .product-price, .price').first().text();
    const m = text.match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    return m ? parseFloat(m[1].replace(/,/g, '')) : null;
}

function extractProductLinks(html) {
    const $ = cheerio.load(html);
    const out = [];
    $('a[href*="index.php/products/"]').each((_, el) => {
        let href = $(el).attr('href') || '';
        if (href.startsWith('/')) href = `${BASE}${href}`;
        else if (!href.startsWith('http')) href = `${BASE}/${href}`;
        if (href.includes('/index.php/products/')) out.push(href.split('#')[0]);
    });
    return [...new Set(out)];
}

async function loadScrapedBySku() {
    const bySku = new Map();
    const files = [
        path.join(__dirname, '../data/scraped-products.json'),
        path.join(__dirname, '../data/complete-scraped-products.json')
    ];
    for (const file of files) {
        try {
            const raw = await fsp.readFile(file, 'utf8');
            const data = JSON.parse(raw);
            for (const product of data.products || []) {
                const sku = String(product.sku || '').trim();
                if (!sku) continue;
                const key = sku.toUpperCase();
                const existing = bySku.get(key);
                const price = parseFloat(product.price);
                if (
                    !existing ||
                    (Number.isFinite(price) && price > 0 && (!existing.price || existing.price <= 0))
                ) {
                    bySku.set(key, {
                        sku: key,
                        url: product.url || null,
                        price: Number.isFinite(price) ? price : null,
                        images: Array.isArray(product.images) ? product.images : [],
                        name: product.name || ''
                    });
                }
            }
        } catch (e) {
            if (e.code !== 'ENOENT') console.warn(`Could not read ${file}:`, e.message);
        }
    }
    return bySku;
}

async function fetchProductPage(url) {
    const res = await axios.get(url, { headers: HEADERS, timeout: 20000, validateStatus: (s) => s < 500 });
    if (res.status >= 400) return null;
    const $ = cheerio.load(res.data);
    if (!$('h1').text() && !$('body').text().includes('Add to Cart')) return null;
    return { url, html: res.data, $ };
}

async function findPageBySku(sku, scraped) {
    const candidates = [];
    const seen = new Set();
    const add = (u) => {
        if (!u || seen.has(u)) return;
        seen.add(u);
        candidates.push(u);
    };

    if (scraped && scraped.url) add(scraped.url);

    for (const url of [...candidates]) {
        try {
            const page = await fetchProductPage(url);
            if (page) return page;
        } catch (_) {}
    }
    return null;
}

function resolveLiveData(page, sku, scraper, scraped) {
    const variant = extractVariantBySku(page.html, sku);
    if (variant) {
        return {
            price: variant.price,
            image: variant.imageUrl ? { url: variant.imageUrl, score: 100 } : null,
            imageCandidates: variant.imageCandidates || [],
            source: 'variationData'
        };
    }

    const pageSku = page.$('.store-product-sku span').first().text().trim().toUpperCase();
    const price =
        pageSku === String(sku).toUpperCase()
            ? extractPrice(page.$)
            : scraped && scraped.price != null
              ? scraped.price
              : extractPrice(page.$);
    const best = pickBestImage(scraper, page.html, sku, scraped);
    return {
        price,
        image: best,
        imageCandidates: best ? [best.url] : [],
        source: 'pdp'
    };
}

function fallbackFromScraped(scraped, sku) {
    if (!scraped) return null;
    const imgs = (scraped.images || [])
        .map((im) => im && im.url)
        .filter(Boolean)
        .sort((a, b) => {
            const score = (u) => {
                let s = 0;
                const x = String(u).toLowerCase();
                if (x.includes(String(sku).toLowerCase())) s += 50;
                if (!/\/cache\/thumb/i.test(x)) s += 10;
                return s;
            };
            return score(b) - score(a);
        });
    if (!scraped.price && !imgs.length) return null;
    return {
        price: scraped.price,
        image: imgs[0] ? { url: imgs[0], score: 40 } : null,
        imageCandidates: imgs,
        source: 'json'
    };
}

function safeSlugSegment(s) {
    return String(s || '')
        .replace(/[/\\?*:|"<>]/g, '-')
        .replace(/\s+/g, '-')
        .substring(0, 120);
}

function isValidImageBuffer(buf) {
    if (!buf || buf.length < 800) return false;
    const probe = buf.slice(0, 64).toString('ascii');
    if (/^<!DOCTYPE/i.test(probe) || /^<html/i.test(probe)) return false;
    if (buf[0] === 0xff && buf[1] === 0xd8) return true;
    if (buf[0] === 0x89 && buf[1] === 0x50) return true;
    if (buf[0] === 0x47 && buf[1] === 0x49) return true;
    return buf.slice(8, 12).toString('ascii') === 'WEBP';
}

function extFromMagic(buf) {
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
    if (buf[0] === 0x47 && buf[1] === 0x49) return 'gif';
    if (buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
    return 'jpg';
}

async function downloadImage(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 45000,
        headers: { ...HEADERS, Accept: 'image/*', Referer: `${BASE}/` },
        validateStatus: (s) => s === 200
    });
    const buf = Buffer.from(res.data);
    if (!isValidImageBuffer(buf)) throw new Error('invalid image buffer');
    return buf;
}

async function setPrimaryImage(pool, productId, productName, publicUrl, dryRun) {
    if (dryRun) return;
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

function pickBestImage(scraper, html, sku, scraped) {
    const $ = cheerio.load(html);
    const fromPage = scraper.extractImages($) || [];
    const fromJson = (scraped && scraped.images) || [];
    const merged = [...fromPage, ...fromJson.map((im) => ({ url: im.url, alt: im.alt || '' }))];
    const scored = merged
        .filter((im) => im && im.url && !CatalogScraper.isJunkProductImageUrl(im.url))
        .map((im) => {
            let score = 0;
            const u = String(im.url).toLowerCase();
            if (u.includes(String(sku))) score += 50;
            if (u.includes('product-main-img')) score += 20;
            if (!/\/cache\/thumb/i.test(u)) score += 10;
            if (u.includes('/application/files/') && !u.includes('i0.wp.com')) score += 8;
            return { ...im, score };
        })
        .sort((a, b) => b.score - a.score);
    return scored[0] || null;
}

async function main() {
    const { dryRun, force, pricesOnly, imagesOnly, limit } = parseArgs();
    await fsp.mkdir(IMAGES_DIR, { recursive: true });
    const scraper = new CatalogScraper({ domain: BASE });
    const scrapedIndex = await loadScrapedBySku();
    console.log(`Scrape index: ${scrapedIndex.size} numeric SKUs`);
    const pool = createPool({ connectionLimit: 3 });

    let sql = `SELECT p.id, p.slug, p.sku, p.name, p.price, pi.image_url
        FROM products p
        JOIN brands b ON p.brand_id = b.id
        LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
        WHERE b.slug = 'newton-labs' AND p.is_active = 1
        ORDER BY p.id`;
    if (limit) sql += ` LIMIT ${limit}`;
    const [rows] = await pool.query(sql);

    console.log(`Syncing ${rows.length} Newton Labs products from ${BASE}${dryRun ? ' (dry-run)' : ''}\n`);

    let priceUpdates = 0;
    let imageUpdates = 0;
    let failed = 0;
    const priceIssues = [];
    const imageIssues = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sku = catalogSku(row);
        const label = `${i + 1}/${rows.length} #${row.id} SKU ${sku || '?'}`;
        if (!sku) {
            console.error(`FAIL ${label} no catalog SKU`);
            failed++;
            continue;
        }
        if (i > 0) await new Promise((r) => setTimeout(r, 1100));

        const scraped = scrapedIndex.get(String(sku).toUpperCase()) || null;
        let live = null;
        let pageUrl = scraped && scraped.url ? scraped.url : null;

        try {
            const page = await findPageBySku(sku, scraped);
            if (page) {
                pageUrl = page.url;
                live = resolveLiveData(page, sku, scraper, scraped);
            }
        } catch (e) {
            console.error(`FAIL ${label} fetch: ${e.message}`);
            failed++;
            continue;
        }

        if (!live) {
            live = fallbackFromScraped(scraped, sku);
        }
        if (!live || (live.price == null && !live.image && !(live.imageCandidates || []).length)) {
            console.error(`FAIL ${label} no hmherbs data for SKU ${sku}`);
            failed++;
            continue;
        }

        const curPrice = parseFloat(row.price);
        const livePrice = live.price;
        const priceDiff = livePrice != null && Math.abs(curPrice - livePrice) > 0.01;

        if (!imagesOnly && livePrice != null && (priceDiff || force)) {
            if (dryRun) {
                console.log(
                    `[price] ${label}: $${curPrice.toFixed(2)} -> $${livePrice.toFixed(2)} (${live.source}${pageUrl ? ` ${pageUrl}` : ''})`
                );
            } else {
                await pool.execute('UPDATE products SET price = ?, updated_at = NOW() WHERE id = ?', [
                    livePrice,
                    row.id
                ]);
                console.log(`[price] ${label}: $${curPrice.toFixed(2)} -> $${livePrice.toFixed(2)} (${live.source})`);
            }
            priceUpdates++;
            if (priceDiff) priceIssues.push({ id: row.id, sku, db: curPrice, live: livePrice, url: pageUrl });
        }

        if (!pricesOnly) {
            const best = live.image || null;
            const downloadUrls = [
                ...(best ? [best.url] : []),
                ...(live.imageCandidates || []),
                ...((scraped && scraped.images) || []).map((im) => im.url)
            ].filter(Boolean);
            const uniqueUrls = [...new Set(downloadUrls)];

            if (!uniqueUrls.length) {
                console.error(`FAIL ${label} no image URL`);
                failed++;
                continue;
            }

            const stem = safeSlugSegment(row.slug || row.sku || `product-${row.id}`);
            const curImg = row.image_url || '';
            const curHasSku =
                curImg.includes(String(sku)) || curImg.includes(`product-main-img-${sku}`);
            if (!force && curHasSku) {
                console.log(`skip image ${label} already has SKU-matched image`);
                continue;
            }

            try {
                let buf = null;
                let winningUrl = null;
                for (const url of uniqueUrls) {
                    try {
                        buf = await downloadImage(url);
                        winningUrl = url;
                        break;
                    } catch (_) {}
                }
                if (!buf) throw new Error('all image URLs failed');

                const ext = extFromMagic(buf);
                const fileName = `${stem}-id${row.id}-hmherbs-primary.${ext}`;
                const fullPath = path.join(IMAGES_DIR, fileName);
                const publicUrl = `/images/products/${encodeURIComponent(fileName)}`;

                if (!dryRun) {
                    await fsp.writeFile(fullPath, buf);
                    await setPrimaryImage(pool, row.id, row.name, publicUrl, dryRun);
                }
                console.log(
                    `[image] ${label}: ${(curImg || '(none)').slice(-40)} -> ${fileName} (${buf.length} b) from ${winningUrl.slice(0, 90)}`
                );
                imageUpdates++;
            } catch (e) {
                console.error(`FAIL ${label} image download: ${e.message}`);
                imageIssues.push({ id: row.id, sku, error: e.message });
                failed++;
            }
        }
    }

    await pool.end();
    console.log('\n' + '='.repeat(60));
    console.log(`Price updates: ${priceUpdates}`);
    console.log(`Image updates: ${imageUpdates}`);
    console.log(`Failed: ${failed}`);
    if (priceIssues.length) {
        console.log('\nPrice corrections:');
        console.log(JSON.stringify(priceIssues, null, 2));
    }
    console.log('='.repeat(60));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
