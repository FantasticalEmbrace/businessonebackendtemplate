// Advanced Caching Strategy for HM Herbs
// Multi-layer caching with intelligent cache management

const crypto = require('crypto');

class AdvancedCacheManager {
    constructor() {
        this.memoryCache = new Map();
        this.cacheStats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0
        };
        this.maxMemorySize = 100 * 1024 * 1024; // 100MB
        this.currentMemoryUsage = 0;
        
        // Cache warming schedule
        this.warmupSchedule = new Map();
        
        // Start cache maintenance
        this.startMaintenance();
    }

    // HTTP Cache Headers Middleware
    httpCacheHeaders() {
        return (req, res, next) => {
            const cacheConfig = this.getCacheConfigForRoute(req.path);
            
            if (cacheConfig) {
                // Set cache headers based on content type and route
                res.set({
                    'Cache-Control': cacheConfig.cacheControl,
                    'ETag': this.generateETag(req.path + JSON.stringify(req.query)),
                    'Vary': 'Accept-Encoding, User-Agent',
                    'Last-Modified': new Date().toUTCString()
                });
                
                // Handle conditional requests
                if (req.headers['if-none-match'] === res.get('ETag')) {
                    return res.status(304).end();
                }
            }
            
            next();
        };
    }

    // Intelligent cache configuration per route
    getCacheConfigForRoute(path) {
        const cacheConfigs = {
            // Static assets - long cache
            '/css/': {
                cacheControl: 'public, max-age=31536000, immutable', // 1 year
                type: 'static'
            },
            '/js/': {
                cacheControl: 'public, max-age=31536000, immutable', // 1 year
                type: 'static'
            },
            '/images/': {
                cacheControl: 'public, max-age=2592000', // 30 days
                type: 'static'
            },
            
            // API endpoints - short cache
            '/api/products': {
                cacheControl: 'public, max-age=300, s-maxage=600', // 5 min browser, 10 min CDN
                type: 'api'
            },
            '/api/categories': {
                cacheControl: 'public, max-age=3600, s-maxage=7200', // 1 hour browser, 2 hours CDN
                type: 'api'
            },
            '/api/brands': {
                cacheControl: 'public, max-age=3600, s-maxage=7200', // 1 hour browser, 2 hours CDN
                type: 'api'
            },
            
            // Dynamic content - minimal cache
            '/api/cart': {
                cacheControl: 'private, no-cache, no-store, must-revalidate',
                type: 'dynamic'
            },
            '/api/user': {
                cacheControl: 'private, no-cache, no-store, must-revalidate',
                type: 'dynamic'
            },
            
            // HTML pages - moderate cache
            '/': {
                cacheControl: 'public, max-age=300, s-maxage=600', // 5 min browser, 10 min CDN
                type: 'html'
            },
            '/products.html': {
                cacheControl: 'public, max-age=600, s-maxage=1200', // 10 min browser, 20 min CDN
                type: 'html'
            }
        };
        
        // Find matching config
        for (const [pattern, config] of Object.entries(cacheConfigs)) {
            if (path.startsWith(pattern)) {
                return config;
            }
        }
        
        // Default cache config
        return {
            cacheControl: 'public, max-age=300', // 5 minutes
            type: 'default'
        };
    }

    // Memory cache with size management
    async get(key) {
        const cached = this.memoryCache.get(key);
        
        if (cached) {
            if (this.isExpired(cached)) {
                this.memoryCache.delete(key);
                this.updateMemoryUsage();
                this.cacheStats.misses++;
                return null;
            }
            
            // Update access time for LRU
            cached.lastAccessed = Date.now();
            this.cacheStats.hits++;
            return cached.data;
        }
        
        this.cacheStats.misses++;
        return null;
    }

    async set(key, data, ttl = 300000) { // 5 minutes default
        const serialized = JSON.stringify(data);
        const size = Buffer.byteLength(serialized, 'utf8');
        
        // Check if we need to evict items
        while (this.currentMemoryUsage + size > this.maxMemorySize && this.memoryCache.size > 0) {
            this.evictLRU();
        }
        
        // Don't cache if item is too large
        if (size > this.maxMemorySize * 0.1) { // Don't cache items larger than 10% of max size
            return false;
        }
        
        const cacheItem = {
            data,
            size,
            createdAt: Date.now(),
            lastAccessed: Date.now(),
            ttl,
            expiresAt: Date.now() + ttl
        };
        
        this.memoryCache.set(key, cacheItem);
        this.currentMemoryUsage += size;
        this.cacheStats.sets++;
        
        return true;
    }

    async delete(key) {
        const cached = this.memoryCache.get(key);
        if (cached) {
            this.memoryCache.delete(key);
            this.currentMemoryUsage -= cached.size;
            this.cacheStats.deletes++;
            return true;
        }
        return false;
    }

    // Cache warming strategies
    async warmCache() {
        const warmupTasks = [
            this.warmCategories(),
            this.warmBrands(),
            this.warmFeaturedProducts(),
            this.warmPopularProducts()
        ];
        
        try {
            await Promise.all(warmupTasks);
            console.log('Cache warming completed successfully');
        } catch (error) {
            console.error('Cache warming failed:', error);
        }
    }

    async warmCategories() {
        // This would typically fetch from database
        const categories = await this.fetchCategories();
        await this.set('categories:all', categories, 60 * 60 * 1000); // 1 hour
    }

    async warmBrands() {
        const brands = await this.fetchBrands();
        await this.set('brands:all', brands, 60 * 60 * 1000); // 1 hour
    }

    async warmFeaturedProducts() {
        const featured = await this.fetchFeaturedProducts();
        await this.set('products:featured', featured, 30 * 60 * 1000); // 30 minutes
    }

    async warmPopularProducts() {
        const popular = await this.fetchPopularProducts();
        await this.set('products:popular', popular, 30 * 60 * 1000); // 30 minutes
    }

    // Cache invalidation strategies
    invalidatePattern(pattern) {
        const keysToDelete = [];
        
        for (const key of this.memoryCache.keys()) {
            if (key.includes(pattern)) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.delete(key));
        
        return keysToDelete.length;
    }

    invalidateProductCache(productId = null) {
        if (productId) {
            this.invalidatePattern(`product:${productId}`);
        } else {
            this.invalidatePattern('products:');
            this.invalidatePattern('product:');
        }
    }

    invalidateUserCache(userId) {
        this.invalidatePattern(`user:${userId}`);
        this.invalidatePattern(`cart:${userId}`);
        this.invalidatePattern(`orders:${userId}`);
    }

    // Service Worker Cache Strategies
    getServiceWorkerCacheStrategies() {
        return {
            // Cache First - for static assets
            cacheFirst: {
                urlPatterns: [
                    /\.(?:css|js|woff|woff2|ttf|eot)$/,
                    /\/images\//,
                    /\/icons\//
                ],
                strategy: 'CacheFirst',
                options: {
                    cacheName: 'static-assets',
                    expiration: {
                        maxEntries: 100,
                        maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
                    }
                }
            },
            
            // Network First - for API calls
            networkFirst: {
                urlPatterns: [
                    /\/api\//
                ],
                strategy: 'NetworkFirst',
                options: {
                    cacheName: 'api-cache',
                    networkTimeoutSeconds: 3,
                    expiration: {
                        maxEntries: 50,
                        maxAgeSeconds: 5 * 60 // 5 minutes
                    }
                }
            },
            
            // Stale While Revalidate - for HTML pages
            staleWhileRevalidate: {
                urlPatterns: [
                    /\.html$/,
                    /\/$/
                ],
                strategy: 'StaleWhileRevalidate',
                options: {
                    cacheName: 'pages-cache',
                    expiration: {
                        maxEntries: 20,
                        maxAgeSeconds: 24 * 60 * 60 // 24 hours
                    }
                }
            }
        };
    }

    // CDN Configuration
    getCDNConfiguration() {
        return {
            cloudflare: {
                // Page Rules
                pageRules: [
                    {
                        url: '*.css',
                        settings: {
                            cacheLevel: 'cache_everything',
                            edgeCacheTtl: 2592000, // 30 days
                            browserCacheTtl: 31536000 // 1 year
                        }
                    },
                    {
                        url: '*.js',
                        settings: {
                            cacheLevel: 'cache_everything',
                            edgeCacheTtl: 2592000, // 30 days
                            browserCacheTtl: 31536000 // 1 year
                        }
                    },
                    {
                        url: '/images/*',
                        settings: {
                            cacheLevel: 'cache_everything',
                            edgeCacheTtl: 604800, // 7 days
                            browserCacheTtl: 2592000 // 30 days
                        }
                    },
                    {
                        url: '/api/products*',
                        settings: {
                            cacheLevel: 'cache_everything',
                            edgeCacheTtl: 300, // 5 minutes
                            browserCacheTtl: 300
                        }
                    }
                ],
                
                // Cache purge endpoints
                purgeEndpoints: [
                    '/api/cache/purge/all',
                    '/api/cache/purge/products',
                    '/api/cache/purge/static'
                ]
            },
            
            aws: {
                // CloudFront behaviors
                behaviors: [
                    {
                        pathPattern: '*.css',
                        cachePolicyId: 'static-assets',
                        compress: true,
                        viewerProtocolPolicy: 'redirect-to-https'
                    },
                    {
                        pathPattern: '*.js',
                        cachePolicyId: 'static-assets',
                        compress: true,
                        viewerProtocolPolicy: 'redirect-to-https'
                    },
                    {
                        pathPattern: '/api/*',
                        cachePolicyId: 'api-cache',
                        originRequestPolicyId: 'api-requests',
                        compress: true
                    }
                ]
            }
        };
    }

    // Helper methods
    generateETag(content) {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    isExpired(cached) {
        return Date.now() > cached.expiresAt;
    }

    evictLRU() {
        let oldestKey = null;
        let oldestTime = Date.now();
        
        for (const [key, cached] of this.memoryCache.entries()) {
            if (cached.lastAccessed < oldestTime) {
                oldestTime = cached.lastAccessed;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            const cached = this.memoryCache.get(oldestKey);
            this.memoryCache.delete(oldestKey);
            this.currentMemoryUsage -= cached.size;
        }
    }

    updateMemoryUsage() {
        let totalSize = 0;
        for (const cached of this.memoryCache.values()) {
            totalSize += cached.size;
        }
        this.currentMemoryUsage = totalSize;
    }

    startMaintenance() {
        // Clean expired items every 5 minutes
        setInterval(() => {
            this.cleanExpired();
        }, 5 * 60 * 1000);
        
        // Warm cache every hour
        setInterval(() => {
            this.warmCache();
        }, 60 * 60 * 1000);
        
        // Initial cache warming
        setTimeout(() => {
            this.warmCache();
        }, 5000); // 5 seconds after startup
    }

    cleanExpired() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, cached] of this.memoryCache.entries()) {
            if (now > cached.expiresAt) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => {
            const cached = this.memoryCache.get(key);
            this.memoryCache.delete(key);
            this.currentMemoryUsage -= cached.size;
        });
        
        if (keysToDelete.length > 0) {
            console.log(`Cleaned ${keysToDelete.length} expired cache entries`);
        }
    }

    // Statistics and monitoring
    getStats() {
        const hitRate = this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100;
        
        return {
            ...this.cacheStats,
            hitRate: hitRate.toFixed(2) + '%',
            memoryUsage: {
                current: this.formatBytes(this.currentMemoryUsage),
                max: this.formatBytes(this.maxMemorySize),
                percentage: (this.currentMemoryUsage / this.maxMemorySize * 100).toFixed(2) + '%'
            },
            cacheSize: this.memoryCache.size
        };
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Placeholder methods for data fetching (would be implemented with actual database calls)
    async fetchCategories() {
        // Implement actual database call
        return [];
    }

    async fetchBrands() {
        // Implement actual database call
        return [];
    }

    async fetchFeaturedProducts() {
        // Implement actual database call
        return [];
    }

    async fetchPopularProducts() {
        // Implement actual database call
        return [];
    }
}

// Export singleton instance
const cacheManager = new AdvancedCacheManager();

module.exports = {
    AdvancedCacheManager,
    cacheManager,
    httpCacheHeaders: cacheManager.httpCacheHeaders.bind(cacheManager),
    get: cacheManager.get.bind(cacheManager),
    set: cacheManager.set.bind(cacheManager),
    delete: cacheManager.delete.bind(cacheManager),
    invalidatePattern: cacheManager.invalidatePattern.bind(cacheManager),
    getStats: cacheManager.getStats.bind(cacheManager)
};
