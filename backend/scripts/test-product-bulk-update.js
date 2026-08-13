#!/usr/bin/env node
'use strict';

/**
 * Verify bulk + single product settings persist (all bulk-edit fields).
 * Run locally: node scripts/test-product-bulk-update.js
 * On Linode:   node scripts/test-product-bulk-update.js --base http://127.0.0.1:3001
 */

const jwt = require('jsonwebtoken');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');

loadBackendEnv();

const BASE = (() => {
    const i = process.argv.indexOf('--base');
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/+$/, '');
    return 'http://127.0.0.1:3001';
})();

const TAG = `BULK-TEST-${Date.now()}`;
let pool;

function pass(name, detail = '') {
    console.log(`  OK ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
}

async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(opts.headers || {})
        }
    });
    let body = null;
    try {
        body = await res.json();
    } catch {
        body = null;
    }
    return { status: res.status, body, ok: res.ok };
}

async function adminToken() {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET missing');
    const [admins] = await pool.execute(
        `SELECT id FROM admin_users WHERE is_active = 1 AND role IN ('developer','admin','manager','super_admin') ORDER BY id ASC LIMIT 1`
    );
    if (!admins.length) throw new Error('No active manager/admin user in database');
    return jwt.sign({ adminId: admins[0].id }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function assertEq(name, actual, expected) {
    const a = actual === true || actual === 1 ? true : actual === false || actual === 0 ? false : actual;
    const e = expected === true || expected === 1 ? true : expected === false || expected === 0 ? false : expected;
    if (a === e || Number(a) === Number(e)) {
        pass(name, String(actual));
        return;
    }
    fail(name, `expected ${expected}, got ${actual}`);
}

async function main() {
    console.log(`Product bulk/single save test (${BASE})\n`);
    pool = await createPool();

    const token = await adminToken();
    const auth = { Authorization: `Bearer ${token}` };

    const [brands] = await pool.execute('SELECT id FROM brands WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
    const [categories] = await pool.execute('SELECT id FROM product_categories ORDER BY id ASC LIMIT 1');
    if (!brands.length || !categories.length) {
        fail('Fixtures', 'Need at least one brand and category');
        return;
    }
    const brandId = brands[0].id;
    const categoryId = categories[0].id;

    const createRes = await api('/api/admin/products', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
            sku: `${TAG}-SKU`,
            name: `${TAG} Product`,
            brand_id: brandId,
            category_id: categoryId,
            price: 9.99,
            inventory_quantity: 1,
            is_active: true,
            show_on_web: false
        })
    });
    if (!createRes.ok) {
        fail('Create test product', `HTTP ${createRes.status} ${JSON.stringify(createRes.body)}`);
        return;
    }
    pass('Create test product');

    const [createdRows] = await pool.execute('SELECT id FROM products WHERE sku = ? LIMIT 1', [`${TAG}-SKU`]);
    const productId = createdRows[0]?.id;
    if (!productId) {
        fail('Lookup test product', 'Not found after create');
        return;
    }

    const bulkUpdates = {
        brand_id: brandId,
        category_id: categoryId,
        price: 24.99,
        cost_price: 11.5,
        compare_price: 29.99,
        weight: 4.25,
        inventory_quantity: 88,
        low_stock_threshold: 7,
        is_active: false,
        is_featured: true,
        show_on_web: true,
        is_cannabis: false
    };

    const bulkRes = await api('/api/admin/products/bulk', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ ids: [productId], updates: bulkUpdates })
    });
    if (!bulkRes.ok) {
        fail('Bulk update all fields', `HTTP ${bulkRes.status} ${JSON.stringify(bulkRes.body)}`);
    } else {
        pass('Bulk update all fields', bulkRes.body?.message || '');
        if (Array.isArray(bulkRes.body?.fields) && bulkRes.body.fields.length === 12) {
            pass('Bulk response lists 12 fields');
        } else {
            fail('Bulk response field list', JSON.stringify(bulkRes.body?.fields));
        }
    }

    const getRes = await api(`/api/admin/products/${productId}`, { headers: auth });
    if (!getRes.ok) {
        fail('Fetch product after bulk', `HTTP ${getRes.status}`);
    } else {
        const p = getRes.body;
        assertEq('bulk brand_id', p.brand_id, brandId);
        assertEq('bulk category_id', p.category_id, categoryId);
        assertEq('bulk price', Number(p.price), 24.99);
        assertEq('bulk cost_price', Number(p.cost_price), 11.5);
        assertEq('bulk compare_price', Number(p.compare_price), 29.99);
        assertEq('bulk weight', Number(p.weight), 4.25);
        assertEq('bulk inventory_quantity', p.inventory_quantity, 88);
        assertEq('bulk low_stock_threshold', p.low_stock_threshold, 7);
        assertEq('bulk is_active', p.is_active, false);
        assertEq('bulk is_featured', p.is_featured, true);
        assertEq('bulk show_on_web', p.show_on_web, true);
        assertEq('bulk is_cannabis', p.is_cannabis, false);
    }

    const presetRes = await api('/api/admin/products/bulk', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ ids: [productId], action: 'activate' })
    });
    if (!presetRes.ok) fail('Preset activate', `HTTP ${presetRes.status}`);
    else pass('Preset activate');

    const putRes = await api(`/api/admin/products/${productId}`, {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({
            name: `${TAG} Product Updated`,
            short_description: 'Bulk test short',
            long_description: 'Bulk test long',
            price: 19.99,
            cost_price: null,
            compare_price: null,
            weight: null,
            inventory_quantity: 12,
            low_stock_threshold: 3,
            is_active: true,
            is_featured: false,
            show_on_web: false,
            is_cannabis: false,
            brand_id: brandId,
            category_id: categoryId
        })
    });
    if (!putRes.ok) fail('Single product PUT', `HTTP ${putRes.status} ${JSON.stringify(putRes.body)}`);
    else pass('Single product PUT');

    const get2 = await api(`/api/admin/products/${productId}`, { headers: auth });
    if (get2.ok) {
        const p = get2.body;
        assertEq('single name', p.name, `${TAG} Product Updated`);
        assertEq('single short_description', p.short_description, 'Bulk test short');
        assertEq('single price', Number(p.price), 19.99);
        assertEq('single cost_price cleared', p.cost_price, null);
        assertEq('single show_on_web', p.show_on_web, false);
    }

    await pool.execute('DELETE FROM products WHERE id = ?', [productId]);
    pass('Cleanup test product');

    if (process.exitCode) {
        console.error('\nSome product save tests failed.');
    } else {
        console.log('\nAll product bulk + single save tests passed.');
    }

    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
