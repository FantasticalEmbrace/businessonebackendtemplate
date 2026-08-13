// HM Herbs POS Discount Integration Service
// Sync and manage discounts from connected POS systems

class POSDiscountService {
    constructor(db) {
        this.db = db;
    }

    // Sync discounts from POS system
    async syncDiscountsFromPOS(posSystemId) {
        const connection = await this.db.getConnection();
        
        try {
            await connection.beginTransaction();

            // Get POS system configuration
            const [posSystems] = await connection.execute(
                'SELECT * FROM pos_systems WHERE id = ? AND status = "active"',
                [posSystemId]
            );

            if (posSystems.length === 0) {
                throw new Error('POS system not found or inactive');
            }

            const posSystem = posSystems[0];
            const discounts = await this.fetchDiscountsFromPOS(posSystem);

            const results = {
                discounts: {
                    total: discounts.length,
                    new: 0,
                    updated: 0,
                    failed: 0
                },
                usage: {
                    total: 0,
                    new: 0,
                    updated: 0,
                    failed: 0
                },
                errors: []
            };

            // Sync discounts first
            for (const discountData of discounts) {
                try {
                    const result = await this.upsertPOSDiscount(posSystemId, discountData, connection);
                    if (result.created) {
                        results.discounts.new++;
                    } else {
                        results.discounts.updated++;
                    }

                    // Sync usage data for this discount
                    if (discountData.external_id) {
                        const usageData = await this.fetchDiscountUsageFromPOS(posSystem, discountData.external_id);
                        results.usage.total += usageData.length;

                        for (const usage of usageData) {
                            try {
                                const usageResult = await this.upsertPOSDiscountUsage(
                                    result.id, 
                                    posSystemId, 
                                    usage, 
                                    connection
                                );
                                if (usageResult.created) {
                                    results.usage.new++;
                                } else {
                                    results.usage.updated++;
                                }
                            } catch (error) {
                                results.usage.failed++;
                                results.errors.push({
                                    type: 'usage',
                                    discount_id: discountData.external_id,
                                    usage_id: usage.external_id,
                                    error: error.message
                                });
                            }
                        }
                    }
                } catch (error) {
                    results.discounts.failed++;
                    results.errors.push({
                        type: 'discount',
                        discount_id: discountData.external_id,
                        error: error.message
                    });
                }
            }

            // Update sync timestamp
            await connection.execute(
                'UPDATE pos_systems SET last_sync = CURRENT_TIMESTAMP WHERE id = ?',
                [posSystemId]
            );

            await connection.commit();
            return results;
        } catch (error) {
            await connection.rollback();
            throw new Error(`Failed to sync discounts from POS: ${error.message}`);
        } finally {
            connection.release();
        }
    }

    async fetchDiscountsFromPOS(posSystem) {
        const credentials = JSON.parse(posSystem.auth_credentials || '{}');
        
        switch (posSystem.system_type) {
            case 'square':
                return await this.fetchSquareDiscounts(posSystem, credentials);
            case 'shopify_pos':
                return await this.fetchShopifyDiscounts(posSystem, credentials);
            case 'lightspeed':
                return await this.fetchLightspeedDiscounts(posSystem, credentials);
            default:
                return await this.fetchGenericDiscounts(posSystem, credentials);
        }
    }

    async fetchSquareDiscounts(posSystem, credentials) {
        const axios = require('axios');
        
        try {
            const response = await axios.get(`${posSystem.api_endpoint}/v2/catalog/list?types=DISCOUNT`, {
                headers: {
                    'Authorization': `Bearer ${credentials.access_token}`,
                    'Square-Version': '2023-10-18',
                    'Content-Type': 'application/json'
                }
            });

            return response.data.objects?.filter(obj => obj.type === 'DISCOUNT').map(discount => ({
                external_id: discount.id,
                discount_name: discount.discount_data?.name || 'Square Discount',
                discount_type: this.mapSquareDiscountType(discount.discount_data?.discount_type),
                discount_percentage: discount.discount_data?.percentage ? parseFloat(discount.discount_data.percentage) : null,
                discount_value: discount.discount_data?.amount_money ? (discount.discount_data.amount_money.amount / 100) : null,
                minimum_order_amount: discount.discount_data?.minimum_order_amount_money ? (discount.discount_data.minimum_order_amount_money.amount / 100) : null,
                applies_to: 'order',
                status: 'active',
                is_active: true,
                requires_code: false,
                stackable: false,
                starts_at: null,
                ends_at: null
            })) || [];
        } catch (error) {
            throw new Error(`Square API error: ${error.response?.data?.message || error.message}`);
        }
    }

    async fetchShopifyDiscounts(posSystem, credentials) {
        const axios = require('axios');
        
        try {
            // Fetch price rules (Shopify's discount system)
            const response = await axios.get(`${posSystem.api_endpoint}/admin/api/2023-10/price_rules.json`, {
                headers: {
                    'X-Shopify-Access-Token': credentials.access_token,
                    'Content-Type': 'application/json'
                }
            });

            const discounts = [];
            
            for (const priceRule of response.data.price_rules || []) {
                // Get discount codes for this price rule
                let discountCodes = [];
                try {
                    const codesResponse = await axios.get(`${posSystem.api_endpoint}/admin/api/2023-10/price_rules/${priceRule.id}/discount_codes.json`, {
                        headers: {
                            'X-Shopify-Access-Token': credentials.access_token,
                            'Content-Type': 'application/json'
                        }
                    });
                    discountCodes = codesResponse.data.discount_codes || [];
                } catch (error) {
                    // Continue without codes if API fails
                }

                discounts.push({
                    external_id: priceRule.id.toString(),
                    discount_name: priceRule.title,
                    discount_type: priceRule.value_type === 'percentage' ? 'percentage' : 'fixed_amount',
                    discount_percentage: priceRule.value_type === 'percentage' ? parseFloat(priceRule.value) : null,
                    discount_value: priceRule.value_type === 'fixed_amount' ? parseFloat(priceRule.value) : null,
                    minimum_order_amount: priceRule.prerequisite_subtotal_range?.greater_than_or_equal_to ? parseFloat(priceRule.prerequisite_subtotal_range.greater_than_or_equal_to) : null,
                    maximum_discount_amount: priceRule.value_type === 'percentage' && priceRule.value ? parseFloat(priceRule.value) : null,
                    applies_to: priceRule.target_type === 'line_item' ? 'product' : 'order',
                    usage_limit_total: priceRule.usage_limit,
                    usage_limit_per_customer: priceRule.once_per_customer ? 1 : null,
                    current_usage_count: priceRule.usage_count || 0,
                    starts_at: priceRule.starts_at,
                    ends_at: priceRule.ends_at,
                    status: priceRule.ends_at && new Date(priceRule.ends_at) < new Date() ? 'expired' : 'active',
                    is_active: !priceRule.ends_at || new Date(priceRule.ends_at) >= new Date(),
                    requires_code: discountCodes.length > 0,
                    discount_code: discountCodes.length > 0 ? discountCodes[0].code : null,
                    stackable: false
                });
            }

            return discounts;
        } catch (error) {
            throw new Error(`Shopify API error: ${error.response?.data?.message || error.message}`);
        }
    }

    async fetchLightspeedDiscounts(posSystem, credentials) {
        const axios = require('axios');
        
        try {
            const response = await axios.get(`${posSystem.api_endpoint}/API/Account/${credentials.account_id}/Discount.json`, {
                headers: {
                    'Authorization': `Bearer ${credentials.access_token}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.Discount?.map(discount => ({
                external_id: discount.discountID.toString(),
                discount_name: discount.name || 'Lightspeed Discount',
                discount_type: discount.type === 'percent' ? 'percentage' : 'fixed_amount',
                discount_percentage: discount.type === 'percent' ? parseFloat(discount.amount) : null,
                discount_value: discount.type === 'amount' ? parseFloat(discount.amount) : null,
                minimum_order_amount: discount.minimumAmount ? parseFloat(discount.minimumAmount) : null,
                applies_to: 'order',
                status: discount.archived ? 'archived' : 'active',
                is_active: !discount.archived,
                requires_code: false,
                stackable: false,
                starts_at: discount.startDate,
                ends_at: discount.endDate
            })) || [];
        } catch (error) {
            throw new Error(`Lightspeed API error: ${error.response?.data?.message || error.message}`);
        }
    }

    async fetchGenericDiscounts(posSystem, credentials) {
        const axios = require('axios');
        
        try {
            const config = {
                method: 'GET',
                url: `${posSystem.api_endpoint}/discounts`,
                headers: { 'Content-Type': 'application/json' }
            };

            if (posSystem.auth_type === 'api_key') {
                config.headers[credentials.header_name || 'X-API-Key'] = credentials.api_key;
            } else if (posSystem.auth_type === 'bearer') {
                config.headers['Authorization'] = `Bearer ${credentials.token}`;
            }

            const response = await axios(config);
            
            return response.data.discounts?.map(discount => ({
                external_id: discount.id || discount.external_id,
                discount_name: discount.name,
                discount_type: discount.type || 'percentage',
                discount_percentage: discount.percentage ? parseFloat(discount.percentage) : null,
                discount_value: discount.value ? parseFloat(discount.value) : null,
                minimum_order_amount: discount.minimum_order_amount ? parseFloat(discount.minimum_order_amount) : null,
                maximum_discount_amount: discount.maximum_discount_amount ? parseFloat(discount.maximum_discount_amount) : null,
                applies_to: discount.applies_to || 'order',
                usage_limit_total: discount.usage_limit_total ? parseInt(discount.usage_limit_total) : null,
                usage_limit_per_customer: discount.usage_limit_per_customer ? parseInt(discount.usage_limit_per_customer) : null,
                current_usage_count: discount.current_usage_count ? parseInt(discount.current_usage_count) : 0,
                starts_at: discount.starts_at,
                ends_at: discount.ends_at,
                status: discount.status || 'active',
                is_active: discount.is_active !== false,
                requires_code: discount.requires_code || false,
                discount_code: discount.code,
                stackable: discount.stackable || false
            })) || [];
        } catch (error) {
            throw new Error(`Generic POS API error: ${error.message}`);
        }
    }

    async fetchDiscountUsageFromPOS(posSystem, discountId) {
        const credentials = JSON.parse(posSystem.auth_credentials || '{}');
        
        switch (posSystem.system_type) {
            case 'square':
                return await this.fetchSquareDiscountUsage(posSystem, credentials, discountId);
            case 'shopify_pos':
                return await this.fetchShopifyDiscountUsage(posSystem, credentials, discountId);
            case 'lightspeed':
                return await this.fetchLightspeedDiscountUsage(posSystem, credentials, discountId);
            default:
                return await this.fetchGenericDiscountUsage(posSystem, credentials, discountId);
        }
    }

    async fetchSquareDiscountUsage(_posSystem, _credentials, _discountId) {
        // Square doesn't provide detailed discount usage history via API
        // This would require order analysis
        return [];
    }

    async fetchShopifyDiscountUsage(posSystem, credentials, _discountId) {
        const axios = require('axios');
        
        try {
            // Get orders that used this discount
            const response = await axios.get(`${posSystem.api_endpoint}/admin/api/2023-10/orders.json?status=any&limit=250`, {
                headers: {
                    'X-Shopify-Access-Token': credentials.access_token,
                    'Content-Type': 'application/json'
                }
            });

            const usage = [];
            
            for (const order of response.data.orders || []) {
                if (order.discount_applications) {
                    for (const discount of order.discount_applications) {
                        if (discount.title && discount.value) {
                            usage.push({
                                external_id: `${order.id}-${discount.title}`,
                                customer_email: order.customer?.email,
                                customer_name: order.customer ? `${order.customer.first_name} ${order.customer.last_name}`.trim() : null,
                                order_reference: order.order_number?.toString(),
                                discount_amount_applied: parseFloat(discount.value),
                                order_total: parseFloat(order.total_price),
                                usage_date: order.created_at,
                                pos_location: order.location_id?.toString(),
                                sales_channel: order.source_name === 'web' ? 'online' : 'in_store'
                            });
                        }
                    }
                }
            }

            return usage;
        } catch (error) {
            console.error('Shopify discount usage fetch error:', error);
            return [];
        }
    }

    async fetchLightspeedDiscountUsage(_posSystem, _credentials, _discountId) {
        // Lightspeed usage would require sale analysis
        return [];
    }

    async fetchGenericDiscountUsage(posSystem, credentials, discountId) {
        const axios = require('axios');
        
        try {
            const config = {
                method: 'GET',
                url: `${posSystem.api_endpoint}/discounts/${discountId}/usage`,
                headers: { 'Content-Type': 'application/json' }
            };

            if (posSystem.auth_type === 'api_key') {
                config.headers[credentials.header_name || 'X-API-Key'] = credentials.api_key;
            } else if (posSystem.auth_type === 'bearer') {
                config.headers['Authorization'] = `Bearer ${credentials.token}`;
            }

            const response = await axios(config);
            
            return response.data.usage?.map(usage => ({
                external_id: usage.id || usage.external_id,
                customer_email: usage.customer_email,
                customer_name: usage.customer_name,
                order_reference: usage.order_reference,
                discount_amount_applied: parseFloat(usage.discount_amount),
                order_total: parseFloat(usage.order_total || 0),
                usage_date: usage.usage_date,
                pos_location: usage.location,
                sales_channel: usage.sales_channel || 'online'
            })) || [];
        } catch (error) {
            return [];
        }
    }

    async upsertPOSDiscount(posSystemId, discountData, connection = null) {
        const db = connection || this.db;
        
        // Check if discount already exists
        const [existing] = await db.execute(
            'SELECT id FROM pos_discounts WHERE pos_system_id = ? AND external_discount_id = ?',
            [posSystemId, discountData.external_id]
        );

        if (existing.length > 0) {
            // Update existing discount
            await db.execute(`
                UPDATE pos_discounts 
                SET discount_name = ?, discount_type = ?, discount_value = ?, discount_percentage = ?,
                    minimum_order_amount = ?, maximum_discount_amount = ?, applies_to = ?,
                    usage_limit_total = ?, usage_limit_per_customer = ?, current_usage_count = ?,
                    starts_at = ?, ends_at = ?, customer_eligibility = ?, status = ?, is_active = ?,
                    requires_code = ?, discount_code = ?, stackable = ?, last_synced = CURRENT_TIMESTAMP,
                    sync_status = 'synced'
                WHERE id = ?
            `, [
                discountData.discount_name,
                discountData.discount_type,
                discountData.discount_value,
                discountData.discount_percentage,
                discountData.minimum_order_amount,
                discountData.maximum_discount_amount,
                discountData.applies_to,
                discountData.usage_limit_total,
                discountData.usage_limit_per_customer,
                discountData.current_usage_count,
                discountData.starts_at,
                discountData.ends_at,
                discountData.customer_eligibility || 'all',
                discountData.status,
                discountData.is_active,
                discountData.requires_code,
                discountData.discount_code,
                discountData.stackable,
                existing[0].id
            ]);

            return { created: false, id: existing[0].id };
        } else {
            // Create new discount record
            const [result] = await db.execute(`
                INSERT INTO pos_discounts (
                    pos_system_id, external_discount_id, discount_name, discount_type,
                    discount_value, discount_percentage, minimum_order_amount, maximum_discount_amount,
                    applies_to, usage_limit_total, usage_limit_per_customer, current_usage_count,
                    starts_at, ends_at, customer_eligibility, status, is_active, requires_code,
                    discount_code, stackable, sync_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
            `, [
                posSystemId,
                discountData.external_id,
                discountData.discount_name,
                discountData.discount_type,
                discountData.discount_value,
                discountData.discount_percentage,
                discountData.minimum_order_amount,
                discountData.maximum_discount_amount,
                discountData.applies_to,
                discountData.usage_limit_total,
                discountData.usage_limit_per_customer,
                discountData.current_usage_count,
                discountData.starts_at,
                discountData.ends_at,
                discountData.customer_eligibility || 'all',
                discountData.status,
                discountData.is_active,
                discountData.requires_code,
                discountData.discount_code,
                discountData.stackable
            ]);

            return { created: true, id: result.insertId };
        }
    }

    async upsertPOSDiscountUsage(posDiscountId, posSystemId, usageData, connection = null) {
        const db = connection || this.db;
        
        // Check if usage record already exists
        const [existing] = await db.execute(
            'SELECT id FROM pos_discount_usage WHERE pos_system_id = ? AND external_usage_id = ?',
            [posSystemId, usageData.external_id]
        );

        if (existing.length > 0) {
            // Update existing usage record
            await db.execute(`
                UPDATE pos_discount_usage 
                SET customer_email = ?, customer_name = ?, order_reference = ?,
                    discount_amount_applied = ?, order_total = ?, usage_date = ?,
                    pos_location = ?, sales_channel = ?, last_synced = CURRENT_TIMESTAMP,
                    sync_status = 'synced'
                WHERE id = ?
            `, [
                usageData.customer_email,
                usageData.customer_name,
                usageData.order_reference,
                usageData.discount_amount_applied,
                usageData.order_total,
                usageData.usage_date,
                usageData.pos_location,
                usageData.sales_channel,
                existing[0].id
            ]);

            return { created: false, id: existing[0].id };
        } else {
            // Create new usage record
            const [result] = await db.execute(`
                INSERT INTO pos_discount_usage (
                    pos_discount_id, pos_system_id, external_usage_id, customer_email,
                    customer_name, order_reference, discount_amount_applied, order_total,
                    usage_date, pos_location, sales_channel, sync_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
            `, [
                posDiscountId,
                posSystemId,
                usageData.external_id,
                usageData.customer_email,
                usageData.customer_name,
                usageData.order_reference,
                usageData.discount_amount_applied,
                usageData.order_total,
                usageData.usage_date,
                usageData.pos_location,
                usageData.sales_channel
            ]);

            return { created: true, id: result.insertId };
        }
    }

    // Get discounts from all POS systems
    async getPOSDiscounts(filters = {}) {
        const { 
            pos_system_id, 
            discount_type, 
            status,
            is_active,
            requires_code,
            search,
            limit = 50, 
            offset = 0 
        } = filters;
        
        let query = `
            SELECT pd.*, ps.name as pos_system_name, ps.system_type
            FROM pos_discounts pd
            JOIN pos_systems ps ON pd.pos_system_id = ps.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (pos_system_id) {
            query += ' AND pd.pos_system_id = ?';
            params.push(pos_system_id);
        }
        
        if (discount_type) {
            query += ' AND pd.discount_type = ?';
            params.push(discount_type);
        }

        if (status) {
            query += ' AND pd.status = ?';
            params.push(status);
        }

        if (is_active !== undefined) {
            query += ' AND pd.is_active = ?';
            params.push(is_active);
        }

        if (requires_code !== undefined) {
            query += ' AND pd.requires_code = ?';
            params.push(requires_code);
        }

        if (search) {
            query += ' AND (pd.discount_name LIKE ? OR pd.discount_code LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm);
        }
        
        query += ' ORDER BY pd.last_synced DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [discounts] = await this.db.execute(query, params);
        return discounts;
    }

    async getPOSDiscountById(discountId) {
        const [discounts] = await this.db.execute(`
            SELECT pd.*, ps.name as pos_system_name, ps.system_type
            FROM pos_discounts pd
            JOIN pos_systems ps ON pd.pos_system_id = ps.id
            WHERE pd.id = ?
        `, [discountId]);

        if (discounts.length === 0) {
            throw new Error('POS discount not found');
        }

        return discounts[0];
    }

    async getPOSDiscountUsage(filters = {}) {
        const { 
            pos_discount_id,
            pos_system_id, 
            customer_email,
            date_from,
            date_to,
            limit = 50, 
            offset = 0 
        } = filters;
        
        let query = `
            SELECT pdu.*, pd.discount_name, ps.name as pos_system_name
            FROM pos_discount_usage pdu
            JOIN pos_discounts pd ON pdu.pos_discount_id = pd.id
            JOIN pos_systems ps ON pdu.pos_system_id = ps.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (pos_discount_id) {
            query += ' AND pdu.pos_discount_id = ?';
            params.push(pos_discount_id);
        }
        
        if (pos_system_id) {
            query += ' AND pdu.pos_system_id = ?';
            params.push(pos_system_id);
        }

        if (customer_email) {
            query += ' AND pdu.customer_email LIKE ?';
            params.push(`%${customer_email}%`);
        }

        if (date_from) {
            query += ' AND pdu.usage_date >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND pdu.usage_date <= ?';
            params.push(date_to);
        }
        
        query += ' ORDER BY pdu.usage_date DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [usage] = await this.db.execute(query, params);
        return usage;
    }

    // Analytics for POS discounts
    async getPOSDiscountAnalytics(posSystemId = null, dateRange = 30) {
        let systemFilter = '';
        const params = [dateRange];
        
        if (posSystemId) {
            systemFilter = 'AND pd.pos_system_id = ?';
            params.push(posSystemId);
        }

        const [analytics] = await this.db.execute(`
            SELECT 
                ps.name as pos_system_name,
                ps.system_type,
                COUNT(DISTINCT pd.id) as total_discounts,
                COUNT(DISTINCT CASE WHEN pd.is_active = 1 THEN pd.id END) as active_discounts,
                COUNT(DISTINCT CASE WHEN pd.requires_code = 1 THEN pd.id END) as code_based_discounts,
                COUNT(DISTINCT pdu.id) as total_usage_count,
                SUM(pdu.discount_amount_applied) as total_discount_amount,
                AVG(pdu.discount_amount_applied) as avg_discount_amount,
                COUNT(DISTINCT pdu.customer_email) as unique_customers,
                COUNT(DISTINCT CASE WHEN pdu.usage_date >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN pdu.id END) as recent_usage_count,
                COUNT(CASE WHEN pd.sync_status = 'error' THEN 1 END) as sync_errors
            FROM pos_discounts pd
            JOIN pos_systems ps ON pd.pos_system_id = ps.id
            LEFT JOIN pos_discount_usage pdu ON pd.id = pdu.pos_discount_id
            WHERE 1=1 ${systemFilter}
            GROUP BY pd.pos_system_id
            ORDER BY ps.name
        `, params);

        const [typeBreakdown] = await this.db.execute(`
            SELECT 
                pd.discount_type,
                COUNT(*) as count,
                AVG(pd.discount_percentage) as avg_percentage,
                AVG(pd.discount_value) as avg_value
            FROM pos_discounts pd
            WHERE pd.is_active = 1 ${systemFilter}
            GROUP BY pd.discount_type
            ORDER BY count DESC
        `, params.slice(1)); // Remove dateRange param

        return {
            overview: analytics,
            type_breakdown: typeBreakdown
        };
    }

    // Handle webhook updates from POS systems
    async handleDiscountWebhook(posSystemId, webhookData) {
        try {
            const discountUpdate = this.extractDiscountUpdateFromWebhook(webhookData);
            
            if (discountUpdate) {
                await this.upsertPOSDiscount(posSystemId, discountUpdate);
                return { processed: true, discount_id: discountUpdate.external_id };
            }

            return { processed: false, reason: 'No discount data in webhook' };
        } catch (error) {
            throw new Error(`Failed to process discount webhook: ${error.message}`);
        }
    }

    extractDiscountUpdateFromWebhook(webhookData) {
        // Extract discount data from webhook payload
        if (webhookData.discount || webhookData.price_rule) {
            const discount = webhookData.discount || webhookData.price_rule;
            return {
                external_id: discount.id,
                discount_name: discount.name || discount.title,
                discount_type: discount.type || (discount.value_type === 'percentage' ? 'percentage' : 'fixed_amount'),
                discount_percentage: discount.percentage || (discount.value_type === 'percentage' ? discount.value : null),
                discount_value: discount.value_type === 'fixed_amount' ? discount.value : null,
                status: discount.status || 'active',
                is_active: discount.is_active !== false
            };
        }

        return null;
    }

    // Utility methods
    mapSquareDiscountType(squareType) {
        switch (squareType) {
            case 'FIXED_PERCENTAGE':
                return 'percentage';
            case 'FIXED_AMOUNT':
                return 'fixed_amount';
            case 'VARIABLE_PERCENTAGE':
                return 'percentage';
            case 'VARIABLE_AMOUNT':
                return 'fixed_amount';
            default:
                return 'custom';
        }
    }
}

module.exports = POSDiscountService;

