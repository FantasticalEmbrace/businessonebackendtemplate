#!/usr/bin/env node
/**
 * Converts a crawl export (e.g. Screaming Frog) with columns like:
 *   URL, Stattus, Size, Title, ContentType
 * into redirect-planning CSV: pathname + blank new_url + metadata.
 *
 * Usage (from repo root):
 *   node scripts/seo-migration/from-concrete-url-export.js "C:\path\to\hmherbs-urls.csv"
 *   node scripts/seo-migration/from-concrete-url-export.js "C:\path\to\hmherbs-urls.csv" --write
 *
 * --write  → scripts/seo-migration/output/concrete-url-redirect-stubs.csv
 * --all    → include non-HTML rows (default: text/html only)
 */

const fs = require('fs');
const path = require('path');

function parseLine(line) {
    const parts = line.split(',');
    if (parts.length < 5) {
        return null;
    }
    const url = parts[0].trim();
    if (!url.startsWith('http')) {
        return null;
    }
    const status = parts[1].trim();
    const size = parts[2].trim();
    const contentType = parts[parts.length - 1].trim();
    const title = parts.slice(3, -1).join(',').trim();
    return { url, status, size, title, contentType };
}

function pathnameOnly(urlStr) {
    try {
        const u = new URL(urlStr);
        return u.pathname + (u.search || '');
    } catch {
        return '';
    }
}

function escapeCsv(cell) {
    const s = String(cell ?? '');
    if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

function main() {
    const args = process.argv.slice(2).filter((a) => a !== '--write' && a !== '--all');
    const write = process.argv.includes('--write');
    const allTypes = process.argv.includes('--all');

    const inputPath = args[0];
    if (!inputPath || !fs.existsSync(inputPath)) {
        console.error('Usage: node scripts/seo-migration/from-concrete-url-export.js <path-to-hmherbs-urls.csv> [--write] [--all]');
        process.exit(1);
    }

    const raw = fs.readFileSync(inputPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const byPath = new Map();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || i === 0) {
            continue;
        }
        const row = parseLine(line);
        if (!row) {
            continue;
        }
        if (!allTypes && !row.contentType.toLowerCase().includes('text/html')) {
            continue;
        }
        const fromPath = pathnameOnly(row.url);
        if (!fromPath) {
            continue;
        }
        if (!byPath.has(fromPath)) {
            byPath.set(fromPath, row);
        }
    }

    const sortedPaths = [...byPath.keys()].sort();
    const outRows = [['from_path', 'new_url', 'http_status', 'title', 'content_type', 'source_full_url']];
    for (const p of sortedPaths) {
        const r = byPath.get(p);
        outRows.push([p, '', r.status, r.title, r.contentType, r.url]);
    }

    const csv = outRows.map((r) => r.map(escapeCsv).join(',')).join('\n');

    if (write) {
        const outDir = path.join(__dirname, 'output');
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, 'concrete-url-redirect-stubs.csv');
        fs.writeFileSync(outFile, csv, 'utf8');
        console.log('Wrote', outFile);
        console.log('Rows (unique pathnames):', sortedPaths.length);
    } else {
        console.log(csv);
    }
}

main();
