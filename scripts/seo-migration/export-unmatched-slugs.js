#!/usr/bin/env node
/** Writes scripts/seo-migration/output/unmatched-old-slugs.csv for manual 301 rows. */

const fs = require('fs');
const path = require('path');

const reportPath = path.join(__dirname, 'output', 'slug-alias-report.json');
const outPath = path.join(__dirname, 'output', 'unmatched-old-slugs.csv');

if (!fs.existsSync(reportPath)) {
    console.error('Run: npm run seo:slug-aliases first');
    process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const lines = ['old_slug,suggested_from_path,manual_new_slug'];
for (const slug of report.unmatchedSamples || []) {
    lines.push(
        `"${slug.replace(/"/g, '""')}","/index.php/products/${slug.replace(/"/g, '""')}",`
    );
}

fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
console.log('Wrote', outPath);
