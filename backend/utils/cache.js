/**
 * Cache utility for HM Herbs & Vitamins
 * Provides Redis-based caching with fallback to in-memory cache
 */

const redis = require('redis');
const logger = require('./logger');

class CacheManager {
    constructor() {
        this.redisClient = null;
        this.memoryCache = new Map();
        this.isRedisConnected = false;
        // Initialize Redis asynchronously - don't block server startup
        // Errors are caught and logged, server will continue with in-memory cache
        this.initializeRedis().catch(err => {
            logger.error('Cache initialization error (non-fatal):', err);
        });
    }

    /**
     * Initialize Redis connection
     */
    async initializeRedis() {
        try {
            if (process.env.REDIS_URL) {
                this.redisClient = redis.createClient({
                    url: process.env.REDIS_URL
                });

                this.redisClient.on('error', (err) => {
                    logger.error('Redis Client Error:', err);
                    this.isRedisConnected = false;
                });

                this.redisClient.on('connect', () => {
                    logger.info('Redis Client Connected');
                    this.isRedisConnected = true;
                });

                await this.redisClient.connect();
            } else {
                logger.info('Redis URL not provided, using in-memory cache only');
            }
        } catch (error) {
            logger.error('Failed to initialize Redis:', error);
            this.isRedisConnected = false;
        }
    }

    /**
     * Get value from cache
     * @param {string} key - Cache key
     * @returns {Promise<any>} Cached value or null
     */
    async get(key) {
        try {
            if (this.isRedisConnected && this.redisClient) {
                const value = await this.redisClient.get(key);
                return value ? JSON.parse(value) : null;
            } else {
                // Fallback to memory cache
                const cached = this.memoryCache.get(key);
                if (cached && cached.expiry > Date.now()) {
                    return cached.value;
                } else if (cached) {
                    this.memoryCache.delete(key);
                }
                return null;
            }
        } catch (error) {
            logger.error('Cache get error:', error);
            return null;
        }
    }

    /**
     * Set value in cache
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttl - Time to live in seconds (default: 300)
     */
    async set(key, value, ttl = 300) {
        try {
            if (this.isRedisConnected && this.redisClient) {
                await this.redisClient.setEx(key, ttl, JSON.stringify(value));
            } else {
                // Fallback to memory cache
                this.memoryCache.set(key, {
                    value,
                    expiry: Date.now() + (ttl * 1000)
                });
                
                // Clean up expired entries periodically
                if (this.memoryCache.size > 1000) {
                    this.cleanupMemoryCache();
                }
            }
        } catch (error) {
            logger.error('Cache set error:', error);
        }
    }

    /**
     * Delete value from cache
     * @param {string} key - Cache key
     */
    async del(key) {
        try {
            if (this.isRedisConnected && this.redisClient) {
                await this.redisClient.del(key);
            } else {
                this.memoryCache.delete(key);
            }
        } catch (error) {
            logger.error('Cache delete error:', error);
        }
    }

    /**
     * Clear all cache
     */
    async clear() {
        try {
            if (this.isRedisConnected && this.redisClient) {
                await this.redisClient.flushAll();
            } else {
                this.memoryCache.clear();
            }
        } catch (error) {
            logger.error('Cache clear error:', error);
        }
    }

    /**
     * Clean up expired entries from memory cache
     */
    cleanupMemoryCache() {
        const now = Date.now();
        for (const [key, cached] of this.memoryCache.entries()) {
            if (cached.expiry <= now) {
                this.memoryCache.delete(key);
            }
        }
    }

    /**
     * Get or set cache with a function
     * @param {string} key - Cache key
     * @param {Function} fn - Function to execute if cache miss
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<any>} Cached or computed value
     */
    async getOrSet(key, fn, ttl = 300) {
        let value = await this.get(key);
        if (value === null) {
            value = await fn();
            if (value !== null && value !== undefined) {
                await this.set(key, value, ttl);
            }
        }
        return value;
    }

    /**
     * Close Redis connection
     */
    async close() {
        if (this.redisClient) {
            await this.redisClient.quit();
        }
    }
}

// Create singleton instance
const cacheManager = new CacheManager();

module.exports = cacheManager;
