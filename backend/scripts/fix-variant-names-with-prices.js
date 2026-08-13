#!/usr/bin/env node
/**
 * Move prices embedded in variant names into the price field.
 * Excludes Newton Labs Bladder and Kidney (handled manually).
 *
 * Usage:
 *   node scripts/fix-variant-names-with-prices.js --dry-run
 *   node scripts/fix-variant-names-with-prices.js --apply
 */
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const {
    parsePriceFromLabel,
    labelWithoutPrice,
} = require('../utils/extractHmherbsVariants');

loadBackendEnv();

const dryRun = !process.argv.includes('--apply');
const EXCLUDE_PRODUCT_PATTERNS = [/newton\s*labs.*bladder.*kidney/i, /bladder.*kidney.*newton/i];

function cleanVariantName(name) {
    let cleaned = String(name).trim();
    cleaned = cleaned.replace(/\s*=\s*\$\s*[\d,.]+\s*$/i, '').trim();
    cleaned = labelWithoutPrice(cleaned);
    cleaned = cleaned.replace(/\s*\(\s*\$\s*[\d,.]+\s*\)\s*$/i, '').trim();
    cleaned = cleaned.replace(/\s*\$\s*[\d,.]+\s*$/i, '').trim();
    cleaned = cleaned.replace(/\s*-\s*\$\s*[\d,.]+\s*$/i, '').trim();
    cleaned = cleaned.replace(/-\$\s*[\d,.]+\s*$/i, '').trim();
    return cleaned || String(name).trim();
}

function extractPriceFromName(name) {
    const salePrice = String(name).match(/=\s*\$\s*([\d,.]+)\s*$/i);
    if (salePrice) {
        const n = parseFloat(salePrice[1].replace(/,/g, ''));
        if (Number.isFinite(n)) return n;
    }

    const trailing = parsePriceFromLabel(name);
    if (trailing != null) return trailing;

    const paren = String(name).match(/\(\s*\$\s*([\d,.]+)\s*\)/i);
    if (paren) {
        const n = parseFloat(paren[1].replace(/,/g, ''));
        if (Number.isFinite(n)) return n;
    }

    const inline = String(name).match(/\$\s*([\d,.]+)/);
    if (inline) {
        const n = parseFloat(inline[1].replace(/,/g, ''));
        if (Number.isFinite(n)) return n;
    }

    return null;
}

function nameHasPrice(name) {
    return /\$\s*[\d,.]+/.test(String(name)) || /\(\s*\$\s*[\d,.]+\s*\)/.test(String(name));
}

function isExcludedProduct(productName) {
    return EXCLUDE_PRODUCT_PATTERNS.some((re) => re.test(String(productName || '')));
}

async function main() {
    const pool = createPool();
    const [rows] = await pool.query(`
        SELECT pv.id, pv.product_id, pv.sku, pv.name, pv.price, p.name AS product_name
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE pv.is_active = 1
        ORDER BY p.name, pv.sort_order, pv.id
    `);

    const candidates = rows.filter((row) => nameHasPrice(row.name) && !isExcludedProduct(row.product_name));

    console.log(`Found ${candidates.length} variant(s) with price in name (${dryRun ? 'dry run' : 'apply'})`);
    if (!candidates.length) {
        await pool.end();
        return;
    }

    let updated = 0;
    for (const row of candidates) {
        const parsedPrice = extractPriceFromName(row.name);
        const cleanedName = cleanVariantName(row.name);
        const currentPrice = parseFloat(row.price);
        const newPrice =
            parsedPrice != null && Number.isFinite(parsedPrice)
                ? parsedPrice
                : Number.isFinite(currentPrice)
                  ? currentPrice
                  : 0;

        if (cleanedName === row.name && parsedPrice == null) continue;
        if (cleanedName === row.name && Math.abs(newPrice - currentPrice) < 0.001) continue;

        console.log(
            `#${row.id} ${row.product_name}\n` +
                `  was: "${row.name}" @ $${currentPrice}\n` +
                `  now: "${cleanedName}" @ $${newPrice.toFixed(2)}`
        );

        if (!dryRun) {
            await pool.query('UPDATE product_variants SET name = ?, price = ? WHERE id = ?', [
                cleanedName,
                newPrice,
                row.id,
            ]);
        }
        updated += 1;
    }

    console.log(`\n${dryRun ? 'Would update' : 'Updated'}: ${updated}`);
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
