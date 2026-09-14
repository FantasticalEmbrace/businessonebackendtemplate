'use strict';

/**
 * Hard-delete a product when safe; otherwise archive it (hide from POS + web)
 * so admin "Delete" never 500s on FK history (orders / inventory / etc.).
 */

async function countRows(connection, sql, params) {
    try {
        const [rows] = await connection.execute(sql, params);
        return Number(rows?.[0]?.c || 0);
    } catch (err) {
        if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146) return 0;
        throw err;
    }
}

async function productHasSalesOrInventoryHistory(connection, productId) {
    const id = Number(productId);
    if (!Number.isFinite(id) || id <= 0) return false;

    const orderItems = await countRows(
        connection,
        'SELECT COUNT(*) AS c FROM order_items WHERE product_id = ?',
        [id]
    );
    if (orderItems > 0) return true;

    const inventory = await countRows(
        connection,
        'SELECT COUNT(*) AS c FROM inventory_transactions WHERE product_id = ?',
        [id]
    );
    if (inventory > 0) return true;

    // Variant-linked history
    const [variants] = await connection.execute(
        'SELECT id FROM product_variants WHERE product_id = ?',
        [id]
    );
    const variantIds = (variants || []).map((v) => Number(v.id)).filter((n) => n > 0);
    if (!variantIds.length) return false;

    const ph = variantIds.map(() => '?').join(',');
    const oiVar = await countRows(
        connection,
        `SELECT COUNT(*) AS c FROM order_items WHERE variant_id IN (${ph})`,
        variantIds
    );
    if (oiVar > 0) return true;

    const invVar = await countRows(
        connection,
        `SELECT COUNT(*) AS c FROM inventory_transactions WHERE variant_id IN (${ph})`,
        variantIds
    );
    return invVar > 0;
}

async function archiveProduct(connection, productId) {
    const [result] = await connection.execute(
        `UPDATE products
            SET is_active = 0,
                show_on_web = 0,
                deleted_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [productId]
    );
    // Soft-deactivate variants too so they stay out of admin/storefront selectors.
    try {
        await connection.execute(
            `UPDATE product_variants SET is_active = 0 WHERE product_id = ?`,
            [productId]
        );
    } catch (err) {
        if (err.code !== 'ER_NO_SUCH_TABLE' && err.errno !== 1146) throw err;
    }
    return result.affectedRows || 0;
}

async function hardDeleteProduct(connection, productId) {
    // Best-effort cleanup of non-historical children before DELETE.
    const childDeletes = [
        'DELETE FROM product_images WHERE product_id = ?',
        'DELETE FROM product_health_categories WHERE product_id = ?',
        'DELETE FROM product_variants WHERE product_id = ?',
        'DELETE FROM cart_items WHERE product_id = ?',
    ];
    for (const sql of childDeletes) {
        try {
            await connection.execute(sql, [productId]);
        } catch (err) {
            if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146) continue;
            if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
                const e = new Error('PRODUCT_REFERENCED');
                e.code = 'PRODUCT_REFERENCED';
                throw e;
            }
            throw err;
        }
    }
    const [result] = await connection.execute('DELETE FROM products WHERE id = ?', [productId]);
    return result.affectedRows || 0;
}

/**
 * @returns {Promise<{ mode: 'deleted'|'archived', affected: number, message: string }>}
 */
async function deleteOrArchiveProduct(connection, productId) {
    const id = Number(productId);
    if (!Number.isFinite(id) || id <= 0) {
        const err = new Error('Invalid product id');
        err.code = 'INVALID_PRODUCT_ID';
        throw err;
    }

    const [[existing]] = await connection.execute(
        'SELECT id, name FROM products WHERE id = ? LIMIT 1',
        [id]
    );
    if (!existing) {
        const err = new Error('Product not found');
        err.code = 'NOT_FOUND';
        throw err;
    }

    const hasHistory = await productHasSalesOrInventoryHistory(connection, id);
    if (hasHistory) {
        const affected = await archiveProduct(connection, id);
        return {
            mode: 'archived',
            affected,
            message: 'Product removed from the catalog. Order history was kept.',
        };
    }

    try {
        const affected = await hardDeleteProduct(connection, id);
        if (!affected) {
            const err = new Error('Product not found');
            err.code = 'NOT_FOUND';
            throw err;
        }
        return {
            mode: 'deleted',
            affected,
            message: 'Product deleted successfully',
        };
    } catch (err) {
        if (
            err.code === 'PRODUCT_REFERENCED' ||
            err.code === 'ER_ROW_IS_REFERENCED_2' ||
            err.errno === 1451
        ) {
            const affected = await archiveProduct(connection, id);
            return {
                mode: 'archived',
                affected,
                message: 'Product removed from the catalog. Related history was kept.',
            };
        }
        throw err;
    }
}

module.exports = {
    deleteOrArchiveProduct,
    productHasSalesOrInventoryHistory,
    archiveProduct,
};
