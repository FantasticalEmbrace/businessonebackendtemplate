#!/usr/bin/env node
/**
 * Remove brand prefixes from product display names while keeping brand_id intact.
 *
 * Usage (from backend/):
 *   node scripts/strip-brand-from-product-names.js --dry-run
 *   node scripts/strip-brand-from-product-names.js
 *   node scripts/strip-brand-from-product-names.js --brand "Newton Labs"
 */
const { createPool } = require('../utils/dbConfig');

function parseArgs() {
    const args = process.argv.slice(2);
    const brandIdx = args.indexOf('--brand');
    return {
        dryRun: args.includes('--dry-run'),
        brandFilter: brandIdx >= 0 && args[brandIdx + 1] ? args[brandIdx + 1] : null
    };
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCaseWords(text) {
    return String(text || '')
        .split(/[\s-]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

function buildBrandVariants(brandName, brandSlug) {
    const variants = new Set();
    const name = String(brandName || '').trim();
    const slug = String(brandSlug || '').trim();

    if (name) {
        variants.add(name);
        variants.add(name.replace(/['']/g, ''));
        variants.add(name.replace(/['']s\b/gi, 's'));
        variants.add(name.replace(/\bs\b/gi, ''));
        variants.add(name.replace(/\./g, ''));
    }

    if (slug) {
        variants.add(slug);
        variants.add(slug.replace(/-/g, ' '));
        variants.add(titleCaseWords(slug.replace(/-/g, ' ')));
    }

    return [...variants]
        .map((value) => value.trim())
        .filter((value) => value.length >= 2)
        .sort((a, b) => b.length - a.length);
}

function stripBrandPrefix(productName, brandName, brandSlug) {
    const original = String(productName || '').trim();
    if (!original) return null;

    const variants = buildBrandVariants(brandName, brandSlug);
    for (const variant of variants) {
        const pattern = new RegExp(`^${escapeRegex(variant)}(?:['']s)?(?:[\\s\\-–—:|/]+|$)`, 'i');
        if (!pattern.test(original)) continue;

        const stripped = original.replace(pattern, '').trim().replace(/^[\-–—:|/]+/, '').trim();
        if (stripped && stripped.toLowerCase() !== original.toLowerCase()) {
            return stripped;
        }
    }

    return null;
}

async function main() {
    const options = parseArgs();
    const pool = createPool({ connectionLimit: 5 });

    try {
        let query = `
            SELECT p.id, p.sku, p.name, p.brand_id, b.name AS brand_name, b.slug AS brand_slug
            FROM products p
            JOIN brands b ON p.brand_id = b.id
            WHERE p.is_active = 1
              AND b.name NOT IN ('Unknown', 'Miscellaneous')
        `;
        const params = [];
        if (options.brandFilter) {
            query += ' AND (b.name = ? OR b.slug = ?)';
            params.push(options.brandFilter, options.brandFilter);
        }
        query += ' ORDER BY b.name, p.name';

        const [products] = await pool.execute(query, params);
        const updates = [];

        for (const product of products) {
            const newName = stripBrandPrefix(product.name, product.brand_name, product.brand_slug);
            if (!newName) continue;
            updates.push({
                id: product.id,
                sku: product.sku,
                brand: product.brand_name,
                oldName: product.name,
                newName
            });
        }

        console.log(`Scanned ${products.length} products`);
        console.log(`Names to update: ${updates.length}${options.dryRun ? ' (dry run)' : ''}`);

        if (updates.length) {
            console.log('\nSample changes:');
            for (const row of updates.slice(0, 25)) {
                console.log(`  [${row.brand}] ${row.oldName} -> ${row.newName}`);
            }
            if (updates.length > 25) {
                console.log(`  ... and ${updates.length - 25} more`);
            }
        }

        if (!updates.length || options.dryRun) {
            if (options.dryRun && updates.length) {
                console.log('\nDry run complete. Re-run without --dry-run to apply.');
            }
            return;
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            for (const row of updates) {
                await connection.execute(
                    'UPDATE products SET name = ?, updated_at = NOW() WHERE id = ?',
                    [row.newName, row.id]
                );
            }
            await connection.commit();
            console.log(`\nUpdated ${updates.length} product names.`);
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Strip brand names failed:', err.message);
        process.exit(1);
    });
}

module.exports = {
    stripBrandPrefix,
    buildBrandVariants
};
