#!/usr/bin/env node
/**
 * Loads redirects-301.csv via the same middleware as server.js and asserts 301 + Location.
 * Run from backend so express resolves:  cd backend && node ../scripts/seo-migration/test-seo-redirects.js
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const {
    createSeoRedirectMiddleware,
    parseRedirectCsv,
    resolveRedirectFileList
} = require('../../backend/middleware/seoRedirects');

const rootPath = path.join(__dirname, '..', '..');
const logger = {
    info() {},
    warn() {}
};

const app = express();
app.use(createSeoRedirectMiddleware({ rootPath, logger, reloadMs: 0 }));
app.get('*', (req, res) => res.status(200).send('no-redirect'));

const cases = [
    ['/index.php/brand/flexcin', 301, '/products.html?brand=flexcin'],
    ['/index.php/products/edom-chiro-klenz-original', 301, '/product.html?slug=edom-labs-chiro-klenz-tea-original'],
    ['/index.php', 301, '/'],
    ['/index.php/company/about', 301, '/about.html'],
    ['/index.php/company/contact', 301, '/index.html#contact'],
    ['/index.php/register', 301, '/account.html'],
    ['/login', 301, '/account.html'],
    ['/search', 301, '/products.html'],
    ['/index.php/brand', 301, '/brands.html'],
    ['/index.php/category', 301, '/categories.html'],
    ['/index.php/cbd', 301, '/products.html?category=cbd'],
    ['/categories/herbs', 301, '/categories.html'],
    ['/health-conditions/immune', 301, '/products.html?category=immune'],
    ['/brands/flexcin', 301, '/products.html?brand=flexcin'],
    ['/privacy-policy', 301, '/privacy-policy.html'],
    ['/account/login', 301, '/account.html'],
    [
        '/index.php/products/3-1-nitric-oxide-booster-pre-workout-1',
        301,
        '/product.html?slug=3-in-1-nitric-oxide-booster'
    ],
    ['/z-no-redirect-test-xyz', 200, null]
];

async function verifyFullCsv(app) {
    const map = new Map();
    const names = [];
    for (const csvPath of resolveRedirectFileList(rootPath)) {
        if (!fs.existsSync(csvPath)) continue;
        names.push(path.basename(csvPath));
        for (const [k, v] of parseRedirectCsv(fs.readFileSync(csvPath, 'utf8'))) {
            map.set(k, v);
        }
    }
    console.log(`\nVerifying ${map.size} rows from ${names.join(', ')} ...`);
    let failed = 0;
    for (const [fromPath, toPath] of map) {
        const res = await request(app).get(fromPath);
        if (res.status !== 301) {
            console.error(`FAIL ${fromPath}: status ${res.status}, want 301`);
            failed++;
            continue;
        }
        if (res.headers.location !== toPath) {
            console.error(`FAIL ${fromPath}: Location "${res.headers.location}", want "${toPath}"`);
            failed++;
        }
    }
    if (failed) {
        throw new Error(`${failed} CSV redirect(s) failed`);
    }
    console.log(`All ${map.size} CSV redirects matched middleware behavior.`);
}

async function run() {
    let failed = 0;
    for (const [url, wantStatus, wantLocation] of cases) {
        const res = await request(app).get(url);
        const loc = res.headers.location;
        if (res.status !== wantStatus) {
            console.error(`FAIL ${url}: status ${res.status}, want ${wantStatus}`);
            failed++;
            continue;
        }
        if (wantLocation != null && loc !== wantLocation) {
            console.error(`FAIL ${url}: Location "${loc}", want "${wantLocation}"`);
            failed++;
            continue;
        }
        console.log(`OK   ${wantStatus} ${url} -> ${loc || res.text}`);
    }

    if (failed) {
        process.exit(1);
    }
    console.log('\nAll spot-check redirect checks passed.');

    await verifyFullCsv(app);
    console.log('\nDone.');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
