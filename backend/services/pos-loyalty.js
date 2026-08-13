// HM Herbs POS Loyalty Program Integration Service
// Sync and manage loyalty programs from connected POS systems

class POSLoyaltyService {
    constructor(db) {
        this.db = db;
    }

    // Sync loyalty programs from POS system
    async syncLoyaltyProgramsFromPOS(posSystemId) {
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
            const programs = await this.fetchLoyaltyProgramsFromPOS(posSystem);

            const results = {
                programs: {
                    total: programs.length,
                    new: 0,
                    updated: 0,
                    failed: 0
                },
                customers: {
                    total: 0,
                    new: 0,
                    updated: 0,
                    failed: 0
                },
                errors: []
            };

            // Sync programs first
            for (const programData of programs) {
                try {
                    const result = await this.upsertPOSLoyaltyProgram(posSystemId, programData, connection);
                    if (result.created) {
                        results.programs.new++;
                    } else {
                        results.programs.updated++;
                    }

                    // Sync customers for this program
                    const customers = await this.fetchLoyaltyCustomersFromPOS(posSystem, programData.external_id);
                    results.customers.total += customers.length;

                    for (const customerData of customers) {
                        try {
                            const customerResult = await this.upsertPOSLoyaltyCustomer(
                                posSystemId, 
                                result.id, 
                                customerData, 
                                connection
                            );
                            if (customerResult.created) {
                                results.customers.new++;
                            } else {
                                results.customers.updated++;
                            }
                        } catch (error) {
                            results.customers.failed++;
                            results.errors.push({
                                type: 'customer',
                                program_id: programData.external_id,
                                customer_id: customerData.external_id,
                                error: error.message
                            });
                        }
                    }
                } catch (error) {
                    results.programs.failed++;
                    results.errors.push({
                        type: 'program',
                        program_id: programData.external_id,
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
            throw new Error(`Failed to sync loyalty programs from POS: ${error.message}`);
        } finally {
            connection.release();
        }
    }

    async fetchLoyaltyProgramsFromPOS(posSystem) {
        const credentials = JSON.parse(posSystem.auth_credentials || '{}');
        
        switch (posSystem.system_type) {
            case 'square':
                return await this.fetchSquareLoyaltyPrograms(posSystem, credentials);
            case 'shopify_pos':
                return await this.fetchShopifyLoyaltyPrograms(posSystem, credentials);
            case 'lightspeed':
                return await this.fetchLightspeedLoyaltyPrograms(posSystem, credentials);
            default:
                return await this.fetchGenericLoyaltyPrograms(posSystem, credentials);
        }
    }

    async fetchSquareLoyaltyPrograms(posSystem, credentials) {
        const axios = require('axios');
        
        try {
            const response = await axios.get(`${posSystem.api_endpoint}/v2/loyalty/programs`, {
                headers: {
                    'Authorization': `Bearer ${credentials.access_token}`,
                    'Square-Version': '2023-10-18',
                    'Content-Type': 'application/json'
                }
            });

            return response.data.programs?.map(program => ({
                external_id: program.id,
                program_name: program.terminology?.one || 'Square Loyalty',
                program_type: 'points',
                description: `Square loyalty program - ${program.terminology?.other || 'points'}`,
                is_active: program.status === 'ACTIVE',
                points_per_dollar: program.accrual_rules?.[0]?.points || 1,
                dollar_per_point: program.reward_tiers?.[0]?.pricing?.discount_money?.amount ? 
                    (program.reward_tiers[0].pricing.discount_money.amount / 100) / program.reward_tiers[0].points : 0.01
            })) || [];
        } catch (error) {
            throw new Error(`Square API error: ${error.response?.data?.message || error.message}`);
        }
    }

    async fetchShopifyLoyaltyPrograms(posSystem, credentials) {
        // Shopify doesn't have a built-in loyalty API, but many use apps
        // This would integrate with popular Shopify loyalty apps like Smile.io, LoyaltyLion, etc.
        const axios = require('axios');
        
        try {
            // Example for Smile.io integration
            const _response = await axios.get(`${posSystem.api_endpoint}/admin/api/2023-10/metafields.json?namespace=smile`, {
                headers: {
                    'X-Shopify-Access-Token': credentials.access_token,
                    'Content-Type': 'application/json'
                }
            });

            // Parse Shopify loyalty app data
            return [{
                external_id: 'shopify_loyalty_1',
                program_name: 'Shopify Loyalty Program',
                program_type: 'points',
                description: 'Shopify-based loyalty program',
                is_active: true,
                points_per_dollar: 1,
                dollar_per_point: 0.01
            }];
        } catch (error) {
            // Return empty if no loyalty app detected
            return [];
        }
    }

    async fetchLightspeedLoyaltyPrograms(posSystem, credentials) {
        const axios = require('axios');
        
        try {
            const response = await axios.get(`${posSystem.api_endpoint}/API/Account/${credentials.account_id}/CustomerType.json`, {
                headers: {
                    'Authorization': `Bearer ${credentials.access_token}`,
                    'Content-Type': 'application/json'
                }
            });

            // Lightspeed uses customer types for loyalty tiers
            return response.data.CustomerType?.map(type => ({
                external_id: type.customerTypeID.toString(),
                program_name: type.name || 'Lightspeed Loyalty',
                program_type: 'tier_based',
                description: `Lightspeed customer tier: ${type.name}`,
                is_active: !type.archived,
                points_per_dollar: parseFloat(type.discountPercent || 0) / 100,
                dollar_per_point: 0
            })) || [];
        } catch (error) {
            throw new Error(`Lightspeed API error: ${error.response?.data?.message || error.message}`);
        }
    }

    async fetchGenericLoyaltyPrograms(posSystem, credentials) {
        const axios = require('axios');
        
        try {
            const config = {
                method: 'GET',
                url: `${posSystem.api_endpoint}/loyalty/programs`,
                headers: { 'Content-Type': 'application/json' }
            };

            if (posSystem.auth_type === 'api_key') {
                config.headers[credentials.header_name || 'X-API-Key'] = credentials.api_key;
            } else if (posSystem.auth_type === 'bearer') {
                config.headers['Authorization'] = `Bearer ${credentials.token}`;
            }

            const response = await axios(config);
            
            return response.data.programs?.map(program => ({
                external_id: program.id || program.external_id,
                program_name: program.name,
                program_type: program.type || 'points',
                description: program.description,
                is_active: program.is_active !== false,
                points_per_dollar: parseFloat(program.points_per_dollar || 1),
                dollar_per_point: parseFloat(program.dollar_per_point || 0.01)
            })) || [];
        } catch (error) {
            throw new Error(`Generic POS API error: ${error.message}`);
        }
    }

    async fetchLoyaltyCustomersFromPOS(posSystem, programId) {
        const credentials = JSON.parse(posSystem.auth_credentials || '{}');
        
        switch (posSystem.system_type) {
            case 'square':
                return await this.fetchSquareLoyaltyCustomers(posSystem, credentials, programId);
            case 'shopify_pos':
                return await this.fetchShopifyLoyaltyCustomers(posSystem, credentials);
            case 'lightspeed':
                return await this.fetchLightspeedLoyaltyCustomers(posSystem, credentials, programId);
            default:
                return await this.fetchGenericLoyaltyCustomers(posSystem, credentials, programId);
        }
    }

    async fetchSquareLoyaltyCustomers(posSystem, credentials, programId) {
        const axios = require('axios');
        
        try {
            const response = await axios.post(`${posSystem.api_endpoint}/v2/loyalty/accounts/search`, {
                query: {
                    filter: {
                        loyalty_program_id: programId
                    }
                }
            }, {
                headers: {
                    'Authorization': `Bearer ${credentials.access_token}`,
                    'Square-Version': '2023-10-18',
                    'Content-Type': 'application/json'
                }
            });

            return response.data.loyalty_accounts?.map(account => ({
                external_id: account.id,
                customer_email: account.customer_id, // Would need to fetch customer details separately
                customer_name: null,
                customer_phone: null,
                current_points: account.balance || 0,
                lifetime_points: account.lifetime_balance || 0,
                current_tier: null,
                tier_level: 0,
                total_visits: 0,
                total_spent: 0,
                last_visit_date: account.updated_at ? new Date(account.updated_at).toISOString().split('T')[0] : null
            })) || [];
        } catch (error) {
            throw new Error(`Square API error: ${error.response?.data?.message || error.message}`);
        }
    }

    async fetchShopifyLoyaltyCustomers(posSystem, credentials) {
        const axios = require('axios');
        
        try {
            const response = await axios.get(`${posSystem.api_endpoint}/admin/api/2023-10/customers.json?limit=250`, {
                headers: {
                    'X-Shopify-Access-Token': credentials.access_token,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.customers?.map(customer => ({
                external_id: customer.id.toString(),
                customer_email: customer.email,
                customer_name: `${customer.first_name} ${customer.last_name}`.trim(),
                customer_phone: customer.phone,
                current_points: 0, // Would need loyalty app integration
                lifetime_points: 0,
                current_tier: customer.tags?.includes('VIP') ? 'VIP' : 'Standard',
                tier_level: customer.tags?.includes('VIP') ? 2 : 1,
                total_visits: customer.orders_count || 0,
                total_spent: parseFloat(customer.total_spent || 0),
                last_visit_date: customer.last_order_date
            })) || [];
        } catch (error) {
            throw new Error(`Shopify API error: ${error.response?.data?.message || error.message}`);
        }
    }

    async fetchLightspeedLoyaltyCustomers(posSystem, credentials, customerTypeId) {
        const axios = require('axios');
        
        try {
            const response = await axios.get(`${posSystem.api_endpoint}/API/Account/${credentials.account_id}/Customer.json?customerTypeID=${customerTypeId}`, {
                headers: {
                    'Authorization': `Bearer ${credentials.access_token}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.Customer?.map(customer => ({
                external_id: customer.customerID.toString(),
                customer_email: customer.Contact?.Emails?.ContactEmail?.address,
                customer_name: `${customer.firstName} ${customer.lastName}`.trim(),
                customer_phone: customer.Contact?.Phones?.ContactPhone?.number,
                current_points: 0, // Lightspeed doesn't track points directly
                lifetime_points: 0,
                current_tier: customer.CustomerType?.name,
                tier_level: parseInt(customer.customerTypeID || 0),
                total_visits: 0,
                total_spent: parseFloat(customer.creditLimit || 0),
                last_visit_date: customer.modifyTime ? new Date(customer.modifyTime).toISOString().split('T')[0] : null
            })) || [];
        } catch (error) {
            throw new Error(`Lightspeed API error: ${error.response?.data?.message || error.message}`);
        }
    }

    async fetchGenericLoyaltyCustomers(posSystem, credentials, programId) {
        const axios = require('axios');
        
        try {
            const config = {
                method: 'GET',
                url: `${posSystem.api_endpoint}/loyalty/programs/${programId}/customers`,
                headers: { 'Content-Type': 'application/json' }
            };

            if (posSystem.auth_type === 'api_key') {
                config.headers[credentials.header_name || 'X-API-Key'] = credentials.api_key;
            } else if (posSystem.auth_type === 'bearer') {
                config.headers['Authorization'] = `Bearer ${credentials.token}`;
            }

            const response = await axios(config);
            
            return response.data.customers?.map(customer => ({
                external_id: customer.id || customer.external_id,
                customer_email: customer.email,
                customer_name: customer.name,
                customer_phone: customer.phone,
                current_points: parseInt(customer.current_points || 0),
                lifetime_points: parseInt(customer.lifetime_points || 0),
                current_tier: customer.tier,
                tier_level: parseInt(customer.tier_level || 0),
                total_visits: parseInt(customer.total_visits || 0),
                total_spent: parseFloat(customer.total_spent || 0),
                last_visit_date: customer.last_visit_date
            })) || [];
        } catch (error) {
            throw new Error(`Generic POS API error: ${error.message}`);
        }
    }

    async upsertPOSLoyaltyProgram(posSystemId, programData, connection = null) {
        const db = connection || this.db;
        
        // Check if program already exists
        const [existing] = await db.execute(
            'SELECT id FROM pos_loyalty_programs WHERE pos_system_id = ? AND external_program_id = ?',
            [posSystemId, programData.external_id]
        );

        if (existing.length > 0) {
            // Update existing program
            await db.execute(`
                UPDATE pos_loyalty_programs 
                SET program_name = ?, program_type = ?, description = ?, is_active = ?,
                    points_per_dollar = ?, dollar_per_point = ?, last_synced = CURRENT_TIMESTAMP,
                    sync_status = 'synced'
                WHERE id = ?
            `, [
                programData.program_name,
                programData.program_type,
                programData.description,
                programData.is_active,
                programData.points_per_dollar,
                programData.dollar_per_point,
                existing[0].id
            ]);

            return { created: false, id: existing[0].id };
        } else {
            // Create new program record
            const [result] = await db.execute(`
                INSERT INTO pos_loyalty_programs (
                    pos_system_id, external_program_id, program_name, program_type,
                    description, is_active, points_per_dollar, dollar_per_point, sync_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced')
            `, [
                posSystemId,
                programData.external_id,
                programData.program_name,
                programData.program_type,
                programData.description,
                programData.is_active,
                programData.points_per_dollar,
                programData.dollar_per_point
            ]);

            return { created: true, id: result.insertId };
        }
    }

    async upsertPOSLoyaltyCustomer(posSystemId, posProgramId, customerData, connection = null) {
        const db = connection || this.db;
        
        // Check if customer already exists
        const [existing] = await db.execute(
            'SELECT id FROM pos_customer_loyalty WHERE pos_system_id = ? AND pos_program_id = ? AND external_customer_id = ?',
            [posSystemId, posProgramId, customerData.external_id]
        );

        if (existing.length > 0) {
            // Update existing customer
            await db.execute(`
                UPDATE pos_customer_loyalty 
                SET customer_email = ?, customer_name = ?, customer_phone = ?,
                    current_points = ?, lifetime_points = ?, current_tier = ?, tier_level = ?,
                    total_visits = ?, total_spent = ?, last_visit_date = ?,
                    last_synced = CURRENT_TIMESTAMP, sync_status = 'synced'
                WHERE id = ?
            `, [
                customerData.customer_email,
                customerData.customer_name,
                customerData.customer_phone,
                customerData.current_points,
                customerData.lifetime_points,
                customerData.current_tier,
                customerData.tier_level,
                customerData.total_visits,
                customerData.total_spent,
                customerData.last_visit_date,
                existing[0].id
            ]);

            return { created: false, id: existing[0].id };
        } else {
            // Create new customer record
            const [result] = await db.execute(`
                INSERT INTO pos_customer_loyalty (
                    pos_system_id, pos_program_id, external_customer_id, customer_email,
                    customer_name, customer_phone, current_points, lifetime_points,
                    current_tier, tier_level, total_visits, total_spent, last_visit_date, sync_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
            `, [
                posSystemId,
                posProgramId,
                customerData.external_id,
                customerData.customer_email,
                customerData.customer_name,
                customerData.customer_phone,
                customerData.current_points,
                customerData.lifetime_points,
                customerData.current_tier,
                customerData.tier_level,
                customerData.total_visits,
                customerData.total_spent,
                customerData.last_visit_date
            ]);

            return { created: true, id: result.insertId };
        }
    }

    // Get loyalty programs from all POS systems
    async getPOSLoyaltyPrograms(filters = {}) {
        const { pos_system_id, is_active, limit = 50, offset = 0 } = filters;
        
        let query = `
            SELECT plp.*, ps.name as pos_system_name, ps.system_type,
                   COUNT(pcl.id) as enrolled_customers
            FROM pos_loyalty_programs plp
            JOIN pos_systems ps ON plp.pos_system_id = ps.id
            LEFT JOIN pos_customer_loyalty pcl ON plp.id = pcl.pos_program_id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (pos_system_id) {
            query += ' AND plp.pos_system_id = ?';
            params.push(pos_system_id);
        }
        
        if (is_active !== undefined) {
            query += ' AND plp.is_active = ?';
            params.push(is_active);
        }
        
        query += ' GROUP BY plp.id ORDER BY plp.last_synced DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [programs] = await this.db.execute(query, params);
        return programs;
    }

    async getPOSLoyaltyCustomers(filters = {}) {
        const { 
            pos_system_id, 
            pos_program_id, 
            customer_email,
            current_tier,
            limit = 50, 
            offset = 0 
        } = filters;
        
        let query = `
            SELECT pcl.*, plp.program_name, ps.name as pos_system_name, ps.system_type
            FROM pos_customer_loyalty pcl
            JOIN pos_loyalty_programs plp ON pcl.pos_program_id = plp.id
            JOIN pos_systems ps ON pcl.pos_system_id = ps.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (pos_system_id) {
            query += ' AND pcl.pos_system_id = ?';
            params.push(pos_system_id);
        }
        
        if (pos_program_id) {
            query += ' AND pcl.pos_program_id = ?';
            params.push(pos_program_id);
        }

        if (customer_email) {
            query += ' AND pcl.customer_email LIKE ?';
            params.push(`%${customer_email}%`);
        }

        if (current_tier) {
            query += ' AND pcl.current_tier = ?';
            params.push(current_tier);
        }
        
        query += ' ORDER BY pcl.last_synced DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [customers] = await this.db.execute(query, params);
        return customers;
    }

    // Analytics for POS loyalty programs
    async getPOSLoyaltyAnalytics(posSystemId = null, programId = null) {
        let systemFilter = '';
        let programFilter = '';
        const params = [];
        
        if (posSystemId) {
            systemFilter = 'AND plp.pos_system_id = ?';
            params.push(posSystemId);
        }
        
        if (programId) {
            programFilter = 'AND plp.id = ?';
            params.push(programId);
        }

        const [analytics] = await this.db.execute(`
            SELECT 
                plp.program_name,
                ps.name as pos_system_name,
                ps.system_type,
                COUNT(DISTINCT pcl.id) as total_customers,
                COUNT(DISTINCT CASE WHEN pcl.current_points > 0 THEN pcl.id END) as customers_with_points,
                SUM(pcl.current_points) as total_outstanding_points,
                SUM(pcl.lifetime_points) as total_lifetime_points,
                AVG(pcl.current_points) as avg_current_points,
                AVG(pcl.total_spent) as avg_customer_spending,
                COUNT(DISTINCT pcl.current_tier) as tier_count,
                MAX(pcl.last_synced) as last_sync_date
            FROM pos_loyalty_programs plp
            JOIN pos_systems ps ON plp.pos_system_id = ps.id
            LEFT JOIN pos_customer_loyalty pcl ON plp.id = pcl.pos_program_id
            WHERE plp.is_active = 1 ${systemFilter} ${programFilter}
            GROUP BY plp.id
            ORDER BY ps.name, plp.program_name
        `, params);

        return analytics;
    }

    // Handle webhook updates from POS systems
    async handleLoyaltyWebhook(posSystemId, webhookData) {
        try {
            const loyaltyUpdate = this.extractLoyaltyUpdateFromWebhook(webhookData);
            
            if (loyaltyUpdate.type === 'customer_update' && loyaltyUpdate.data) {
                // Find the program
                const [programs] = await this.db.execute(
                    'SELECT id FROM pos_loyalty_programs WHERE pos_system_id = ? AND external_program_id = ?',
                    [posSystemId, loyaltyUpdate.program_id]
                );

                if (programs.length > 0) {
                    await this.upsertPOSLoyaltyCustomer(posSystemId, programs[0].id, loyaltyUpdate.data);
                    return { processed: true, customer_id: loyaltyUpdate.data.external_id };
                }
            }

            return { processed: false, reason: 'No loyalty data in webhook or program not found' };
        } catch (error) {
            throw new Error(`Failed to process loyalty webhook: ${error.message}`);
        }
    }

    extractLoyaltyUpdateFromWebhook(webhookData) {
        // Extract loyalty data from webhook payload
        if (webhookData.loyalty_account) {
            return {
                type: 'customer_update',
                program_id: webhookData.loyalty_account.program_id,
                data: {
                    external_id: webhookData.loyalty_account.customer_id,
                    current_points: webhookData.loyalty_account.balance || 0,
                    lifetime_points: webhookData.loyalty_account.lifetime_balance || 0
                }
            };
        }

        return { type: 'unknown' };
    }
}

module.exports = POSLoyaltyService;

