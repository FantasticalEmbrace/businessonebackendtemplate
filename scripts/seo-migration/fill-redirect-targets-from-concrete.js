#!/usr/bin/env node
/**
 * Reads hmherbs-urls.csv (crawl export) and writes concrete-url-redirect-map-filled.csv
 * with heuristic new_url targets for the static Node site.
 *
 * Usage (from repo root):
 *   node scripts/seo-migration/fill-redirect-targets-from-concrete.js "path/to/hmherbs-urls.csv"
 */

const fs = require('fs');
const path = require('path');

function parseLine(line) {
    const parts = line.split(',');
    if (parts.length < 5) return null;
    const url = parts[0].trim();
    if (!url.startsWith('http')) return null;
    const status = parts[1].trim();
    const size = parts[2].trim();
    const contentType = parts[parts.length - 1].trim();
    const title = parts.slice(3, -1).join(',').trim();
    return { url, status, size, title, contentType };
}

function escapeCsv(cell) {
    const s = String(cell ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

const RESERVED_SINGLE = new Set([
    'brand',
    'category',
    'products',
    'company',
    'register',
    'login',
    'cart',
    'search',
    'cbd',
    'gift-cards',
    'ccm',
    'download_file'
]);

/**
 * Map old Concrete pathname to new site path (relative, may include query/hash).
 * Returns '' when unknown / needs manual review.
 */
function mapOldPathnameToNew(pathnameWithSearch) {
    const [pathnameRaw] = pathnameWithSearch.split('?');
    let norm = pathnameRaw.replace(/\/+$/, '') || '/';

    if (norm === '/login') {
        return '/account.html';
    }
    if (norm === '/search') {
        return '/products.html';
    }

    if (norm === '/' || norm === '/index.php') {
        return '/';
    }

    if (norm === '/index.php/products') {
        return '/products.html';
    }

    let m = /^\/index\.php\/products\/([^/]+)\/?$/.exec(norm);
    if (m) {
        return `/product.html?slug=${encodeURIComponent(m[1])}`;
    }

    if (norm === '/index.php/brand') {
        return '/brands.html';
    }
    m = /^\/index\.php\/brand\/([^/]+)\/?$/.exec(norm);
    if (m) {
        return `/products.html?brand=${encodeURIComponent(m[1])}`;
    }

    if (norm === '/index.php/category') {
        return '/categories.html';
    }
    m = /^\/index\.php\/category\/([^/]+)\/?$/.exec(norm);
    if (m) {
        return `/products.html?category=${encodeURIComponent(m[1])}`;
    }

    if (norm === '/index.php/company/shipping-and-returns') {
        return '/shipping-returns.html';
    }
    if (norm === '/index.php/company/contact') {
        return '/index.html#contact';
    }
    if (norm === '/index.php/company/about' || norm === '/index.php/company') {
        return '/about.html';
    }

    if (norm === '/index.php/register') {
        return '/account.html';
    }
    if (norm.startsWith('/index.php/login')) {
        return '/account.html';
    }

    if (norm === '/index.php/cart') {
        return '/index.html';
    }
    if (norm === '/index.php/search') {
        return '/products.html';
    }
    if (norm === '/index.php/cbd') {
        return '/products.html?category=cbd';
    }
    if (norm === '/index.php/gift-cards') {
        return '/products.html?search=gift+card';
    }

    if (norm.startsWith('/index.php/download_file')) {
        return '/';
    }
    if (norm.startsWith('/index.php/ccm/')) {
        return '';
    }

    m = /^\/index\.php\/([^/]+)\/?$/.exec(norm);
    if (m) {
        const seg = m[1];
        if (!RESERVED_SINGLE.has(seg)) {
            return `/product.html?slug=${encodeURIComponent(seg)}`;
        }
    }

    return '';
}

function main() {
    const inputPath = process.argv[2];
    if (!inputPath || !fs.existsSync(inputPath)) {
        console.error('Usage: node scripts/seo-migration/fill-redirect-targets-from-concrete.js <path-to-hmherbs-urls.csv>');
        process.exit(1);
    }

    const raw = fs.readFileSync(inputPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const byPath = new Map();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || i === 0) continue;
        const row = parseLine(line);
        if (!row || !row.contentType.toLowerCase().includes('text/html')) {
            continue;
        }
        let pathnameFull;
        let pathnameKey;
        try {
            const u = new URL(row.url);
            pathnameFull = u.pathname + (u.search || '');
            pathnameKey = u.pathname.replace(/\/+$/, '') || '/';
        } catch {
            continue;
        }
        if (!byPath.has(pathnameKey)) {
            byPath.set(pathnameKey, { ...row, pathnameFull });
        }
    }

    const sortedPaths = [...byPath.keys()].sort();
    const rows = [
        [
            'from_path',
            'new_url',
            'http_status',
            'title',
            'content_type',
            'source_full_url',
            'needs_manual_review'
        ]
    ];

    let manual = 0;
    for (const pathname of sortedPaths) {
        const r = byPath.get(pathname);
        const newUrl = mapOldPathnameToNew(pathname);
        const flag = newUrl === '' ? 'yes' : '';
        if (newUrl === '') manual++;
        rows.push([pathname, newUrl, r.status, r.title, r.contentType, r.url, flag]);
    }

    const outDir = path.join(__dirname);
    const outFile = path.join(outDir, 'concrete-url-redirect-map-filled.csv');
    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
    fs.writeFileSync(outFile, csv, 'utf8');
    console.log('Wrote', outFile);
    console.log('Total rows:', sortedPaths.length);
    console.log('Needs manual review (empty new_url):', manual);

    const rootDir = path.join(__dirname, '..', '..');
    const snippetPath = path.join(rootDir, 'redirects-301.concrete-snippet.csv');
    const snippetRows = [['from_path', 'to_path']];
    for (const pathname of sortedPaths) {
        const newUrl = mapOldPathnameToNew(pathname);
        if (!newUrl) {
            continue;
        }
        if (pathname === '/' && newUrl === '/') {
            continue;
        }
        snippetRows.push([pathname, newUrl]);
    }
    const snippetCsv = snippetRows.map((row) => row.map(escapeCsv).join(',')).join('\n');
    fs.writeFileSync(snippetPath, snippetCsv, 'utf8');
    console.log('Wrote', snippetPath, `(${snippetRows.length - 1} redirect rules)`);

    if (process.argv.includes('--write-root-redirects')) {
        const redirectPath = path.join(rootDir, 'redirects-301.csv');
        const headerComments = [
            '# SEO migration — rules below are 301 redirects (from_path → to_path).',
            '# from_path = pathname only (no domain). Trailing slashes normalized when matching.',
            '# to_path = relative path or full URL. Generated from Concrete crawl export; verify before launch.',
            '# Regenerate: node scripts/seo-migration/fill-redirect-targets-from-concrete.js "<path-to-hmherbs-urls.csv>" --write-root-redirects',
            '#',
            'from_path,to_path'
        ].join('\n');
        const body = snippetRows
            .slice(1)
            .map((row) => row.map(escapeCsv).join(','))
            .join('\n');
        fs.writeFileSync(redirectPath, `${headerComments}\n${body}\n`, 'utf8');
        console.log('Updated', redirectPath);
    }
}

main();
