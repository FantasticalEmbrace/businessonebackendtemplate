'use strict';

/**
 * Storefront list/detail should show products.price. For variant products the parent
 * row is kept in sync with the lowest active variant price when variants are saved;
 * these helpers backfill display when that sync was missed.
 */

function parsePositivePrice(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function needsVariantPriceFallback(price) {
    const cur = parseFloat(price);
    return !Number.isFinite(cur) || cur <= 0;
}

function minActiveVariantPrice(variants) {
    if (!Array.isArray(variants) || !variants.length) return null;
    const prices = variants
        .filter((v) => v && (v.is_active === undefined || v.is_active === 1 || v.is_active === true))
        .map((v) => parsePositivePrice(v.price))
        .filter((p) => p != null);
    return prices.length ? Math.min(...prices) : null;
}

function applyVariantPriceFallback(row, minVariantPrice) {
    if (!row || minVariantPrice == null) return row;
    if (!needsVariantPriceFallback(row.price)) return row;
    row.price = minVariantPrice;
    return row;
}

/**
 * Batch-enrich listing rows when parent price is missing but variants have prices.
 */
async function enrichProductListPricesFromVariants(pool, products) {
    if (!pool || !Array.isArray(products) || !products.length) return products;

    const ids = products.filter((p) => p && needsVariantPriceFallback(p.price)).map((p) => p.id);
    if (!ids.length) return products;

    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await pool.query(
        `SELECT product_id, MIN(price) AS min_price
         FROM product_variants
         WHERE product_id IN (${placeholders})
           AND is_active = 1
           AND price > 0
         GROUP BY product_id`,
        ids
    );

    const minByProduct = new Map(
        (rows || []).map((r) => [Number(r.product_id), parsePositivePrice(r.min_price)])
    );

    for (const product of products) {
        const minPrice = minByProduct.get(Number(product.id));
        applyVariantPriceFallback(product, minPrice);
    }

    return products;
}

function applyVariantPriceFallbackFromVariants(row, variants) {
    return applyVariantPriceFallback(row, minActiveVariantPrice(variants));
}

/**
 * Persist parent products.price from lowest active variant (same rule as saveProductVariants).
 */
async function syncParentPriceFromVariants(connection, productId) {
    const [variants] = await connection.execute(
        `SELECT price, inventory_quantity
         FROM product_variants
         WHERE product_id = ? AND is_active = 1 AND price > 0`,
        [productId]
    );
    if (!variants.length) return false;

    const minPrice = Math.min(...variants.map((v) => parseFloat(v.price)));
    const totalInv = variants.reduce((s, v) => s + (parseInt(v.inventory_quantity, 10) || 0), 0);
    await connection.execute('UPDATE products SET price = ?, inventory_quantity = ? WHERE id = ?', [
        minPrice,
        totalInv,
        productId,
    ]);
    return true;
}

/**
 * Backfill all products whose parent price is zero but variants have prices.
 */
async function syncAllParentPricesFromVariants(pool, { dryRun = false } = {}) {
    const [rows] = await pool.query(
        `SELECT p.id, p.name, p.sku, p.price AS current_price,
                MIN(pv.price) AS min_variant_price,
                COUNT(pv.id) AS variant_count
         FROM products p
         INNER JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1 AND pv.price > 0
         WHERE p.price IS NULL OR p.price <= 0
         GROUP BY p.id, p.name, p.sku, p.price
         ORDER BY p.id`
    );

    if (dryRun) {
        return { updated: 0, candidates: rows };
    }

    let updated = 0;
    const conn = await pool.getConnection();
    try {
        for (const row of rows) {
            const ok = await syncParentPriceFromVariants(conn, row.id);
            if (ok) updated += 1;
        }
    } finally {
        conn.release();
    }

    return { updated, candidates: rows };
}

module.exports = {
    needsVariantPriceFallback,
    minActiveVariantPrice,
    applyVariantPriceFallback,
    applyVariantPriceFallbackFromVariants,
    enrichProductListPricesFromVariants,
    syncParentPriceFromVariants,
    syncAllParentPricesFromVariants,
};
