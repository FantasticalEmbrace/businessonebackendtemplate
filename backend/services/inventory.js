// Inventory Management Service
// Centralized inventory operations with audit trail and concurrency protection

const { loadInventorySettings } = require('../utils/inventorySettings');

class InventoryService {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Deduct inventory for an order
     * @param {Array} orderItems - Array of {productId, variantId, quantity}
     * @param {number} orderId - Order ID for audit trail
     * @param {string} reason - Reason for deduction
     */
    async deductInventoryForOrder(orderItems, orderId, reason = 'Order completion', options = {}) {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            const results = [];
            
            for (const item of orderItems) {
                const result = await this._deductInventory(
                    connection,
                    item.productId,
                    item.variantId,
                    item.quantity,
                    'sale',
                    'order',
                    orderId,
                    reason,
                    null,
                    options
                );
                results.push(result);
            }
            
            await connection.commit();
            
            console.log(`✅ Inventory deducted for order ${orderId}:`, results);
            return results;
            
        } catch (error) {
            await connection.rollback();
            console.error(`❌ Failed to deduct inventory for order ${orderId}:`, error);
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Restore inventory for cancelled/refunded order
     * @param {Array} orderItems - Array of {productId, variantId, quantity}
     * @param {number} orderId - Order ID for audit trail
     * @param {string} reason - Reason for restoration
     */
    async restoreInventoryForOrder(orderItems, orderId, reason = 'Order cancellation', existingConnection = null) {
        const ownsConnection = !existingConnection;
        const connection = existingConnection || await this.pool.getConnection();

        try {
            if (ownsConnection) await connection.beginTransaction();

            const results = [];

            for (const item of orderItems) {
                const result = await this._addInventory(
                    connection,
                    item.productId,
                    item.variantId,
                    item.quantity,
                    'return',
                    'order',
                    orderId,
                    reason
                );
                results.push(result);
            }

            if (ownsConnection) await connection.commit();

            console.log(`✅ Inventory restored for order ${orderId}:`, results);
            return results;
        } catch (error) {
            if (ownsConnection) await connection.rollback();
            console.error(`❌ Failed to restore inventory for order ${orderId}:`, error);
            throw error;
        } finally {
            if (ownsConnection) connection.release();
        }
    }

    /**
     * Manual inventory adjustment by admin
     * @param {number} productId - Product ID
     * @param {number|null} variantId - Variant ID (optional)
     * @param {number} quantityChange - Positive for increase, negative for decrease
     * @param {number} adminId - Admin user ID
     * @param {string} reason - Reason for adjustment
     */
    async adjustInventory(productId, variantId, quantityChange, adminId, reason = 'Manual adjustment') {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            let result;
            if (quantityChange > 0) {
                result = await this._addInventory(
                    connection,
                    productId,
                    variantId,
                    quantityChange,
                    'adjustment',
                    'manual',
                    adminId,
                    reason,
                    adminId
                );
            } else {
                result = await this._deductInventory(
                    connection,
                    productId,
                    variantId,
                    Math.abs(quantityChange),
                    'adjustment',
                    'manual',
                    adminId,
                    reason,
                    adminId
                );
            }
            
            await connection.commit();
            
            console.log(`✅ Inventory adjusted by admin ${adminId}:`, result);
            return result;
            
        } catch (error) {
            await connection.rollback();
            console.error(`❌ Failed to adjust inventory:`, error);
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Internal method to deduct inventory with audit trail
     */
    async _deductInventory(
        connection,
        productId,
        variantId,
        quantity,
        type,
        referenceType,
        referenceId,
        reason,
        createdBy = null,
        options = {}
    ) {
        // Get current inventory
        let currentInventory, tableName, idField;

        const [parentProducts] = await connection.execute(
            'SELECT track_inventory, allow_backorder FROM products WHERE id = ?',
            [productId]
        );
        const parentProduct = parentProducts[0];
        if (parentProduct && !parentProduct.track_inventory) {
            return { productId, variantId, skipped: true, reason: 'Inventory tracking disabled' };
        }
        
        if (variantId) {
            const [variants] = await connection.execute(
                'SELECT inventory_quantity FROM product_variants WHERE id = ? AND product_id = ?',
                [variantId, productId]
            );
            
            if (variants.length === 0) {
                throw new Error(`Product variant ${variantId} not found`);
            }
            
            currentInventory = variants[0].inventory_quantity;
            tableName = 'product_variants';
            idField = 'id';
        } else {
            const [products] = await connection.execute(
                'SELECT inventory_quantity, track_inventory, allow_backorder FROM products WHERE id = ?',
                [productId]
            );
            
            if (products.length === 0) {
                const err = new Error(`Product ${productId} not found`);
                err.code = 'PRODUCT_NOT_FOUND';
                throw err;
            }
            
            const product = products[0];
            currentInventory = product.inventory_quantity;
            tableName = 'products';
            idField = 'id';
            
            // Check if we should track inventory
            if (!product.track_inventory) {
                console.log(`⚠️ Product ${productId} doesn't track inventory, skipping deduction`);
                return { productId, variantId, skipped: true, reason: 'Inventory tracking disabled' };
            }
            
            const inventorySettings = await loadInventorySettings(connection);
            const allowOversell =
                Boolean(options.allowOversell) ||
                Boolean(product.allow_backorder) ||
                Boolean(inventorySettings.allowOversell);

            // Check if we have enough inventory (unless oversell allowed)
            if (!allowOversell && currentInventory < quantity) {
                const err = new Error(
                    `Insufficient inventory for product ${productId}. Available: ${currentInventory}, Requested: ${quantity}`
                );
                err.code = 'INSUFFICIENT_INVENTORY';
                err.productId = productId;
                err.available = currentInventory;
                err.requested = quantity;
                throw err;
            }
        }
        
        const newInventory = currentInventory - quantity;
        
        // Update inventory (product_variants has no updated_at column on all deployments)
        const updateSql =
            tableName === 'products'
                ? `UPDATE ${tableName} SET inventory_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE ${idField} = ?`
                : `UPDATE ${tableName} SET inventory_quantity = ? WHERE ${idField} = ?`;
        await connection.execute(updateSql, [newInventory, variantId || productId]);
        
        // Log transaction
        await connection.execute(
            `INSERT INTO inventory_transactions 
             (product_id, variant_id, type, quantity_change, quantity_after, reference_type, reference_id, notes, created_by) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [productId, variantId, type, -quantity, newInventory, referenceType, referenceId, reason, createdBy]
        );
        
        return {
            productId,
            variantId,
            quantityBefore: currentInventory,
            quantityAfter: newInventory,
            quantityChange: -quantity,
            type
        };
    }

    /**
     * Internal method to add inventory with audit trail
     */
    async _addInventory(connection, productId, variantId, quantity, type, referenceType, referenceId, reason, createdBy = null) {
        // Get current inventory
        let currentInventory, tableName, idField;
        
        if (variantId) {
            const [variants] = await connection.execute(
                'SELECT inventory_quantity FROM product_variants WHERE id = ? AND product_id = ?',
                [variantId, productId]
            );
            
            if (variants.length === 0) {
                throw new Error(`Product variant ${variantId} not found`);
            }
            
            currentInventory = variants[0].inventory_quantity;
            tableName = 'product_variants';
            idField = 'id';
        } else {
            const [products] = await connection.execute(
                'SELECT inventory_quantity, track_inventory FROM products WHERE id = ?',
                [productId]
            );
            
            if (products.length === 0) {
                throw new Error(`Product ${productId} not found`);
            }
            
            const product = products[0];
            currentInventory = product.inventory_quantity;
            tableName = 'products';
            idField = 'id';
            
            // Check if we should track inventory
            if (!product.track_inventory) {
                console.log(`⚠️ Product ${productId} doesn't track inventory, skipping addition`);
                return { productId, variantId, skipped: true, reason: 'Inventory tracking disabled' };
            }
        }
        
        const newInventory = currentInventory + quantity;
        
        const updateSql =
            tableName === 'products'
                ? `UPDATE ${tableName} SET inventory_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE ${idField} = ?`
                : `UPDATE ${tableName} SET inventory_quantity = ? WHERE ${idField} = ?`;
        await connection.execute(updateSql, [newInventory, variantId || productId]);
        
        // Log transaction
        await connection.execute(
            `INSERT INTO inventory_transactions 
             (product_id, variant_id, type, quantity_change, quantity_after, reference_type, reference_id, notes, created_by) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [productId, variantId, type, quantity, newInventory, referenceType, referenceId, reason, createdBy]
        );
        
        return {
            productId,
            variantId,
            quantityBefore: currentInventory,
            quantityAfter: newInventory,
            quantityChange: quantity,
            type
        };
    }

    /**
     * Get inventory transaction history
     * @param {number} productId - Product ID
     * @param {number|null} variantId - Variant ID (optional)
     * @param {number} limit - Number of records to return
     */
    async getInventoryHistory(productId, variantId = null, limit = 50) {
        try {
            const [transactions] = await this.pool.execute(`
                SELECT 
                    it.*,
                    p.name as product_name,
                    p.sku as product_sku,
                    pv.name as variant_name,
                    au.first_name,
                    au.last_name
                FROM inventory_transactions it
                JOIN products p ON it.product_id = p.id
                LEFT JOIN product_variants pv ON it.variant_id = pv.id
                LEFT JOIN admin_users au ON it.created_by = au.id
                WHERE it.product_id = ? AND (it.variant_id = ? OR (it.variant_id IS NULL AND ? IS NULL))
                ORDER BY it.created_at DESC
                LIMIT ?
            `, [productId, variantId, variantId, limit]);
            
            return transactions;
        } catch (error) {
            console.error('Failed to get inventory history:', error);
            throw error;
        }
    }

    /**
     * Get low stock products
     * @param {number} limit - Number of products to return
     */
    async getLowStockProducts(limit = 20) {
        try {
            const inventorySettings = await loadInventorySettings(this.pool);
            const globalThreshold = inventorySettings.globalLowStockThreshold;

            // Do not bind LIMIT with prepared statements — some MySQL/MariaDB builds return
            // ER_WRONG_ARGUMENTS (1210) for LIMIT ? in mysqld_stmt_execute.
            const raw = parseInt(limit, 10);
            const safeLimit = Number.isFinite(raw)
                ? Math.min(Math.max(raw, 1), 10000)
                : 20;

            // Use query(), not execute(): prepared statements (execute) can fail on some
            // MySQL/MariaDB builds even for LIMIT with a literal; query uses plain text SQL.
            const [products] = await this.pool.query(
                `
                SELECT 
                    p.id,
                    p.sku,
                    p.name,
                    p.inventory_quantity,
                    COALESCE(NULLIF(p.low_stock_threshold, 0), ${Number(globalThreshold) || 5}) AS low_stock_threshold,
                    b.name as brand_name,
                    pc.name as category_name
                FROM products p
                LEFT JOIN brands b ON p.brand_id = b.id
                LEFT JOIN product_categories pc ON p.category_id = pc.id
                WHERE p.track_inventory = 1 
                  AND p.is_active = 1
                  AND p.inventory_quantity <= COALESCE(NULLIF(p.low_stock_threshold, 0), ${Number(globalThreshold) || 5})
                ORDER BY p.inventory_quantity ASC
                LIMIT ${safeLimit}
                `
            );

            return products;
        } catch (error) {
            console.error('Failed to get low stock products:', error);
            throw error;
        }
    }

    /**
     * Get current inventory level
     * @param {number} productId - Product ID
     * @param {number|null} variantId - Variant ID (optional)
     */
    async getCurrentInventory(productId, variantId = null) {
        try {
            if (variantId) {
                const [variants] = await this.pool.execute(
                    'SELECT inventory_quantity FROM product_variants WHERE id = ? AND product_id = ?',
                    [variantId, productId]
                );
                return variants.length > 0 ? variants[0].inventory_quantity : 0;
            } else {
                const [products] = await this.pool.execute(
                    'SELECT inventory_quantity FROM products WHERE id = ?',
                    [productId]
                );
                return products.length > 0 ? products[0].inventory_quantity : 0;
            }
        } catch (error) {
            console.error('Failed to get current inventory:', error);
            throw error;
        }
    }

    /**
     * Bulk inventory import (for product imports)
     * @param {Array} inventoryUpdates - Array of {productId, variantId, quantity}
     * @param {string} reason - Reason for import
     */
    async bulkInventoryImport(inventoryUpdates, reason = 'Bulk import') {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            const results = [];
            
            for (const update of inventoryUpdates) {
                // Set inventory to exact amount (not add/subtract)
                const currentInventory = await this.getCurrentInventory(update.productId, update.variantId);
                const quantityChange = update.quantity - currentInventory;
                
                if (quantityChange !== 0) {
                    let result;
                    if (quantityChange > 0) {
                        result = await this._addInventory(
                            connection,
                            update.productId,
                            update.variantId,
                            quantityChange,
                            'restock',
                            'import',
                            null,
                            reason
                        );
                    } else {
                        result = await this._deductInventory(
                            connection,
                            update.productId,
                            update.variantId,
                            Math.abs(quantityChange),
                            'adjustment',
                            'import',
                            null,
                            reason
                        );
                    }
                    results.push(result);
                }
            }
            
            await connection.commit();
            
            console.log(`✅ Bulk inventory import completed: ${results.length} products updated`);
            return results;
            
        } catch (error) {
            await connection.rollback();
            console.error('❌ Failed bulk inventory import:', error);
            throw error;
        } finally {
            connection.release();
        }
    }
}

module.exports = InventoryService;
