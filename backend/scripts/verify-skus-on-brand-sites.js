#!/usr/bin/env node
/**
 * Verify product SKUs against manufacturer brand websites (not hmherbs.com).
 * Uses DuckDuckGo/Brave site search + JSON-LD sku/mpn on brand PDPs.
 *
 * Usage:
 *   node scripts/verify-skus-on-brand-sites.js --limit=50
 *   node scripts/verify-skus-on-brand-sites.js --apply-report
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const {
    extractCatalogSkuFromProduct,
    isReservedInternalSku,
    normalizeCatalogSku,
} = require('../utils/extractCatalogSku');
const {
    resolveBrandWebsite,
    cleanProductQuery,
} = require('./manufacturer-site-images');

loadBackendEnv();

const LIMIT = (() => {
    const m = process.argv.find((a) => a.startsWith('--limit='));
    return m ? parseInt(m.split('=')[1], 10) : 0;
})();
const DELAY_MS = 800;

const SKIP_NAMES = new Set(['Featured Products', 'Shop']);

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function extractSkusFromHtml(html) {
    const found = new Set();
    const $ = cheerio.load(html);
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const j = JSON.parse($(el).html() || '{}');
            const nodes = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
            for (const item of nodes) {
                if (!item) continue;
                if (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product'))) {
                    for (const key of ['sku', 'mpn', 'productID']) {
                        if (item[key]) found.add(normalizeCatalogSku(String(item[key])));
                    }
                }
            }
        } catch {
            /* ignore */
        }
    });
    const bodyText = $.text();
    const inline = bodyText.match(/\bSKU\s*[#:]?\s*([A-Z0-9-]{2,20})\b/gi) || [];
    inline.forEach((m) => {
        const part = m.match(/([A-Z0-9-]{2,20})$/i);
        if (part) found.add(normalizeCatalogSku(part[1]));
    });
    return [...found];
}

async function searchBrandPdp(brandUrl, query) {
    const hostname = new URL(brandUrl).hostname;
    const q = `site:${hostname.replace(/^www\./, '')} ${query}`;
    try {
        const res = await axios.get('https://search.brave.com/search', {
            params: { q },
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 22000,
        });
        const $ = cheerio.load(res.data);
        const links = [];
        $('a[href^="http"]').each((_, el) => {
            const h = $(el).attr('href');
            if (h && h.includes(hostname.replace(/^www\./, ''))) links.push(h);
        });
        return links[0] || null;
    } catch {
        return null;
    }
}

async function verifyProduct(row) {
    const expected = normalizeCatalogSku(row.sku);
    const brandUrl = resolveBrandWebsite(row.brand_name, row.website_url);
    if (!brandUrl) {
        return { status: 'no-brand-site', expected, brandSiteSku: null, pdpUrl: null };
    }

    const queries = [expected, cleanProductQuery(row.name)].filter(Boolean);
    let pdpUrl = null;
    for (const q of queries) {
        pdpUrl = await searchBrandPdp(brandUrl, q);
        if (pdpUrl) break;
        await sleep(DELAY_MS);
    }
    if (!pdpUrl) {
        return { status: 'not-found-on-brand', expected, brandSiteSku: null, pdpUrl: null };
    }

    try {
        const res = await axios.get(pdpUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0' },
            timeout: 20000,
        });
        const brandSkus = extractSkusFromHtml(res.data);
        const match = brandSkus.some(
            (s) => s === expected || s.includes(expected) || expected.includes(s)
        );
        if (match) {
            return { status: 'verified', expected, brandSiteSku: brandSkus.join(','), pdpUrl };
        }
        if (brandSkus.length) {
            return { status: 'mismatch', expected, brandSiteSku: brandSkus.join(','), pdpUrl };
        }
        if (res.data.toUpperCase().includes(expected)) {
            return { status: 'verified-text', expected, brandSiteSku: expected, pdpUrl };
        }
        return { status: 'inconclusive', expected, brandSiteSku: null, pdpUrl };
    } catch {
        return { status: 'fetch-error', expected, brandSiteSku: null, pdpUrl };
    }
}

async function main() {
    const pool = createPool();
    const [products] = await pool.query(`
        SELECT p.id, p.sku, p.slug, p.name, b.name AS brand_name, b.website_url
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        ORDER BY p.id
    `);

    let rows = products.filter((p) => !SKIP_NAMES.has(p.name) && !isReservedInternalSku(p.sku));
    if (LIMIT > 0) rows = rows.slice(0, LIMIT);

    const results = [];
    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const label = `[${i + 1}/${rows.length}] #${row.id} ${row.sku}`;
        process.stdout.write(`${label} … `);
        const result = await verifyProduct(row);
        console.log(result.status);
        results.push({
            id: row.id,
            sku: row.sku,
            name: row.name,
            brand: row.brand_name,
            slug: row.slug,
            ...result,
        });
        await sleep(DELAY_MS);
    }

    const summary = results.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
    }, {});

    const outPath = path.join(__dirname, '../data/sku-brand-verify-report.json');
    fs.writeFileSync(
        outPath,
        JSON.stringify({ summary, results, generatedAt: new Date().toISOString() }, null, 2)
    );
    console.log('\nSummary:', summary);
    console.log(`Report: ${outPath}`);
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
