/**
 * Update product prices and stock from hmherbs.com
 */

const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
const mysql = require('mysql2/promise');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

class PriceStockUpdater {
    constructor() {
        this.baseUrl = 'https://hmherbs.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        };
    }

    extractPrice($) {
        // Try various price selectors
        const priceSelectors = [
            '.price',
            '.product-price',
            '.woocommerce-Price-amount',
            '[class*="price"]',
            'span.price',
            '.amount'
        ];

        for (const selector of priceSelectors) {
            const priceEl = $(selector).first();
            if (priceEl.length) {
                let priceText = priceEl.text().trim();
                // Extract number with decimal
                const match = priceText.match(/\$?([\d,]+\.?\d*)/);
                if (match) {
                    const price = parseFloat(match[1].replace(/,/g, ''));
                    if (price > 0) {
                        return price;
                    }
                }
            }
        }

        // Try to find price in text content
        const bodyText = $('body').text();
        const priceMatches = bodyText.match(/\$([\d,]+\.?\d{2})/g);
        if (priceMatches && priceMatches.length > 0) {
            const price = parseFloat(priceMatches[0].replace(/[$,]/g, ''));
            if (price > 0) {
                return price;
            }
        }

        return null;
    }

    extractStockQuantity($) {
        // Check for stock indicators
        const stockSelectors = [
            '.stock',
            '.in-stock',
            '.availability',
            '[class*="stock"]',
            '[class*="inventory"]'
        ];

        for (const selector of stockSelectors) {
            const stockEl = $(selector).first();
            if (stockEl.length) {
                const text = stockEl.text().toLowerCase();
                // Look for "in stock" or numbers
                if (text.includes('in stock')) {
                    // Try to extract quantity
                    const match = text.match(/(\d+)/);
                    if (match) {
                        return parseInt(match[1]);
                    }
                    // If just says "in stock" without quantity, assume available
                    return 100;
                }
                if (text.includes('out of stock') || text.includes('unavailable')) {
                    return 0;
                }
            }
        }

        // Default: if page loads and has price, assume in stock
        return null;
    }

    checkStock($) {
        const stockText = $('body').text().toLowerCase();
        if (stockText.includes('out of stock') || stockText.includes('unavailable') || stockText.includes('sold out')) {
            return false;
        }
        if (stockText.includes('in stock') || stockText.includes('available')) {
            return true;
        }
        // Default to true if we can't determine
        return true;
    }

    async searchProductOnHMHerbs(productName, sku) {
        try {
            // Try to find product by SKU first (most reliable)
            if (sku) {
                const skuUrl = `${this.baseUrl}/?s=${encodeURIComponent(sku)}`;
                const response = await axios.get(skuUrl, {
                    headers: this.headers,
                    timeout: 10000
                });

                const $ = cheerio.load(response.data);
                
                // Look for product links in search results
                const productLinks = $('a[href*="/product"], h2 a, h3 a, .product-title a');
                for (let i = 0; i < Math.min(productLinks.length, 5); i++) {
                    const link = $(productLinks[i]);
                    const href = link.attr('href');
                    if (href && (href.includes('/product/') || href.includes(sku))) {
                        const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
                        const productData = await this.scrapeProductPage(fullUrl);
                        if (productData && (productData.price || productData.stock !== null)) {
                            return productData;
                        }
                    }
                }
            }

            // Try searching by product name
            const searchUrl = `${this.baseUrl}/?s=${encodeURIComponent(productName)}`;
            const response = await axios.get(searchUrl, {
                headers: this.headers,
                timeout: 10000
            });

            const $ = cheerio.load(response.data);
            
            // Look for product links
            const productLinks = $('a[href*="/product"], h2 a, h3 a, .product-title a');
            for (let i = 0; i < Math.min(productLinks.length, 5); i++) {
                const link = $(productLinks[i]);
                const href = link.attr('href');
                const linkText = link.text().toLowerCase();
                const nameLower = productName.toLowerCase();
                
                // Check if link text matches product name
                if (href && (linkText.includes(nameLower.substring(0, 20)) || linkText.includes(sku))) {
                    const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
                    const productData = await this.scrapeProductPage(fullUrl);
                    if (productData && (productData.price || productData.stock !== null)) {
                        return productData;
                    }
                }
            }

            return null;
        } catch (error) {
            console.error(`   ❌ Search error:`, error.message);
            return null;
        }
    }

    async scrapeProductPage(url) {
        try {
            const response = await axios.get(url, {
                headers: this.headers,
                timeout: 10000
            });

            const $ = cheerio.load(response.data);
            
            const price = this.extractPrice($);
            const stockQuantity = this.extractStockQuantity($);
            const inStock = this.checkStock($);

            return {
                url,
                price,
                stockQuantity: stockQuantity !== null ? stockQuantity : (inStock ? 100 : 0),
                inStock
            };
        } catch (error) {
            return null;
        }
    }

    async updateProduct(pool, productId, price, stockQuantity) {
        try {
            const updates = [];
            const params = [];

            if (price !== null && price > 0) {
                updates.push('price = ?');
                params.push(price);
            }

            if (stockQuantity !== null) {
                updates.push('inventory_quantity = ?');
                params.push(stockQuantity);
            }

            if (updates.length === 0) {
                return false;
            }

            params.push(productId);

            await pool.execute(
                `UPDATE products SET ${updates.join(', ')} WHERE id = ?`,
                params
            );

            return true;
        } catch (error) {
            console.error(`   ❌ Database update error:`, error.message);
            return false;
        }
    }

    async updateProducts(pool, products) {
        let updated = 0;
        let failed = 0;

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            console.log(`\n[${i + 1}/${products.length}] ${product.name}`);
            console.log(`   SKU: ${product.sku}, Issue: ${product.issue || 'unknown'}`);

            try {
                const productData = await this.searchProductOnHMHerbs(product.name, product.sku);
                
                if (productData) {
                    const needsPrice = !product.price || product.price === 0;
                    const needsStock = product.inventory_quantity === null || product.inventory_quantity === 0;

                    let shouldUpdate = false;
                    const updatePrice = needsPrice && productData.price ? productData.price : null;
                    const updateStock = needsStock && productData.stockQuantity !== null ? productData.stockQuantity : null;

                    if (updatePrice || updateStock) {
                        const success = await this.updateProduct(pool, product.id, updatePrice, updateStock);
                        if (success) {
                            console.log(`   ✅ Updated:`);
                            if (updatePrice) console.log(`      Price: $${updatePrice}`);
                            if (updateStock) console.log(`      Stock: ${updateStock}`);
                            updated++;
                        } else {
                            failed++;
                        }
                    } else {
                        console.log(`   ⚠️  No data found on hmherbs.com`);
                        failed++;
                    }
                } else {
                    console.log(`   ⚠️  Product not found on hmherbs.com`);
                    failed++;
                }

                // Rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (error) {
                console.error(`   ❌ Error:`, error.message);
                failed++;
            }
        }

        return { updated, failed };
    }
}

async function main() {
    loadBackendEnv();
    const pool = createPool({ connectionLimit: 5 });

    try {
        // Load products that need updates
        const { checkMissingPriceStock } = require('./check-missing-price-stock');
        const products = await checkMissingPriceStock();

        if (products.length === 0) {
            console.log('\n✅ No products need updates!');
            return;
        }

        console.log(`\n🚀 Starting price/stock update from hmherbs.com...`);
        console.log(`📊 Found ${products.length} products to check\n`);

        const updater = new PriceStockUpdater();
        const { updated, failed } = await updater.updateProducts(pool, products);

        console.log('\n' + '='.repeat(60));
        console.log('📊 SUMMARY:');
        console.log(`   Updated: ${updated}`);
        console.log(`   Failed: ${failed}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main()
        .then(() => {
            console.log('\n✅ Script completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = { PriceStockUpdater };

