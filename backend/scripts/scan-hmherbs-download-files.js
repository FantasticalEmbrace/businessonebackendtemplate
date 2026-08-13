#!/usr/bin/env node
/** Scan all scraped hmherbs product pages for download_file COA links. */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'scraped-products.json'), 'utf8'));
const urls = [...new Set((data.products || data).map((p) => p.url).filter(Boolean))];

(async () => {
    const hits = [];
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        try {
            const res = await fetch(url, {
                redirect: 'follow',
                headers: { 'User-Agent': 'Mozilla/5.0 HMHerbsCOA/1.0' }
            });
            if (!res.ok) continue;
            const html = await res.text();
            const matches = [...html.matchAll(/download_file\/view\/[^"'\s<>]+/gi)].map((m) => m[0]);
            if (matches.length) {
                hits.push({ url, downloads: [...new Set(matches)] });
                console.log(url);
                [...new Set(matches)].forEach((d) => console.log(' ', d));
            }
        } catch {
            /* skip */
        }
        if ((i + 1) % 100 === 0) process.stderr.write(`scanned ${i + 1}/${urls.length}\n`);
    }
    console.log(`\nTotal pages with download_file: ${hits.length}`);
    fs.writeFileSync(path.join(__dirname, '..', 'data', 'hmherbs-download-files.json'), JSON.stringify(hits, null, 2));
})();
