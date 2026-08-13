#!/usr/bin/env node
'use strict';

/**
 * Backfill products.price from the lowest active variant price when parent price is 0.
 *
 *   node scripts/sync-parent-prices-from-variants.js --dry-run
 *   node scripts/sync-parent-prices-from-variants.js --apply
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const { buildDbConfig } = require('../utils/dbConfig');
const { syncAllParentPricesFromVariants } = require('../utils/storefrontProductPrice');

async function main() {
    const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
    const pool = mysql.createPool(buildDbConfig());

    try {
        const result = await syncAllParentPricesFromVariants(pool, { dryRun });
        const candidates = result.candidates || [];

        console.log(
            dryRun
                ? `Dry run: ${candidates.length} product(s) would update parent price from variants`
                : `Updated parent price on ${result.updated} product(s)`
        );

        for (const row of candidates.slice(0, 50)) {
            console.log(
                `  #${row.id} ${row.sku || '—'} ${String(row.name || '').slice(0, 60)} → $${Number(row.min_variant_price).toFixed(2)}`
            );
        }
        if (candidates.length > 50) {
            console.log(`  … and ${candidates.length - 50} more`);
        }

        if (dryRun && candidates.length) {
            console.log('\nRe-run with --apply to write changes.');
        }
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
