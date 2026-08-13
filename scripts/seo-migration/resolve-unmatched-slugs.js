#!/usr/bin/env node
/**
 * Resolves the remaining unmatched old product slugs and appends to redirects-slug-aliases.csv.
 * Strategies: inactive SKU match, strip -1/-2 suffix, brand prefix, fuzzy slug, EDSA/gift specials, search, catalog.
 */

const { loadBackendEnv, createPool, createConnection } = require('../../backend/utils/dbConfig');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { parseRedirectCsv } = require('../../backend/middleware/seoRedirects');

const rootDir = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(rootDir, 'backend', '.env') });

function normSlug(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function normTitle(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeCsv(cell) {
    const v = String(cell ?? '');
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function tokenSet(s) {
    return new Set(
        normTitle(s)
            .split(' ')
            .filter((t) => t.length > 2 && !/^\d+$/.test(t))
    );
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const t of a) {
        if (b.has(t)) inter++;
    }
    return inter / (a.size + b.size - inter);
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = i - 1;
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const temp = row[j];
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
            prev = temp;
        }
    }
    return row[b.length];
}

function slugVariants(slug) {
    const out = [slug];
    const stripped = slug.replace(/-\d+$/, '');
    if (stripped !== slug) out.push(stripped);
    const stripped2 = stripped.replace(/-\d+$/, '');
    if (stripped2 !== stripped) out.push(stripped2);
    return out;
}

function loadConcreteTitles() {
    const fp = path.join(__dirname, 'concrete-url-redirect-map-filled.csv');
    if (!fs.existsSync(fp)) return new Map();
    const bySlug = new Map();
    const text = fs.readFileSync(fp, 'utf8');
    for (const line of text.split(/\r?\n/).slice(1)) {
        if (!line.trim()) continue;
        const m = line.match(/^\/index\.php\/products\/([^,]+),/);
        if (!m) continue;
        const titlePart = line.split(',').slice(3, 4)[0]?.replace(/^"|"$/g, '') || '';
        bySlug.set(decodeURIComponent(m[1]), titlePart);
    }
    return bySlug;
}

function specialRedirect(oldSlug) {
    const s = oldSlug.toLowerCase();
    if (s.includes('edsa') && (s.includes('test') || s.includes('biofeedback') || s.includes('association'))) {
        return { to: '/index.html#edsa-service', method: 'special_edsa' };
    }
    if (s.includes('gift-bag') || s.includes('gift-card')) {
        return { to: '/products.html', method: 'special_gift' };
    }
    return null;
}

function pickBrandRedirect(oldSlug, brands, productsActive) {
    const sorted = [...brands].sort((a, b) => b.slug.length - a.slug.length);
    for (const brand of sorted) {
        const prefix = `${brand.slug}-`;
        if (oldSlug.startsWith(prefix) || oldSlug === brand.slug) {
            const brandProducts = productsActive.filter((p) => p.brand_slug === brand.slug);
            if (brandProducts.length === 1) {
                return {
                    to: `/product.html?slug=${encodeURIComponent(brandProducts[0].slug)}`,
                    method: 'brand_single_product'
                };
            }
            return {
                to: `/products.html?brand=${encodeURIComponent(brand.slug)}`,
                method: 'brand_catalog'
            };
        }
    }
    return null;
}

function fuzzySlugMatch(oldSlug, products) {
    const nOld = normSlug(oldSlug);
    let best = null;
    let bestDist = Infinity;
    let second = Infinity;
    for (const p of products) {
        const n = normSlug(p.slug);
        const d = levenshtein(nOld, n);
        const maxLen = Math.max(nOld.length, n.length) || 1;
        const ratio = 1 - d / maxLen;
        if (d < bestDist) {
            second = bestDist;
            bestDist = d;
            best = { product: p, ratio, d };
        } else if (d < second) {
            second = d;
        }
    }
    if (!best) return null;
    if (best.ratio >= 0.82 && bestDist - second >= 2) {
        return {
            to: `/product.html?slug=${encodeURIComponent(best.product.slug)}`,
            method: `fuzzy_slug_${best.ratio.toFixed(2)}`
        };
    }
    return null;
}

function tokenMatch(oldSlug, title, productsActive) {
    const tokens = tokenSet(oldSlug.replace(/-/g, ' '));
    if (title) {
        for (const t of tokenSet(title)) tokens.add(t);
    }
    let best = null;
    let bestScore = 0;
    let second = 0;
    for (const p of productsActive) {
        const score = jaccard(tokens, tokenSet(`${p.name} ${p.slug}`));
        if (score > bestScore) {
            second = bestScore;
            bestScore = score;
            best = p;
        } else if (score > second) {
            second = score;
        }
    }
    if (best && bestScore >= 0.38 && bestScore - second >= 0.08) {
        return {
            to: `/product.html?slug=${encodeURIComponent(best.slug)}`,
            method: `token_match_${bestScore.toFixed(2)}`
        };
    }
    return null;
}

function searchFallback(oldSlug) {
    const q = oldSlug
        .replace(/-\d+$/, '')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (q.length >= 3) {
        return { to: `/products.html?search=${encodeURIComponent(q)}`, method: 'search_fallback' };
    }
    return { to: '/products.html', method: 'catalog_fallback' };
}

function resolveOne(oldSlug, ctx) {
    const fromPath = `/index.php/products/${oldSlug}`;

    const special = specialRedirect(oldSlug);
    if (special) return { fromPath, oldSlug, ...special };

    for (const variant of slugVariants(oldSlug)) {
        const exact = ctx.bySlug.get(variant);
        if (exact) {
            const target = exact.is_active
                ? `/product.html?slug=${encodeURIComponent(exact.slug)}`
                : ctx.activeByBrand.get(exact.brand_id)?.[0]
                  ? `/product.html?slug=${encodeURIComponent(ctx.activeByBrand.get(exact.brand_id)[0].slug)}`
                  : null;
            if (target) {
                return {
                    fromPath,
                    oldSlug,
                    to: target,
                    method: exact.is_active ? 'inactive_exact_active' : 'inactive_substitute'
                };
            }
        }
        const n = normSlug(variant);
        const byNorm = ctx.byNormSlug.get(n);
        if (byNorm && byNorm.is_active) {
            return {
                fromPath,
                oldSlug,
                to: `/product.html?slug=${encodeURIComponent(byNorm.slug)}`,
                method: 'normalized_variant'
            };
        }
    }

    const brandHit = pickBrandRedirect(oldSlug, ctx.brands, ctx.productsActive);
    if (brandHit) return { fromPath, oldSlug, ...brandHit };

    const fuzzy = fuzzySlugMatch(oldSlug, ctx.productsActive);
    if (fuzzy) return { fromPath, oldSlug, ...fuzzy };

    const title = ctx.titles.get(oldSlug);
    const tok = tokenMatch(oldSlug, title, ctx.productsActive);
    if (tok) return { fromPath, oldSlug, ...tok };

    const fb = searchFallback(oldSlug);
    return { fromPath, oldSlug, ...fb };
}

async function main() {
    loadBackendEnv(path.join(__dirname, '..', '..', 'backend', '.env'));
    const reportPath = path.join(__dirname, 'output', 'slug-alias-report.json');
    const unmatchedCsv = path.join(__dirname, 'output', 'unmatched-old-slugs.csv');

    let oldSlugs = [];
    if (fs.existsSync(reportPath)) {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        oldSlugs = report.unmatchedSlugs || [];
    }
    if (!oldSlugs.length && fs.existsSync(unmatchedCsv)) {
        oldSlugs = fs
            .readFileSync(unmatchedCsv, 'utf8')
            .split(/\r?\n/)
            .slice(1)
            .map((line) => line.split(',')[0]?.replace(/^"|"$/g, ''))
            .filter(Boolean);
    }

    if (!oldSlugs.length) {
        console.log('No unmatched slugs to resolve.');
        return;
    }

    const pool = createPool({ connectionLimit: 5 });

    const [allProducts] = await pool.query(
        `SELECT p.id, p.slug, p.name, p.sku, p.is_active, p.brand_id, b.slug AS brand_slug
           FROM products p
           LEFT JOIN brands b ON b.id = p.brand_id
          WHERE TRIM(p.slug) <> ""`
    );
    const [brands] = await pool.query(
        'SELECT id, slug, name FROM brands WHERE is_active = 1 AND TRIM(slug) <> ""'
    );
    await pool.end();

    const productsActive = allProducts.filter((p) => p.is_active);
    const bySlug = new Map(allProducts.map((p) => [p.slug, p]));
    const byNormSlug = new Map();
    for (const p of allProducts) {
        const n = normSlug(p.slug);
        if (!byNormSlug.has(n)) byNormSlug.set(n, p);
    }
    const activeByBrand = new Map();
    for (const p of productsActive) {
        if (!activeByBrand.has(p.brand_id)) activeByBrand.set(p.brand_id, []);
        activeByBrand.get(p.brand_id).push(p);
    }

    const ctx = {
        productsActive,
        bySlug,
        byNormSlug,
        brands,
        activeByBrand,
        titles: loadConcreteTitles()
    };

    const resolved = [];
    const byMethod = {};
    for (const oldSlug of oldSlugs) {
        const r = resolveOne(oldSlug, ctx);
        resolved.push(r);
        byMethod[r.method] = (byMethod[r.method] || 0) + 1;
    }

    const aliasPath = path.join(rootDir, 'redirects-slug-aliases.csv');
    const existing = new Map();
    if (fs.existsSync(aliasPath)) {
        for (const [from, to] of parseRedirectCsv(fs.readFileSync(aliasPath, 'utf8'))) {
            existing.set(from, to);
        }
    }
    for (const r of resolved) {
        existing.set(r.fromPath, r.to);
    }

    const header = [
        '# Product slug aliases (auto + unmatched resolver). Regenerate:',
        '#   npm run seo:slug-aliases && npm run seo:resolve-unmatched',
        '#'
    ].join('\n');
    const lines = [['from_path', 'to_path'], ...[...existing.entries()].map(([f, t]) => [f, t])];
    fs.writeFileSync(
        aliasPath,
        `${header}\n${lines.map((r) => r.map(escapeCsv).join(',')).join('\n')}\n`,
        'utf8'
    );

    const logPath = path.join(__dirname, 'output', 'unmatched-resolved-log.csv');
    const logLines = [
        'old_slug,to_path,method',
        ...resolved.map((r) =>
            [escapeCsv(r.oldSlug), escapeCsv(r.to), escapeCsv(r.method)].join(',')
        )
    ];
    fs.writeFileSync(logPath, `${logLines.join('\n')}\n`, 'utf8');

    fs.writeFileSync(
        path.join(__dirname, 'output', 'unmatched-old-slugs.csv'),
        'old_slug,from_path,status\n',
        'utf8'
    );

    console.log('Resolved unmatched slugs:', resolved.length);
    console.log('By method:', byMethod);
    console.log('Total alias rules now:', existing.size, '→', aliasPath);
    console.log('Resolution log:', logPath);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
