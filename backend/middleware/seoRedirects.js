/**
 * Loads pathname → target mappings from a CSV at the project root and issues 301 redirects.
 *
 * File: SEO_REDIRECTS_FILE env (default redirects-301.csv), two columns: from_path,to_path
 * - from_path: pathname only, e.g. /old-blog/article (no domain, no query string)
 * - to_path: relative (/new-path) or absolute (https://...)
 *
 * Reloads periodically so you can update the CSV without restarting (production: every 120s).
 *
 * Magento/Concrete legacy product URLs (`/index.php/products/:slug`) always 301 somewhere:
 * CSV hit → that target; else product-slug-aliases / DB slug / collapsed-slug fuzzy → product.html;
 * else search fallback. Never fall through to Express `Cannot GET`.
 */

const fs = require('fs');
const path = require('path');
const { STOREFRONT_VISIBLE_WHERE } = require('../utils/storefrontProductVisibility');
const { findProductSlugWithFallback } = require('../utils/productSlugResolution');

const INDEXPHP_PRODUCT_RE = /^\/index\.php\/products\/([^/]+)$/i;

function normalizePathname(p) {
    if (!p || p === '/') {
        return '/';
    }
    let s = String(p).trim();
    try {
        if (s.startsWith('http://') || s.startsWith('https://')) {
            s = new URL(s).pathname || '/';
        }
    } catch {
        return '/';
    }
    if (!s.startsWith('/')) {
        s = `/${s}`;
    }
    const noTrail = s.replace(/\/+$/, '');
    return noTrail === '' ? '/' : noTrail;
}

function collapseSlug(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function parseRedirectCsv(text) {
    const map = new Map();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        if (/^from_path\s*,/i.test(trimmed)) {
            continue;
        }
        const comma = trimmed.indexOf(',');
        if (comma <= 0) {
            continue;
        }
        const fromRaw = trimmed.slice(0, comma).trim();
        const toRaw = trimmed.slice(comma + 1).trim();
        if (!fromRaw || !toRaw) {
            continue;
        }
        const fromKey = normalizePathname(fromRaw);
        if (fromKey === '/') {
            continue;
        }
        map.set(fromKey, toRaw);
    }
    return map;
}

function resolveRedirectFileList(rootPath) {
    const envList = String(process.env.SEO_REDIRECTS_FILES || '').trim();
    if (envList) {
        return envList
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean)
            .map((f) => (path.isAbsolute(f) ? f : path.join(rootPath, f)));
    }
    const single = process.env.SEO_REDIRECTS_FILE || 'redirects-301.csv';
    const files = [path.join(rootPath, single)];
    if (single === 'redirects-301.csv') {
        for (const name of [
            'redirects-legacy-sitemap.csv',
            'redirects-products-db.csv',
            'redirects-slug-aliases.csv',
            'redirects-scraped-indexphp.csv',
            'redirects-category-aliases.csv',
        ]) {
            const fp = path.join(rootPath, name);
            if (fs.existsSync(fp)) {
                files.push(fp);
            }
        }
    }
    return files;
}

/** Old product.html?slug= values → canonical slug (from redirects-product-slug-aliases.csv). */
function parseProductSlugAliasCsv(text) {
    const map = new Map();
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (/^old_slug\s*,/i.test(trimmed)) continue;
        const comma = trimmed.indexOf(',');
        if (comma <= 0) continue;
        const from = trimmed.slice(0, comma).trim();
        const to = trimmed.slice(comma + 1).trim();
        if (from && to && from !== to) map.set(from, to);
    }
    return map;
}

function productSlugAliasFile(rootPath) {
    return path.join(rootPath, 'redirects-product-slug-aliases.csv');
}

function productRedirectLocation(slug) {
    return `/product.html?slug=${encodeURIComponent(slug)}`;
}

function searchRedirectLocation(legacySlug) {
    const q = String(legacySlug || '')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return `/products.html?search=${encodeURIComponent(q || legacySlug)}`;
}

/**
 * Resolve a Magento/Concrete product slug to a 301 Location without a CSV row.
 * Uses slug aliases, exact DB slug, then collapsed-slug fuzzy (handles slash-stripped
 * forms like rheumatismarth → rheumatism-arthritis).
 */
function resolveLegacyIndexPhpProductSlug(legacySlug, { productSlugAliases, productSlugs, collapsedToSlug }) {
    const raw = String(legacySlug || '')
        .trim()
        .toLowerCase();
    if (!raw) return null;

    const candidates = [raw];
    const stripped = raw.replace(/-\d+$/, '');
    if (stripped && stripped !== raw) candidates.push(stripped);
    const stripped2 = stripped.replace(/-\d+$/, '');
    if (stripped2 && stripped2 !== stripped) candidates.push(stripped2);

    for (const cand of candidates) {
        const aliased = productSlugAliases.get(cand);
        if (aliased) {
            if (aliased.startsWith('/') || aliased.startsWith('http://') || aliased.startsWith('https://')) {
                return aliased;
            }
            const aliasedSlug = String(aliased).trim().toLowerCase();
            // Only send to product.html when the canonical slug is in the live index.
            if (productSlugs.has(aliasedSlug)) {
                return productRedirectLocation(aliasedSlug);
            }
        }
        if (productSlugs.has(cand)) {
            return productRedirectLocation(cand);
        }
        const collapsed = collapseSlug(cand);
        if (!collapsed) continue;
        const exactCollapsed = collapsedToSlug.get(collapsed);
        if (exactCollapsed) {
            return productRedirectLocation(exactCollapsed);
        }
        // Prefix / near-prefix: Magento often dropped "/" and truncated (rheumatismarth).
        let best = null;
        let bestExtra = Infinity;
        for (const [cSlug, realSlug] of collapsedToSlug) {
            if (!cSlug.startsWith(collapsed)) continue;
            const extra = cSlug.length - collapsed.length;
            // Allow modest remainder (e.g. "ritis" from arthritis) but avoid tiny legacy stubs.
            if (extra > 16) continue;
            if (collapsed.length < 10 && extra > 4) continue;
            if (extra < bestExtra) {
                bestExtra = extra;
                best = realSlug;
            }
        }
        if (best) {
            return productRedirectLocation(best);
        }
    }

    return searchRedirectLocation(raw);
}

function createSeoRedirectMiddleware({ rootPath, logger, reloadMs = 120000, pool = null } = {}) {
    const filePaths = resolveRedirectFileList(rootPath);
    const slugAliasPath = productSlugAliasFile(rootPath);
    let map = new Map();
    let productSlugAliases = new Map();
    /** @type {Set<string>} */
    let productSlugs = new Set();
    /** @type {Map<string, string>} collapsed alphanum → canonical slug */
    let collapsedToSlug = new Map();
    /** @type {Map<string, number>} */
    const mtimes = new Map();

    function load() {
        try {
            const merged = new Map();
            const loadedNames = [];
            for (const filePath of filePaths) {
                if (!fs.existsSync(filePath)) {
                    continue;
                }
                mtimes.set(filePath, fs.statSync(filePath).mtimeMs);
                const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
                for (const [k, v] of parseRedirectCsv(text)) {
                    merged.set(k, v);
                }
                loadedNames.push(path.basename(filePath));
            }
            map = merged;
            if (fs.existsSync(slugAliasPath)) {
                mtimes.set(slugAliasPath, fs.statSync(slugAliasPath).mtimeMs);
                productSlugAliases = parseProductSlugAliasCsv(
                    fs.readFileSync(slugAliasPath, 'utf8').replace(/^\uFEFF/, '')
                );
                loadedNames.push(path.basename(slugAliasPath));
            } else {
                productSlugAliases = new Map();
            }
            if (logger && typeof logger.info === 'function' && loadedNames.length) {
                logger.info(
                    `SEO 301 redirects loaded (${map.size} path rules, ${productSlugAliases.size} slug aliases) from ${loadedNames.join(', ')}`
                );
            }
        } catch (e) {
            map = new Map();
            productSlugAliases = new Map();
            if (logger && typeof logger.warn === 'function') {
                logger.warn(`SEO redirects: load failed: ${e.message}`);
            }
        }
    }

    let productIndexLoading = null;

    async function loadProductSlugs(dbPool = pool) {
        const qPool = dbPool || pool;
        if (!qPool || typeof qPool.query !== 'function') {
            return;
        }
        if (productIndexLoading) {
            return productIndexLoading;
        }
        productIndexLoading = (async () => {
            try {
                const [rows] = await qPool.query(
                    // Storefront-visible catalog only — never 301 Magento/Google URLs
                    // to POS-only or soft-deleted rows (those become soft 404s on PDP).
                    `SELECT p.slug FROM products p
                      WHERE COALESCE(TRIM(p.slug), '') <> ''
                        AND p.is_active = 1
                        AND ${STOREFRONT_VISIBLE_WHERE}`
                );
                const nextSlugs = new Set();
                const nextCollapsed = new Map();
                for (const row of rows || []) {
                    const slug = String(row.slug || '')
                        .trim()
                        .toLowerCase();
                    if (!slug) continue;
                    nextSlugs.add(slug);
                    const collapsed = collapseSlug(slug);
                    if (!collapsed) continue;
                    // Prefer shorter canonical when two collapse the same (rare).
                    const existing = nextCollapsed.get(collapsed);
                    if (!existing || slug.length < existing.length) {
                        nextCollapsed.set(collapsed, slug);
                    }
                }
                productSlugs = nextSlugs;
                collapsedToSlug = nextCollapsed;
                if (logger && typeof logger.info === 'function') {
                    logger.info(`SEO legacy product slug index loaded (${productSlugs.size} slugs)`);
                }
            } catch (e) {
                if (logger && typeof logger.warn === 'function') {
                    logger.warn(`SEO redirects: product slug index failed: ${e.message}`);
                }
            } finally {
                productIndexLoading = null;
            }
        })();
        return productIndexLoading;
    }

    function latestMtime() {
        let max = 0;
        for (const filePath of [...filePaths, slugAliasPath]) {
            try {
                if (fs.existsSync(filePath)) {
                    max = Math.max(max, fs.statSync(filePath).mtimeMs);
                }
            } catch {
                /* ignore */
            }
        }
        return max;
    }

    let lastCheck = latestMtime();
    load();
    // Fire-and-forget; middleware still works from CSV before index is ready.
    void loadProductSlugs();
    if (reloadMs > 0) {
        setInterval(() => {
            try {
                const t = latestMtime();
                if (t !== lastCheck) {
                    lastCheck = t;
                    load();
                }
            } catch {
                /* ignore */
            }
        }, reloadMs);
        // Refresh product slug index on the same cadence (DB changes without CSV mtime).
        setInterval(() => {
            void loadProductSlugs();
        }, Math.max(reloadMs, 120000));
    }

    return function seoRedirectMiddleware(req, res, next) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return next();
        }
        const p = req.path || '/';
        if (p.startsWith('/api')) {
            return next();
        }
        if (
            p === '/robots.txt' ||
            p === '/sitemap.xml' ||
            p === '/sitemap-pages.xml' ||
            p === '/sitemap-products.xml'
        ) {
            return next();
        }

        if (p === '/product.html') {
            const rawSlug = String(req.query.slug || '').trim();
            if (rawSlug) {
                const finishProductHtml = async () => {
                    const rawKey = rawSlug.toLowerCase();
                    // Never alias away from a slug that already exists in the live catalog
                    // (inverted CSV rows were 301'ing search hits to dead short slugs).
                    if (productSlugs.size > 0 && productSlugs.has(rawKey)) {
                        return next();
                    }
                    const canonical =
                        productSlugAliases.get(rawSlug) ||
                        productSlugAliases.get(rawKey) ||
                        null;
                    if (canonical && canonical !== rawSlug) {
                        // Allow full-path targets for discontinued SKUs (e.g. /products.html?search=...)
                        if (
                            canonical.startsWith('/') ||
                            canonical.startsWith('http://') ||
                            canonical.startsWith('https://')
                        ) {
                            return res.redirect(301, canonical);
                        }
                        const canonicalKey = String(canonical).trim().toLowerCase();
                        // Only 301 when the alias target is a real storefront slug.
                        if (productSlugs.size === 0 || productSlugs.has(canonicalKey)) {
                            const qs = new URLSearchParams(req.query);
                            qs.set('slug', canonical);
                            return res.redirect(301, `/product.html?${qs.toString()}`);
                        }
                    }

                    // Global recovery: Magento/Google slugs → live catalog match, else products search.
                    // Never serve a soft "Product Not Found" 200 for a dead/hidden slug.
                    const qPool = (req.pool && typeof req.pool.query === 'function') ? req.pool : pool;
                    if (qPool && typeof qPool.query === 'function') {
                        try {
                            const liveSlug = await findProductSlugWithFallback(
                                qPool,
                                rawKey,
                                productSlugs.size > 0 ? [...productSlugs] : null
                            );
                            if (liveSlug && String(liveSlug).toLowerCase() !== rawKey) {
                                const qs = new URLSearchParams(req.query);
                                qs.set('slug', liveSlug);
                                return res.redirect(301, `/product.html?${qs.toString()}`);
                            }
                        } catch {
                            /* fall through to search */
                        }
                    }
                    return res.redirect(301, searchRedirectLocation(rawKey));
                };
                if (productSlugs.size === 0 && req.pool && typeof req.pool.query === 'function') {
                    return loadProductSlugs(req.pool)
                        .then(() => finishProductHtml())
                        .catch(() => finishProductHtml());
                }
                return Promise.resolve()
                    .then(() => finishProductHtml())
                    .catch(() => next());
            }
        }

        const key = normalizePathname(p);
        const target = map.get(key);
        if (target) {
            let location = target.trim();
            if (!location.startsWith('http://') && !location.startsWith('https://')) {
                if (!location.startsWith('/')) {
                    location = `/${location}`;
                }
            }
            return res.redirect(301, location);
        }

        // Durable Magento/Concrete product fallback — never Express Cannot GET.
        const m = key.match(INDEXPHP_PRODUCT_RE);
        if (m) {
            let legacySlug = m[1];
            try {
                legacySlug = decodeURIComponent(legacySlug);
            } catch {
                /* keep raw */
            }

            const finish = async () => {
                let location = resolveLegacyIndexPhpProductSlug(legacySlug, {
                    productSlugAliases,
                    productSlugs,
                    collapsedToSlug
                });
                const qPool = (req.pool && typeof req.pool.query === 'function') ? req.pool : pool;
                // If legacy resolver only found search (or nothing), try global fuzzy → live PDP.
                const isSearchOnly =
                    !location ||
                    String(location).startsWith('/products.html?search=');
                if (isSearchOnly && qPool && typeof qPool.query === 'function') {
                    try {
                        const liveSlug = await findProductSlugWithFallback(
                            qPool,
                            String(legacySlug || '').trim().toLowerCase(),
                            productSlugs.size > 0 ? [...productSlugs] : null
                        );
                        if (liveSlug) {
                            location = productRedirectLocation(liveSlug);
                        }
                    } catch {
                        /* keep search fallback */
                    }
                }
                if (location) {
                    return res.redirect(301, location);
                }
                return next();
            };

            // Lazy-load slug index from req.pool when createSeoRedirectMiddleware was not passed pool.
            if (productSlugs.size === 0 && req.pool && typeof req.pool.query === 'function') {
                return loadProductSlugs(req.pool)
                    .then(() => finish())
                    .catch(() => finish());
            }
            return Promise.resolve()
                .then(() => finish())
                .catch(() => next());
        }

        return next();
    };
}

function createProductSlugAliasResolver({ rootPath, reloadMs = 120000 } = {}) {
    const root = rootPath || path.join(__dirname, '..', '..');
    const aliasPath = productSlugAliasFile(root);
    let aliases = new Map();
    let lastMtime = 0;

    function load() {
        try {
            if (!fs.existsSync(aliasPath)) {
                aliases = new Map();
                return;
            }
            lastMtime = fs.statSync(aliasPath).mtimeMs;
            aliases = parseProductSlugAliasCsv(fs.readFileSync(aliasPath, 'utf8').replace(/^\uFEFF/, ''));
        } catch {
            aliases = new Map();
        }
    }

    load();
    if (reloadMs > 0) {
        setInterval(() => {
            try {
                if (!fs.existsSync(aliasPath)) return;
                const t = fs.statSync(aliasPath).mtimeMs;
                if (t !== lastMtime) load();
            } catch {
                /* ignore */
            }
        }, reloadMs);
    }

    return function resolveProductSlug(slug) {
        const raw = String(slug || '').trim();
        if (!raw) return raw;
        const mapped = aliases.get(raw);
        // Path/URL targets are for product.html 301s only — keep the raw slug for API lookup.
        if (!mapped || mapped.startsWith('/') || mapped.startsWith('http://') || mapped.startsWith('https://')) {
            return raw;
        }
        return mapped;
    };
}

module.exports = {
    createSeoRedirectMiddleware,
    createProductSlugAliasResolver,
    normalizePathname,
    parseRedirectCsv,
    parseProductSlugAliasCsv,
    productSlugAliasFile,
    resolveRedirectFileList,
    resolveLegacyIndexPhpProductSlug,
    collapseSlug,
    INDEXPHP_PRODUCT_RE
};
