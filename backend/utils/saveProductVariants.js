/**
 * Upsert product variants and sync parent price/inventory from variants.
 * Avoids DELETE-all, which breaks FK constraints on inventory_transactions / order_items.
 */
const { parsePriceFromLabel, labelWithoutPrice } = require('./extractHmherbsVariants');
const { normalizeScannedSku, variantSkuTaken, generateUniqueVariantSku } = require('./generateProductSku');

function normalizeOptionGroups(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!Array.isArray(raw) || !raw.length) return null;
    return raw.map((g) => ({
        name: String(g.name || 'Options').trim(),
        values: Array.isArray(g.values) ? g.values.map((v) => String(v).trim()).filter(Boolean) : [],
    }));
}

function normalizeVariantRow(v, productSku, index) {
    const rawName = String(v.name || v.label || '').trim();
    let name = labelWithoutPrice(rawName);
    name = name.replace(/\s*\(\s*\$\s*[\d,.]+\s*\)\s*$/i, '').trim();
    if (!name) name = rawName;

    let price = parseFloat(v.price);
    if (!Number.isFinite(price)) {
        const fromName = parsePriceFromLabel(rawName);
        price = fromName != null ? fromName : NaN;
    }
    if (!Number.isFinite(price)) return null;

    let sku = normalizeScannedSku(v.sku || '');
    if (!sku) {
        const ext = v.externalValue || v.external_value;
        const hint = v.skuHint || v.sku_hint;
        const parentSku = normalizeScannedSku(productSku) || 'ITEM';
        if (ext) {
            sku = normalizeScannedSku(`${parentSku}-${ext}`);
        } else if (hint) {
            sku = normalizeScannedSku(`${parentSku}-${hint}-${index + 1}`);
        } else {
            sku = normalizeScannedSku(`${parentSku}-V${index + 1}`);
        }
    }
    sku = sku.slice(0, 100);

    let attributes = v.attributes;
    if (typeof attributes === 'string') {
        try {
            attributes = JSON.parse(attributes);
        } catch {
            attributes = null;
        }
    }

    const id = v.id != null && v.id !== '' ? parseInt(v.id, 10) : null;

    return {
        id: Number.isFinite(id) ? id : null,
        sku,
        name,
        price,
        compare_price:
            v.compare_price != null && v.compare_price !== ''
                ? parseFloat(v.compare_price)
                : null,
        cost_price:
            v.cost_price != null && v.cost_price !== ''
                ? parseFloat(v.cost_price)
                : null,
        image_url: String(v.image_url || '').trim() || null,
        inventory_quantity: parseInt(v.inventory_quantity, 10) || 0,
        weight: v.weight != null && v.weight !== '' ? parseFloat(v.weight) : null,
        is_active: v.is_active === false || v.is_active === 0 ? 0 : 1,
        sort_order: v.sort_order != null ? parseInt(v.sort_order, 10) : index,
        attributes: attributes && typeof attributes === 'object' ? attributes : null,
    };
}

class VariantSkuConflictError extends Error {
    constructor(sku, existingProductName, existingProductId, conflictType = 'variant') {
        const where =
            conflictType === 'product'
                ? `parent product "${existingProductName}" (ID ${existingProductId})`
                : `variant on product "${existingProductName}" (ID ${existingProductId})`;
        super(
            `Variant SKU "${sku}" is already used by ${where}. Each SKU must be unique across all products and variants.`
        );
        this.name = 'VariantSkuConflictError';
        this.code = 'VARIANT_SKU_EXISTS';
        this.status = 409;
        this.sku = sku;
    }
}

async function findVariantSkuOwner(connection, sku) {
    const normalized = normalizeScannedSku(sku);
    if (!normalized) return null;

    const [rows] = await connection.execute(
        `SELECT pv.id, pv.product_id, p.name AS product_name
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         WHERE pv.sku = ?
         LIMIT 1`,
        [normalized]
    );
    if (rows[0]) return { ...rows[0], conflictType: 'variant' };

    const [products] = await connection.execute(
        'SELECT id, name FROM products WHERE sku = ? LIMIT 1',
        [normalized]
    );
    if (products[0]) {
        return {
            id: null,
            product_id: products[0].id,
            product_name: products[0].name,
            conflictType: 'product',
        };
    }
    return null;
}

async function variantIsReferenced(connection, variantId) {
    const [inventory] = await connection.execute(
        'SELECT 1 FROM inventory_transactions WHERE variant_id = ? LIMIT 1',
        [variantId]
    );
    if (inventory.length > 0) return true;

    const [orders] = await connection.execute(
        'SELECT 1 FROM order_items WHERE variant_id = ? LIMIT 1',
        [variantId]
    );
    return orders.length > 0;
}

function mergeOptionGroupsFromVariants(groupsJson, rows) {
    const order = [];
    const valueMap = new Map();

    for (const group of groupsJson || []) {
        const name = String(group?.name || '').trim();
        if (!name) continue;
        if (!valueMap.has(name)) {
            valueMap.set(name, new Set());
            order.push(name);
        }
        for (const value of group?.values || []) {
            const val = String(value || '').trim();
            if (val) valueMap.get(name).add(val);
        }
    }

    for (const row of rows || []) {
        if (!row.attributes || typeof row.attributes !== 'object') continue;
        for (const [key, rawVal] of Object.entries(row.attributes)) {
            const name = String(key || '').trim();
            const val = String(rawVal || '').trim();
            if (!name || !val) continue;
            if (!valueMap.has(name)) {
                valueMap.set(name, new Set());
                order.push(name);
            }
            valueMap.get(name).add(val);
        }
    }

    const merged = order
        .map((name) => ({
            name,
            values: [...valueMap.get(name)],
        }))
        .filter((group) => group.values.length);

    return merged.length ? merged : null;
}

async function saveProductVariants(connection, productId, productSku, variantOptionGroups, variants) {
    const rawList = Array.isArray(variants) ? variants : [];
    const rows = rawList
        .map((v, i) => normalizeVariantRow(v, productSku, i))
        .filter(Boolean);

    const groupsJson = mergeOptionGroupsFromVariants(
        normalizeOptionGroups(variantOptionGroups),
        rows
    );
    const groupsPayload = groupsJson ? JSON.stringify(groupsJson) : null;

    await connection.execute('UPDATE products SET variant_option_groups = ? WHERE id = ?', [
        groupsPayload,
        productId,
    ]);

    const [existingRows] = await connection.execute(
        'SELECT id, sku FROM product_variants WHERE product_id = ?',
        [productId]
    );
    const existingById = new Map(existingRows.map((r) => [Number(r.id), r]));
    const existingBySku = new Map(existingRows.map((r) => [String(r.sku), r]));

    const keptIds = new Set();

    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const rawSku = normalizeScannedSku(rawList[i]?.sku || '');
        const userProvidedSku = Boolean(rawSku);

        if (userProvidedSku) {
            row.sku = rawSku.slice(0, 100);
            // eslint-disable-next-line no-await-in-loop
            if (await variantSkuTaken(connection, row.sku, { excludeVariantId: row.id })) {
                // eslint-disable-next-line no-await-in-loop
                const owner = await findVariantSkuOwner(connection, row.sku);
                const sameVariant = row.id && owner?.id && Number(owner.id) === Number(row.id);
                if (!sameVariant) {
                    throw new VariantSkuConflictError(
                        row.sku,
                        owner.product_name,
                        owner.product_id,
                        owner.conflictType || 'variant'
                    );
                }
            }
        } else {
            // eslint-disable-next-line no-await-in-loop
            row.sku = await generateUniqueVariantSku(connection, {
                productSku,
                variantName: row.name,
                index: i,
                excludeVariantId: row.id,
            });
        }

        let targetId = row.id && existingById.has(row.id) ? row.id : null;
        if (!targetId && row.sku && existingBySku.has(row.sku)) {
            targetId = Number(existingBySku.get(row.sku).id);
        }

        const attrsJson = row.attributes ? JSON.stringify(row.attributes) : null;

        if (targetId) {
            const skuOwner = await findVariantSkuOwner(connection, row.sku);
            if (skuOwner && Number(skuOwner.id) !== targetId) {
                throw new VariantSkuConflictError(
                    row.sku,
                    skuOwner.product_name,
                    skuOwner.product_id,
                    skuOwner.conflictType || 'variant'
                );
            }

            await connection.execute(
                `UPDATE product_variants
                 SET sku = ?, name = ?, price = ?, compare_price = ?, cost_price = ?, image_url = ?, inventory_quantity = ?,
                     weight = ?, is_active = ?, sort_order = ?, attributes = ?
                 WHERE id = ? AND product_id = ?`,
                [
                    row.sku,
                    row.name,
                    row.price,
                    row.compare_price,
                    row.cost_price,
                    row.image_url,
                    row.inventory_quantity,
                    row.weight,
                    row.is_active,
                    row.sort_order,
                    attrsJson,
                    targetId,
                    productId,
                ]
            );
            keptIds.add(targetId);
        } else {
            const skuOwner = await findVariantSkuOwner(connection, row.sku);
            if (skuOwner) {
                if (Number(skuOwner.product_id) === Number(productId)) {
                    targetId = Number(skuOwner.id);
                    await connection.execute(
                        `UPDATE product_variants
                         SET sku = ?, name = ?, price = ?, compare_price = ?, cost_price = ?, image_url = ?, inventory_quantity = ?,
                             weight = ?, is_active = ?, sort_order = ?, attributes = ?
                         WHERE id = ? AND product_id = ?`,
                        [
                            row.sku,
                            row.name,
                            row.price,
                            row.compare_price,
                            row.cost_price,
                            row.image_url,
                            row.inventory_quantity,
                            row.weight,
                            row.is_active,
                            row.sort_order,
                            attrsJson,
                            targetId,
                            productId,
                        ]
                    );
                    keptIds.add(targetId);
                    continue;
                }
                throw new VariantSkuConflictError(
                    row.sku,
                    skuOwner.product_name,
                    skuOwner.product_id,
                    skuOwner.conflictType || 'variant'
                );
            }

            const [insertResult] = await connection.execute(
                `INSERT INTO product_variants
                 (product_id, sku, name, price, compare_price, cost_price, image_url, inventory_quantity, weight, is_active, sort_order, attributes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    productId,
                    row.sku,
                    row.name,
                    row.price,
                    row.compare_price,
                    row.cost_price,
                    row.image_url,
                    row.inventory_quantity,
                    row.weight,
                    row.is_active,
                    row.sort_order,
                    attrsJson,
                ]
            );
            keptIds.add(Number(insertResult.insertId));
        }
    }

    for (const existing of existingRows) {
        const existingId = Number(existing.id);
        if (keptIds.has(existingId)) continue;

        if (await variantIsReferenced(connection, existingId)) {
            await connection.execute(
                'UPDATE product_variants SET is_active = 0 WHERE id = ? AND product_id = ?',
                [existingId, productId]
            );
        } else {
            try {
                await connection.execute(
                    'DELETE FROM product_variants WHERE id = ? AND product_id = ?',
                    [existingId, productId]
                );
            } catch (deleteErr) {
                if (deleteErr.code === 'ER_ROW_IS_REFERENCED_2' || deleteErr.errno === 1451) {
                    await connection.execute(
                        'UPDATE product_variants SET is_active = 0 WHERE id = ? AND product_id = ?',
                        [existingId, productId]
                    );
                } else {
                    throw deleteErr;
                }
            }
        }
    }

    if (rows.length) {
        const minPrice = Math.min(...rows.map((r) => r.price));
        const totalInv = rows.reduce((s, r) => s + (r.inventory_quantity || 0), 0);
        await connection.execute(
            'UPDATE products SET price = ?, inventory_quantity = ? WHERE id = ?',
            [minPrice, totalInv, productId]
        );
    }

    return rows.length;
}

module.exports = {
    saveProductVariants,
    normalizeOptionGroups,
    normalizeVariantRow,
    mergeOptionGroupsFromVariants,
    VariantSkuConflictError,
};
