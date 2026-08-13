#!/usr/bin/env node
/**
 * Compare Newton Labs products in DB vs live hmherbs.com (price + primary image).
 * Usage: node scripts/audit-newton-vs-hmherbs.js [--limit N]
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');

loadBackendEnv();

const envFile = path.join(__dirname, '../../deploy/db-connection.env');
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) process.env[m[1]] = m[2];
    }
    process.env.DB_SSL_CA = path.join(__dirname, '../../deploy/hmherbs-miami-ca-certificate.crt');
}

const BASE = process.env.CATALOG_SCRAPE_DOMAIN || 'https://hmherbs.com';
const HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 && process.argv[limitArg + 1] ? parseInt(process.argv[limitArg + 1], 10) : null;

function extractPrice($) {
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
                    if (p > 0 && p < 10000) {
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

function extractImage($) {
    const og = $('meta[property="og:image"]').attr('content');
    if (og) return og.trim();
    const src = $('.product-image img, .store-product-image img, img.product-image, .product-details img')
        .first()
        .attr('src');
    return src ? src.trim() : null;
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
    return urls;
}

async function scrapeLive(row) {
    for (const url of productPageUrls(row)) {
        try {
            const res = await axios.get(url, { headers: HEADERS, timeout: 15000, validateStatus: (s) => s < 500 });
            if (res.status === 404) continue;
            const $ = cheerio.load(res.data);
            const h1 = $('h1').first().text();
            if (!h1.includes('SKU:') && !$('body').text().includes('Add to Cart')) continue;
            return { price: extractPrice($), image: extractImage($), url, h1: h1.slice(0, 80) };
        } catch (_) {
            /* next */
        }
    }
    return null;
}

async function main() {
    const pool = createPool({ connectionLimit: 3 });
    let sql = `SELECT p.id, p.sku, p.slug, p.name, p.price, pi.image_url
        FROM products p
        JOIN brands b ON p.brand_id = b.id
        LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
        WHERE b.slug = 'newton-labs' AND p.is_active = 1
        ORDER BY p.id`;
    if (limit) sql += ` LIMIT ${limit}`;
    const [rows] = await pool.query(sql);

    console.log(`Auditing ${rows.length} Newton Labs products vs ${BASE}\n`);

    let priceMismatch = 0;
    let scrapeFail = 0;
    let imgMissing = 0;
    const issues = [];

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, 900));
        const live = await scrapeLive(r);
        if (!live) {
            scrapeFail++;
            issues.push({ id: r.id, sku: r.sku, issue: 'no_live_page' });
            continue;
        }
        const cur = parseFloat(r.price);
        if (!Number.isFinite(live.price) || Math.abs(cur - live.price) > 0.01) {
            priceMismatch++;
            issues.push({
                id: r.id,
                sku: r.sku,
                issue: 'price',
                db: cur,
                live: live.price,
                url: live.url
            });
        }
        const img = (r.image_url || '').trim();
        if (!img) imgMissing++;
    }

    console.log(`Price mismatches: ${priceMismatch}`);
    console.log(`No live page: ${scrapeFail}`);
    console.log(`Missing DB image: ${imgMissing}`);
    console.log('\nIssues sample:');
    console.log(JSON.stringify(issues.slice(0, 20), null, 2));
    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
