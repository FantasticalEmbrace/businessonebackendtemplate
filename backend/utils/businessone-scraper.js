'use strict';

const path = require('path');
const fs = require('fs');

function resolveToolRoot() {
    const candidates = [
        process.env.BUSINESSONE_SCRAPER_PATH,
        path.resolve(__dirname, '../../../../businessone-scraping-tool'),
        path.resolve(__dirname, '../../../businessone-scraping-tool'),
    ].filter(Boolean);

    for (const root of candidates) {
        if (fs.existsSync(path.join(root, 'lib', 'catalog-scraper.js'))) {
            return root;
        }
    }

    throw new Error(
        'businessone-scraping-tool not found. Clone it next to this project or set BUSINESSONE_SCRAPER_PATH.'
    );
}

function loadScraper() {
    return require(path.join(resolveToolRoot(), 'lib/catalog-scraper.js'));
}

function createScraper(options = {}) {
    const CatalogScraper = loadScraper();
    return new CatalogScraper(options);
}

module.exports = { resolveToolRoot, loadScraper, createScraper };
