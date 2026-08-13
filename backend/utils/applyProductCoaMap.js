'use strict';

const { PRODUCT_COA_MAP } = require('./productCoaMap');

/**
 * Apply COA URLs to products. Skips rows that already have coa_url unless force=true.
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ force?: boolean, slugs?: string[] }} [opts]
 * @returns {Promise<{ applied: number, skipped: number, missing: string[] }>}
 */
async function findProductForCoaSlug(pool, slug) {
    const [exact] = await pool.query('SELECT id, name, coa_url, slug FROM products WHERE slug = ? LIMIT 1', [
        slug
    ]);
    if (exact.length) return exact[0];

    const [prefix] = await pool.query(
        'SELECT id, name, coa_url, slug FROM products WHERE slug = ? OR slug LIKE ? ORDER BY LENGTH(slug) ASC LIMIT 1',
        [slug, `${slug}-%`]
    );
    if (prefix.length) return prefix[0];

    const [reverse] = await pool.query(
        'SELECT id, name, coa_url, slug FROM products WHERE ? LIKE CONCAT(slug, \'-%\') ORDER BY LENGTH(slug) DESC LIMIT 1',
        [slug]
    );
    return reverse.length ? reverse[0] : null;
}

async function applyProductCoaMap(pool, opts = {}) {
    const force = Boolean(opts.force);
    const slugFilter = opts.slugs ? new Set(opts.slugs) : null;
    let applied = 0;
    let skipped = 0;
    const missing = [];

    for (const row of PRODUCT_COA_MAP) {
        if (slugFilter && !slugFilter.has(row.slug)) continue;

        const product = await findProductForCoaSlug(pool, row.slug);
        if (!product) {
            missing.push(row.slug);
            continue;
        }

        const hasCoa = product.coa_url && String(product.coa_url).trim() !== '';
        if (hasCoa && !force) {
            skipped++;
            continue;
        }

        await pool.execute(
            `UPDATE products SET coa_url = ?, coa_updated_at = ?, is_cannabis = 1 WHERE id = ?`,
            [row.coa_url, row.coa_updated_at, product.id]
        );
        applied++;
        console.log(`COA ${product.slug} -> ${row.coa_url}`);
    }

    return { applied, skipped, missing };
}

module.exports = { applyProductCoaMap, PRODUCT_COA_MAP };
