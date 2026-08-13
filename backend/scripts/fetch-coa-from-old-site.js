#!/usr/bin/env node
/**
 * Download COA PDFs from legacy hmherbs.com download_file URLs into images/coa/.
 *
 * Usage (from backend/): node scripts/fetch-coa-from-old-site.js
 * Optional: --dry-run
 */

const fs = require('fs').promises;
const path = require('path');
const { OLD_SITE_COA_DOWNLOADS } = require('../utils/productCoaMap');

const COA_DIR = path.join(__dirname, '..', '..', 'images', 'coa');
const HEMP_BOMBS_INDEX = path.join(COA_DIR, 'hemp-bombs-cbd-gummies-w-mushroom-coas.html');

const HEMP_BOMBS_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Certificates of Analysis — Hemp Bombs CBD Gummies W/Mushroom</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 1rem; background: #f8faf8; color: #1a2e1a; }
        h1 { font-size: 1.25rem; }
        ul { line-height: 1.8; }
        a { color: #10b981; }
        a.back { display: inline-block; margin-bottom: 1rem; }
    </style>
</head>
<body>
    <a class="back" href="javascript:history.back()">← Back</a>
    <h1>Certificates of Analysis — Hemp Bombs CBD Gummies W/Mushroom</h1>
    <p>Third-party lab reports (from hmherbs.com product listing):</p>
    <ul>
        <li><a href="hemp-bombs-cbd-gummies-w-mushroom-coa-1.pdf" target="_blank" rel="noopener">COA #1 (PDF)</a></li>
        <li><a href="hemp-bombs-cbd-gummies-w-mushroom-coa-2.pdf" target="_blank" rel="noopener">COA #2 (PDF)</a></li>
    </ul>
</body>
</html>
`;

async function download(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
}

(async () => {
    const dryRun = process.argv.includes('--dry-run');
    await fs.mkdir(COA_DIR, { recursive: true });

    for (const item of OLD_SITE_COA_DOWNLOADS) {
        const dest = path.join(COA_DIR, item.dest);
        if (dryRun) {
            console.log(`Would download ${item.url}\n  → ${item.dest} (${item.slug})`);
            continue;
        }
        const buf = await download(item.url);
        await fs.writeFile(dest, buf);
        console.log(`✓ ${item.dest} (${buf.length} bytes)`);
    }

    if (!dryRun) {
        await fs.writeFile(HEMP_BOMBS_INDEX, HEMP_BOMBS_INDEX_HTML, 'utf8');
        console.log('✓ hemp-bombs-cbd-gummies-w-mushroom-coas.html');
    } else {
        console.log('Would write hemp-bombs-cbd-gummies-w-mushroom-coas.html');
    }

    console.log('\nDone. Run: node scripts/apply-product-coa-map.js');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
