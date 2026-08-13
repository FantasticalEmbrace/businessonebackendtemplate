#!/usr/bin/env node
/**
 * Lists hemp/cannabis-flagged products and whether coa_url is set.
 * Run: node scripts/list-cannabis-coa-status.js
 *
 * This does not fetch or upload PDFs — COAs must come from your supplier/lab files
 * or URLs you already have, then use Admin → product → COA upload or bulk tooling.
 */

const { loadBackendEnv, createPool } = require('../utils/dbConfig');

(async () => {
    loadBackendEnv();
    const pool = createPool({ connectionLimit: 2 });

    try {
        const [rows] = await pool.query(`
            SELECT id, sku, name,
                   coa_url,
                   coa_updated_at,
                   CASE WHEN coa_url IS NULL OR TRIM(coa_url) = '' THEN 0 ELSE 1 END AS has_coa
            FROM products
            WHERE is_cannabis = 1 AND is_active = 1
            ORDER BY has_coa ASC, name ASC
        `);

        const missing = rows.filter((r) => !r.coa_url || String(r.coa_url).trim() === '');
        console.log(`Cannabis/hemp products (active): ${rows.length}`);
        console.log(`Missing COA URL: ${missing.length}\n`);

        rows.forEach((r) => {
            const ok = r.coa_url && String(r.coa_url).trim() !== '';
            console.log(`${ok ? '✓' : '✗'} [${r.sku}] ${r.name}`);
            if (ok) console.log(`    ${r.coa_url}`);
        });

        if (missing.length) {
            console.log('\n--- SKUs needing a COA (paste into your checklist) ---');
            console.log(missing.map((m) => m.sku).join(', '));
        }
    } finally {
        await pool.end();
    }
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
