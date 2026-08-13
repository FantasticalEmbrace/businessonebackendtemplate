#!/usr/bin/env node
/**
 * Reads repo-root sitemap.xml and prints CSV: loc,path_only
 * Usage (from repo root): node scripts/seo-migration/build-sitemap-inventory.js
 * Optional: node scripts/seo-migration/build-sitemap-inventory.js --write
 *   writes scripts/seo-migration/output/sitemap-urls.csv
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const sitemapPath = path.join(root, 'sitemap.xml');
const write = process.argv.includes('--write');

function extractLocs(xml) {
    const locs = [];
    const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
        locs.push(m[1].trim());
    }
    return locs;
}

function main() {
    if (!fs.existsSync(sitemapPath)) {
        console.error('Missing sitemap.xml at', sitemapPath);
        process.exit(1);
    }
    const xml = fs.readFileSync(sitemapPath, 'utf8');
    const locs = extractLocs(xml);
    const rows = [['loc', 'path_only', 'new_url_blank_for_you']];
    for (const loc of locs) {
        let pathname = '';
        try {
            pathname = new URL(loc).pathname || '/';
        } catch {
            pathname = '';
        }
        rows.push([loc, pathname, '']);
    }

    const esc = (cell) => {
        const s = String(cell);
        if (/[",\n\r]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    };
    const csv = rows.map((r) => r.map(esc).join(',')).join('\n');

    if (write) {
        const outDir = path.join(__dirname, 'output');
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, 'sitemap-urls.csv');
        fs.writeFileSync(outFile, csv, 'utf8');
        console.log('Wrote', outFile, `(${locs.length} URLs)`);
    } else {
        console.log(csv);
    }
}

main();
