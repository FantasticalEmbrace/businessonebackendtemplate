const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
loadBackendEnv();

/**
 * Update product prices and stock from hmherbs.com
 * For products with missing/zero price or stock
 */

const mysql = require('mysql2/promise');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

class HMHerbsPriceStockUpdater {
    constructor() {
        this.baseUrl = 'https://hmherbs.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        };
    }

    extractPrice($) {
        // Use the same method as the existing scraper
        const productForm = $('form.store-product, .product-details, .product-info').first();
        const searchArea = productForm.length > 0 ? productForm : $('body');

        // Try structured data first (JSON-LD) - most reliable
        const jsonLdScripts = $('script[type="application/ld+json"]');
        for (let i = 0; i < jsonLdScripts.length; i++) {
            try {
                const jsonData = JSON.parse($(jsonLdScripts[i]).html());
                const products = Array.isArray(jsonData) ? jsonData : (jsonData['@graph'] || [jsonData]);

                for (const item of products) {
                    if (item['@type'] === 'Product' || item['@type'] === 'http://schema.org/Product' || item['@type'] === 'https://schema.org/Product') {
                        if (item.offers) {
                            const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
                            for (const offer of offers) {
                                if (offer.price) {
                                    const price = parseFloat(offer.price);
                                    if (!isNaN(price) && price > 0 && price <= 10000) {
                                        return price;
                                    }
                                }
                            }
                        }
                        if (item.price) {
                            const price = parseFloat(item.price);
                            if (!isNaN(price) && price > 0 && price <= 10000) {
                                return price;
                            }
                        }
                    }
                }
            } catch (e) {
                // Continue if JSON parsing fails
            }
        }

        // Try price selectors
        const priceSelectors = [
            '.product-price',
            '.price',
            '[itemprop="price"]',
            '[class*="price"]',
            'span:contains("$")'
        ];

        for (const selector of priceSelectors) {
            const priceEl = searchArea.find(selector).first();
            if (priceEl.length) {
                let priceText = priceEl.text().trim();
                const priceMatch = priceText.match(/\$?([\d,]+\.?\d*)/);
                if (priceMatch) {
                    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
                    if (!isNaN(price) && price > 0 && price <= 10000) {
                        return price;
                    }
                }
            }
        }

        return null;
    }

    extractStockQuantity($) {
        // Use the same method as the existing scraper
        const outOfStockLabel = $('.store-out-of-stock-label, .store-not-available-label');
        let isOutOfStock = false;

        outOfStockLabel.each((i, el) => {
            if (!$(el).hasClass('hidden')) {
                isOutOfStock = true;
            }
        });

        if (isOutOfStock) return 0;

        // Try to find actual stock quantity
        const stockSelectors = [
            '.stock-quantity',
            '.inventory-quantity',
            '.qty-available',
            '.quantity-available',
            '[data-stock]',
            '[data-quantity]',
            '.product-stock'
        ];

        for (const selector of stockSelectors) {
            const text = $(selector).first().text().trim();
            if (text) {
                const quantityMatch = text.match(/(\d+)/);
                if (quantityMatch) {
                    const quantity = parseInt(quantityMatch[1]);
                    if (quantity >= 0) return quantity;
                }
            }

            const dataValue = $(selector).first().attr('data-stock') || $(selector).first().attr('data-quantity');
            if (dataValue) {
                const quantity = parseInt(dataValue);
                if (!isNaN(quantity) && quantity >= 0) return quantity;
            }
        }

        // Check stock status
        const stockIndicators = [
            $('.in-stock').length > 0,
            $('.available').length > 0,
            $('.add-to-cart').length > 0,
            !$('.out-of-stock').length,
            !$('.unavailable').length
        ];

        if (stockIndicators.some(indicator => indicator)) {
            return 100; // Default high quantity for in-stock items
        }

        return 0; // Assume out of stock if no indicators
    }

    async findProductOnHmHerbs(productName, sku) {
        try {
            // Build search URL
            const searchQuery = sku ? `${sku}` : productName;
            const searchUrl = `${this.baseUrl}/index.php/products?search=${encodeURIComponent(searchQuery)}`;
            
            const response = await axios.get(searchUrl, {
                headers: this.headers,
                timeout: 10000
            });

            const $ = cheerio.load(response.data);

            // Try to find product link on search results
            const productLinks = $('a[href*="/index.php/products/"]');
            
            for (let i = 0; i < Math.min(productLinks.length, 10); i++) {
                const link = $(productLinks[i]);
                const href = link.attr('href');
                const linkText = link.text().toLowerCase();
                const productNameLower = productName.toLowerCase();

                // Check if this link matches our product
                if (href && (linkText.includes(productNameLower.substring(0, 20)) || 
                    (sku && linkText.includes(sku.toLowerCase())))) {
                    // Found potential match, scrape the product page
                    const productUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
                    return await this.scrapeProductPage(productUrl);
                }
            }

            // If no match found in search, try direct product URL construction
            // HM Herbs URLs are typically: /index.php/products/product-name
            const slug = productName.toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
            const directUrl = `${this.baseUrl}/index.php/products/${slug}`;
            
            return await this.scrapeProductPage(directUrl);

        } catch (error) {
            console.error(`   ❌ Error searching: ${error.message}`);
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

            // Check if this is actually a product page
            if (!$('h1').length || !$('h1').text().includes('SKU:')) {
                return null; // Not a product page
            }

            const price = this.extractPrice($);
            const stock = this.extractStockQuantity($);

            return { price, stock, url };

        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null; // Product not found
            }
            throw error;
        }
    }

    async updateProducts() {
        const pool = createPool({ connectionLimit: 5 });

        try {
            console.log('🔍 Finding products with missing price or stock...\n');

            // Get products that need updating
            const [products] = await pool.execute(`
                SELECT 
                    p.id,
                    p.sku,
                    p.name,
                    p.slug,
                    p.price,
                    p.inventory_quantity
                FROM products p
                WHERE p.is_active = 1 
                AND (p.price IS NULL OR p.price = 0 OR p.inventory_quantity IS NULL OR p.inventory_quantity = 0)
                ORDER BY p.id
            `);

            console.log(`📊 Found ${products.length} products to update\n`);

            let updated = 0;
            let notFound = 0;
            let errors = 0;

            for (let i = 0; i < products.length; i++) {
                const product = products[i];
                console.log(`[${i + 1}/${products.length}] ${product.name} (SKU: ${product.sku})`);

                try {
                    const result = await this.findProductOnHmHerbs(product.name, product.sku);

                    if (result && (result.price || result.stock !== null)) {
                        const updates = [];
                        const values = [];

                        if (result.price && (!product.price || product.price === 0)) {
                            updates.push('price = ?');
                            values.push(result.price);
                            console.log(`   💰 Price: $${result.price}`);
                        }

                        if (result.stock !== null && (!product.inventory_quantity || product.inventory_quantity === 0)) {
                            updates.push('inventory_quantity = ?');
                            values.push(result.stock);
                            console.log(`   📦 Stock: ${result.stock}`);
                        }

                        if (updates.length > 0) {
                            values.push(product.id);
                            await pool.execute(
                                `UPDATE products SET ${updates.join(', ')} WHERE id = ?`,
                                values
                            );
                            console.log(`   ✅ Updated`);
                            updated++;
                        } else {
                            console.log(`   ℹ️  No updates needed`);
                        }
                    } else {
                        console.log(`   ⚠️  Product not found on hmherbs.com`);
                        notFound++;
                    }

                    // Add delay to avoid overwhelming the server
                    await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (error) {
                    console.error(`   ❌ Error: ${error.message}`);
                    errors++;
                }
            }

            console.log('\n' + '='.repeat(60));
            console.log('📊 SUMMARY:');
            console.log(`   Updated: ${updated}`);
            console.log(`   Not found: ${notFound}`);
            console.log(`   Errors: ${errors}`);
            console.log('='.repeat(60));

        } catch (error) {
            console.error('❌ Error:', error.message);
            throw error;
        } finally {
            await pool.end();
        }
    }
}

if (require.main === module) {
    const updater = new HMHerbsPriceStockUpdater();
    updater.updateProducts()
        .then(() => {
            console.log('\n✅ Script completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = { HMHerbsPriceStockUpdater };
