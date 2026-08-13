// Database Query Optimization Middleware for HM Herbs
// Advanced database performance optimization and monitoring

const { performance } = require('perf_hooks');

class DatabaseOptimizer {
    constructor() {
        this.queryCache = new Map();
        this.queryStats = new Map();
        this.slowQueryThreshold = 100; // 100ms
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.maxCacheSize = 1000;
        
        // Clean up cache periodically
        setInterval(() => {
            this.cleanupCache();
        }, 60 * 1000); // Every minute
    }

    // Query performance monitoring middleware
    monitorQuery() {
        return (req, res, next) => {
            const originalQuery = req.query;
            const startTime = performance.now();
            
            // Override res.json to capture response time
            const originalJson = res.json;
            res.json = function(data) {
                const endTime = performance.now();
                const duration = endTime - startTime;
                
                // Log slow queries
                if (duration > this.slowQueryThreshold) {
                    console.warn(`Slow query detected: ${req.path}`, {
                        duration: `${duration.toFixed(2)}ms`,
                        query: originalQuery,
                        method: req.method
                    });
                }
                
                // Update query statistics
                this.updateQueryStats(req.path, duration);
                
                return originalJson.call(this, data);
            }.bind(this);
            
            next();
        };
    }

    // Intelligent query caching
    cacheQuery(key, queryFunction, options = {}) {
        const cacheKey = this.generateCacheKey(key, options);
        const cached = this.queryCache.get(cacheKey);
        
        if (cached && !this.isCacheExpired(cached)) {
            return Promise.resolve(cached.data);
        }
        
        return queryFunction().then(result => {
            // Don't cache if result is too large
            if (JSON.stringify(result).length < 100000) { // 100KB limit
                this.setCache(cacheKey, result);
            }
            return result;
        });
    }

    // Generate optimized database indexes recommendations
    generateIndexRecommendations() {
        return {
            products: [
                'CREATE INDEX idx_products_category_brand ON products(category_id, brand_id);',
                'CREATE INDEX idx_products_price_range ON products(price) WHERE price IS NOT NULL;',
                'CREATE INDEX idx_products_search ON products USING gin(to_tsvector(\'english\', name || \' \' || description));',
                'CREATE INDEX idx_products_inventory ON products(inventory_quantity) WHERE inventory_quantity > 0;',
                'CREATE INDEX idx_products_active ON products(is_active, created_at) WHERE is_active = true;'
            ],
            orders: [
                'CREATE INDEX idx_orders_user_date ON orders(user_id, created_at);',
                'CREATE INDEX idx_orders_status_date ON orders(status, created_at);',
                'CREATE INDEX idx_orders_total ON orders(total_amount) WHERE total_amount > 0;'
            ],
            users: [
                'CREATE INDEX idx_users_email_active ON users(email) WHERE is_active = true;',
                'CREATE INDEX idx_users_created ON users(created_at);'
            ],
            edsa_bookings: [
                'CREATE INDEX idx_edsa_date_status ON edsa_bookings(appointment_date, status);',
                'CREATE INDEX idx_edsa_user ON edsa_bookings(user_id, created_at);'
            ]
        };
    }

    // Optimized query builders for common operations
    buildOptimizedQueries() {
        return {
            // Product search with full-text search and pagination
            productSearch: (searchTerm, filters = {}, limit = 20, offset = 0) => {
                let query = `
                    SELECT p.*, c.name as category_name, b.name as brand_name,
                           ts_rank(to_tsvector('english', p.name || ' ' || COALESCE(p.description, '')), 
                                  plainto_tsquery('english', $1)) as relevance_score
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    LEFT JOIN brands b ON p.brand_id = b.id
                    WHERE p.is_active = true
                `;
                
                const params = [searchTerm];
                let paramIndex = 2;
                
                if (searchTerm) {
                    query += ` AND to_tsvector('english', p.name || ' ' || COALESCE(p.description, '')) 
                              @@ plainto_tsquery('english', $1)`;
                }
                
                if (filters.categoryId) {
                    query += ` AND p.category_id = $${paramIndex}`;
                    params.push(filters.categoryId);
                    paramIndex++;
                }
                
                if (filters.brandId) {
                    query += ` AND p.brand_id = $${paramIndex}`;
                    params.push(filters.brandId);
                    paramIndex++;
                }
                
                if (filters.minPrice) {
                    query += ` AND p.price >= $${paramIndex}`;
                    params.push(filters.minPrice);
                    paramIndex++;
                }
                
                if (filters.maxPrice) {
                    query += ` AND p.price <= $${paramIndex}`;
                    params.push(filters.maxPrice);
                    paramIndex++;
                }
                
                if (filters.inStock) {
                    query += ` AND p.inventory_quantity > 0`;
                }
                
                query += ` ORDER BY ${searchTerm ? 'relevance_score DESC,' : ''} p.created_at DESC`;
                query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
                params.push(limit, offset);
                
                return { query, params };
            },

            // Optimized dashboard analytics
            dashboardStats: () => ({
                query: `
                    WITH recent_orders AS (
                        SELECT COUNT(*) as order_count, SUM(total_amount) as revenue
                        FROM orders 
                        WHERE created_at >= NOW() - INTERVAL '30 days'
                    ),
                    product_stats AS (
                        SELECT COUNT(*) as total_products, 
                               COUNT(*) FILTER (WHERE inventory_quantity > 0) as in_stock_products
                        FROM products 
                        WHERE is_active = true
                    ),
                    user_stats AS (
                        SELECT COUNT(*) as total_users,
                               COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as new_users
                        FROM users 
                        WHERE is_active = true
                    )
                    SELECT 
                        ro.order_count, ro.revenue,
                        ps.total_products, ps.in_stock_products,
                        us.total_users, us.new_users
                    FROM recent_orders ro, product_stats ps, user_stats us;
                `,
                params: []
            }),

            // Optimized inventory alerts
            inventoryAlerts: (threshold = 10) => ({
                query: `
                    SELECT p.id, p.name, p.sku, p.inventory_quantity, c.name as category_name
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.is_active = true 
                    AND p.inventory_quantity <= $1 
                    AND p.inventory_quantity > 0
                    ORDER BY p.inventory_quantity ASC, p.name ASC;
                `,
                params: [threshold]
            }),

            // Optimized order history with pagination
            orderHistory: (userId = null, limit = 50, offset = 0) => {
                let query = `
                    SELECT o.*, u.email, u.first_name, u.last_name,
                           COUNT(oi.id) as item_count
                    FROM orders o
                    LEFT JOIN users u ON o.user_id = u.id
                    LEFT JOIN order_items oi ON o.id = oi.order_id
                `;
                
                const params = [];
                let paramIndex = 1;
                
                if (userId) {
                    query += ` WHERE o.user_id = $${paramIndex}`;
                    params.push(userId);
                    paramIndex++;
                }
                
                query += ` GROUP BY o.id, u.email, u.first_name, u.last_name`;
                query += ` ORDER BY o.created_at DESC`;
                query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
                params.push(limit, offset);
                
                return { query, params };
            }
        };
    }

    // Connection pool optimization
    optimizeConnectionPool() {
        return {
            // PostgreSQL connection pool settings
            postgresql: {
                max: 20, // Maximum number of connections
                min: 5,  // Minimum number of connections
                acquire: 30000, // Maximum time to acquire connection
                idle: 10000,    // Maximum time connection can be idle
                evict: 1000,    // Time interval to run eviction
                handleDisconnects: true,
                dialectOptions: {
                    statement_timeout: 30000, // 30 seconds
                    query_timeout: 30000,
                    idle_in_transaction_session_timeout: 30000
                }
            },
            
            // MySQL connection pool settings
            mysql: {
                connectionLimit: 20,
                acquireTimeout: 30000,
                timeout: 30000,
                reconnect: true,
                multipleStatements: false
            }
        };
    }

    // Query result caching strategies
    getCachingStrategies() {
        return {
            // Cache static/semi-static data longer
            longCache: {
                ttl: 60 * 60 * 1000, // 1 hour
                queries: [
                    'categories',
                    'brands',
                    'settings',
                    'shipping_methods'
                ]
            },
            
            // Cache frequently accessed data for medium duration
            mediumCache: {
                ttl: 15 * 60 * 1000, // 15 minutes
                queries: [
                    'featured_products',
                    'popular_products',
                    'dashboard_stats'
                ]
            },
            
            // Cache dynamic data for short duration
            shortCache: {
                ttl: 5 * 60 * 1000, // 5 minutes
                queries: [
                    'product_search',
                    'inventory_levels',
                    'recent_orders'
                ]
            }
        };
    }

    // N+1 Query Prevention
    preventNPlusOne() {
        return {
            // Use JOIN instead of separate queries
            productWithDetails: `
                SELECT p.*, c.name as category_name, b.name as brand_name,
                       v.name as vendor_name, v.contact_email as vendor_email
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                LEFT JOIN brands b ON p.brand_id = b.id
                LEFT JOIN vendors v ON p.vendor_id = v.id
                WHERE p.id = ANY($1);
            `,
            
            // Batch load related data
            orderWithItems: `
                SELECT o.*, 
                       json_agg(
                           json_build_object(
                               'id', oi.id,
                               'product_id', oi.product_id,
                               'product_name', p.name,
                               'quantity', oi.quantity,
                               'price', oi.price
                           )
                       ) as items
                FROM orders o
                LEFT JOIN order_items oi ON o.id = oi.order_id
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE o.id = ANY($1)
                GROUP BY o.id;
            `
        };
    }

    // Helper methods
    generateCacheKey(key, options) {
        return `${key}:${JSON.stringify(options)}`;
    }

    isCacheExpired(cached) {
        return Date.now() - cached.timestamp > this.cacheTimeout;
    }

    setCache(key, data) {
        // Implement LRU cache eviction
        if (this.queryCache.size >= this.maxCacheSize) {
            const firstKey = this.queryCache.keys().next().value;
            this.queryCache.delete(firstKey);
        }
        
        this.queryCache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    updateQueryStats(path, duration) {
        const stats = this.queryStats.get(path) || {
            count: 0,
            totalTime: 0,
            avgTime: 0,
            maxTime: 0
        };
        
        stats.count++;
        stats.totalTime += duration;
        stats.avgTime = stats.totalTime / stats.count;
        stats.maxTime = Math.max(stats.maxTime, duration);
        
        this.queryStats.set(path, stats);
    }

    cleanupCache() {
        const now = Date.now();
        for (const [key, cached] of this.queryCache.entries()) {
            if (now - cached.timestamp > this.cacheTimeout) {
                this.queryCache.delete(key);
            }
        }
    }

    // Get performance statistics
    getPerformanceStats() {
        return {
            cacheSize: this.queryCache.size,
            queryStats: Object.fromEntries(this.queryStats),
            recommendations: this.generatePerformanceRecommendations()
        };
    }

    generatePerformanceRecommendations() {
        const recommendations = [];
        
        for (const [path, stats] of this.queryStats.entries()) {
            if (stats.avgTime > this.slowQueryThreshold) {
                recommendations.push({
                    type: 'slow_query',
                    path,
                    avgTime: stats.avgTime,
                    suggestion: 'Consider adding database indexes or optimizing query'
                });
            }
            
            if (stats.count > 1000) {
                recommendations.push({
                    type: 'high_frequency',
                    path,
                    count: stats.count,
                    suggestion: 'Consider implementing caching for this endpoint'
                });
            }
        }
        
        return recommendations;
    }
}

// Export singleton instance
const dbOptimizer = new DatabaseOptimizer();

module.exports = {
    DatabaseOptimizer,
    dbOptimizer,
    monitorQuery: dbOptimizer.monitorQuery.bind(dbOptimizer),
    cacheQuery: dbOptimizer.cacheQuery.bind(dbOptimizer),
    getPerformanceStats: dbOptimizer.getPerformanceStats.bind(dbOptimizer)
};
