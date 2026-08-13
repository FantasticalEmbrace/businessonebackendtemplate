// HM Herbs Analytics and Monitoring Service
// Comprehensive monitoring and reporting for all integrations

class AnalyticsService {
    constructor(db) {
        this.db = db;
    }

    // Vendor Performance Analytics
    async getVendorPerformanceMetrics(vendorId = null, dateRange = 30) {
        let vendorFilter = '';
        const params = [dateRange];
        
        if (vendorId) {
            vendorFilter = 'AND v.id = ?';
            params.push(vendorId);
        }

        const [metrics] = await this.db.execute(`
            SELECT 
                v.id,
                v.name as vendor_name,
                v.status,
                v.rating,
                COUNT(DISTINCT vp.product_id) as total_products,
                COUNT(DISTINCT CASE WHEN vp.mapping_status = 'mapped' THEN vp.product_id END) as mapped_products,
                COUNT(DISTINCT CASE WHEN vp.mapping_status = 'conflict' THEN vp.product_id END) as conflict_products,
                COUNT(DISTINCT vci.id) as total_imports,
                COUNT(DISTINCT CASE WHEN vci.status = 'completed' THEN vci.id END) as successful_imports,
                COUNT(DISTINCT CASE WHEN vci.status = 'failed' THEN vci.id END) as failed_imports,
                AVG(vp.vendor_price) as avg_product_price,
                SUM(CASE WHEN vci.status = 'completed' THEN vci.new_products ELSE 0 END) as total_new_products,
                SUM(CASE WHEN vci.status = 'completed' THEN vci.updated_products ELSE 0 END) as total_updated_products,
                MAX(v.last_catalog_sync) as last_sync_date,
                DATEDIFF(NOW(), MAX(v.last_catalog_sync)) as days_since_last_sync
            FROM vendors v
            LEFT JOIN vendor_products vp ON v.id = vp.vendor_id
            LEFT JOIN vendor_catalog_imports vci ON v.id = vci.vendor_id 
                AND vci.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            WHERE 1=1 ${vendorFilter}
            GROUP BY v.id
            ORDER BY v.name
        `, params);

        return metrics;
    }

    async getVendorCatalogImportTrends(vendorId, days = 30) {
        const [trends] = await this.db.execute(`
            SELECT 
                DATE(created_at) as import_date,
                COUNT(*) as import_count,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful_imports,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_imports,
                SUM(CASE WHEN status = 'completed' THEN new_products ELSE 0 END) as new_products,
                SUM(CASE WHEN status = 'completed' THEN updated_products ELSE 0 END) as updated_products,
                AVG(CASE WHEN status = 'completed' THEN 
                    TIMESTAMPDIFF(MINUTE, started_at, completed_at) ELSE NULL END) as avg_duration_minutes
            FROM vendor_catalog_imports
            WHERE vendor_id = ? 
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            GROUP BY DATE(created_at)
            ORDER BY import_date DESC
        `, [vendorId, days]);

        return trends;
    }

    // POS Integration Health Monitoring
    async getPOSSystemHealth(systemId = null) {
        let systemFilter = '';
        const params = [];
        
        if (systemId) {
            systemFilter = 'AND ps.id = ?';
            params.push(systemId);
        }

        const [health] = await this.db.execute(`
            SELECT 
                ps.id,
                ps.name as system_name,
                ps.system_type,
                ps.status,
                ps.last_sync,
                ps.last_error,
                TIMESTAMPDIFF(MINUTE, ps.last_sync, NOW()) as minutes_since_last_sync,
                COUNT(pt.id) as total_transactions_24h,
                COUNT(CASE WHEN pt.status = 'completed' THEN 1 END) as successful_transactions_24h,
                COUNT(CASE WHEN pt.status = 'failed' THEN 1 END) as failed_transactions_24h,
                COUNT(CASE WHEN pt.status = 'pending' THEN 1 END) as pending_transactions,
                AVG(CASE WHEN pt.status = 'completed' THEN 
                    TIMESTAMPDIFF(SECOND, pt.created_at, pt.processed_at) END) as avg_processing_time_seconds,
                COUNT(CASE WHEN pt.transaction_type = 'inventory_sync' AND pt.status = 'completed' THEN 1 END) as inventory_syncs_24h,
                COUNT(CASE WHEN pt.transaction_type = 'webhook' AND pt.status = 'completed' THEN 1 END) as webhooks_processed_24h
            FROM pos_systems ps
            LEFT JOIN pos_transactions pt ON ps.id = pt.pos_system_id 
                AND pt.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            WHERE 1=1 ${systemFilter}
            GROUP BY ps.id
            ORDER BY ps.name
        `, params);

        // Add health status assessment
        return health.map(system => {
            let healthStatus = 'healthy';
            const issues = [];

            if (system.status === 'error') {
                healthStatus = 'critical';
                issues.push('System status is error');
            } else if (system.status === 'inactive') {
                healthStatus = 'warning';
                issues.push('System is inactive');
            }

            if (system.minutes_since_last_sync > 120) { // 2 hours
                healthStatus = healthStatus === 'healthy' ? 'warning' : 'critical';
                issues.push('Last sync was over 2 hours ago');
            }

            if (system.failed_transactions_24h > system.successful_transactions_24h * 0.1) {
                healthStatus = 'warning';
                issues.push('High failure rate (>10%)');
            }

            if (system.pending_transactions > 10) {
                healthStatus = 'warning';
                issues.push('Many pending transactions');
            }

            return {
                ...system,
                health_status: healthStatus,
                issues: issues
            };
        });
    }

    async getPOSTransactionTrends(systemId, days = 7) {
        const [trends] = await this.db.execute(`
            SELECT 
                DATE(created_at) as transaction_date,
                HOUR(created_at) as transaction_hour,
                transaction_type,
                direction,
                COUNT(*) as transaction_count,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_count,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
                AVG(CASE WHEN status = 'completed' THEN 
                    TIMESTAMPDIFF(SECOND, created_at, processed_at) END) as avg_processing_time
            FROM pos_transactions
            WHERE pos_system_id = ? 
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            GROUP BY DATE(created_at), HOUR(created_at), transaction_type, direction
            ORDER BY transaction_date DESC, transaction_hour DESC
        `, [systemId, days]);

        return trends;
    }

    // POS Gift Card Analytics
    async getPOSGiftCardMetrics(posSystemId = null, dateRange = 30) {
        let systemFilter = '';
        const params = [dateRange];
        
        if (posSystemId) {
            systemFilter = 'AND pgc.pos_system_id = ?';
            params.push(posSystemId);
        }

        const [metrics] = await this.db.execute(`
            SELECT 
                ps.name as pos_system_name,
                ps.system_type,
                COUNT(*) as total_cards,
                COUNT(CASE WHEN pgc.status = 'active' THEN 1 END) as active_cards,
                COUNT(CASE WHEN pgc.current_balance = 0 THEN 1 END) as fully_redeemed_cards,
                SUM(pgc.current_balance) as total_outstanding_balance,
                SUM(pgc.initial_amount) as total_value_issued,
                AVG(pgc.current_balance) as avg_balance,
                AVG(pgc.initial_amount) as avg_initial_value,
                COUNT(CASE WHEN pgc.last_synced >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 END) as recently_synced,
                COUNT(CASE WHEN pgc.sync_status = 'error' THEN 1 END) as sync_errors
            FROM pos_gift_cards pgc
            JOIN pos_systems ps ON pgc.pos_system_id = ps.id
            WHERE pgc.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ${systemFilter}
            GROUP BY pgc.pos_system_id
            ORDER BY ps.name
        `, [dateRange, dateRange]);

        const [syncHealth] = await this.db.execute(`
            SELECT 
                sync_status,
                COUNT(*) as count
            FROM pos_gift_cards pgc
            WHERE pgc.last_synced >= DATE_SUB(NOW(), INTERVAL ? DAY) ${systemFilter}
            GROUP BY sync_status
        `, [dateRange]);

        return {
            overview: metrics,
            sync_health: syncHealth
        };
    }

    // POS Loyalty Program Analytics
    async getPOSLoyaltyMetrics(posSystemId = null, programId = null, dateRange = 30) {
        let systemFilter = '';
        let programFilter = '';
        const params = [dateRange];
        
        if (posSystemId) {
            systemFilter = 'AND plp.pos_system_id = ?';
            params.push(posSystemId);
        }
        
        if (programId) {
            programFilter = 'AND plp.id = ?';
            params.push(programId);
        }

        const [metrics] = await this.db.execute(`
            SELECT 
                plp.program_name,
                ps.name as pos_system_name,
                ps.system_type,
                plp.program_type,
                COUNT(DISTINCT pcl.id) as total_customers,
                COUNT(DISTINCT CASE WHEN pcl.current_points > 0 THEN pcl.id END) as customers_with_points,
                COUNT(DISTINCT CASE WHEN pcl.last_synced >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN pcl.id END) as recently_synced_customers,
                SUM(pcl.current_points) as total_outstanding_points,
                SUM(pcl.lifetime_points) as total_lifetime_points,
                AVG(pcl.current_points) as avg_current_points,
                AVG(pcl.total_spent) as avg_customer_spending,
                COUNT(DISTINCT pcl.current_tier) as tier_count,
                MAX(pcl.last_synced) as last_sync_date
            FROM pos_loyalty_programs plp
            JOIN pos_systems ps ON plp.pos_system_id = ps.id
            LEFT JOIN pos_customer_loyalty pcl ON plp.id = pcl.pos_program_id
            WHERE plp.is_active = 1 
            AND plp.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) 
            ${systemFilter} ${programFilter}
            GROUP BY plp.id
            ORDER BY ps.name, plp.program_name
        `, [dateRange, dateRange]);

        const [tierDistribution] = await this.db.execute(`
            SELECT 
                pcl.current_tier,
                COUNT(*) as customer_count,
                AVG(pcl.current_points) as avg_points,
                AVG(pcl.total_spent) as avg_spending
            FROM pos_customer_loyalty pcl
            JOIN pos_loyalty_programs plp ON pcl.pos_program_id = plp.id
            WHERE plp.is_active = 1 ${systemFilter} ${programFilter}
            AND pcl.current_tier IS NOT NULL
            GROUP BY pcl.current_tier
            ORDER BY customer_count DESC
        `, params.slice(1)); // Remove dateRange param

        return {
            overview: metrics,
            tier_distribution: tierDistribution
        };
    }

    // POS Discount Analytics
    async getPOSDiscountMetrics(posSystemId = null, dateRange = 30) {
        let systemFilter = '';
        const params = [dateRange];
        
        if (posSystemId) {
            systemFilter = 'AND pd.pos_system_id = ?';
            params.push(posSystemId);
        }

        const [metrics] = await this.db.execute(`
            SELECT 
                ps.name as pos_system_name,
                ps.system_type,
                COUNT(DISTINCT pd.id) as total_discounts,
                COUNT(DISTINCT CASE WHEN pd.is_active = 1 THEN pd.id END) as active_discounts,
                COUNT(DISTINCT CASE WHEN pd.requires_code = 1 THEN pd.id END) as code_based_discounts,
                COUNT(DISTINCT CASE WHEN pd.ends_at IS NOT NULL AND pd.ends_at < NOW() THEN pd.id END) as expired_discounts,
                COUNT(DISTINCT pdu.id) as total_usage_count,
                SUM(pdu.discount_amount_applied) as total_discount_amount,
                AVG(pdu.discount_amount_applied) as avg_discount_amount,
                COUNT(DISTINCT pdu.customer_email) as unique_customers_used,
                COUNT(DISTINCT CASE WHEN pdu.usage_date >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN pdu.id END) as recent_usage_count,
                COUNT(CASE WHEN pd.sync_status = 'error' THEN 1 END) as sync_errors
            FROM pos_discounts pd
            JOIN pos_systems ps ON pd.pos_system_id = ps.id
            LEFT JOIN pos_discount_usage pdu ON pd.id = pdu.pos_discount_id
            WHERE pd.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ${systemFilter}
            GROUP BY pd.pos_system_id
            ORDER BY ps.name
        `, [dateRange, dateRange]);

        const [typeBreakdown] = await this.db.execute(`
            SELECT 
                pd.discount_type,
                COUNT(*) as discount_count,
                COUNT(DISTINCT pdu.id) as usage_count,
                SUM(pdu.discount_amount_applied) as total_amount_saved,
                AVG(pd.discount_percentage) as avg_percentage,
                AVG(pd.discount_value) as avg_value
            FROM pos_discounts pd
            LEFT JOIN pos_discount_usage pdu ON pd.id = pdu.pos_discount_id
            WHERE pd.is_active = 1 ${systemFilter}
            GROUP BY pd.discount_type
            ORDER BY usage_count DESC
        `, params.slice(1)); // Remove dateRange param

        const [usageTrends] = await this.db.execute(`
            SELECT 
                DATE(pdu.usage_date) as usage_date,
                COUNT(*) as usage_count,
                SUM(pdu.discount_amount_applied) as total_discount_amount,
                COUNT(DISTINCT pdu.customer_email) as unique_customers,
                AVG(pdu.order_total) as avg_order_total
            FROM pos_discount_usage pdu
            JOIN pos_discounts pd ON pdu.pos_discount_id = pd.id
            WHERE pdu.usage_date >= DATE_SUB(NOW(), INTERVAL ? DAY) ${systemFilter}
            GROUP BY DATE(pdu.usage_date)
            ORDER BY usage_date DESC
        `, [dateRange]);

        return {
            overview: metrics,
            type_breakdown: typeBreakdown,
            usage_trends: usageTrends
        };
    }

    // Comprehensive Dashboard Metrics
    async getDashboardOverview(dateRange = 30) {
        // Vendor metrics
        const [vendorMetrics] = await this.db.execute(`
            SELECT 
                COUNT(*) as total_vendors,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_vendors,
                COUNT(CASE WHEN last_catalog_sync >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as recently_synced_vendors,
                SUM(total_products) as total_vendor_products
            FROM vendors
        `);

        // POS metrics
        const [posMetrics] = await this.db.execute(`
            SELECT 
                COUNT(*) as total_pos_systems,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_pos_systems,
                COUNT(CASE WHEN last_sync >= DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 1 END) as recently_synced_pos
            FROM pos_systems
        `);

        // POS Gift card metrics
        const [giftCardMetrics] = await this.db.execute(`
            SELECT 
                COUNT(*) as total_gift_cards,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_gift_cards,
                SUM(current_balance) as outstanding_gift_card_value,
                COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 END) as new_gift_cards,
                COUNT(CASE WHEN sync_status = 'error' THEN 1 END) as sync_errors
            FROM pos_gift_cards
        `, [dateRange]);

        // POS Loyalty metrics
        const [loyaltyMetrics] = await this.db.execute(`
            SELECT 
                COUNT(DISTINCT plp.id) as total_loyalty_programs,
                COUNT(DISTINCT CASE WHEN plp.is_active THEN plp.id END) as active_loyalty_programs,
                COUNT(DISTINCT pcl.id) as total_loyalty_members,
                SUM(pcl.current_points) as total_outstanding_points,
                COUNT(CASE WHEN pcl.sync_status = 'error' THEN 1 END) as sync_errors
            FROM pos_loyalty_programs plp
            LEFT JOIN pos_customer_loyalty pcl ON plp.id = pcl.pos_program_id
        `);

        // POS Discount metrics
        const [discountMetrics] = await this.db.execute(`
            SELECT 
                COUNT(*) as total_discounts,
                COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_discounts,
                COUNT(CASE WHEN requires_code = 1 THEN 1 END) as code_based_discounts,
                COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 END) as new_discounts,
                COUNT(CASE WHEN sync_status = 'error' THEN 1 END) as sync_errors
            FROM pos_discounts
        `, [dateRange]);

        // Email Marketing metrics
        const [emailMetrics] = await this.db.execute(`
            SELECT 
                COUNT(DISTINCT ec.id) as total_campaigns,
                COUNT(DISTINCT CASE WHEN ec.is_active = 1 THEN ec.id END) as active_campaigns,
                COUNT(DISTINCT es.id) as total_subscribers,
                COUNT(DISTINCT CASE WHEN es.status = 'active' THEN es.id END) as active_subscribers,
                COUNT(DISTINCT CASE WHEN es.subscribed_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN es.id END) as new_subscribers,
                COUNT(DISTINCT CASE WHEN es.offer_claimed = 1 THEN es.id END) as offers_claimed,
                COALESCE(SUM(eca.impressions), 0) as total_impressions,
                COALESCE(SUM(eca.signups), 0) as total_signups,
                COALESCE(ROUND(AVG(eca.conversion_rate), 2), 0) as avg_conversion_rate
            FROM email_campaigns ec
            LEFT JOIN email_subscribers es ON ec.id = es.campaign_id
            LEFT JOIN email_campaign_analytics eca ON ec.id = eca.campaign_id 
                AND eca.date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        `, [dateRange, dateRange]);

        // Recent activity
        const [recentActivity] = await this.db.execute(`
            SELECT 
                'vendor_import' as activity_type,
                COUNT(*) as count,
                MAX(created_at) as last_activity
            FROM vendor_catalog_imports
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            
            UNION ALL
            
            SELECT 
                'pos_transaction' as activity_type,
                COUNT(*) as count,
                MAX(created_at) as last_activity
            FROM pos_transactions
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            
            UNION ALL
            
            SELECT 
                'gift_card_transaction' as activity_type,
                COUNT(*) as count,
                MAX(created_at) as last_activity
            FROM gift_card_transactions
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            
            UNION ALL
            
            SELECT 
                'loyalty_transaction' as activity_type,
                COUNT(*) as count,
                MAX(created_at) as last_activity
            FROM loyalty_transactions
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [dateRange, dateRange, dateRange, dateRange]);

        return {
            vendors: vendorMetrics[0],
            pos_systems: posMetrics[0],
            gift_cards: giftCardMetrics[0],
            loyalty: loyaltyMetrics[0],
            discounts: discountMetrics[0],
            email_marketing: emailMetrics[0],
            recent_activity: recentActivity
        };
    }

    // Alert and Monitoring
    async getSystemAlerts() {
        const alerts = [];

        // Check for failed vendor imports
        const [failedImports] = await this.db.execute(`
            SELECT v.name, vci.created_at, vci.error_details
            FROM vendor_catalog_imports vci
            JOIN vendors v ON vci.vendor_id = v.id
            WHERE vci.status = 'failed' 
            AND vci.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            ORDER BY vci.created_at DESC
            LIMIT 10
        `);

        failedImports.forEach(import_ => {
            alerts.push({
                type: 'error',
                category: 'vendor_import',
                message: `Failed catalog import for vendor: ${import_.name}`,
                timestamp: import_.created_at,
                details: import_.error_details
            });
        });

        // Check for POS system errors
        const [posErrors] = await this.db.execute(`
            SELECT ps.name, ps.last_error, ps.updated_at
            FROM pos_systems ps
            WHERE ps.status = 'error' 
            AND ps.updated_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `);

        posErrors.forEach(system => {
            alerts.push({
                type: 'error',
                category: 'pos_system',
                message: `POS system error: ${system.name}`,
                timestamp: system.updated_at,
                details: system.last_error
            });
        });

        // Check for stale POS syncs
        const [staleSyncs] = await this.db.execute(`
            SELECT name, last_sync
            FROM pos_systems
            WHERE status = 'active' 
            AND (last_sync IS NULL OR last_sync < DATE_SUB(NOW(), INTERVAL 4 HOUR))
        `);

        staleSyncs.forEach(system => {
            alerts.push({
                type: 'warning',
                category: 'pos_sync',
                message: `POS system hasn't synced recently: ${system.name}`,
                timestamp: system.last_sync || new Date(),
                details: `Last sync: ${system.last_sync || 'Never'}`
            });
        });

        // Check for POS gift card sync errors
        const [giftCardSyncErrors] = await this.db.execute(`
            SELECT ps.name, COUNT(*) as error_count
            FROM pos_gift_cards pgc
            JOIN pos_systems ps ON pgc.pos_system_id = ps.id
            WHERE pgc.sync_status = 'error' 
            AND pgc.last_synced >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            GROUP BY ps.id
        `);

        giftCardSyncErrors.forEach(system => {
            alerts.push({
                type: 'warning',
                category: 'pos_gift_card_sync',
                message: `${system.error_count} gift card sync errors from ${system.name}`,
                timestamp: new Date(),
                details: 'Check POS gift card sync configuration'
            });
        });

        // Check for POS loyalty sync errors
        const [loyaltySyncErrors] = await this.db.execute(`
            SELECT ps.name, COUNT(*) as error_count
            FROM pos_customer_loyalty pcl
            JOIN pos_systems ps ON pcl.pos_system_id = ps.id
            WHERE pcl.sync_status = 'error' 
            AND pcl.last_synced >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            GROUP BY ps.id
        `);

        loyaltySyncErrors.forEach(system => {
            alerts.push({
                type: 'warning',
                category: 'pos_loyalty_sync',
                message: `${system.error_count} loyalty sync errors from ${system.name}`,
                timestamp: new Date(),
                details: 'Check POS loyalty sync configuration'
            });
        });

        // Check for stale POS gift card data
        const [staleGiftCards] = await this.db.execute(`
            SELECT ps.name, COUNT(*) as stale_count
            FROM pos_gift_cards pgc
            JOIN pos_systems ps ON pgc.pos_system_id = ps.id
            WHERE pgc.last_synced < DATE_SUB(NOW(), INTERVAL 24 HOUR)
            AND ps.status = 'active'
            GROUP BY ps.id
        `);

        staleGiftCards.forEach(system => {
            alerts.push({
                type: 'info',
                category: 'pos_gift_card_stale',
                message: `${system.stale_count} gift cards from ${system.name} haven't synced in 24+ hours`,
                timestamp: new Date(),
                details: 'Consider running manual sync'
            });
        });

        // Check for POS discount sync errors
        const [discountSyncErrors] = await this.db.execute(`
            SELECT ps.name, COUNT(*) as error_count
            FROM pos_discounts pd
            JOIN pos_systems ps ON pd.pos_system_id = ps.id
            WHERE pd.sync_status = 'error' 
            AND pd.last_synced >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            GROUP BY ps.id
        `);

        discountSyncErrors.forEach(system => {
            alerts.push({
                type: 'warning',
                category: 'pos_discount_sync',
                message: `${system.error_count} discount sync errors from ${system.name}`,
                timestamp: new Date(),
                details: 'Check POS discount sync configuration'
            });
        });

        // Check for expired discounts that are still marked as active
        const [expiredActiveDiscounts] = await this.db.execute(`
            SELECT ps.name, COUNT(*) as expired_count
            FROM pos_discounts pd
            JOIN pos_systems ps ON pd.pos_system_id = ps.id
            WHERE pd.is_active = 1 
            AND pd.ends_at IS NOT NULL 
            AND pd.ends_at < NOW()
            GROUP BY ps.id
        `);

        expiredActiveDiscounts.forEach(system => {
            alerts.push({
                type: 'info',
                category: 'pos_discount_expired',
                message: `${system.expired_count} expired discounts still marked as active in ${system.name}`,
                timestamp: new Date(),
                details: 'Consider running discount sync to update status'
            });
        });

        // Check for email campaigns with low conversion rates
        const [lowConversionCampaigns] = await this.db.execute(`
            SELECT ec.campaign_name, AVG(eca.conversion_rate) as avg_conversion_rate
            FROM email_campaigns ec
            JOIN email_campaign_analytics eca ON ec.id = eca.campaign_id
            WHERE ec.is_active = 1 
            AND eca.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            AND eca.impressions > 100
            GROUP BY ec.id
            HAVING avg_conversion_rate < 2.0
        `);

        lowConversionCampaigns.forEach(campaign => {
            alerts.push({
                type: 'warning',
                category: 'email_campaign_performance',
                message: `Email campaign "${campaign.campaign_name}" has low conversion rate (${campaign.avg_conversion_rate}%)`,
                timestamp: new Date(),
                details: 'Consider updating the offer or targeting settings'
            });
        });

        // Check for campaigns with no recent activity
        const [inactiveCampaigns] = await this.db.execute(`
            SELECT ec.campaign_name
            FROM email_campaigns ec
            LEFT JOIN email_campaign_analytics eca ON ec.id = eca.campaign_id 
                AND eca.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            WHERE ec.is_active = 1 
            AND eca.id IS NULL
        `);

        inactiveCampaigns.forEach(campaign => {
            alerts.push({
                type: 'info',
                category: 'email_campaign_inactive',
                message: `Email campaign "${campaign.campaign_name}" has no recent activity`,
                timestamp: new Date(),
                details: 'Check campaign targeting and display settings'
            });
        });

        return alerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    // Performance Monitoring
    async getPerformanceMetrics(hours = 24) {
        const [dbMetrics] = await this.db.execute(`
            SELECT 
                'vendor_imports' as operation,
                COUNT(*) as total_operations,
                AVG(TIMESTAMPDIFF(SECOND, started_at, completed_at)) as avg_duration_seconds,
                MAX(TIMESTAMPDIFF(SECOND, started_at, completed_at)) as max_duration_seconds,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_operations
            FROM vendor_catalog_imports
            WHERE started_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
            AND completed_at IS NOT NULL
            
            UNION ALL
            
            SELECT 
                'pos_transactions' as operation,
                COUNT(*) as total_operations,
                AVG(TIMESTAMPDIFF(SECOND, created_at, processed_at)) as avg_duration_seconds,
                MAX(TIMESTAMPDIFF(SECOND, created_at, processed_at)) as max_duration_seconds,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_operations
            FROM pos_transactions
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
            AND processed_at IS NOT NULL
        `, [hours, hours]);

        return dbMetrics;
    }
}

module.exports = AnalyticsService;
