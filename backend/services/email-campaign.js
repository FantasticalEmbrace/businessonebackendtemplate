// HM Herbs Email Campaign Service
// Manage email collection campaigns and subscriber lists

class EmailCampaignService {
    constructor(db) {
        this.db = db;
    }

    // ===== CAMPAIGN MANAGEMENT =====

    // Create new email campaign
    async createCampaign(campaignData, adminId) {
        const {
            campaign_name,
            campaign_description,
            prompt_title,
            prompt_message,
            button_text,
            offer_type,
            offer_value,
            offer_description,
            offer_code,
            offer_expiry_days,
            display_type,
            display_delay,
            display_frequency,
            target_pages,
            target_new_visitors,
            target_returning_visitors,
            min_time_on_site,
            ab_test_variant,
            ab_test_traffic_split
        } = campaignData;

        // Validate required fields
        if (!campaign_name || !offer_type || !offer_description) {
            throw new Error('Campaign name, offer type, and offer description are required');
        }

        // Validate offer configuration
        if (['discount_percentage', 'discount_fixed', 'loyalty_points'].includes(offer_type) && !offer_value) {
            throw new Error('Offer value is required for discount and loyalty point offers');
        }

        const [result] = await this.db.execute(`
            INSERT INTO email_campaigns (
                campaign_name, campaign_description, prompt_title, prompt_message, button_text,
                offer_type, offer_value, offer_description, offer_code, offer_expiry_days,
                display_type, display_delay, display_frequency, target_pages,
                target_new_visitors, target_returning_visitors, min_time_on_site,
                ab_test_variant, ab_test_traffic_split, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            campaign_name,
            campaign_description,
            prompt_title || 'Join Our Newsletter',
            prompt_message || 'Get exclusive offers and updates!',
            button_text || 'Sign Me Up',
            offer_type,
            offer_value,
            offer_description,
            offer_code,
            offer_expiry_days || 30,
            display_type || 'popup',
            display_delay || 5,
            display_frequency || 'once_per_session',
            target_pages ? JSON.stringify(target_pages) : null,
            target_new_visitors !== false,
            target_returning_visitors || false,
            min_time_on_site || 0,
            ab_test_variant || 'A',
            ab_test_traffic_split || 100,
            adminId
        ]);

        return await this.getCampaignById(result.insertId);
    }

    // Update existing campaign
    async updateCampaign(campaignId, campaignData, _adminId) {
        const {
            campaign_name,
            campaign_description,
            is_active,
            prompt_title,
            prompt_message,
            button_text,
            offer_type,
            offer_value,
            offer_description,
            offer_code,
            offer_expiry_days,
            display_type,
            display_delay,
            display_frequency,
            target_pages,
            target_new_visitors,
            target_returning_visitors,
            min_time_on_site,
            ab_test_variant,
            ab_test_traffic_split
        } = campaignData;

        await this.db.execute(`
            UPDATE email_campaigns 
            SET campaign_name = ?, campaign_description = ?, is_active = ?,
                prompt_title = ?, prompt_message = ?, button_text = ?,
                offer_type = ?, offer_value = ?, offer_description = ?, offer_code = ?, offer_expiry_days = ?,
                display_type = ?, display_delay = ?, display_frequency = ?, target_pages = ?,
                target_new_visitors = ?, target_returning_visitors = ?, min_time_on_site = ?,
                ab_test_variant = ?, ab_test_traffic_split = ?
            WHERE id = ?
        `, [
            campaign_name,
            campaign_description,
            is_active,
            prompt_title,
            prompt_message,
            button_text,
            offer_type,
            offer_value,
            offer_description,
            offer_code,
            offer_expiry_days,
            display_type,
            display_delay,
            display_frequency,
            target_pages ? JSON.stringify(target_pages) : null,
            target_new_visitors,
            target_returning_visitors,
            min_time_on_site,
            ab_test_variant,
            ab_test_traffic_split,
            campaignId
        ]);

        return await this.getCampaignById(campaignId);
    }

    // Get all campaigns
    async getCampaigns(filters = {}) {
        const { is_active, offer_type, display_type, limit = 50, offset = 0 } = filters;
        
        let query = `
            SELECT ec.*, CONCAT(COALESCE(au.first_name,''), ' ', COALESCE(au.last_name,'')) as created_by_username,
                   (SELECT COUNT(*) FROM email_subscribers es WHERE es.campaign_id = ec.id) as subscriber_count,
                   (SELECT COUNT(*) FROM email_subscribers es WHERE es.campaign_id = ec.id AND es.offer_claimed = 1) as offers_claimed
            FROM email_campaigns ec
            LEFT JOIN admin_users au ON ec.created_by = au.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (is_active !== undefined) {
            query += ' AND ec.is_active = ?';
            params.push(is_active);
        }
        
        if (offer_type) {
            query += ' AND ec.offer_type = ?';
            params.push(offer_type);
        }

        if (display_type) {
            query += ' AND ec.display_type = ?';
            params.push(display_type);
        }
        
        query += ' ORDER BY ec.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [campaigns] = await this.db.execute(query, params);
        
        // Parse JSON fields
        return campaigns.map(campaign => ({
            ...campaign,
            target_pages: campaign.target_pages ? JSON.parse(campaign.target_pages) : null
        }));
    }

    // Get campaign by ID
    async getCampaignById(campaignId) {
        const [campaigns] = await this.db.execute(`
            SELECT ec.*, CONCAT(COALESCE(au.first_name,''), ' ', COALESCE(au.last_name,'')) as created_by_username,
                   (SELECT COUNT(*) FROM email_subscribers es WHERE es.campaign_id = ec.id) as subscriber_count,
                   (SELECT COUNT(*) FROM email_subscribers es WHERE es.campaign_id = ec.id AND es.offer_claimed = 1) as offers_claimed
            FROM email_campaigns ec
            LEFT JOIN admin_users au ON ec.created_by = au.id
            WHERE ec.id = ?
        `, [campaignId]);

        if (campaigns.length === 0) {
            throw new Error('Campaign not found');
        }

        const campaign = campaigns[0];
        return {
            ...campaign,
            target_pages: campaign.target_pages ? JSON.parse(campaign.target_pages) : null
        };
    }

    // Get active campaign for frontend display
    async getActiveCampaignForDisplay(_userAgent = '', _referrer = '', isNewVisitor = true) {
        const [campaigns] = await this.db.execute(`
            SELECT * FROM email_campaigns 
            WHERE is_active = 1 
            AND (target_new_visitors = 1 AND ? = 1 OR target_returning_visitors = 1 AND ? = 0)
            ORDER BY created_at DESC 
            LIMIT 1
        `, [isNewVisitor, isNewVisitor]);

        if (campaigns.length === 0) {
            return null;
        }

        const campaign = campaigns[0];
        
        // A/B testing logic
        if (campaign.ab_test_traffic_split < 100) {
            const random = Math.random() * 100;
            if (random > campaign.ab_test_traffic_split) {
                return null; // Don't show to this user
            }
        }

        return {
            ...campaign,
            target_pages: campaign.target_pages ? JSON.parse(campaign.target_pages) : null
        };
    }

    // Delete campaign
    async deleteCampaign(campaignId) {
        const [result] = await this.db.execute('DELETE FROM email_campaigns WHERE id = ?', [campaignId]);
        
        if (result.affectedRows === 0) {
            throw new Error('Campaign not found');
        }

        return { success: true, message: 'Campaign deleted successfully' };
    }

    // ===== SUBSCRIBER MANAGEMENT =====

    // Add new subscriber
    async addSubscriber(subscriberData) {
        const {
            email,
            first_name,
            last_name,
            campaign_id,
            signup_ip,
            signup_user_agent,
            signup_referrer
        } = subscriberData;

        // Validate email
        if (!email || !this.isValidEmail(email)) {
            throw new Error('Valid email address is required');
        }

        const connection = await this.db.getConnection();
        
        try {
            await connection.beginTransaction();

            // Check if email already exists
            const [existing] = await connection.execute(
                'SELECT id, status FROM email_subscribers WHERE email = ?',
                [email.toLowerCase()]
            );

            if (existing.length > 0) {
                if (existing[0].status === 'active') {
                    throw new Error('Email address is already subscribed');
                } else {
                    // Reactivate if previously unsubscribed
                    await connection.execute(`
                        UPDATE email_subscribers 
                        SET status = 'active', campaign_id = ?, subscribed_at = CURRENT_TIMESTAMP,
                            unsubscribed_at = NULL, first_name = ?, last_name = ?
                        WHERE id = ?
                    `, [campaign_id, first_name, last_name, existing[0].id]);
                    
                    await connection.commit();
                    return await this.getSubscriberById(existing[0].id);
                }
            }

            // Get campaign details for offer
            let offerCode = null;
            let offerExpiresAt = null;
            
            if (campaign_id) {
                const [campaigns] = await connection.execute(
                    'SELECT offer_code, offer_expiry_days FROM email_campaigns WHERE id = ?',
                    [campaign_id]
                );
                
                if (campaigns.length > 0) {
                    const campaign = campaigns[0];
                    offerCode = campaign.offer_code || this.generateOfferCode();
                    
                    if (campaign.offer_expiry_days) {
                        offerExpiresAt = new Date();
                        offerExpiresAt.setDate(offerExpiresAt.getDate() + campaign.offer_expiry_days);
                    }
                }
            }

            // Insert new subscriber
            const [result] = await connection.execute(`
                INSERT INTO email_subscribers (
                    email, first_name, last_name, campaign_id, offer_code_sent, offer_expires_at,
                    signup_ip, signup_user_agent, signup_referrer
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                email.toLowerCase(),
                first_name,
                last_name,
                campaign_id,
                offerCode,
                offerExpiresAt,
                signup_ip,
                signup_user_agent,
                signup_referrer
            ]);

            // Update campaign analytics
            if (campaign_id) {
                await this.updateCampaignAnalytics(campaign_id, 'signup', connection);
            }

            await connection.commit();
            return await this.getSubscriberById(result.insertId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Get all subscribers
    async getSubscribers(filters = {}) {
        const { 
            status, 
            campaign_id, 
            offer_claimed,
            search,
            limit = 50, 
            offset = 0 
        } = filters;
        
        let query = `
            SELECT es.*, ec.campaign_name, ec.offer_description
            FROM email_subscribers es
            LEFT JOIN email_campaigns ec ON es.campaign_id = ec.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (status) {
            query += ' AND es.status = ?';
            params.push(status);
        }
        
        if (campaign_id) {
            query += ' AND es.campaign_id = ?';
            params.push(campaign_id);
        }

        if (offer_claimed !== undefined) {
            query += ' AND es.offer_claimed = ?';
            params.push(offer_claimed);
        }

        if (search) {
            query += ' AND (es.email LIKE ? OR es.first_name LIKE ? OR es.last_name LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        
        query += ' ORDER BY es.subscribed_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [subscribers] = await this.db.execute(query, params);
        return subscribers;
    }

    // Get subscriber by ID
    async getSubscriberById(subscriberId) {
        const [subscribers] = await this.db.execute(`
            SELECT es.*, ec.campaign_name, ec.offer_description
            FROM email_subscribers es
            LEFT JOIN email_campaigns ec ON es.campaign_id = ec.id
            WHERE es.id = ?
        `, [subscriberId]);

        if (subscribers.length === 0) {
            throw new Error('Subscriber not found');
        }

        return subscribers[0];
    }

    // Update subscriber status
    async updateSubscriberStatus(subscriberId, status, _reason = null) {
        const validStatuses = ['active', 'unsubscribed', 'bounced', 'complained'];
        
        if (!validStatuses.includes(status)) {
            throw new Error('Invalid status');
        }

        const updateData = { status };
        
        if (status === 'unsubscribed') {
            updateData.unsubscribed_at = new Date();
        }

        await this.db.execute(`
            UPDATE email_subscribers 
            SET status = ?, unsubscribed_at = ?
            WHERE id = ?
        `, [status, updateData.unsubscribed_at || null, subscriberId]);

        return await this.getSubscriberById(subscriberId);
    }

    // Mark offer as claimed
    async claimOffer(subscriberId, _orderReference = null) {
        await this.db.execute(`
            UPDATE email_subscribers 
            SET offer_claimed = 1
            WHERE id = ? AND offer_claimed = 0
        `, [subscriberId]);

        // Update campaign analytics
        const subscriber = await this.getSubscriberById(subscriberId);
        if (subscriber.campaign_id) {
            await this.updateCampaignAnalytics(subscriber.campaign_id, 'offer_claimed');
        }

        return { success: true, message: 'Offer claimed successfully' };
    }

    // ===== ANALYTICS =====

    // Record campaign impression
    async recordImpression(campaignId, variant = 'A') {
        await this.updateCampaignAnalytics(campaignId, 'impression', null, variant);
    }

    // Update campaign analytics
    async updateCampaignAnalytics(campaignId, action, connection = null, variant = 'A') {
        const db = connection || this.db;
        const today = new Date().toISOString().split('T')[0];

        // Get or create today's analytics record
        const [existing] = await db.execute(`
            SELECT * FROM email_campaign_analytics 
            WHERE campaign_id = ? AND date = ? AND variant = ?
        `, [campaignId, today, variant]);

        if (existing.length > 0) {
            // Update existing record
            let updateQuery = 'UPDATE email_campaign_analytics SET ';
            const params = [];
            
            switch (action) {
                case 'impression':
                    updateQuery += 'impressions = impressions + 1';
                    break;
                case 'signup':
                    updateQuery += 'signups = signups + 1';
                    break;
                case 'offer_claimed':
                    updateQuery += 'offers_claimed = offers_claimed + 1';
                    break;
            }
            
            updateQuery += ' WHERE id = ?';
            params.push(existing[0].id);
            
            await db.execute(updateQuery, params);
        } else {
            // Create new record
            const initialData = {
                impressions: action === 'impression' ? 1 : 0,
                signups: action === 'signup' ? 1 : 0,
                offers_claimed: action === 'offer_claimed' ? 1 : 0
            };

            await db.execute(`
                INSERT INTO email_campaign_analytics (
                    campaign_id, date, variant, impressions, signups, offers_claimed
                ) VALUES (?, ?, ?, ?, ?, ?)
            `, [
                campaignId, 
                today, 
                variant,
                initialData.impressions,
                initialData.signups,
                initialData.offers_claimed
            ]);
        }

        // Update conversion rates
        await this.updateConversionRates(campaignId, today, variant, db);
    }

    // Update conversion rates
    async updateConversionRates(campaignId, date, variant, db) {
        await db.execute(`
            UPDATE email_campaign_analytics 
            SET conversion_rate = CASE 
                WHEN impressions > 0 THEN ROUND((signups / impressions) * 100, 2)
                ELSE 0 
            END,
            offer_claim_rate = CASE 
                WHEN signups > 0 THEN ROUND((offers_claimed / signups) * 100, 2)
                ELSE 0 
            END
            WHERE campaign_id = ? AND date = ? AND variant = ?
        `, [campaignId, date, variant]);
    }

    // Get campaign analytics
    async getCampaignAnalytics(campaignId, dateRange = 30) {
        const [analytics] = await this.db.execute(`
            SELECT 
                DATE(date) as date,
                SUM(impressions) as impressions,
                SUM(signups) as signups,
                AVG(conversion_rate) as conversion_rate,
                SUM(offers_claimed) as offers_claimed,
                AVG(offer_claim_rate) as offer_claim_rate,
                variant
            FROM email_campaign_analytics
            WHERE campaign_id = ? 
            AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            GROUP BY DATE(date), variant
            ORDER BY date DESC
        `, [campaignId, dateRange]);

        const [summary] = await this.db.execute(`
            SELECT 
                SUM(impressions) as total_impressions,
                SUM(signups) as total_signups,
                ROUND(AVG(conversion_rate), 2) as avg_conversion_rate,
                SUM(offers_claimed) as total_offers_claimed,
                ROUND(AVG(offer_claim_rate), 2) as avg_offer_claim_rate
            FROM email_campaign_analytics
            WHERE campaign_id = ? 
            AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        `, [campaignId, dateRange]);

        return {
            summary: summary[0],
            daily_data: analytics
        };
    }

    // Get overall email marketing metrics
    async getEmailMarketingOverview(dateRange = 30) {
        const [overview] = await this.db.execute(`
            SELECT 
                COUNT(DISTINCT ec.id) as total_campaigns,
                COUNT(DISTINCT CASE WHEN ec.is_active = 1 THEN ec.id END) as active_campaigns,
                COUNT(DISTINCT es.id) as total_subscribers,
                COUNT(DISTINCT CASE WHEN es.status = 'active' THEN es.id END) as active_subscribers,
                COUNT(DISTINCT CASE WHEN es.subscribed_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN es.id END) as new_subscribers,
                COUNT(DISTINCT CASE WHEN es.offer_claimed = 1 THEN es.id END) as offers_claimed,
                SUM(eca.impressions) as total_impressions,
                SUM(eca.signups) as total_signups,
                ROUND(AVG(eca.conversion_rate), 2) as avg_conversion_rate
            FROM email_campaigns ec
            LEFT JOIN email_subscribers es ON ec.id = es.campaign_id
            LEFT JOIN email_campaign_analytics eca ON ec.id = eca.campaign_id 
                AND eca.date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        `, [dateRange, dateRange]);

        return overview[0];
    }

    // ===== UTILITY METHODS =====

    // Validate email format
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Generate unique offer code
    generateOfferCode(prefix = 'WELCOME') {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 5);
        return `${prefix}${timestamp}${random}`.toUpperCase();
    }

    // Export subscribers for email marketing platforms
    async exportSubscribers(format = 'csv', filters = {}) {
        const subscribers = await this.getSubscribers({ ...filters, limit: 10000 });
        
        if (format === 'csv') {
            return this.convertToCSV(subscribers);
        } else if (format === 'json') {
            return JSON.stringify(subscribers, null, 2);
        }
        
        throw new Error('Unsupported export format');
    }

    convertToCSV(data) {
        if (data.length === 0) return '';
        
        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(','),
            ...data.map(row => 
                headers.map(header => {
                    const value = row[header];
                    return typeof value === 'string' && value.includes(',') 
                        ? `"${value}"` 
                        : value;
                }).join(',')
            )
        ].join('\n');
        
        return csvContent;
    }
}

module.exports = EmailCampaignService;

