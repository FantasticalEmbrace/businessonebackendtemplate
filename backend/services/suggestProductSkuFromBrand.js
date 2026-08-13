/**
 * Look up a product's manufacturer SKU by searching the brand's own website.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const { normalizeCatalogSku } = require('../utils/extractCatalogSku');

const DEFAULT_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const manufacturerSiteImages = require('../scripts/manufacturer-site-images');

const { resolveBrandWebsite, cleanProductQuery } = manufacturerSiteImages;

function baseHost(hostname) {
    return String(hostname || '')
        .toLowerCase()
        .replace(/^www\./, '');
}

function pageMatchesBrand(pageUrl, brandHostname) {
    try {
        const h = baseHost(new URL(pageUrl).hostname);
        const b = baseHost(brandHostname);
        return h === b || h.endsWith(`.${b}`);
    } catch {
        return false;
    }
}

function scorePdpUrl(u) {
    let s = 0;
    const x = String(u).toLowerCase();
    if (/\/item\d+/i.test(x)) s += 55;
    if (/\/products\/[^/]+/i.test(x)) s += 45;
    if (/\/p\/[^/]+/i.test(x)) s += 40;
    if (x.includes('/product/')) s += 35;
    if (x.includes('/collections/')) s -= 25;
    return s;
}

function isJunkSku(value) {
    const s = String(value || '').trim().toUpperCase();
    if (!s || s.length < 2 || s.length > 24) return true;
    if (/^(SKU|ITEM|PRODUCT|N\/A|NA|NONE|TBD)$/.test(s)) return true;
    if (/^HM-[A-Z0-9-]+$/.test(s)) return true;
    return false;
}

function extractSkusFromHtml(html) {
    const found = new Set();
    const $ = cheerio.load(html);

    $('[itemprop="sku"], [data-product-sku], [data-sku]').each((_, el) => {
        const v =
            $(el).attr('content') ||
            $(el).attr('data-product-sku') ||
            $(el).attr('data-sku') ||
            $(el).text();
        if (v) found.add(normalizeCatalogSku(String(v).trim()));
    });

    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const j = JSON.parse($(el).html() || '{}');
            const nodes = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
            for (const item of nodes) {
                if (!item) continue;
                const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
                if (!types.includes('Product')) continue;
                for (const key of ['sku', 'mpn', 'productID']) {
                    if (item[key]) found.add(normalizeCatalogSku(String(item[key])));
                }
            }
        } catch {
            /* ignore */
        }
    });

    const bodyText = $.text();
    const inline = bodyText.match(/\b(?:SKU|Item\s*#?|Model\s*#?)\s*[:#]?\s*([A-Z0-9-]{2,24})\b/gi) || [];
    inline.forEach((m) => {
        const part = m.match(/([A-Z0-9-]{2,24})$/i);
        if (part) found.add(normalizeCatalogSku(part[1]));
    });

    return [...found].filter((s) => !isJunkSku(s));
}

async function braveSiteLinks(brandHostname, query) {
    const q = `site:${baseHost(brandHostname)} ${query}`;
    try {
        const res = await axios.get('https://search.brave.com/search', {
            params: { q },
            headers: DEFAULT_HEADERS,
            timeout: 22000,
        });
        const $ = cheerio.load(res.data);
        const out = [];
        $('a[href^="http"]').each((_, el) => {
            const h = $(el).attr('href');
            if (h && pageMatchesBrand(h, brandHostname)) out.push(h);
        });
        out.sort((a, b) => scorePdpUrl(b) - scorePdpUrl(a));
        return [...new Set(out)];
    } catch {
        return [];
    }
}

async function tryBrandSearchPage(origin, query) {
    const base = origin.replace(/\/$/, '');
    const urls = [
        `${base}/search?q=${encodeURIComponent(query)}`,
        `${base}/search?type=product&q=${encodeURIComponent(query)}`,
    ];
    const links = [];
    for (const u of urls) {
        try {
            const res = await axios.get(u, {
                headers: DEFAULT_HEADERS,
                timeout: 15000,
                validateStatus: (s) => s >= 200 && s < 400,
            });
            const $ = cheerio.load(res.data);
            $('a[href*="/products/"], a[href*="/product/"], a[href*="/p/"]').each((_, el) => {
                let h = $(el).attr('href');
                if (!h) return;
                if (h.startsWith('/')) h = new URL(h, base).href;
                if (/^https?:\/\//i.test(h)) links.push(h);
            });
            if (links.length) break;
        } catch {
            /* next */
        }
    }
    links.sort((a, b) => scorePdpUrl(b) - scorePdpUrl(a));
    return [...new Set(links)];
}

function buildSearchQueries(productName) {
    const queries = [];
    const q1 = cleanProductQuery(productName);
    if (q1) queries.push(q1);
    const words = q1.split(/\s+/).filter(Boolean);
    if (words.length > 6) queries.push(words.slice(0, 6).join(' '));
    if (words.length > 3) queries.push(words.slice(0, 3).join(' '));
    return [...new Set(queries.filter(Boolean))];
}

async function findBrandProductPages(brandUrl, productName) {
    let brandHostname;
    try {
        brandHostname = new URL(brandUrl).hostname;
    } catch {
        return [];
    }

    const queries = buildSearchQueries(productName);
    const pageUrls = [];

    for (const q of queries) {
        const found = await braveSiteLinks(brandHostname, q);
        for (const u of found) {
            if (!pageUrls.includes(u)) pageUrls.push(u);
        }
        if (pageUrls.length >= 5) break;
    }

    if (pageUrls.length < 3) {
        for (const q of queries.slice(0, 2)) {
            const extra = await tryBrandSearchPage(brandUrl, q);
            for (const u of extra) {
                if (pageMatchesBrand(u, brandHostname) && !pageUrls.includes(u)) {
                    pageUrls.push(u);
                }
            }
        }
    }

    pageUrls.sort((a, b) => scorePdpUrl(b) - scorePdpUrl(a));
    return pageUrls.slice(0, 5);
}

function loadCompleteScrapedIndex() {
    const file = path.join(__dirname, '../data/complete-scraped-products.json');
    if (!fs.existsSync(file)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return data.products || [];
    } catch {
        return [];
    }
}

function lookupCatalogSkuByName(productName) {
    const needle = cleanProductQuery(productName).toLowerCase();
    if (!needle || needle.length < 4) return null;

    const products = loadCompleteScrapedIndex();
    let best = null;
    let bestScore = 0;

    for (const row of products) {
        const sku = normalizeCatalogSku(row.sku);
        if (isJunkSku(sku)) continue;
        const rowName = cleanProductQuery(row.name).toLowerCase();
        if (!rowName) continue;

        let score = 0;
        if (rowName === needle) score = 100;
        else if (rowName.includes(needle) || needle.includes(rowName)) score = 70;
        else {
            const words = needle.split(/\s+/).filter((w) => w.length > 2);
            const hits = words.filter((w) => rowName.includes(w)).length;
            score = words.length ? Math.round((hits / words.length) * 60) : 0;
        }

        if (score > bestScore) {
            bestScore = score;
            best = { sku, score, source: 'catalog-index', name: row.name };
        }
    }

    return bestScore >= 45 ? best : null;
}

function pickBestSku(candidates) {
    const clean = [...new Set(candidates.filter((s) => !isJunkSku(s)))];
    if (!clean.length) return null;
    clean.sort((a, b) => {
        const aNum = /^\d+$/.test(a);
        const bNum = /^\d+$/.test(b);
        if (aNum && !bNum) return -1;
        if (!aNum && bNum) return 1;
        return a.length - b.length;
    });
    return clean[0];
}

async function suggestProductSkuFromBrand({ productName, brandName, websiteUrl }) {
    const name = String(productName || '').trim();
    if (!name) {
        return { ok: false, reason: 'missing-name', message: 'Enter a product name first.' };
    }

    const brandUrl = resolveBrandWebsite(brandName, websiteUrl);
    if (!brandUrl) {
        const catalogHit = lookupCatalogSkuByName(name);
        if (catalogHit) {
            return {
                ok: true,
                sku: catalogHit.sku,
                source: catalogHit.source,
                pdpUrl: null,
                brandWebsite: null,
                message: 'Found catalog SKU (no brand website configured for this brand).',
            };
        }
        return {
            ok: false,
            reason: 'no-brand-site',
            message: `No manufacturer website is configured for "${brandName || 'this brand'}". Add a website on the brand or pick a brand with a known site.`,
        };
    }

    const pageUrls = await findBrandProductPages(brandUrl, name);
    if (!pageUrls.length) {
        const catalogHit = lookupCatalogSkuByName(name);
        if (catalogHit) {
            return {
                ok: true,
                sku: catalogHit.sku,
                source: 'catalog-index-fallback',
                pdpUrl: null,
                brandWebsite: brandUrl,
                message: 'Product page not found on brand site; used catalog index match.',
            };
        }
        return {
            ok: false,
            reason: 'not-found',
            brandWebsite: brandUrl,
            message: 'Could not find this product on the manufacturer website. Try a shorter product name or enter the SKU manually.',
        };
    }

    const allCandidates = [];
    let bestPage = null;

    for (const pageUrl of pageUrls) {
        try {
            const res = await axios.get(pageUrl, {
                headers: DEFAULT_HEADERS,
                timeout: 20000,
                validateStatus: (s) => s >= 200 && s < 400,
            });
            const skus = extractSkusFromHtml(res.data);
            if (skus.length) {
                allCandidates.push(...skus);
                if (!bestPage) bestPage = { pageUrl, skus };
            }
        } catch {
            /* try next page */
        }
    }

    const sku = pickBestSku(allCandidates);
    if (!sku) {
        return {
            ok: false,
            reason: 'no-sku-on-page',
            brandWebsite: brandUrl,
            pdpUrl: pageUrls[0],
            message: 'Found a product page on the brand site but could not read a SKU from it. Enter the SKU manually or scan the barcode.',
        };
    }

    return {
        ok: true,
        sku,
        source: 'brand-website',
        pdpUrl: bestPage?.pageUrl || pageUrls[0],
        brandWebsite: brandUrl,
        candidates: [...new Set(allCandidates)],
        message: 'Manufacturer SKU found on brand website.',
    };
}

module.exports = {
    suggestProductSkuFromBrand,
    extractSkusFromHtml,
};
