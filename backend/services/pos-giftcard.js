// HM Herbs POS Gift Card Integration Service
// Sync and manage gift cards from connected POS systems

class POSGiftCardService {
    constructor(db) {
        this.db = db;
    }

    // Sync gift cards from POS system
    async syncGiftCardsFromPOS(posSystemId) {
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
            const giftCards = await this.fetchGiftCardsFromPOS(posSystem);

            const results = {
                total: giftCards.length,
                new: 0,
                updated: 0,
                failed: 0,
                errors: []
            };

            for (const giftCardData of giftCards) {
                try {
                    const result = await this.upsertPOSGiftCard(posSystemId, giftCardData, connection);
                    if (result.created) {
                        results.new++;
                    } else {
                        results.updated++;
                    }
                } catch (error) {
                    results.failed++;
                    results.errors.push({
                        external_id: giftCardData.external_id,
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
            throw new Error(`Failed to sync gift cards from POS: ${error.message}`);
        } finally {
            connection.release();
        }
    }

    async fetchGiftCardsFromPOS(posSystem) {
        const credentials = JSON.parse(posSystem.auth_credentials || '{}');
        
        switch (posSystem.system_type) {
            case 'square':
                return await this.fetchSquareGiftCards(posSystem, credentials);
            case 'shopify_pos':
                return await this.fetchShopifyGiftCards(posSystem, credentials);
            case 'lightspeed':
                return await this.fetchLightspeedGiftCards(posSystem, credentials);
            default:
                return await this.fetchGenericGiftCards(posSystem, credentials);
        }
    }

    async fetchSquareGiftCards(posSystem, credentials) {
        const axios = require('axios');
        
        try {
            const response = await axios.get(`${posSystem.api_endpoint}/v2/gift-cards`, {
                headers: {
                    'Authorization': `Bearer ${credentials.access_token}`,
                    'Square-Version': '2023-10-18',
                    'Content-Type': 'application/json'
                }
            });

            return response.data.gift_cards?.map(card => ({
                external_id: card.id,
                card_number: card.gan,
                current_balance: (card.balance_money?.amount || 0) / 100,
                initial_amount: (card.balance_money?.amount || 0) / 100, // Square doesn't track initial
                currency: card.balance_money?.currency || 'USD',
                status: card.state?.toLowerCase() || 'unknown',
                issued_date: card.created_at ? new Date(card.created_at).toISOString().split('T')[0] : null,
                customer_email: null, // Square doesn't expose customer info in gift card API
                customer_name: null
            })) || [];
        } catch (error) {
            throw new Error(`Square API error: ${error.response?.data?.message || error.message}`);
        }
    }

    async fetchShopifyGiftCards(posSystem, credentials) {
        const axios = require('axios');
        
        try {
            const response = await axios.get(`${posSystem.api_endpoint}/admin/api/2023-10/gift_cards.json`, {
                headers: {
                    'X-Shopify-Access-Token': credentials.access_token,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.gift_cards?.map(card => ({
                external_id: card.id.toString(),
                card_number: card.code,
                current_balance: parseFloat(card.balance || 0),
                initial_amount: parseFloat(card.initial_value || 0),
                currency: card.currency || 'USD',
                status: card.disabled_at ? 'disabled' : 'active',
                issued_date: card.created_at ? new Date(card.created_at).toISOString().split('T')[0] : null,
                customer_email: card.customer?.email || null,
                customer_name: card.customer ? `${card.customer.first_name} ${card.customer.last_name}`.trim() : null
            })) || [];
        } catch (error) {
            throw new Error(`Shopify API error: ${error.response?.data?.message || error.message}`);
        }
    }

    async fetchLightspeedGiftCards(posSystem, credentials) {
        const axios = require('axios');
        
        try {
            const response = await axios.get(`${posSystem.api_endpoint}/API/Account/${credentials.account_id}/GiftCard.json`, {
                headers: {
                    'Authorization': `Bearer ${credentials.access_token}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.GiftCard?.map(card => ({
                external_id: card.giftCardID.toString(),
                card_number: card.code,
                current_balance: parseFloat(card.balance || 0),
                initial_amount: parseFloat(card.originalBalance || 0),
                currency: 'USD', // Lightspeed typically uses USD
                status: card.archived ? 'archived' : 'active',
                issued_date: card.createTime ? new Date(card.createTime).toISOString().split('T')[0] : null,
                customer_email: card.Customer?.Contact?.Emails?.ContactEmail?.address || null,
                customer_name: card.Customer ? `${card.Customer.firstName} ${card.Customer.lastName}`.trim() : null
            })) || [];
        } catch (error) {
            throw new Error(`Lightspeed API error: ${error.response?.data?.message || error.message}`);
        }
    }

    async fetchGenericGiftCards(posSystem, credentials) {
        // Generic implementation for custom POS systems
        const axios = require('axios');
        
        try {
            const config = {
                method: 'GET',
                url: `${posSystem.api_endpoint}/gift-cards`,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            // Add authentication based on type
            if (posSystem.auth_type === 'api_key') {
                config.headers[credentials.header_name || 'X-API-Key'] = credentials.api_key;
            } else if (posSystem.auth_type === 'bearer') {
                config.headers['Authorization'] = `Bearer ${credentials.token}`;
            }

            const response = await axios(config);
            
            // Assume generic format
            return response.data.gift_cards?.map(card => ({
                external_id: card.id || card.external_id,
                card_number: card.number || card.code,
                current_balance: parseFloat(card.balance || 0),
                initial_amount: parseFloat(card.initial_amount || card.balance || 0),
                currency: card.currency || 'USD',
                status: card.status || 'active',
                issued_date: card.issued_date || card.created_at,
                customer_email: card.customer_email,
                customer_name: card.customer_name
            })) || [];
        } catch (error) {
            throw new Error(`Generic POS API error: ${error.message}`);
        }
    }

    async upsertPOSGiftCard(posSystemId, giftCardData, connection = null) {
        const db = connection || this.db;
        
        // Check if gift card already exists
        const [existing] = await db.execute(
            'SELECT id FROM pos_gift_cards WHERE pos_system_id = ? AND external_gift_card_id = ?',
            [posSystemId, giftCardData.external_id]
        );

        if (existing.length > 0) {
            // Update existing gift card
            await db.execute(`
                UPDATE pos_gift_cards 
                SET card_number = ?, current_balance = ?, initial_amount = ?, currency = ?,
                    status = ?, issued_date = ?, expiry_date = ?, customer_email = ?, 
                    customer_name = ?, last_synced = CURRENT_TIMESTAMP, sync_status = 'synced'
                WHERE id = ?
            `, [
                giftCardData.card_number,
                giftCardData.current_balance,
                giftCardData.initial_amount,
                giftCardData.currency,
                giftCardData.status,
                giftCardData.issued_date,
                giftCardData.expiry_date || null,
                giftCardData.customer_email,
                giftCardData.customer_name,
                existing[0].id
            ]);

            return { created: false, id: existing[0].id };
        } else {
            // Create new gift card record
            const [result] = await db.execute(`
                INSERT INTO pos_gift_cards (
                    pos_system_id, external_gift_card_id, card_number, current_balance,
                    initial_amount, currency, status, issued_date, expiry_date,
                    customer_email, customer_name, sync_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
            `, [
                posSystemId,
                giftCardData.external_id,
                giftCardData.card_number,
                giftCardData.current_balance,
                giftCardData.initial_amount,
                giftCardData.currency,
                giftCardData.status,
                giftCardData.issued_date,
                giftCardData.expiry_date || null,
                giftCardData.customer_email,
                giftCardData.customer_name
            ]);

            return { created: true, id: result.insertId };
        }
    }

    // Get gift cards from all POS systems
    async getPOSGiftCards(filters = {}) {
        const { 
            pos_system_id, 
            status, 
            customer_email,
            card_number,
            limit = 50, 
            offset = 0 
        } = filters;
        
        let query = `
            SELECT pgc.*, ps.name as pos_system_name, ps.system_type
            FROM pos_gift_cards pgc
            JOIN pos_systems ps ON pgc.pos_system_id = ps.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (pos_system_id) {
            query += ' AND pgc.pos_system_id = ?';
            params.push(pos_system_id);
        }
        
        if (status) {
            query += ' AND pgc.status = ?';
            params.push(status);
        }

        if (customer_email) {
            query += ' AND pgc.customer_email LIKE ?';
            params.push(`%${customer_email}%`);
        }

        if (card_number) {
            query += ' AND pgc.card_number LIKE ?';
            params.push(`%${card_number}%`);
        }
        
        query += ' ORDER BY pgc.last_synced DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [giftCards] = await this.db.execute(query, params);
        return giftCards;
    }

    async getPOSGiftCardById(giftCardId) {
        const [giftCards] = await this.db.execute(`
            SELECT pgc.*, ps.name as pos_system_name, ps.system_type
            FROM pos_gift_cards pgc
            JOIN pos_systems ps ON pgc.pos_system_id = ps.id
            WHERE pgc.id = ?
        `, [giftCardId]);

        if (giftCards.length === 0) {
            throw new Error('POS gift card not found');
        }

        return giftCards[0];
    }

    // Check gift card balance in real-time from POS
    async checkGiftCardBalance(giftCardId) {
        const giftCard = await this.getPOSGiftCardById(giftCardId);
        
        try {
            // Get fresh balance from POS system
            const [posSystems] = await this.db.execute(
                'SELECT * FROM pos_systems WHERE id = ?',
                [giftCard.pos_system_id]
            );

            if (posSystems.length === 0) {
                throw new Error('POS system not found');
            }

            const posSystem = posSystems[0];
            const freshBalance = await this.fetchGiftCardBalanceFromPOS(
                posSystem, 
                giftCard.external_gift_card_id
            );

            // Update local record if balance changed
            if (freshBalance !== giftCard.current_balance) {
                await this.db.execute(`
                    UPDATE pos_gift_cards 
                    SET current_balance = ?, last_synced = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [freshBalance, giftCardId]);
            }

            return {
                card_number: giftCard.card_number,
                current_balance: freshBalance,
                status: giftCard.status,
                pos_system: giftCard.pos_system_name
            };
        } catch (error) {
            // Return cached balance if POS is unavailable
            return {
                card_number: giftCard.card_number,
                current_balance: giftCard.current_balance,
                status: giftCard.status,
                pos_system: giftCard.pos_system_name,
                note: 'Cached balance - POS system unavailable'
            };
        }
    }

    async fetchGiftCardBalanceFromPOS(posSystem, externalGiftCardId) {
        const credentials = JSON.parse(posSystem.auth_credentials || '{}');
        
        switch (posSystem.system_type) {
            case 'square':
                return await this.fetchSquareGiftCardBalance(posSystem, credentials, externalGiftCardId);
            case 'shopify_pos':
                return await this.fetchShopifyGiftCardBalance(posSystem, credentials, externalGiftCardId);
            case 'lightspeed':
                return await this.fetchLightspeedGiftCardBalance(posSystem, credentials, externalGiftCardId);
            default:
                return await this.fetchGenericGiftCardBalance(posSystem, credentials, externalGiftCardId);
        }
    }

    async fetchSquareGiftCardBalance(posSystem, credentials, giftCardId) {
        const axios = require('axios');
        
        const response = await axios.get(`${posSystem.api_endpoint}/v2/gift-cards/${giftCardId}`, {
            headers: {
                'Authorization': `Bearer ${credentials.access_token}`,
                'Square-Version': '2023-10-18'
            }
        });

        return (response.data.gift_card?.balance_money?.amount || 0) / 100;
    }

    async fetchShopifyGiftCardBalance(posSystem, credentials, giftCardId) {
        const axios = require('axios');
        
        const response = await axios.get(`${posSystem.api_endpoint}/admin/api/2023-10/gift_cards/${giftCardId}.json`, {
            headers: {
                'X-Shopify-Access-Token': credentials.access_token
            }
        });

        return parseFloat(response.data.gift_card?.balance || 0);
    }

    async fetchLightspeedGiftCardBalance(posSystem, credentials, giftCardId) {
        const axios = require('axios');
        
        const response = await axios.get(`${posSystem.api_endpoint}/API/Account/${credentials.account_id}/GiftCard/${giftCardId}.json`, {
            headers: {
                'Authorization': `Bearer ${credentials.access_token}`
            }
        });

        return parseFloat(response.data.GiftCard?.balance || 0);
    }

    async fetchGenericGiftCardBalance(posSystem, credentials, giftCardId) {
        const axios = require('axios');
        
        const config = {
            method: 'GET',
            url: `${posSystem.api_endpoint}/gift-cards/${giftCardId}/balance`,
            headers: { 'Content-Type': 'application/json' }
        };

        if (posSystem.auth_type === 'api_key') {
            config.headers[credentials.header_name || 'X-API-Key'] = credentials.api_key;
        } else if (posSystem.auth_type === 'bearer') {
            config.headers['Authorization'] = `Bearer ${credentials.token}`;
        }

        const response = await axios(config);
        return parseFloat(response.data.balance || 0);
    }

    // Analytics for POS gift cards
    async getPOSGiftCardAnalytics(posSystemId = null, dateRange = 30) {
        let systemFilter = '';
        const params = [dateRange];
        
        if (posSystemId) {
            systemFilter = 'AND pgc.pos_system_id = ?';
            params.push(posSystemId);
        }

        const [analytics] = await this.db.execute(`
            SELECT 
                COUNT(*) as total_cards,
                COUNT(CASE WHEN pgc.status = 'active' THEN 1 END) as active_cards,
                COUNT(CASE WHEN pgc.current_balance = 0 THEN 1 END) as fully_redeemed_cards,
                SUM(pgc.current_balance) as total_outstanding_balance,
                SUM(pgc.initial_amount) as total_value_issued,
                AVG(pgc.current_balance) as avg_balance,
                AVG(pgc.initial_amount) as avg_initial_value,
                COUNT(CASE WHEN pgc.last_synced >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 END) as recently_synced,
                ps.name as pos_system_name,
                ps.system_type
            FROM pos_gift_cards pgc
            JOIN pos_systems ps ON pgc.pos_system_id = ps.id
            WHERE 1=1 ${systemFilter}
            GROUP BY pgc.pos_system_id
            ORDER BY ps.name
        `, params);

        return analytics;
    }

    // Handle webhook updates from POS systems
    async handleGiftCardWebhook(posSystemId, webhookData) {
        try {
            const giftCardUpdate = this.extractGiftCardUpdateFromWebhook(webhookData);
            
            if (giftCardUpdate) {
                await this.upsertPOSGiftCard(posSystemId, giftCardUpdate);
                return { processed: true, gift_card_id: giftCardUpdate.external_id };
            }

            return { processed: false, reason: 'No gift card data in webhook' };
        } catch (error) {
            throw new Error(`Failed to process gift card webhook: ${error.message}`);
        }
    }

    extractGiftCardUpdateFromWebhook(webhookData) {
        // Extract gift card data from webhook payload
        // This would be customized based on POS system webhook format
        if (webhookData.gift_card) {
            return {
                external_id: webhookData.gift_card.id,
                card_number: webhookData.gift_card.number || webhookData.gift_card.code,
                current_balance: parseFloat(webhookData.gift_card.balance || 0),
                status: webhookData.gift_card.status || 'active'
            };
        }

        return null;
    }
}

module.exports = POSGiftCardService;

