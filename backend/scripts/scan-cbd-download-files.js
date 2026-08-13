#!/usr/bin/env node
/** Scan hmherbs CBD product pages (+ brand pages) for download_file links. */
const { CBD_PRODUCT_SLUGS } = require('../utils/cbdProductSlugs');

const SLUG_ALIASES = {
    'hemp-bombs-cbd-gummies-w-mushroom': ['hemp-bombs-cbd-gummiesmushroom'],
    'hippie-jack-s-yummy-hemp-gummie': ['hippie-jacks-yummy-hemp-gummie'],
    'regalabs-cannabis-oil-for-pets': ['regalabs-cannabis-oil-pets'],
    'regalabs-full-spectrum-cbd-gummies': ['regalabs-cbd-gummies-1', 'regalabs-cbd-gummies']
};

function pathsForSlug(slug) {
    return [slug, ...(SLUG_ALIASES[slug] || [])];
}

(async () => {
    const allHits = [];
    for (const slug of CBD_PRODUCT_SLUGS) {
        for (const pathSlug of pathsForSlug(slug)) {
            const url = `https://hmherbs.com/index.php/products/${pathSlug}`;
            try {
                const res = await fetch(url, {
                    redirect: 'follow',
                    headers: { 'User-Agent': 'Mozilla/5.0 HMHerbsCOA/1.0' }
                });
                const html = await res.ok ? await res.text() : '';
                const downloads = [...html.matchAll(/download_file\/view\/[^"'\s<>]+/gi)].map((m) => m[0]);
                const pdfs = [...html.matchAll(/\/application\/files\/[^"'\s<>]+\.pdf/gi)].map((m) => m[0]);
                if (downloads.length || pdfs.length) {
                    allHits.push({ slug, url, downloads: [...new Set(downloads)], pdfs: [...new Set(pdfs)] });
                    console.log(slug, url);
                    downloads.forEach((d) => console.log('  dl', d));
                    pdfs.forEach((p) => console.log('  pdf', p));
                }
            } catch (e) {
                console.log(slug, url, 'ERR', e.message);
            }
        }
    }
    console.log('\nHits:', allHits.length);
})();
