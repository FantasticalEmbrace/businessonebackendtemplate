'use strict';

/**
 * Storefront list/detail should show products.price as the *primary* (base) catalog
 * price — not the cheapest accessory/add-on variant.
 *
 * Primary variant = SKU match to parent, else lowest sort_order (then id).
 * Parent row is kept in sync on variant save; helpers backfill when that sync was missed.
 */

function parsePositivePrice(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function needsVariantPriceFallback(price) {
    const cur = parseFloat(price);
    return !Number.isFinite(cur) || cur <= 0;
}

function isActiveVariant(v) {
    return v && (v.is_active === undefined || v.is_active === 1 || v.is_active === true);
}

function activePricedVariants(variants) {
    if (!Array.isArray(variants) || !variants.length) return [];
    return variants.filter((v) => isActiveVariant(v) && parsePositivePrice(v.price) != null);
}

/**
 * Prefer the catalog/base SKU; otherwise the first option by sort_order (then id).
 * Never use Math.min(price) — that surfaces cheap accessories as the product price.
 */
function pickPrimaryVariant(variants, productSku) {
    const list = activePricedVariants(variants);
    if (!list.length) return null;

    const sku = String(productSku || '').trim().toUpperCase();
    if (sku) {
        const bySku = list.find((v) => String(v.sku || '').trim().toUpperCase() === sku);
        if (bySku) return bySku;
    }

    return [...list].sort((a, b) => {
        const so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
        if (so !== 0) return so;
        return (Number(a.id) || 0) - (Number(b.id) || 0);
    })[0];
}

function primaryActiveVariantPrice(variants, productSku) {
    const primary = pickPrimaryVariant(variants, productSku);
    return primary ? parsePositivePrice(primary.price) : null;
}

/** @deprecated Prefer primaryActiveVariantPrice — kept for callers that need lowest price. */
function minActiveVariantPrice(variants) {
    const prices = activePricedVariants(variants)
        .map((v) => parsePositivePrice(v.price))
        .filter((p) => p != null);
    return prices.length ? Math.min(...prices) : null;
}

function applyVariantPriceFallback(row, displayPrice) {
    if (!row || displayPrice == null) return row;
    if (!needsVariantPriceFallback(row.price)) return row;
    row.price = displayPrice;
    return row;
}

/**
 * Batch-enrich listing rows when parent price is missing but variants have prices.
 * Uses primary (sort_order) variant, not MIN(price).
 */
async function enrichProductListPricesFromVariants(pool, products) {
    if (!pool || !Array.isArray(products) || !products.length) return products;

    const ids = products.filter((p) => p && needsVariantPriceFallback(p.price)).map((p) => p.id);
    if (!ids.length) return products;

    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await pool.query(
        `SELECT pv.product_id, pv.price AS primary_price, pv.sku, pv.sort_order, pv.id
         FROM product_variants pv
         INNER JOIN (
             SELECT product_id, MIN(sort_order) AS min_sort
             FROM product_variants
             WHERE product_id IN (${placeholders})
               AND is_active = 1
               AND price > 0
             GROUP BY product_id
         ) t ON t.product_id = pv.product_id AND pv.sort_order = t.min_sort
         WHERE pv.is_active = 1
           AND pv.price > 0
           AND pv.product_id IN (${placeholders})
         ORDER BY pv.product_id, pv.id ASC`,
        [...ids, ...ids]
    );

    const primaryByProduct = new Map();
    for (const r of rows || []) {
        const pid = Number(r.product_id);
        if (primaryByProduct.has(pid)) continue;
        primaryByProduct.set(pid, parsePositivePrice(r.primary_price));
    }

    for (const product of products) {
        const primaryPrice = primaryByProduct.get(Number(product.id));
        applyVariantPriceFallback(product, primaryPrice);
    }

    return products;
}

function applyVariantPriceFallbackFromVariants(row, variants) {
    return applyVariantPriceFallback(row, primaryActiveVariantPrice(variants, row && row.sku));
}

/**
 * Persist parent products.price from the primary active variant (same rule as saveProductVariants).
 */
async function syncParentPriceFromVariants(connection, productId) {
    const [productRows] = await connection.execute('SELECT sku FROM products WHERE id = ? LIMIT 1', [
        productId,
    ]);
    const productSku = productRows[0] && productRows[0].sku;

    const [variants] = await connection.execute(
        `SELECT id, sku, price, inventory_quantity, sort_order
         FROM product_variants
         WHERE product_id = ? AND is_active = 1 AND price > 0`,
        [productId]
    );
    if (!variants.length) return false;

    const primaryPrice = primaryActiveVariantPrice(variants, productSku);
    if (primaryPrice == null) return false;

    const totalInv = variants.reduce((s, v) => s + (parseInt(v.inventory_quantity, 10) || 0), 0);
    await connection.execute('UPDATE products SET price = ?, inventory_quantity = ? WHERE id = ?', [
        primaryPrice,
        totalInv,
        productId,
    ]);
    return true;
}

/**
 * Backfill parent prices from the primary active variant.
 * By default fixes missing/zero parents; pass { fixMismatched: true } to also correct
 * parents that currently show a cheaper non-primary variant price.
 */
async function syncAllParentPricesFromVariants(pool, { dryRun = false, fixMismatched = false } = {}) {
    const [rows] = await pool.query(
        `SELECT p.id, p.name, p.sku, p.price AS current_price,
                COUNT(pv.id) AS variant_count
         FROM products p
         INNER JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1 AND pv.price > 0
         GROUP BY p.id, p.name, p.sku, p.price
         HAVING (
             p.price IS NULL OR p.price <= 0
             ${fixMismatched ? 'OR 1=1' : ''}
         )
         ORDER BY p.id`
    );

    const candidates = [];
    for (const row of rows) {
        const [variants] = await pool.query(
            `SELECT id, sku, price, sort_order, is_active
             FROM product_variants
             WHERE product_id = ? AND is_active = 1 AND price > 0`,
            [row.id]
        );
        const primaryPrice = primaryActiveVariantPrice(variants, row.sku);
        if (primaryPrice == null) continue;
        const current = parsePositivePrice(row.current_price);
        const needsUpdate = current == null || Math.abs(current - primaryPrice) > 0.001;
        if (!needsUpdate) continue;
        candidates.push({
            ...row,
            primary_variant_price: primaryPrice,
            min_variant_price: minActiveVariantPrice(variants),
        });
    }

    if (dryRun) {
        return { updated: 0, candidates };
    }

    let updated = 0;
    const conn = await pool.getConnection();
    try {
        for (const row of candidates) {
            const ok = await syncParentPriceFromVariants(conn, row.id);
            if (ok) updated += 1;
        }
    } finally {
        conn.release();
    }

    return { updated, candidates };
}

module.exports = {
    needsVariantPriceFallback,
    pickPrimaryVariant,
    primaryActiveVariantPrice,
    minActiveVariantPrice,
    applyVariantPriceFallback,
    applyVariantPriceFallbackFromVariants,
    enrichProductListPricesFromVariants,
    syncParentPriceFromVariants,
    syncAllParentPricesFromVariants,
};
