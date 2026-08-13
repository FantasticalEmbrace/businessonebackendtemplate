/**
 * Resolve product pack-shot URLs by loading pages on the manufacturer's own site * (Open Graph, Twitter card, JSON-LD, common gallery selectors).
 *
 * Discovery order:
 *   1. DuckDuckGo HTML "site:branddomain + query" to find PDP URLs
 *   2. Optional direct /search?q= on the brand origin (Shopify-style)
 *
 * Exported for use from fetch-hmherbs-product-images.js when hmherbs + JSON fail.
 */
const axios = require('axios');
const cheerio = require('cheerio');

const DEFAULT_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

/** When brands.website_url is empty, guess manufacturer homepages by name. */
const BRAND_WEBSITE_FALLBACKS = [
    { re: /life\s*extension/i, url: 'https://www.lifeextension.com' },
    { re: /life[- ]?flo/i, url: 'https://www.lifeflo.com' },
    { re: /nature'?s\s+plus/i, url: 'https://www.naturesplus.com' },
    { re: /nature'?s\s+sunshine/i, url: 'https://www.naturessunshine.com' },
    { re: /irwin/i, url: 'https://www.irwinnaturals.com' },
    { re: /hemp\s*bombs/i, url: 'https://hempbombs.com' },
    { re: /now\s*foods/i, url: 'https://www.nowfoods.com' },
    { re: /terry\s*naturally/i, url: 'https://www.terrynaturally.com' },
    { re: /buried\s*treasure/i, url: 'https://www.buriedtreasure.com' },
    { re: /north\s*american\s*herb/i, url: 'https://www.northamericanherbandspice.com' },
    { re: /newton/i, url: 'https://www.newtonlabs.net' },
    { re: /standard\s*enzyme/i, url: 'https://www.standardprocess.com' },
    { re: /regal\s*labs/i, url: 'https://www.regalabs.com' },
    { re: /perrin/i, url: 'https://www.perrinsnaturals.com' },
    { re: /our\s*father'?s\s*healing/i, url: 'https://www.ourfathershealingherbs.com' },
    { re: /cardio\s*amaze/i, url: 'https://www.cardioamaze.com' },
    { re: /doctor'?s\s*blend/i, url: 'https://www.doctorsblend.com' },
];

function normalizeWebsiteUrl(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const t = raw.trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    return `https://${t.replace(/^\/+/, '')}`;
}

function resolveBrandWebsite(brandName, websiteUrlFromDb) {
    const fromDb = normalizeWebsiteUrl(websiteUrlFromDb);
    if (fromDb) return fromDb;
    const name = brandName || '';
    for (const { re, url } of BRAND_WEBSITE_FALLBACKS) {
        if (re.test(name)) return url;
    }
    return null;
}

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

function cleanProductQuery(name) {
    let s = String(name || '')
        .replace(/\bfree\s*shipping\b/gi, '')
        .replace(/\s*sku\s*:\s*[A-Za-z0-9-]+/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (s.length > 120) s = s.slice(0, 120);
    return s || String(name || '').trim();
}

function hostnameMatchesBrand(urlStr, brandHostname) {
    try {
        const h = baseHost(new URL(urlStr).hostname);
        const b = baseHost(brandHostname);
        return h === b || h.endsWith(`.${b}`);
    } catch {
        return false;
    }
}

/** Prefer product detail URLs over category pages. */
function scorePdpUrl(u) {
    let s = 0;
    const x = u.toLowerCase();
    if (/\/item\d+/i.test(x)) s += 55;
    if (/\/products\/[^/]+/i.test(x)) s += 45;
    if (/\/p\/[^/]+/i.test(x)) s += 40;
    if (x.includes('/product/')) s += 35;
    if (x.includes('/collections/')) s -= 25;
    if ((x.match(/\//g) || []).length <= 3) s -= 15;
    return s;
}

function sortPdpFirst(urls) {
    const uniq = [...new Set(urls)];
    uniq.sort((a, b) => scorePdpUrl(b) - scorePdpUrl(a));
    return uniq;
}

/**
 * Brave Search HTML (works from datacenters where DDG/Bing return empty/bot pages).
 */
async function braveSiteLinks(brandHostname, query) {
    const q = `site:${baseHost(brandHostname)} ${query}`;
    try {
        const res = await axios.get('https://search.brave.com/search', {
            params: { q },
            headers: DEFAULT_HEADERS,
            timeout: 22000,
            maxRedirects: 5,
            validateStatus: (s) => s >= 200 && s < 400
        });
        const $ = cheerio.load(res.data);
        const out = [];
        $('a[href^="http"]').each((_, el) => {
            const h = $(el).attr('href');
            if (h && hostnameMatchesBrand(h, brandHostname)) out.push(h);
        });
        return sortPdpFirst(out);
    } catch {
        return [];
    }
}

async function tryBrandSearchPage(origin, query) {
    const base = origin.replace(/\/$/, '');
    const urls = [
        `${base}/search?q=${encodeURIComponent(query)}`,
        `${base}/search?type=product&q=${encodeURIComponent(query)}`
    ];
    for (const u of urls) {
        try {
            const res = await axios.get(u, { headers: DEFAULT_HEADERS, timeout: 15000, validateStatus: () => true });
            if (res.status < 200 || res.status >= 400) continue;
            const $ = cheerio.load(res.data);
            const links = [];
            $('a[href*="/products/"], a[href*="/product/"], a[href*="/p/"]').each((_, el) => {
                let h = $(el).attr('href');
                if (!h) return;
                if (h.startsWith('/')) h = new URL(h, base).href;
                if (/^https?:\/\//i.test(h)) links.push(h);
            });
            if (links.length) return [...new Set(links)].slice(0, 8);
        } catch {
            /* next */
        }
    }
    return [];
}

function isJunkImageUrl(url) {
    if (!url || typeof url !== 'string') return true;
    const x = url.toLowerCase();
    const bad = [
        'logo',
        'icon',
        'favicon',
        'placeholder',
        'spinner',
        '1x1',
        'pixel',
        'bat.bing',
        'gravatar',
        '.svg',
        'banner',
        'searchbann'
    ];
    return bad.some((b) => x.includes(b));
}

function absolutize(url, pageUrl) {
    if (!url) return null;
    const t = String(url).trim();
    if (!t) return null;
    try {
        if (t.startsWith('//')) return `https:${t}`;
        if (/^https?:\/\//i.test(t)) return t;
        return new URL(t, pageUrl).href;
    } catch {
        return null;
    }
}

/**
 * Pull candidate image URLs from a product/detail page HTML.
 * Images may be on a CDN; caller should only trust URLs found on pages hosted on the brand domain.
 */
function extractImageUrlsFromProductHtml(html, pageUrl) {
    const $ = cheerio.load(html);
    const ordered = [];

    const push = (u) => {
        const abs = absolutize(u, pageUrl);
        if (abs && !isJunkImageUrl(abs)) ordered.push(abs);
    };

    push($('meta[property="og:image"]').attr('content'));
    push($('meta[property="og:image:secure_url"]').attr('content'));
    push($('meta[name="twitter:image"]').attr('content'));
    push($('meta[name="twitter:image:src"]').attr('content'));

    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const j = JSON.parse($(el).html() || '{}');
            const nodes = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
            for (const item of nodes) {
                if (!item || item['@type'] !== 'Product') continue;
                const img = item.image;
                if (typeof img === 'string') push(img);
                else if (Array.isArray(img)) img.forEach((x) => push(typeof x === 'string' ? x : x && x.url));
                else if (img && img.url) push(img.url);
            }
        } catch {
            /* ignore */
        }
    });

    const selectors = [
        '.product__media img',
        '.product-single__photo img',
        '.product-gallery img',
        '.product__image img',
        'img.product-image',
        '.product-image img',
        '.product-photo img',
        '[data-product-image] img',
        'figure.product img'
    ];
    for (const sel of selectors) {
        $(sel).each((_, el) => {
            const $el = $(el);
            push($el.attr('src') || $el.attr('data-src') || $el.attr('data-original'));
        });
    }

    const seen = new Set();
    const uniq = [];
    for (const u of ordered) {
        if (seen.has(u)) continue;
        seen.add(u);
        uniq.push(u);
    }
    return uniq;
}

async function fetchHtml(url) {
    const res = await axios.get(url, {
        headers: DEFAULT_HEADERS,
        timeout: 20000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400
    });
    return res.data;
}

/**
 * @param {object} opts
 * @param {string} opts.productName
 * @param {string} [opts.brandName]
 * @param {string|null} [opts.websiteUrl] brands.website_url from DB
 * @returns {Promise<string[]>} Image URLs (https), best-effort order
 */
async function getManufacturerImageUrls(opts) {
    const productName = opts.productName || '';
    const brandName = opts.brandName || '';
    const origin = resolveBrandWebsite(brandName, opts.websiteUrl);
    if (!origin) return [];

    let brandHostname;
    try {
        brandHostname = new URL(origin).hostname;
    } catch {
        return [];
    }

    const queries = [];
    const q1 = cleanProductQuery(productName);
    if (q1) queries.push(q1);
    const words = q1.split(/\s+/).filter(Boolean);
    if (words.length > 8) queries.push(words.slice(0, 8).join(' '));
    if (words.length > 4) queries.push(words.slice(0, 4).join(' '));

    const pageUrls = [];
    for (const q of queries) {
        const found = await braveSiteLinks(brandHostname, q);
        for (const u of found) {
            if (pageMatchesBrand(u, brandHostname) && !pageUrls.includes(u)) pageUrls.push(u);
        }
        if (pageUrls.length >= 6) break;
        await new Promise((r) => setTimeout(r, 600));
    }

    if (pageUrls.length < 3) {
        for (const q of queries.slice(0, 2)) {
            const extra = await tryBrandSearchPage(origin, q);
            for (const u of extra) {
                if (pageMatchesBrand(u, brandHostname) && !pageUrls.includes(u)) pageUrls.push(u);
            }
        }
    }

    const candidates = [];
    const seen = new Set();
    for (const pageUrl of pageUrls.slice(0, 5)) {
        try {
            const html = await fetchHtml(pageUrl);
            const imgs = extractImageUrlsFromProductHtml(html, pageUrl);
            for (const im of imgs) {
                if (seen.has(im)) continue;
                seen.add(im);
                candidates.push(im);
            }
        } catch {
            /* next page */
        }
        await new Promise((r) => setTimeout(r, 350));
    }

    return candidates;
}

module.exports = {
    getManufacturerImageUrls,
    resolveBrandWebsite,
    cleanProductQuery
};
