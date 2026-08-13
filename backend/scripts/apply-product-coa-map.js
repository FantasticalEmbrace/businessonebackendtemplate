#!/usr/bin/env node
/**
 * Set coa_url + is_cannabis for products (paths are served from site root).
 *
 * Usage (from backend/): node scripts/apply-product-coa-map.js
 * Optional: --dry-run, --force (overwrite existing coa_url)
 */

const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { applyProductCoaMap, PRODUCT_COA_MAP } = require('../utils/applyProductCoaMap');

(async () => {
    loadBackendEnv();
    const dryRun = process.argv.includes('--dry-run');
    const force = process.argv.includes('--force');
    const pool = createPool({ connectionLimit: 2 });

    console.log(dryRun ? 'DRY RUN\n' : force ? 'Applying COA map (force)…\n' : 'Applying COA map…\n');

    if (dryRun) {
        for (const row of PRODUCT_COA_MAP) {
            const [products] = await pool.query('SELECT id, name, coa_url FROM products WHERE slug = ? LIMIT 1', [
                row.slug
            ]);
            if (!products.length) {
                console.warn(`SKIP: no product with slug "${row.slug}"`);
                continue;
            }
            const p = products[0];
            const hasCoa = p.coa_url && String(p.coa_url).trim() !== '';
            if (hasCoa && !force) {
                console.log(`Keep existing ${row.slug} → ${p.coa_url}`);
                continue;
            }
            console.log(`Would set ${row.slug} (${p.name})\n  → ${row.coa_url}\n`);
        }
    } else {
        const result = await applyProductCoaMap(pool, { force });
        console.log(`Applied: ${result.applied}, skipped (already set): ${result.skipped}`);
        if (result.missing.length) {
            console.warn('Missing products:', result.missing.join(', '));
        }
    }

    await pool.end();
    console.log('\nDone.');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
