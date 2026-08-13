// Find prices and quantities for products that weren't found on the website
// Uses search functionality and alternative URL patterns to locate products

require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

class MissingProductsFinder {
    constructor() {
        this.baseUrl = 'https://hmherbs.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive'
        };
        this.results = {
            found: [],
            notFound: [],
            errors: []
        };
    }

    async connectDatabase() {
        const config = {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME || 'hmherbs'
        };
        
        return await mysql.createConnection(config);
    }

    async getMissingProducts() {
        // Get the products that were not found from the previous check
        // Or get all products with missing price/stock
        const conn = await this.connectDatabase();
        
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

    async searchProduct(searchTerm) {
        try {
            const searchUrl = `${this.baseUrl}/index.php/search?q=${encodeURIComponent(searchTerm)}`;
            const response = await axios.get(searchUrl, {
                headers: this.headers,
                timeout: 15000
            });

            const $ = cheerio.load(response.data);
            
            // Look for product links in search results
            const productLinks = [];
            $('a[href*="/index.php/products/"]').each((i, el) => {
                const href = $(el).attr('href');
                if (href && !href.includes('?ccm_paging_p=')) {
                    const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
                    if (!productLinks.includes(fullUrl)) {
                        productLinks.push(fullUrl);
                    }
                }
            });

            return productLinks;
        } catch (error) {
            return [];
        }
    }

    async tryAlternativeUrls(sku, name, slug) {
        const urls = [];
        
        // Try different URL patterns
        if (sku) {
            urls.push(`${this.baseUrl}/index.php/products/${sku}`);
            urls.push(`${this.baseUrl}/index.php/products/product-${sku}`);
            urls.push(`${this.baseUrl}/index.php/products/sku-${sku}`);
        }
        
        // Try slug variations
        if (slug) {
            urls.push(`${this.baseUrl}/index.php/products/${slug}`);
            // Try with different separators
            urls.push(`${this.baseUrl}/index.php/products/${slug.replace(/-/g, '_')}`);
            urls.push(`${this.baseUrl}/index.php/products/${slug.replace(/-/g, ' ')}`);
        }
        
        // Try name-based slug
        if (name) {
            const nameSlug = name.toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
            urls.push(`${this.baseUrl}/index.php/products/${nameSlug}`);
        }

        return urls;
    }

    async scrapeProductPriceAndStock(url) {
        try {
            const response = await axios.get(url, {
                headers: this.headers,
                timeout: 15000,
                validateStatus: (status) => status < 500 // Don't throw on 404
            });

            if (response.status === 404) {
                return { found: false, error: '404 Not Found' };
            }

            const $ = cheerio.load(response.data);

            if (!this.isProductPage($)) {
                return { found: false, error: 'Not a product page' };
            }

            const price = this.extractPrice($);
            const stock = this.extractStock($);
            const inStock = this.checkStock($);
            const sku = this.extractSKU($);
            const productName = this.extractProductName($);

            return {
                found: true,
                price: price,
                stock: stock,
                inStock: inStock,
                url: url,
                sku: sku,
                name: productName
            };
        } catch (error) {
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

    extractSKU($) {
        const h1Text = $('h1').first().text().trim();
        const skuMatch = h1Text.match(/SKU:\s*([A-Za-z0-9\-]+)/i);
        return skuMatch ? skuMatch[1].trim() : null;
    }

    extractProductName($) {
        const h1Text = $('h1').first().text().trim();
        return h1Text.replace(/\s*SKU:\s*[A-Za-z0-9\-]+.*$/i, '').trim();
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

        return null;
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

    async findProduct(product) {
        console.log(`\n🔍 Searching for: ${product.name} (SKU: ${product.sku})`);
        
        // Strategy 1: Search by SKU
        if (product.sku) {
            console.log(`   📍 Searching by SKU: ${product.sku}`);
            const skuLinks = await this.searchProduct(product.sku);
            
            for (const url of skuLinks) {
                const scraped = await this.scrapeProductPriceAndStock(url);
                if (scraped.found) {
                    const scrapedSku = scraped.sku;
                    if (scrapedSku && scrapedSku === product.sku) {
                        console.log(`   ✅ Found by SKU search!`);
                        return scraped;
                    }
                }
                await this.delay(500);
            }
        }

        // Strategy 2: Search by product name
        console.log(`   📍 Searching by product name: ${product.name}`);
        const nameLinks = await this.searchProduct(product.name);
        
        for (const url of nameLinks) {
            const scraped = await this.scrapeProductPriceAndStock(url);
            if (scraped.found) {
                // Verify it's the right product by checking SKU or name similarity
                const scrapedSku = scraped.sku;
                const scrapedName = scraped.name;
                
                if (scrapedSku && scrapedSku === product.sku) {
                    console.log(`   ✅ Found by name search (SKU match)!`);
                    return scraped;
                }
                
                // Check name similarity
                const nameSimilarity = this.calculateSimilarity(
                    product.name.toLowerCase(),
                    scrapedName.toLowerCase()
                );
                if (nameSimilarity > 0.8) {
                    console.log(`   ✅ Found by name search (name match: ${Math.round(nameSimilarity * 100)}%)!`);
                    return scraped;
                }
            }
            await this.delay(500);
        }

        // Strategy 3: Try alternative URL patterns
        console.log(`   📍 Trying alternative URL patterns...`);
        const altUrls = await this.tryAlternativeUrls(product.sku, product.name, product.slug);
        
        for (const url of altUrls) {
            const scraped = await this.scrapeProductPriceAndStock(url);
            if (scraped.found) {
                const scrapedSku = scraped.sku;
                if (scrapedSku && scrapedSku === product.sku) {
                    console.log(`   ✅ Found via alternative URL!`);
                    return scraped;
                }
            }
            await this.delay(500);
        }

        return null;
    }

    calculateSimilarity(str1, str2) {
        // Simple similarity calculation based on common words
        const words1 = str1.split(/\s+/).filter(w => w.length > 2);
        const words2 = str2.split(/\s+/).filter(w => w.length > 2);
        
        const commonWords = words1.filter(w => words2.includes(w));
        return commonWords.length / Math.max(words1.length, words2.length);
    }

    async findAllProducts(updateDatabase = false) {
        console.log('🔍 Fetching products with missing price or stock...');
        const products = await this.getMissingProducts();
        console.log(`📦 Found ${products.length} products to search for\n`);

        if (products.length === 0) {
            console.log('✅ No products to search for!');
            return;
        }

        let conn = null;
        if (updateDatabase) {
            conn = await this.connectDatabase();
        }

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            console.log(`\n[${i + 1}/${products.length}] Processing: ${product.name}`);

            try {
                const found = await this.findProduct(product);

                if (found && found.found) {
                    const dbPrice = parseFloat(product.price) || 0;
                    const dbStock = parseInt(product.inventory_quantity) || 0;
                    const livePrice = found.price || 0;
                    const liveStock = found.stock !== null ? found.stock : (found.inStock ? 100 : 0);

                    console.log(`   💰 Price: $${livePrice.toFixed(2)}`);
                    console.log(`   📦 Stock: ${liveStock !== null ? liveStock : 'Unknown (In Stock: ' + found.inStock + ')'}`);
                    console.log(`   🔗 URL: ${found.url}`);

                    const result = {
                        product: product,
                        found: true,
                        url: found.url,
                        database: {
                            price: dbPrice,
                            stock: dbStock
                        },
                        live: {
                            price: livePrice,
                            stock: liveStock,
                            inStock: found.inStock
                        },
                        updates: {}
                    };

                    if (livePrice > 0 && Math.abs(dbPrice - livePrice) > 0.01) {
                        result.updates.price = livePrice;
                    }

                    if (liveStock !== null && dbStock !== liveStock) {
                        result.updates.stock = liveStock;
                    }

                    this.results.found.push(result);

                    // Update database if requested
                    if (updateDatabase && conn && Object.keys(result.updates).length > 0) {
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
                            }
                        } catch (error) {
                            console.log(`   ❌ Database update error: ${error.message}`);
                            this.results.errors.push({
                                product: product,
                                error: error.message
                            });
                        }
                    }
                } else {
                    console.log(`   ❌ Product not found`);
                    this.results.notFound.push({
                        product: product,
                        attempts: ['SKU search', 'Name search', 'Alternative URLs']
                    });
                }
            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
                this.results.errors.push({
                    product: product,
                    error: error.message
                });
            }

            // Delay between products
            await this.delay(2000);
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
        console.log(`Total products searched: ${this.results.found.length + this.results.notFound.length}`);
        console.log(`Products found: ${this.results.found.length}`);
        console.log(`Products not found: ${this.results.notFound.length}`);
        console.log(`Errors: ${this.results.errors.length}`);

        if (this.results.found.length > 0) {
            console.log('\n✅ Products found with prices and stock:');
            this.results.found.forEach(result => {
                console.log(`\n  • ${result.product.name} (SKU: ${result.product.sku})`);
                console.log(`    Price: $${result.live.price.toFixed(2)}`);
                console.log(`    Stock: ${result.live.stock !== null ? result.live.stock : 'Unknown (In Stock: ' + result.live.inStock + ')'}`);
                console.log(`    URL: ${result.url}`);
                if (Object.keys(result.updates).length > 0) {
                    console.log(`    Updates needed: ${JSON.stringify(result.updates)}`);
                }
            });
        }

        if (this.results.notFound.length > 0) {
            console.log('\n❌ Products still not found:');
            this.results.notFound.forEach(item => {
                console.log(`  • ${item.product.name} (SKU: ${item.product.sku})`);
            });
        }

        // Save detailed report
        const report = {
            generated_at: new Date().toISOString(),
            summary: {
                total_searched: this.results.found.length + this.results.notFound.length,
                found: this.results.found.length,
                not_found: this.results.notFound.length,
                errors: this.results.errors.length
            },
            products_found: this.results.found,
            products_not_found: this.results.notFound,
            errors: this.results.errors
        };

        fs.writeFileSync(
            'missing-products-search-report.json',
            JSON.stringify(report, null, 2)
        );

        console.log('\n💾 Detailed report saved to: missing-products-search-report.json');
    }
}

// Main execution
(async () => {
    const finder = new MissingProductsFinder();
    
    const updateDb = process.argv.includes('--update') || process.argv.includes('-u');
    
    if (updateDb) {
        console.log('⚠️  UPDATE MODE: Database will be updated with found values\n');
    } else {
        console.log('📋 SEARCH MODE: Only searching, not updating database (use --update to update)\n');
    }

    try {
        await finder.findAllProducts(updateDb);
        console.log('\n✅ Search complete!');
    } catch (error) {
        console.error('\n❌ Error:', error);
        process.exit(1);
    }
})();

