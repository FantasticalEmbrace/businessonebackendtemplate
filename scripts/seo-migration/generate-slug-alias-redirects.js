#!/usr/bin/env node
/**
 * Maps old Concrete product slugs → current MySQL slugs and writes redirects-slug-aliases.csv
 * (loaded last by the server so it overrides stale targets in redirects-301.csv).
 *
 * Usage: node scripts/seo-migration/generate-slug-alias-redirects.js
 *        node scripts/seo-migration/generate-slug-alias-redirects.js --write-report
 */

const { loadBackendEnv, createPool, createConnection } = require('../../backend/utils/dbConfig');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { parseRedirectCsv, normalizePathname } = require('../../backend/middleware/seoRedirects');

const rootDir = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(rootDir, 'backend', '.env') });

function normSlug(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function normTitle(s) {
    return String(s || '')
        .split('::')[0]
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
    return new Set(normTitle(s).split(' ').filter((t) => t.length > 2));
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const t of a) {
        if (b.has(t)) inter++;
    }
    return inter / (a.size + b.size - inter);
}

function loadOldProductRedirects() {
    const csvPath = path.join(rootDir, 'redirects-301.csv');
    const map = parseRedirectCsv(fs.readFileSync(csvPath, 'utf8'));
    const rows = [];
    for (const [from, to] of map) {
        const m = /^\/index\.php\/products\/([^/]+)$/.exec(from);
        if (!m) continue;
        const oldSlug = decodeURIComponent(m[1]);
        const targetMatch = /[?&]slug=([^&]+)/.exec(to);
        const targetSlug = targetMatch ? decodeURIComponent(targetMatch[1]) : oldSlug;
        rows.push({ fromPath: from, oldSlug, targetSlug, currentTo: to });
    }
    return rows;
}

function loadConcreteTitles() {
    const fp = path.join(__dirname, 'concrete-url-redirect-map-filled.csv');
    if (!fs.existsSync(fp)) return new Map();
    const text = fs.readFileSync(fp, 'utf8');
    const lines = text.split(/\r?\n/).slice(1);
    const bySlug = new Map();
    for (const line of lines) {
        if (!line.trim()) continue;
        const cols = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQ = !inQ;
                continue;
            }
            if (ch === ',' && !inQ) {
                cols.push(cur);
                cur = '';
                continue;
            }
            cur += ch;
        }
        cols.push(cur);
        const from = cols[0];
        const title = cols[3];
        const m = /^\/index\.php\/products\/([^/]+)$/.exec(from);
        if (m && title) {
            bySlug.set(decodeURIComponent(m[1]), title);
        }
    }
    return bySlug;
}

function pickUniqueByNorm(items, keyFn) {
    const buckets = new Map();
    for (const item of items) {
        const k = keyFn(item);
        if (!k) continue;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(item);
    }
    const unique = new Map();
    for (const [k, list] of buckets) {
        if (list.length === 1) unique.set(k, list[0]);
    }
    return unique;
}

function bestTokenMatch(items, scoreFn, minScore) {
    let best = null;
    let bestScore = 0;
    let second = 0;
    for (const item of items) {
        const score = scoreFn(item);
        if (score > bestScore) {
            second = bestScore;
            bestScore = score;
            best = item;
        } else if (score > second) {
            second = score;
        }
    }
    if (!best || bestScore < minScore) return null;
    if (bestScore - second < 0.08 && second >= minScore - 0.1) {
        return null;
    }
    return { item: best, score: bestScore };
}

function matchOldToDb(oldSlug, products, titlesByOldSlug) {
    const dbBySlug = new Map(products.map((p) => [p.slug, p]));
    if (dbBySlug.has(oldSlug)) {
        return { product: dbBySlug.get(oldSlug), method: 'exact_slug' };
    }

    const nOld = normSlug(oldSlug);
    const byNorm = pickUniqueByNorm(products, (p) => normSlug(p.slug));
    if (byNorm.has(nOld)) {
        return { product: byNorm.get(nOld), method: 'normalized_slug' };
    }

    const skuHits = products.filter((p) => {
        const ns = normSlug(p.sku);
        return ns.length >= 4 && (nOld.includes(ns) || ns.includes(nOld));
    });
    if (skuHits.length === 1) {
        return { product: skuHits[0], method: 'sku_overlap' };
    }

    const title = titlesByOldSlug.get(oldSlug);
    if (title) {
        const nt = normTitle(title);
        const byTitle = pickUniqueByNorm(products, (p) => normTitle(p.name));
        if (byTitle.has(nt)) {
            return { product: byTitle.get(nt), method: 'concrete_title' };
        }

        const titleTokens = tokenSet(title);
        const hit = bestTokenMatch(
            products,
            (p) => jaccard(titleTokens, tokenSet(p.name)),
            0.72
        );
        if (hit) {
            return { product: hit.item, method: `title_tokens_${hit.score.toFixed(2)}` };
        }
    }

    const oldTokens = tokenSet(oldSlug.replace(/-/g, ' '));
    const slugHit = bestTokenMatch(
        products,
        (p) => jaccard(oldTokens, tokenSet(p.name)),
        0.58
    );
    if (slugHit) {
        return { product: slugHit.item, method: `slug_tokens_${slugHit.score.toFixed(2)}` };
    }

    return null;
}

async function main() {
    loadBackendEnv(path.join(__dirname, '..', '..', 'backend', '.env'));
    const writeReport = process.argv.includes('--write-report');
    const oldRows = loadOldProductRedirects();
    const titlesByOldSlug = loadConcreteTitles();

    const pool = createPool({ connectionLimit: 5 });

    const [products] = await pool.query(
        `SELECT id, slug, name, sku FROM products WHERE is_active = 1 AND TRIM(slug) <> ""`
    );
    await pool.end();

    const dbSlugs = new Set(products.map((p) => p.slug));
    const aliases = [];
    const unmatched = [];
    const unmatchedAll = [];
    const alreadyOk = [];

    for (const row of oldRows) {
        const match = matchOldToDb(row.oldSlug, products, titlesByOldSlug);
        if (!match) {
            unmatched.push(row);
            unmatchedAll.push(row.oldSlug);
            continue;
        }
        const newSlug = match.product.slug;
        const newTo = `/product.html?slug=${encodeURIComponent(newSlug)}`;
        if (newSlug === row.oldSlug && row.currentTo === newTo) {
            alreadyOk.push({ ...row, method: match.method });
            continue;
        }
        aliases.push({
            fromPath: row.fromPath,
            oldSlug: row.oldSlug,
            newSlug,
            newTo,
            method: match.method,
            name: match.product.name
        });
    }

    const outPath = path.join(rootDir, 'redirects-slug-aliases.csv');
    const header = [
        '# Old Concrete product URL → current MySQL slug (overrides redirects-301.csv).',
        '# Regenerate: node scripts/seo-migration/generate-slug-alias-redirects.js',
        '#'
    ].join('\n');
    const body = [
        ['from_path', 'to_path'],
        ...aliases.map((a) => [a.fromPath, a.newTo])
    ];
    const csvLines = body.map((r) => r.map(escapeCsv).join(','));
    fs.writeFileSync(outPath, `${header}\n${csvLines.join('\n')}\n`, 'utf8');

    const reportPath = path.join(__dirname, 'output', 'slug-alias-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const report = {
        generatedAt: new Date().toISOString(),
        oldProductUrls: oldRows.length,
        aliasesWritten: aliases.length,
        alreadyCorrect: alreadyOk.length,
        unmatched: unmatched.length,
        unmatchedSlugs: unmatchedAll,
        unmatchedSamples: unmatchedAll.slice(0, 30),
        aliasSamples: aliases.slice(0, 20)
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log('Old product URLs in redirects-301.csv:', oldRows.length);
    console.log('Active DB products:', products.length);
    console.log('Alias redirects written:', aliases.length, '→', outPath);
    console.log('Already pointed at live slug:', alreadyOk.length);
    console.log('Unmatched (manual review):', unmatched.length);
    if (aliases.length) {
        console.log('Example:', aliases[0].oldSlug, '→', aliases[0].newSlug, `(${aliases[0].method})`);
    }
    if (unmatched.length) {
        const unmatchedCsv = path.join(__dirname, 'output', 'unmatched-old-slugs.csv');
        const umLines = ['old_slug,from_path'];
        for (const row of unmatched) {
            umLines.push(
                `${escapeCsv(row.oldSlug)},${escapeCsv(`/index.php/products/${row.oldSlug}`)}`
            );
        }
        fs.writeFileSync(unmatchedCsv, `${umLines.join('\n')}\n`, 'utf8');
        console.log('Unmatched list:', unmatchedCsv, '(run npm run seo:resolve-unmatched)');
    }

    if (writeReport) {
        console.log('Report:', reportPath);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
