// HM Herbs POS Integration Service
// Bidirectional POS system integration with real-time inventory sync

const axios = require('axios');
const crypto = require('crypto');

class POSService {
    constructor(db, inventoryService) {
        this.db = db;
        this.inventoryService = inventoryService;
        this.retryDelays = [1000, 5000, 15000]; // Retry delays in milliseconds
    }

    // POS System Management
    async createPOSSystem(systemData, adminId) {
        const connection = await this.db.getConnection();
        
        try {
            await connection.beginTransaction();

            // Encrypt sensitive credentials
            const encryptedCredentials = systemData.auth_credentials 
                ? this.encryptCredentials(systemData.auth_credentials)
                : null;

            const [result] = await connection.execute(`
                INSERT INTO pos_systems (
                    name, system_type, api_endpoint, api_version, auth_type, auth_credentials,
                    sync_inventory, sync_orders, sync_customers, sync_frequency, 
                    status, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'testing', ?)
            `, [
                systemData.name,
                systemData.system_type,
                systemData.api_endpoint,
                systemData.api_version || '1.0',
                systemData.auth_type || 'api_key',
                encryptedCredentials,
                systemData.sync_inventory !== false,
                systemData.sync_orders !== false,
                systemData.sync_customers || false,
                systemData.sync_frequency || 'hourly',
                adminId
            ]);

            await connection.commit();
            return { id: result.insertId, ...systemData };
        } catch (error) {
            await connection.rollback();
            throw new Error(`Failed to create POS system: ${error.message}`);
        } finally {
            connection.release();
        }
    }

    async getPOSSystems(filters = {}) {
        const { status, system_type, limit = 50, offset = 0 } = filters;
        
        let query = `
            SELECT ps.*, admin.first_name as created_by_name,
                   COUNT(pt.id) as total_transactions
            FROM pos_systems ps
            LEFT JOIN admin_users admin ON ps.created_by = admin.id
            LEFT JOIN pos_transactions pt ON ps.id = pt.pos_system_id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (status) {
            query += ' AND ps.status = ?';
            params.push(status);
        }
        
        if (system_type) {
            query += ' AND ps.system_type = ?';
            params.push(system_type);
        }
        
        query += ' GROUP BY ps.id ORDER BY ps.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [systems] = await this.db.execute(query, params);
        
        // Decrypt credentials for display (mask sensitive data)
        return systems.map(system => {
            if (system.auth_credentials) {
                const decrypted = this.decryptCredentials(system.auth_credentials);
                system.auth_credentials = this.maskCredentials(decrypted);
            }
            return system;
        });
    }

    async getPOSSystemById(systemId) {
        const [systems] = await this.db.execute(`
            SELECT ps.*, admin.first_name as created_by_name
            FROM pos_systems ps
            LEFT JOIN admin_users admin ON ps.created_by = admin.id
            WHERE ps.id = ?
        `, [systemId]);

        if (systems.length === 0) {
            throw new Error('POS system not found');
        }

        const system = systems[0];
        
        if (system.auth_credentials) {
            system.auth_credentials = this.decryptCredentials(system.auth_credentials);
        }

        return system;
    }

    async updatePOSSystem(systemId, updateData, _adminId) {
        const connection = await this.db.getConnection();
        
        try {
            await connection.beginTransaction();

            const updateFields = [];
            const params = [];
            
            const allowedFields = [
                'name', 'api_endpoint', 'api_version', 'auth_type',
                'sync_inventory', 'sync_orders', 'sync_customers', 'sync_frequency', 'status'
            ];

            for (const field of allowedFields) {
                if (updateData.hasOwnProperty(field)) {
                    updateFields.push(`${field} = ?`);
                    params.push(updateData[field]);
                }
            }

            if (updateData.auth_credentials) {
                updateFields.push('auth_credentials = ?');
                params.push(this.encryptCredentials(updateData.auth_credentials));
            }

            if (updateFields.length === 0) {
                throw new Error('No valid fields to update');
            }

            params.push(systemId);

            const [result] = await connection.execute(`
                UPDATE pos_systems 
                SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, params);

            if (result.affectedRows === 0) {
                throw new Error('POS system not found');
            }

            await connection.commit();
            return await this.getPOSSystemById(systemId);
        } catch (error) {
            await connection.rollback();
            throw new Error(`Failed to update POS system: ${error.message}`);
        } finally {
            connection.release();
        }
    }

    async deletePOSSystem(systemId, _adminId) {
        const connection = await this.db.getConnection();
        
        try {
            await connection.beginTransaction();

            // Check for recent transactions
            const [recentTransactions] = await connection.execute(`
                SELECT COUNT(*) as count FROM pos_transactions 
                WHERE pos_system_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            `, [systemId]);

            if (recentTransactions[0].count > 0) {
                // Soft delete by setting status to inactive
                await connection.execute(
                    'UPDATE pos_systems SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    ['inactive', systemId]
                );
            } else {
                // Hard delete if no recent transactions
                const [result] = await connection.execute(
                    'DELETE FROM pos_systems WHERE id = ?',
                    [systemId]
                );

                if (result.affectedRows === 0) {
                    throw new Error('POS system not found');
                }
            }

            await connection.commit();
            return { success: true };
        } catch (error) {
            await connection.rollback();
            throw new Error(`Failed to delete POS system: ${error.message}`);
        } finally {
            connection.release();
        }
    }

    // POS Integration and Synchronization
    async testConnection(systemId) {
        const system = await this.getPOSSystemById(systemId);
        
        try {
            const response = await this.makeAPIRequest(system, 'GET', '/health', null, 5000);
            
            await this.db.execute(
                'UPDATE pos_systems SET status = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['active', systemId]
            );

            return { 
                success: true, 
                response_time: response.responseTime,
                api_version: response.data?.version || 'unknown'
            };
        } catch (error) {
            await this.db.execute(
                'UPDATE pos_systems SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['error', error.message, systemId]
            );

            throw new Error(`Connection test failed: ${error.message}`);
        }
    }

    async syncInventoryToPOS(systemId, productIds = null) {
        const system = await this.getPOSSystemById(systemId);
        
        if (!system.sync_inventory) {
            throw new Error('Inventory sync is disabled for this POS system');
        }

        let query = `
            SELECT p.id, p.sku, p.name, p.price, p.inventory_quantity, p.status
            FROM products p
            WHERE p.status = 'active'
        `;
        
        const params = [];
        
        if (productIds && productIds.length > 0) {
            query += ` AND p.id IN (${productIds.map(() => '?').join(',')})`;
            params.push(...productIds);
        }

        const [products] = await this.db.execute(query, params);
        
        const results = {
            total: products.length,
            successful: 0,
            failed: 0,
            errors: []
        };

        for (const product of products) {
            try {
                await this.syncProductToPOS(system, product);
                results.successful++;
            } catch (error) {
                results.failed++;
                results.errors.push({
                    product_id: product.id,
                    sku: product.sku,
                    error: error.message
                });
            }
        }

        // Update last sync time
        await this.db.execute(
            'UPDATE pos_systems SET last_sync = CURRENT_TIMESTAMP WHERE id = ?',
            [systemId]
        );

        return results;
    }

    async syncInventoryFromPOS(systemId) {
        const system = await this.getPOSSystemById(systemId);
        
        if (!system.sync_inventory) {
            throw new Error('Inventory sync is disabled for this POS system');
        }

        try {
            const inventoryData = await this.fetchInventoryFromPOS(system);
            
            const results = {
                total: inventoryData.length,
                updated: 0,
                created: 0,
                failed: 0,
                errors: []
            };

            for (const item of inventoryData) {
                try {
                    const result = await this.updateInventoryFromPOS(item);
                    if (result.created) {
                        results.created++;
                    } else {
                        results.updated++;
                    }
                } catch (error) {
                    results.failed++;
                    results.errors.push({
                        sku: item.sku,
                        error: error.message
                    });
                }
            }

            // Update last sync time
            await this.db.execute(
                'UPDATE pos_systems SET last_sync = CURRENT_TIMESTAMP WHERE id = ?',
                [systemId]
            );

            return results;
        } catch (error) {
            throw new Error(`Failed to sync inventory from POS: ${error.message}`);
        }
    }

    async syncProductToPOS(system, product) {
        const transactionId = await this.logTransaction(
            system.id, 'inventory_sync', 'outbound', product.id, 'product'
        );

        try {
            const posProduct = this.mapProductToPOSFormat(product, system.system_type);
            
            // Check if product exists in POS
            try {
                await this.makeAPIRequest(
                    system, 'GET', `/products/${product.sku}`
                );
                
                // Update existing product
                await this.makeAPIRequest(
                    system, 'PUT', `/products/${product.sku}`, posProduct
                );
            } catch (error) {
                if (error.response?.status === 404) {
                    // Create new product
                    await this.makeAPIRequest(
                        system, 'POST', '/products', posProduct
                    );
                } else {
                    throw error;
                }
            }

            await this.updateTransactionStatus(transactionId, 'completed');
        } catch (error) {
            await this.updateTransactionStatus(transactionId, 'failed', error.message);
            throw error;
        }
    }

    async fetchInventoryFromPOS(system) {
        const response = await this.makeAPIRequest(system, 'GET', '/inventory');
        return this.mapPOSInventoryToInternalFormat(response.data, system.system_type);
    }

    async updateInventoryFromPOS(inventoryItem) {
        const connection = await this.db.getConnection();
        
        try {
            await connection.beginTransaction();

            // Find product by SKU
            const [products] = await connection.execute(
                'SELECT id, inventory_quantity FROM products WHERE sku = ?',
                [inventoryItem.sku]
            );

            let created = false;
            
            if (products.length === 0) {
                // Create new product if it doesn't exist
                await connection.execute(`
                    INSERT INTO products (sku, name, price, inventory_quantity, status, created_at)
                    VALUES (?, ?, ?, ?, 'active', NOW())
                `, [
                    inventoryItem.sku,
                    inventoryItem.name || inventoryItem.sku,
                    inventoryItem.price || 0,
                    inventoryItem.quantity
                ]);
                
                created = true;
            } else {
                const product = products[0];
                const quantityDifference = inventoryItem.quantity - product.inventory_quantity;
                
                if (quantityDifference !== 0) {
                    // Update inventory using inventory service
                    await this.inventoryService.adjustInventory(
                        product.id,
                        quantityDifference,
                        'pos_sync',
                        null, // No admin user for POS sync
                        `POS sync adjustment: ${quantityDifference > 0 ? 'increase' : 'decrease'} of ${Math.abs(quantityDifference)} units`,
                        connection
                    );
                }
            }

            await connection.commit();
            return { created };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Webhook Handling
    async handleWebhook(systemId, webhookData, signature = null) {
        const system = await this.getPOSSystemById(systemId);
        
        // Verify webhook signature if provided
        if (signature && !this.verifyWebhookSignature(webhookData, signature, system)) {
            throw new Error('Invalid webhook signature');
        }

        const transactionId = await this.logTransaction(
            systemId, 'webhook', 'inbound', null, 'webhook', JSON.stringify(webhookData)
        );

        try {
            const result = await this.processWebhookData(system, webhookData);
            await this.updateTransactionStatus(transactionId, 'completed', null, JSON.stringify(result));
            return result;
        } catch (error) {
            await this.updateTransactionStatus(transactionId, 'failed', error.message);
            throw error;
        }
    }

    async processWebhookData(system, webhookData) {
        const eventType = this.extractEventType(webhookData, system.system_type);
        
        switch (eventType) {
            case 'inventory.updated':
                return await this.handleInventoryWebhook(system, webhookData);
            case 'order.created':
                return await this.handleOrderWebhook(system, webhookData);
            case 'product.updated':
                return await this.handleProductWebhook(system, webhookData);
            default:
                console.log(`Unhandled webhook event type: ${eventType}`);
                return { processed: false, reason: 'Unhandled event type' };
        }
    }

    async handleInventoryWebhook(system, webhookData) {
        const inventoryUpdates = this.extractInventoryUpdates(webhookData, system.system_type);
        
        for (const update of inventoryUpdates) {
            await this.updateInventoryFromPOS(update);
        }

        return { processed: true, updated_products: inventoryUpdates.length };
    }

    // Utility Methods
    async makeAPIRequest(system, method, endpoint, data = null, timeout = 10000) {
        const config = {
            method,
            url: `${system.api_endpoint}${endpoint}`,
            timeout,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'HMHerbs-POS-Integration/1.0'
            }
        };

        // Add authentication
        const credentials = system.auth_credentials;
        switch (system.auth_type) {
            case 'api_key':
                config.headers[credentials.header_name || 'X-API-Key'] = credentials.api_key;
                break;
            case 'bearer':
                config.headers['Authorization'] = `Bearer ${credentials.token}`;
                break;
            case 'basic':
                config.auth = {
                    username: credentials.username,
                    password: credentials.password
                };
                break;
        }

        if (data) {
            config.data = data;
        }

        const startTime = Date.now();
        const response = await axios(config);
        response.responseTime = Date.now() - startTime;
        
        return response;
    }

    mapProductToPOSFormat(product, systemType) {
        // Map internal product format to POS-specific format
        const baseProduct = {
            sku: product.sku,
            name: product.name,
            price: product.price,
            inventory_quantity: product.inventory_quantity,
            status: product.status === 'active' ? 'enabled' : 'disabled'
        };

        switch (systemType) {
            case 'square':
                return {
                    type: 'ITEM',
                    item_data: {
                        name: baseProduct.name,
                        variations: [{
                            type: 'ITEM_VARIATION',
                            item_variation_data: {
                                item_id: product.sku,
                                name: 'Regular',
                                pricing_type: 'FIXED_PRICING',
                                price_money: {
                                    amount: Math.round(baseProduct.price * 100),
                                    currency: 'USD'
                                },
                                track_inventory: true
                            }
                        }]
                    }
                };
            
            case 'shopify_pos':
                return {
                    product: {
                        title: baseProduct.name,
                        variants: [{
                            sku: baseProduct.sku,
                            price: baseProduct.price,
                            inventory_quantity: baseProduct.inventory_quantity,
                            inventory_management: 'shopify'
                        }]
                    }
                };
            
            default:
                return baseProduct;
        }
    }

    mapPOSInventoryToInternalFormat(data, systemType) {
        // Map POS-specific inventory format to internal format
        switch (systemType) {
            case 'square':
                return data.objects?.map(item => ({
                    sku: item.item_data?.variations?.[0]?.item_variation_data?.item_id,
                    name: item.item_data?.name,
                    quantity: item.item_data?.variations?.[0]?.item_variation_data?.inventory_quantity || 0,
                    price: (item.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount || 0) / 100
                })) || [];
            
            case 'shopify_pos':
                return data.products?.map(product => 
                    product.variants?.map(variant => ({
                        sku: variant.sku,
                        name: product.title,
                        quantity: variant.inventory_quantity || 0,
                        price: parseFloat(variant.price || 0)
                    }))
                ).flat() || [];
            
            default:
                return Array.isArray(data) ? data : [data];
        }
    }

    extractEventType(webhookData, systemType) {
        switch (systemType) {
            case 'square':
                return webhookData.type;
            case 'shopify_pos':
                return webhookData.topic;
            default:
                return webhookData.event_type || webhookData.type || 'unknown';
        }
    }

    extractInventoryUpdates(webhookData, systemType) {
        // Extract inventory updates from webhook data based on POS system type
        switch (systemType) {
            case 'square':
                return webhookData.data?.object ? [this.mapSquareInventoryUpdate(webhookData.data.object)] : [];
            case 'shopify_pos':
                return webhookData.inventory_level ? [this.mapShopifyInventoryUpdate(webhookData.inventory_level)] : [];
            default:
                return webhookData.inventory_updates || [];
        }
    }

    // Transaction Logging
    async logTransaction(posSystemId, transactionType, direction, entityId, entityType, requestData = null) {
        const [result] = await this.db.execute(`
            INSERT INTO pos_transactions (
                pos_system_id, transaction_type, direction, entity_id, entity_type,
                request_data, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())
        `, [
            posSystemId, transactionType, direction, entityId, entityType,
            requestData
        ]);

        return result.insertId;
    }

    async updateTransactionStatus(transactionId, status, errorMessage = null, responseData = null) {
        await this.db.execute(`
            UPDATE pos_transactions 
            SET status = ?, error_message = ?, response_data = ?, processed_at = NOW()
            WHERE id = ?
        `, [status, errorMessage, responseData, transactionId]);
    }

    // Security Methods
    encryptCredentials(credentials) {
        if (!process.env.POS_ENCRYPTION_KEY) {
            throw new Error('CRITICAL: POS_ENCRYPTION_KEY environment variable is not set');
        }
        
        const algorithm = 'aes-256-gcm';
        const key = crypto.scryptSync(process.env.POS_ENCRYPTION_KEY, 'salt', 32);
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipher(algorithm, key);
        cipher.setAAD(Buffer.from('pos-credentials'));
        
        let encrypted = cipher.update(JSON.stringify(credentials), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return JSON.stringify({
            encrypted,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex')
        });
    }

    decryptCredentials(encryptedData) {
        if (!process.env.POS_ENCRYPTION_KEY) {
            throw new Error('CRITICAL: POS_ENCRYPTION_KEY environment variable is not set');
        }
        
        try {
            const { encrypted, iv: _iv, authTag } = JSON.parse(encryptedData);
            const algorithm = 'aes-256-gcm';
            const key = crypto.scryptSync(process.env.POS_ENCRYPTION_KEY, 'salt', 32);
            
            const decipher = crypto.createDecipher(algorithm, key);
            decipher.setAAD(Buffer.from('pos-credentials'));
            decipher.setAuthTag(Buffer.from(authTag, 'hex'));
            
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return JSON.parse(decrypted);
        } catch (error) {
            console.error('Failed to decrypt credentials:', error);
            return {};
        }
    }

    maskCredentials(credentials) {
        const masked = { ...credentials };
        
        if (masked.api_key) {
            masked.api_key = masked.api_key.substring(0, 4) + '****';
        }
        if (masked.password) {
            masked.password = '****';
        }
        if (masked.token) {
            masked.token = masked.token.substring(0, 8) + '****';
        }
        
        return masked;
    }

    verifyWebhookSignature(data, signature, system) {
        // Implement webhook signature verification based on POS system
        if (!system.auth_credentials?.webhook_secret) {
            return true; // Skip verification if no secret configured
        }

        const expectedSignature = crypto
            .createHmac('sha256', system.auth_credentials.webhook_secret)
            .update(JSON.stringify(data))
            .digest('hex');

        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    }
}

module.exports = POSService;
