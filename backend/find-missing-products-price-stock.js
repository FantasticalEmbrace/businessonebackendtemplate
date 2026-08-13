// Find missing products and get their prices and stock from hmherbs.com
// Uses multiple search strategies to locate products that weren't found by slug

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
        // Get products from database that had 404 errors
        const conn = await this.connectDatabase();
        
        const productIds = [1236, 1242, 1246, 1279, 1286, 1287, 1295, 1303, 1304, 1330, 1333, 1339, 1349, 1362, 1376, 1393, 1399, 1400, 1517, 1519, 1536, 1542, 1548, 1926, 1962];
        
        const placeholders = productIds.map(() => '?').join(',');
        const [rows] = await conn.execute(`
            SELECT id, sku, name, slug, price, inventory_quantity
            FROM products
            WHERE id IN (${placeholders})
            ORDER BY name
        `, productIds);
        
        await conn.end();
        return rows;
    }

    async searchBySKU(sku, expectedName) {
        try {
            const searchUrl = `${this.baseUrl}/index.php/search?q=${encodeURIComponent(sku)}`;
            const response = await axios.get(searchUrl, {
                headers: this.headers,
                timeout: 10000
            });

            const $ = cheerio.load(response.data);
            const productLinks = $('a[href*="/index.php/products/"]');
            
            // Try to find a product that matches the SKU
            for (let i = 0; i < productLinks.length; i++) {
                const link = $(productLinks[i]);
                const href = link.attr('href');
                const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
                
                // Check the product page to verify SKU match
                try {
                    const productResponse = await axios.get(fullUrl, {
                        headers: this.headers,
                        timeout: 5000
                    });
                    const product$ = cheerio.load(productResponse.data);
                    
                    // Extract SKU from product page
                    const h1Text = product$('h1').first().text();
                    const skuMatch = h1Text.match(/SKU:\s*([A-Za-z0-9\-]+)/i);
                    const pageSKU = skuMatch ? skuMatch[1].trim() : null;
                    
                    // Also check product name for similarity
                    const pageName = product$('h1').first().text().replace(/\s*SKU:.*$/i, '').trim();
                    const nameSimilarity = this.calculateNameSimilarity(expectedName, pageName);
                    
                    // If SKU matches exactly, or name is very similar, return this URL
                    if (pageSKU && pageSKU.toUpperCase() === sku.toUpperCase()) {
                        return fullUrl;
                    }
                    
                    // If name is very similar (80%+ match), accept it
                    if (nameSimilarity > 0.8) {
                        return fullUrl;
                    }
                } catch (error) {
                    // Continue to next link
                    continue;
                }
            }
            
            // If no exact match found, return first result as fallback
            if (productLinks.length > 0) {
                const href = $(productLinks[0]).attr('href');
                const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
                return fullUrl;
            }
        } catch (error) {
            // Continue to next strategy
        }
        return null;
    }

    calculateNameSimilarity(name1, name2) {
        const words1 = name1.toLowerCase().split(/\s+/);
        const words2 = name2.toLowerCase().split(/\s+/);
        const commonWords = words1.filter(word => words2.includes(word));
        return commonWords.length / Math.max(words1.length, words2.length);
    }

    async searchByName(name) {
        try {
            // Try searching with the product name
            const searchUrl = `${this.baseUrl}/index.php/search?q=${encodeURIComponent(name)}`;
            const response = await axios.get(searchUrl, {
                headers: this.headers,
                timeout: 10000
            });

            const $ = cheerio.load(response.data);
            const productLinks = $('a[href*="/index.php/products/"]');
            
            // Try to find the best match
            for (let i = 0; i < productLinks.length; i++) {
                const link = $(productLinks[i]);
                const linkText = link.text().toLowerCase();
                const productName = name.toLowerCase();
                
                // Check if the link text contains key words from the product name
                const nameWords = productName.split(/\s+/).filter(w => w.length > 3);
                const matchCount = nameWords.filter(word => linkText.includes(word)).length;
                
                if (matchCount >= Math.min(2, nameWords.length)) {
                    const href = link.attr('href');
                    const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
                    return fullUrl;
                }
            }
            
            // If no good match, return first product link
            if (productLinks.length > 0) {
                const href = $(productLinks[0]).attr('href');
                const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
                return fullUrl;
            }
        } catch (error) {
            // Continue to next strategy
        }
        return null;
    }

    async tryAlternativeSlugs(slug) {
        // Try variations of the slug
        const variations = [
            slug,
            slug.replace(/-/g, ''),
            slug.replace(/-/g, '_'),
            slug.toLowerCase(),
            slug.replace(/s$/, ''), // Remove trailing 's'
            slug.split('-').slice(0, -1).join('-'), // Remove last word
        ];

        for (const variant of variations) {
            const url = `${this.baseUrl}/index.php/products/${variant}`;
            try {
                const response = await axios.get(url, {
                    headers: this.headers,
                    timeout: 5000,
                    validateStatus: (status) => status < 500
                });

                if (response.status === 200) {
                    const $ = cheerio.load(response.data);
                    if (this.isProductPage($)) {
                        return url;
                    }
                }
            } catch (error) {
                // Continue to next variation
            }
        }
        return null;
    }

    async findProductUrl(product) {
        console.log(`   🔍 Searching for: ${product.name} (SKU: ${product.sku})`);

        // Strategy 1: Try alternative slug variations
        let url = await this.tryAlternativeSlugs(product.slug);
        if (url) {
            // Verify it's the right product
            const verified = await this.verifyProductMatch(url, product.sku, product.name);
            if (verified) {
                console.log(`   ✅ Found via slug variation: ${url}`);
                return url;
            }
        }

        // Strategy 2: Search by SKU
        url = await this.searchBySKU(product.sku, product.name);
        if (url) {
            // Verify it's the right product
            const verified = await this.verifyProductMatch(url, product.sku, product.name);
            if (verified) {
                console.log(`   ✅ Found via SKU search: ${url}`);
                return url;
            }
        }

        // Strategy 3: Search by product name
        url = await this.searchByName(product.name);
        if (url) {
            // Verify it's the right product
            const verified = await this.verifyProductMatch(url, product.sku, product.name);
            if (verified) {
                console.log(`   ✅ Found via name search: ${url}`);
                return url;
            }
        }

        // Strategy 4: Try direct URL with SKU (if numeric)
        if (/^\d+$/.test(product.sku)) {
            const patterns = [
                `${this.baseUrl}/index.php/products/${product.sku}`,
                `${this.baseUrl}/index.php/products/product-${product.sku}`,
                `${this.baseUrl}/index.php/products/sku-${product.sku}`
            ];

            for (const patternUrl of patterns) {
                try {
                    const response = await axios.get(patternUrl, {
                        headers: this.headers,
                        timeout: 5000,
                        validateStatus: (status) => status < 500
                    });

                    if (response.status === 200) {
                        const $ = cheerio.load(response.data);
                        if (this.isProductPage($)) {
                            // Verify it's the right product
                            const verified = await this.verifyProductMatch(patternUrl, product.sku, product.name);
                            if (verified) {
                                console.log(`   ✅ Found via SKU pattern: ${patternUrl}`);
                                return patternUrl;
                            }
                        }
                    }
                } catch (error) {
                    // Continue
                }
            }
        }

        return null;
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

    async verifyProductMatch(url, expectedSKU, expectedName) {
        try {
            const response = await axios.get(url, {
                headers: this.headers,
                timeout: 5000
            });
            const $ = cheerio.load(response.data);
            
            // Extract SKU from product page
            const h1Text = $('h1').first().text();
            const skuMatch = h1Text.match(/SKU:\s*([A-Za-z0-9\-]+)/i);
            const pageSKU = skuMatch ? skuMatch[1].trim() : null;
            
            // Extract product name
            const pageName = h1Text.replace(/\s*SKU:.*$/i, '').trim();
            
            // Check if SKU matches
            if (pageSKU && pageSKU.toUpperCase() === expectedSKU.toUpperCase()) {
                return true;
            }
            
            // Check if name is very similar
            const nameSimilarity = this.calculateNameSimilarity(expectedName, pageName);
            if (nameSimilarity > 0.85) {
                return true;
            }
            
            return false;
        } catch (error) {
            return false;
        }
    }

    async scrapeProductData(url) {
        try {
            const response = await axios.get(url, {
                headers: this.headers,
                timeout: 15000
            });

            const $ = cheerio.load(response.data);

            if (!this.isProductPage($)) {
                return null;
            }

            const price = this.extractPrice($);
            const stock = this.extractStock($);
            const inStock = this.checkStock($);

            return {
                url: url,
                price: price,
                stock: stock !== null ? stock : (inStock ? 100 : 0),
                inStock: inStock
            };
        } catch (error) {
            return null;
        }
    }

    async findAndUpdateAll(updateDatabase = false) {
        const products = await this.getMissingProducts();
        console.log(`🔍 Searching for ${products.length} missing products on hmherbs.com\n`);

        let conn = null;
        if (updateDatabase) {
            conn = await this.connectDatabase();
        }

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            console.log(`[${i + 1}/${products.length}] ${product.name}`);

            const url = await this.findProductUrl(product);

            if (!url) {
                console.log(`   ❌ Not found on website\n`);
                this.results.notFound.push(product);
                await this.delay(1000);
                continue;
            }

            const scraped = await this.scrapeProductData(url);

            if (!scraped) {
                console.log(`   ❌ Could not extract product data\n`);
                this.results.notFound.push(product);
                await this.delay(1000);
                continue;
            }

            console.log(`   💰 Price: $${scraped.price.toFixed(2)}`);
            console.log(`   📦 Stock: ${scraped.stock}`);

            const result = {
                product: product,
                found: true,
                url: url,
                price: scraped.price,
                stock: scraped.stock,
                inStock: scraped.inStock
            };

            this.results.found.push(result);

            if (updateDatabase && conn) {
                try {
                    const updates = [];
                    const values = [];

                    if (scraped.price > 0) {
                        updates.push('price = ?');
                        values.push(scraped.price);
                    }

                    if (scraped.stock !== null) {
                        updates.push('inventory_quantity = ?');
                        values.push(scraped.stock);
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
                    this.results.errors.push({ product, error: error.message });
                }
            }

            console.log('');

            await this.delay(2000); // Delay between requests
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
        console.log(`Products found: ${this.results.found.length}`);
        console.log(`Products still not found: ${this.results.notFound.length}`);
        console.log(`Errors: ${this.results.errors.length}`);

        if (this.results.found.length > 0) {
            console.log('\n✅ Products found with prices and stock:');
            this.results.found.forEach(result => {
                console.log(`\n  • ${result.product.name} (SKU: ${result.product.sku})`);
                console.log(`    Price: $${result.price.toFixed(2)}`);
                console.log(`    Stock: ${result.stock}`);
                console.log(`    URL: ${result.url}`);
            });
        }

        if (this.results.notFound.length > 0) {
            console.log('\n❌ Products still not found:');
            this.results.notFound.forEach(product => {
                console.log(`  • ${product.name} (SKU: ${product.sku})`);
            });
        }

        // Save detailed report
        const report = {
            generated_at: new Date().toISOString(),
            summary: {
                found: this.results.found.length,
                not_found: this.results.notFound.length,
                errors: this.results.errors.length
            },
            found_products: this.results.found,
            not_found_products: this.results.notFound,
            errors: this.results.errors
        };

        fs.writeFileSync(
            'missing-products-found-report.json',
            JSON.stringify(report, null, 2)
        );

        console.log('\n💾 Detailed report saved to: missing-products-found-report.json');
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
        await finder.findAndUpdateAll(updateDb);
        console.log('\n✅ Search complete!');
    } catch (error) {
        console.error('\n❌ Error:', error);
        process.exit(1);
    }
})();

