#!/usr/bin/env node
/**
 * Pre-launch SEO migration verification (run from repo root).
 *   node scripts/seo-migration/verify-seo-migration.js
 *   node scripts/seo-migration/verify-seo-migration.js --live http://localhost:3001
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const http = require('http');
const https = require('https');

const rootDir = path.join(__dirname, '..', '..');

function runStep(label, cmd, args, cwd) {
    console.log(`\n=== ${label} ===`);
    const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
    if (r.status !== 0) {
        throw new Error(`${label} failed (exit ${r.status})`);
    }
}

function checkFiles() {
    const required = [
        'redirects-301.csv',
        'redirects-legacy-sitemap.csv',
        'redirects-products-db.csv',
        'sitemap.xml',
        'sitemap-pages.xml',
        'sitemap-products.xml',
        'robots.txt'
    ];
    for (const f of required) {
        const fp = path.join(rootDir, f);
        if (!fs.existsSync(fp)) {
            throw new Error(`Missing required file: ${f}`);
        }
    }
    const index = fs.readFileSync(path.join(rootDir, 'sitemap.xml'), 'utf8');
    if (!index.includes('sitemap-pages.xml') || !index.includes('sitemap-products.xml')) {
        throw new Error('sitemap.xml must reference sitemap-pages.xml and sitemap-products.xml');
    }
    if (index.includes('localhost')) {
        console.warn('WARN: sitemap.xml still references localhost — run npm run seo:generate-sitemap -- --base-url https://hmherbs.com');
    }
    console.log('OK   Required SEO files present');
}

function fetchHead(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.request(url, { method: 'HEAD', timeout: 15000 }, (res) => {
            res.resume();
            resolve({
                status: res.statusCode,
                location: res.headers.location || null
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.end();
    });
}

async function liveSpotChecks(base) {
    const baseUrl = base.replace(/\/+$/, '');
    const redirectCases = [
        ['/index.php', 301, '/'],
        ['/categories/herbs', 301, '/categories.html'],
        ['/health-conditions/immune', 301, '/products.html?category=immune'],
        ['/brands', 301, '/brands.html']
    ];
    const staticCases = [['/sitemap.xml', 200], ['/robots.txt', 200]];

    console.log(`\n=== Live spot checks (${baseUrl}) ===`);
    console.log('(Restart the Node server after updating redirect CSVs or middleware.)');
    let failed = 0;

    for (const [pathname, wantStatus, wantLoc] of redirectCases) {
        try {
            const res = await fetchHead(`${baseUrl}${pathname}`);
            const loc = res.location ? new URL(res.location, baseUrl).pathname + new URL(res.location, baseUrl).search : '';
            const ok = res.status === wantStatus && (!wantLoc || loc === wantLoc);
            if (!ok) {
                console.error(
                    `FAIL ${pathname}: ${res.status} → ${res.location || '(none)'} (want ${wantStatus} → ${wantLoc})`
                );
                failed++;
            } else {
                console.log(`OK   ${pathname} → ${res.status} ${res.location}`);
            }
        } catch (e) {
            console.error(`FAIL ${pathname}: ${e.message}`);
            failed++;
        }
    }

    for (const [pathname, wantStatus] of staticCases) {
        try {
            const res = await fetchHead(`${baseUrl}${pathname}`);
            if (res.status !== wantStatus) {
                console.error(`FAIL ${pathname}: ${res.status} (want ${wantStatus})`);
                failed++;
            } else {
                console.log(`OK   ${pathname} → ${res.status}`);
            }
        } catch (e) {
            console.error(`FAIL ${pathname}: ${e.message}`);
            failed++;
        }
    }

    if (failed) {
        throw new Error(
            `${failed} live check(s) failed — start/restart backend (npm run dev:backend) so new redirect files load.`
        );
    }
}

async function main() {
    const liveIdx = process.argv.indexOf('--live');
    const liveBase = liveIdx >= 0 ? process.argv[liveIdx + 1] : null;

    console.log('SEO migration verification\n');

    runStep(
        'Regenerate DB product redirects',
        'node',
        [path.join(rootDir, 'scripts', 'seo-migration', 'generate-db-product-redirects.js')],
        rootDir
    );

    runStep(
        'Map old Concrete slugs → current DB slugs',
        'node',
        [path.join(rootDir, 'scripts', 'seo-migration', 'generate-slug-alias-redirects.js')],
        rootDir
    );

    runStep(
        'Resolve remaining unmatched old slugs',
        'node',
        [path.join(rootDir, 'scripts', 'seo-migration', 'resolve-unmatched-slugs.js')],
        rootDir
    );

    runStep(
        'Validate alias targets exist in DB',
        'node',
        [path.join(rootDir, 'scripts', 'seo-migration', 'validate-alias-targets.js')],
        rootDir
    );

    checkFiles();

    runStep(
        'Redirect middleware tests',
        'node',
        [path.join(rootDir, 'scripts', 'seo-migration', 'test-seo-redirects.js')],
        path.join(rootDir, 'backend')
    );

    runStep(
        'Product slug redirect audit',
        'node',
        [path.join(rootDir, 'scripts', 'seo-migration', 'audit-product-redirects.js')],
        rootDir
    );

    if (liveBase) {
        await liveSpotChecks(liveBase);
    } else {
        console.log('\n(Tip: add --live http://localhost:3001 after starting the server for HTTP checks)');
    }

    console.log('\nAll SEO migration checks passed.');
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
