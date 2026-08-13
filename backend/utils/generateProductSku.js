/**
 * Shared product SKU generation and uniqueness checks.
 */

function generateRandomProductSku() {
    return `HM-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
}

function generateSkuFromProductName(name) {
    const base = String(name || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 28) || 'ITEM';
    return `HM-${base}-${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`;
}

function normalizeScannedSku(value) {
    return String(value || '').trim().replace(/\s+/g, '');
}

async function skuExists(pool, sku, excludeProductId = null) {
    const trimmed = normalizeScannedSku(sku);
    if (!trimmed) return false;

    if (excludeProductId != null) {
        const [rows] = await pool.execute(
            'SELECT id FROM products WHERE sku = ? AND id != ? LIMIT 1',
            [trimmed, excludeProductId]
        );
        return rows.length > 0;
    }

    const [rows] = await pool.execute(
        'SELECT id FROM products WHERE sku = ? LIMIT 1',
        [trimmed]
    );
    return rows.length > 0;
}

async function variantSkuTaken(pool, sku, { excludeVariantId = null } = {}) {
    const trimmed = normalizeScannedSku(sku);
    if (!trimmed) return false;

    let variantSql = 'SELECT id FROM product_variants WHERE sku = ?';
    const variantParams = [trimmed];
    if (excludeVariantId != null) {
        variantSql += ' AND id != ?';
        variantParams.push(excludeVariantId);
    }
    const [variants] = await pool.execute(`${variantSql} LIMIT 1`, variantParams);
    if (variants.length > 0) return true;

    const [products] = await pool.execute('SELECT id FROM products WHERE sku = ? LIMIT 1', [trimmed]);
    return products.length > 0;
}

function variantSkuHintFromName(variantName, index) {
    const slug = String(variantName || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '')
        .slice(0, 20);
    return slug || `V${index + 1}`;
}

async function generateUniqueVariantSku(
    pool,
    { productSku = '', variantName = '', index = 0, excludeVariantId = null, maxAttempts = 16 } = {}
) {
    const parent = normalizeScannedSku(productSku) || 'ITEM';
    const hint = variantSkuHintFromName(variantName, index);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        let candidate;
        if (attempt === 0) {
            candidate = `${parent}-${hint}`;
        } else if (attempt < 6) {
            candidate = `${parent}-${hint}-${attempt}`;
        } else {
            candidate = `${parent}-V${index + 1}-${Math.floor(Math.random() * 1000)}`;
        }
        candidate = normalizeScannedSku(candidate).slice(0, 100);
        // eslint-disable-next-line no-await-in-loop
        if (!(await variantSkuTaken(pool, candidate, { excludeVariantId }))) {
            return candidate;
        }
    }
    return normalizeScannedSku(generateRandomProductSku()).slice(0, 100);
}

async function generateUniqueProductSku(pool, { name = null, maxAttempts = 12 } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const candidate = name && attempt < 4
            ? generateSkuFromProductName(name)
            : generateRandomProductSku();
        // eslint-disable-next-line no-await-in-loop
        const taken = await skuExists(pool, candidate);
        if (!taken) return candidate;
    }
    return generateRandomProductSku();
}

module.exports = {
    generateRandomProductSku,
    generateSkuFromProductName,
    normalizeScannedSku,
    skuExists,
    variantSkuTaken,
    variantSkuHintFromName,
    generateUniqueVariantSku,
    generateUniqueProductSku,
};
