#!/usr/bin/env node
'use strict';

/**
 * Smoke test: public APIs, POS routes, and static asset references.
 * Run: node scripts/smoke-features.js [--base http://127.0.0.1:3001]
 */

const fs = require('fs');
const path = require('path');

const BASE = (() => {
    const i = process.argv.indexOf('--base');
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/+$/, '');
    return 'http://127.0.0.1:3001';
})();

const ROOT = path.resolve(__dirname, '..', '..');
const POS_ROOT = path.resolve(ROOT, '..', 'business-one-pos');

const results = [];

function pass(name, detail = '') {
    results.push({ ok: true, name, detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
    results.push({ ok: false, name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function fetchJson(urlPath, opts = {}) {
    const res = await fetch(`${BASE}${urlPath}`, {
        ...opts,
        headers: { Accept: 'application/json', ...(opts.headers || {}) },
    });
    let body = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        try {
            body = await res.json();
        } catch {
            body = null;
        }
    }
    return { status: res.status, body, ok: res.ok };
}

function readFile(relFromRoot) {
    return fs.readFileSync(path.join(ROOT, relFromRoot), 'utf8');
}

function extractScriptSrc(html) {
    const srcs = [];
    const re = /<script[^>]+src=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html))) srcs.push(m[1]);
    return srcs;
}

function resolveStatic(rel, fromDir) {
    if (rel.startsWith('http://') || rel.startsWith('https://') || rel.startsWith('//')) return null;
    const clean = rel.replace(/^\//, '').split('?')[0];
    if (fromDir === 'pos') return path.join(POS_ROOT, clean);
    return path.join(ROOT, clean);
}

async function testPublicApis() {
    console.log('\nPublic API endpoints');
    const health = await fetchJson('/api/health');
    if (health.status === 200) pass('/api/health', `status ${health.status}`);
    else fail('/api/health', `HTTP ${health.status}`);

    const ready = await fetchJson('/api/health/ready');
    if (ready.status === 200 && ready.body?.database) {
        pass('/api/health/ready', `db=${ready.body.database}`);
    } else if (ready.status === 200) {
        pass('/api/health/ready', 'responded');
    } else {
        fail('/api/health/ready', `HTTP ${ready.status}`);
    }

    const products = await fetchJson('/api/products?limit=1');
    if (products.status === 200 && Array.isArray(products.body?.products ?? products.body)) {
        pass('/api/products', 'returns product list');
    } else if (products.status === 200) {
        pass('/api/products', 'HTTP 200');
    } else {
        fail('/api/products', `HTTP ${products.status}`);
    }

    const store = await fetchJson('/api/store-info');
    if (store.status === 200) pass('/api/store-info');
    else fail('/api/store-info', `HTTP ${store.status}`);

    const banner = await fetchJson('/api/promo-banner');
    if (banner.status === 200) pass('/api/promo-banner');
    else fail('/api/promo-banner', `HTTP ${banner.status}`);

    const categories = await fetchJson('/api/categories');
    if (categories.status === 200) pass('/api/categories');
    else fail('/api/categories', `HTTP ${categories.status}`);

    const paymentCfg = await fetchJson('/api/payments/nmi-client-config');
    if (paymentCfg.status === 200 || paymentCfg.status === 503) {
        pass('/api/payments/nmi-client-config', `HTTP ${paymentCfg.status}`);
    } else {
        fail('/api/payments/nmi-client-config', `HTTP ${paymentCfg.status}`);
    }
}

async function testPosApis() {
    console.log('\nPOS API (unauthenticated expectations)');
    const posHealth = await fetchJson('/api/pos/v1/health');
    if (posHealth.status === 200 && posHealth.body?.ok) {
        pass('/api/pos/v1/health', 'with device auth would return ok');
    } else if (posHealth.status === 401 || posHealth.status === 403) {
        pass('/api/pos/v1/health', 'requires device auth (expected without key)');
    } else {
        fail('/api/pos/v1/health', `HTTP ${posHealth.status}`);
    }

    const config = await fetchJson('/api/pos/v1/config');
    if (config.status === 401 || config.status === 403) {
        pass('/api/pos/v1/config', 'requires device auth');
    } else {
        fail('/api/pos/v1/config', `expected 401/403, got ${config.status}`);
    }

    const displayAds = await fetchJson('/api/pos/v1/display/ads');
    if (displayAds.status === 401 || displayAds.status === 403) {
        pass('/api/pos/v1/display/ads', 'requires device auth');
    } else {
        fail('/api/pos/v1/display/ads', `expected 401/403, got ${displayAds.status}`);
    }
}

function testStaticAssets() {
    console.log('\nStatic script references');
    const pages = [
        { file: 'checkout.html', dir: 'site' },
        { file: 'index.html', dir: 'site' },
        { file: 'admin.html', dir: 'site' },
    ];
    for (const { file, dir } of pages) {
        const html = readFile(file);
        for (const src of extractScriptSrc(html)) {
            const abs = resolveStatic(src, dir);
            if (!abs) continue;
            if (fs.existsSync(abs)) pass(`${file} → ${src}`);
            else fail(`${file} → ${src}`, 'file missing');
        }
    }

    if (fs.existsSync(POS_ROOT)) {
        const posHtml = fs.readFileSync(path.join(POS_ROOT, 'index.html'), 'utf8');
        for (const src of extractScriptSrc(posHtml)) {
            const abs = resolveStatic(src, 'pos');
            if (!abs) continue;
            if (fs.existsSync(abs)) pass(`POS index.html → ${src}`);
            else fail(`POS index.html → ${src}`, 'file missing');
        }

        const sw = fs.readFileSync(path.join(POS_ROOT, 'service-worker.js'), 'utf8');
        const assetMatch = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
        if (assetMatch) {
            const assets = [...assetMatch[1].matchAll(/['"](\.\/[^'"]+)['"]/g)].map((m) => m[1]);
            for (const asset of assets) {
                const abs = path.join(POS_ROOT, asset.replace(/^\.\//, ''));
                if (fs.existsSync(abs)) pass(`service-worker ASSETS → ${asset}`);
                else fail(`service-worker ASSETS → ${asset}`, 'file missing');
            }
        }
    } else {
        fail('business-one-pos', 'directory not found');
    }
}

function testAdminFormWiring() {
    console.log('\nAdmin POS settings form wiring');
    const html = readFile('admin.html');
    const formMatch = html.match(/<form id="pos-settings-form">([\s\S]*?)<\/form>/);
    if (!formMatch) {
        fail('pos-settings-form', 'form not found');
        return;
    }
    const formHtml = formMatch[1];
    const names = [...formHtml.matchAll(/name=["']([^"']+)["']/g)].map((m) => m[1]);
    const unique = [...new Set(names)];
    const adminJs = readFile('admin-app.js');
    const missingApply = [];
    const missingBuild = [];
    for (const name of unique) {
        if (!adminJs.includes(`[name="${name}"]`) && !adminJs.includes(`'${name}'`)) {
            missingBuild.push(name);
        }
    }
    const requiredKeys = ['pos_hardware_printer', 'pos_card_display_mode', 'pos_poi_device_id'];
    for (const key of requiredKeys) {
        if (html.includes(`name="${key}"`)) pass(`admin field ${key}`, 'present in HTML');
        else fail(`admin field ${key}`, 'missing from HTML');
        if (adminJs.includes(key)) pass(`admin-app.js handles ${key}`);
        else fail(`admin-app.js handles ${key}`, 'not referenced');
    }
    if (missingBuild.length) {
        fail('pos-settings-form names in admin-app.js', missingBuild.slice(0, 8).join(', '));
    } else {
        pass('pos-settings-form', `${unique.length} named controls referenced`);
    }
}

async function main() {
    console.log(`Smoke test — base URL: ${BASE}`);
    await testPublicApis();
    await testPosApis();
    testStaticAssets();
    testAdminFormWiring();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('\nFailed:');
        for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
        process.exit(1);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
