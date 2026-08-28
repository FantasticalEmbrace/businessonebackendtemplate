'use strict';

/**
 * Local proof: two merchants, key resolve, catalog isolation (shared schema).
 * Does not deploy to Linode.
 *
 * Usage (from business-one-merchant-platform/backend):
 *   node scripts/prove-shared-tenancy.js
 *
 * Requires MERCHANT_TENANCY=shared and a working MySQL (products table present).
 */

require('dotenv').config();

process.env.MERCHANT_TENANCY = process.env.MERCHANT_TENANCY || 'shared';

const mysql = require('mysql2/promise');
const { ensureTenantsSchema } = require('../utils/ensureTenantsSchema');
const {
    provisionTenant,
    resolveByKey,
    registerDeviceKey
} = require('../services/tenantProvision');

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
        waitForConnections: true,
        connectionLimit: 4
    });

    console.log('ensureTenantsSchema…');
    await ensureTenantsSchema(pool);

    const stamp = Date.now().toString(36);
    const emailA = `tenancy-a-${stamp}@bo-local.test`;
    const emailB = `tenancy-b-${stamp}@bo-local.test`;

    console.log('provision merchant A…');
    const a = await provisionTenant(pool, {
        businessName: `Tenancy Shop A ${stamp}`,
        billingEmail: emailA
    });
    assert(a.merchant?.id, 'merchant A missing id');
    assert(a.websiteApiKey, 'merchant A missing website key');

    console.log('provision merchant B…');
    const b = await provisionTenant(pool, {
        businessName: `Tenancy Shop B ${stamp}`,
        billingEmail: emailB
    });
    assert(b.merchant?.id, 'merchant B missing id');
    assert(b.websiteApiKey, 'merchant B missing website key');
    assert(a.merchant.id !== b.merchant.id, 'merchants must be distinct');

    console.log('idempotent re-provision A…');
    const a2 = await provisionTenant(pool, {
        businessName: `Tenancy Shop A ${stamp}`,
        billingEmail: emailA
    });
    assert(a2.alreadyProvisioned === true, 'expected alreadyProvisioned');
    assert(a2.merchant.id === a.merchant.id, 'idempotent id mismatch');

    const [[brand]] = await pool.execute(`SELECT id FROM brands ORDER BY id ASC LIMIT 1`);
    const [[cat]] = await pool.execute(`SELECT id FROM product_categories ORDER BY id ASC LIMIT 1`);
    assert(brand?.id && cat?.id, 'need at least one brand and category for product insert');

    const skuA = `ISO-A-${stamp}`;
    const skuB = `ISO-B-${stamp}`;
    await pool.execute(
        `INSERT INTO products (sku, name, slug, brand_id, category_id, price, is_active, merchant_id)
         VALUES (?, ?, ?, ?, ?, 9.99, 1, ?)`,
        [skuA, `Isolated A ${stamp}`, `iso-a-${stamp}`, brand.id, cat.id, a.merchant.id]
    );
    await pool.execute(
        `INSERT INTO products (sku, name, slug, brand_id, category_id, price, is_active, merchant_id)
         VALUES (?, ?, ?, ?, ?, 19.99, 1, ?)`,
        [skuB, `Isolated B ${stamp}`, `iso-b-${stamp}`, brand.id, cat.id, b.merchant.id]
    );

    const [catA] = await pool.execute(
        `SELECT sku FROM products WHERE merchant_id = ? AND sku IN (?, ?)`,
        [a.merchant.id, skuA, skuB]
    );
    const [catB] = await pool.execute(
        `SELECT sku FROM products WHERE merchant_id = ? AND sku IN (?, ?)`,
        [b.merchant.id, skuA, skuB]
    );
    assert(catA.length === 1 && catA[0].sku === skuA, 'A must only see own SKU');
    assert(catB.length === 1 && catB[0].sku === skuB, 'B must only see own SKU');

    const resolvedA = await resolveByKey(pool, { websiteApiKey: a.websiteApiKey });
    const resolvedB = await resolveByKey(pool, { websiteApiKey: b.websiteApiKey });
    assert(resolvedA?.id === a.merchant.id, 'website key A resolve failed');
    assert(resolvedB?.id === b.merchant.id, 'website key B resolve failed');

    const deviceKey = `pos1_test_${stamp}`;
    await registerDeviceKey(pool, a.merchant.id, deviceKey, 'e2e-register');
    const resolvedDevice = await resolveByKey(pool, { deviceKey });
    assert(resolvedDevice?.id === a.merchant.id, 'device key must resolve to A');

    // Cleanup isolation products (leave merchants for Ops visibility / optional delete)
    await pool.execute(`DELETE FROM products WHERE sku IN (?, ?)`, [skuA, skuB]);

    console.log('OK — shared tenancy local proof passed');
    console.log(
        JSON.stringify(
            {
                merchantA: a.merchant.id,
                merchantB: b.merchant.id,
                websiteKeyPrefixA: a.websiteApiKey.slice(0, 12),
                websiteKeyPrefixB: b.websiteApiKey.slice(0, 12),
                deviceKeyBoundTo: a.merchant.id,
                isolation: 'products scoped by merchant_id'
            },
            null,
            2
        )
    );

    await pool.end();
}

main().catch((e) => {
    console.error('FAIL:', e.message || e);
    process.exit(1);
});
