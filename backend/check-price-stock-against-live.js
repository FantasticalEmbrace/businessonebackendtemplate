// Check products missing price or stock against hmherbs.com
// Compares database values with live website and reports/updates discrepancies

require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

class PriceStockChecker {
    constructor() {
        this.baseUrl = 'https://hmherbs.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive'
        };
        this.results = {
            checked: [],
            updated: [],
            errors: [],
            notFound: [],
            noChanges: []
        };
    }

    async connectDatabase() {
        // Try to read from environment or use defaults
        const config = {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME || 'hmherbs'
        };
        
        return await mysql.createConnection(config);
    }

    async getProductsMissingPriceOrStock() {
        const conn = await this.connectDatabase();
        
        // Get products where price is 0.00 or NULL, or inventory_quantity is 0 or NULL
        const [rows] = await conn.execute(`
            SELECT 
                p.id,
                p.sku,
                p.name,
                p.slug,
                p.price,
                p.inventory_quantity,
                p.is_active,
                b.name as brand_name
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            WHERE p.is_active = 1
            AND (
                p.price = 0.00 
                OR p.price IS NULL
                OR p.inventory_quantity = 0
                OR p.inventory_quantity IS NULL
            )
            ORDER BY p.name
        `);
        
        await conn.end();
        return rows;
    }

    constructProductUrl(slug) {
        // Product URLs on hmherbs.com follow: /index.php/products/{slug}
        return `${this.baseUrl}/index.php/products/${slug}`;
    }

    async scrapeProductPriceAndStock(url) {
        try {
            const response = await axios.get(url, {
                headers: this.headers,
                timeout: 15000
            });

            const $ = cheerio.load(response.data);

            // Check if this is a product page
            if (!this.isProductPage($)) {
                return { found: false, error: 'Not a product page' };
            }

            const price = this.extractPrice($);
            const stock = this.extractStock($);
            const inStock = this.checkStock($);

            return {
                found: true,
                price: price,
                stock: stock,
                inStock: inStock,
                url: url
            };
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return { found: false, error: 'Product not found (404)' };
            }
            return { found: false, error: error.message };
        }
    }

    isProductPage($) {
        const indicators = [
            $('h1').length > 0 && $('h1').text().includes('SKU:'),
            $('.product-details').length > 0,
            $('.product-price').length > 0,
            $('body').text().includes('Add to Cart')
        ];
        return indicators.some(indicator => indicator);
    }

    extractPrice($) {
        // Try structured data first (JSON-LD)
        const jsonLdScripts = $('script[type="application/ld+json"]');
        for (let i = 0; i < jsonLdScripts.length; i++) {
            try {
                const jsonData = JSON.parse($(jsonLdScripts[i]).html());
                const products = Array.isArray(jsonData) ? jsonData : (jsonData['@graph'] || [jsonData]);

                for (const item of products) {
                    if (item['@type'] === 'Product' || item['@type'] === 'http://schema.org/Product') {
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
            } catch (e) { }
        }

        // Try meta tags
        const metaPrice = $('meta[property="product:price:amount"]').attr('content') ||
            $('meta[property="og:price:amount"]').attr('content') ||
            $('meta[name="price"]').attr('content') ||
            $('meta[itemprop="price"]').attr('content');
        if (metaPrice) {
            const price = parseFloat(metaPrice);
            if (!isNaN(price) && price > 0 && price <= 10000) {
                return price;
            }
        }

        // Try CSS selectors
        const productForm = $('form.store-product, .product-details, .product-info').first();
        const searchArea = productForm.length > 0 ? productForm : $('body');

        const priceSelectors = [
            '.store-product-price',
            '.product-price',
            '.price',
            '.current-price',
            '.sale-price',
            '.amount',
            '.ccm-block-product-price',
            'span.price',
            'div.price'
        ];

        for (const selector of priceSelectors) {
            const elements = searchArea.find(selector);
            for (let j = 0; j < elements.length; j++) {
                const text = $(elements[j]).text().trim();
                if (text) {
                    const priceMatch = text.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/) ||
                        text.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
                    if (priceMatch) {
                        const price = parseFloat(priceMatch[1].replace(/,/g, ''));
                        if (!isNaN(price) && price >= 0.01 && price <= 10000) {
                            return price;
                        }
                    }
                }
            }
        }

        // Fallback: search text for price pattern
        const areaText = searchArea.text();
        const priceMatch = areaText.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
        if (priceMatch) {
            const price = parseFloat(priceMatch[1].replace(/,/g, ''));
            if (!isNaN(price) && price >= 0.01 && price <= 10000) {
                return price;
            }
        }

        return 0;
    }

    extractStock($) {
        // Check for "Out of Stock" labels
        const outOfStockLabel = $('.store-out-of-stock-label, .store-not-available-label');
        let isOutOfStock = false;

        outOfStockLabel.each((i, el) => {
            if (!$(el).hasClass('hidden')) {
                isOutOfStock = true;
            }
        });

        if (isOutOfStock) return 0;

        // Try to find actual stock quantity numbers
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

        // If product is in stock but no quantity found, return default
        return null; // null means we don't know the exact quantity
    }

    checkStock($) {
        const stockIndicators = [
            $('.in-stock').length > 0,
            $('.available').length > 0,
            $('.add-to-cart').length > 0,
            !$('.out-of-stock').length,
            !$('.store-out-of-stock-label').length || $('.store-out-of-stock-label').hasClass('hidden')
        ];

        return stockIndicators.some(indicator => indicator);
    }

    async checkAllProducts(updateDatabase = false) {
        console.log('🔍 Fetching products with missing price or stock from database...');
        const products = await this.getProductsMissingPriceOrStock();
        console.log(`📦 Found ${products.length} products to check\n`);

        if (products.length === 0) {
            console.log('✅ No products with missing price or stock found!');
            return;
        }

        let conn = null;
        if (updateDatabase) {
            conn = await this.connectDatabase();
        }

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            const url = this.constructProductUrl(product.slug);

            console.log(`[${i + 1}/${products.length}] Checking: ${product.name}`);
            console.log(`   SKU: ${product.sku}, Current Price: $${product.price || '0.00'}, Current Stock: ${product.inventory_quantity || 0}`);

            const scraped = await this.scrapeProductPriceAndStock(url);

            if (!scraped.found) {
                console.log(`   ❌ ${scraped.error || 'Not found on website'}`);
                this.results.notFound.push({
                    product: product,
                    error: scraped.error
                });
                await this.delay(1000); // Delay between requests
                continue;
            }

            const dbPrice = parseFloat(product.price) || 0;
            const dbStock = parseInt(product.inventory_quantity) || 0;
            const livePrice = scraped.price || 0;
            const liveStock = scraped.stock !== null ? scraped.stock : (scraped.inStock ? 100 : 0);

            const priceDiff = Math.abs(dbPrice - livePrice) > 0.01;
            const stockDiff = dbStock !== liveStock;

            console.log(`   🌐 Live Price: $${livePrice.toFixed(2)}, Live Stock: ${liveStock !== null ? liveStock : 'Unknown (In Stock: ' + scraped.inStock + ')'}`);

            const result = {
                product: product,
                url: url,
                database: {
                    price: dbPrice,
                    stock: dbStock
                },
                live: {
                    price: livePrice,
                    stock: liveStock,
                    inStock: scraped.inStock
                },
                needsUpdate: false,
                updates: {}
            };

            if (priceDiff && livePrice > 0) {
                result.needsUpdate = true;
                result.updates.price = livePrice;
                console.log(`   ⚠️  Price mismatch: DB=$${dbPrice.toFixed(2)} vs Live=$${livePrice.toFixed(2)}`);
            }

            if (stockDiff && liveStock !== null) {
                result.needsUpdate = true;
                result.updates.stock = liveStock;
                console.log(`   ⚠️  Stock mismatch: DB=${dbStock} vs Live=${liveStock}`);
            }

            if (!result.needsUpdate) {
                console.log(`   ✅ No changes needed`);
                this.results.noChanges.push(result);
            } else {
                this.results.checked.push(result);

                if (updateDatabase && conn) {
                    try {
                        const updates = [];
                        const values = [];

                        if (result.updates.price !== undefined) {
                            updates.push('price = ?');
                            values.push(result.updates.price);
                        }

                        if (result.updates.stock !== undefined) {
                            updates.push('inventory_quantity = ?');
                            values.push(result.updates.stock);
                        }

                        if (updates.length > 0) {
                            values.push(product.id);
                            await conn.execute(
                                `UPDATE products SET ${updates.join(', ')} WHERE id = ?`,
                                values
                            );
                            console.log(`   ✅ Updated in database`);
                            this.results.updated.push(result);
                        }
                    } catch (error) {
                        console.log(`   ❌ Database update error: ${error.message}`);
                        this.results.errors.push({
                            product: product,
                            error: error.message
                        });
                    }
                }
            }

            console.log(''); // Empty line for readability

            // Delay between requests to be respectful
            await this.delay(1500);
        }

        if (conn) {
            await conn.end();
        }

        this.generateReport();
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    generateReport() {
        console.log('\n' + '='.repeat(80));
        console.log('📊 SUMMARY REPORT');
        console.log('='.repeat(80));
        console.log(`Total products checked: ${this.results.checked.length + this.results.noChanges.length + this.results.notFound.length}`);
        console.log(`Products needing updates: ${this.results.checked.length}`);
        console.log(`Products updated: ${this.results.updated.length}`);
        console.log(`Products with no changes needed: ${this.results.noChanges.length}`);
        console.log(`Products not found on website: ${this.results.notFound.length}`);
        console.log(`Errors: ${this.results.errors.length}`);

        if (this.results.checked.length > 0) {
            console.log('\n📋 Products needing updates:');
            this.results.checked.forEach(result => {
                console.log(`\n  • ${result.product.name} (SKU: ${result.product.sku})`);
                if (result.updates.price !== undefined) {
                    console.log(`    Price: $${result.database.price.toFixed(2)} → $${result.updates.price.toFixed(2)}`);
                }
                if (result.updates.stock !== undefined) {
                    console.log(`    Stock: ${result.database.stock} → ${result.updates.stock}`);
                }
                console.log(`    URL: ${result.url}`);
            });
        }

        if (this.results.notFound.length > 0) {
            console.log('\n❌ Products not found on website:');
            this.results.notFound.forEach(item => {
                console.log(`  • ${item.product.name} (SKU: ${item.product.sku}) - ${item.error}`);
            });
        }

        // Save detailed report to JSON
        const report = {
            generated_at: new Date().toISOString(),
            summary: {
                total_checked: this.results.checked.length + this.results.noChanges.length + this.results.notFound.length,
                needs_update: this.results.checked.length,
                updated: this.results.updated.length,
                no_changes: this.results.noChanges.length,
                not_found: this.results.notFound.length,
                errors: this.results.errors.length
            },
            products_needing_updates: this.results.checked,
            products_not_found: this.results.notFound,
            products_no_changes: this.results.noChanges,
            errors: this.results.errors
        };

        fs.writeFileSync(
            'price-stock-check-report.json',
            JSON.stringify(report, null, 2)
        );

        console.log('\n💾 Detailed report saved to: price-stock-check-report.json');
    }
}

// Main execution
(async () => {
    const checker = new PriceStockChecker();
    
    // Check command line arguments
    const updateDb = process.argv.includes('--update') || process.argv.includes('-u');
    
    if (updateDb) {
        console.log('⚠️  UPDATE MODE: Database will be updated with correct values\n');
    } else {
        console.log('📋 CHECK MODE: Only checking, not updating database (use --update to update)\n');
    }

    try {
        await checker.checkAllProducts(updateDb);
        console.log('\n✅ Check complete!');
    } catch (error) {
        console.error('\n❌ Error:', error);
        process.exit(1);
    }
})();

