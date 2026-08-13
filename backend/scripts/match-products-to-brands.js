const { loadBackendEnv, createPool } = require('../utils/dbConfig');

loadBackendEnv();

/**
 * Script to match products to brands based on product name prefix
 * Products' names begin with their brand name, so we extract the brand from the product name
 * and match it to the correct brand in the database.
 */

class ProductBrandMatcher {
    constructor() {
        this.pool = createPool({ connectionLimit: 10, queueLimit: 0 });
    }

    async matchProductsToBrands() {
        console.log('🔍 Starting product-to-brand matching...\n');

        try {
            // Get all brands
            const [brands] = await this.pool.execute(
                'SELECT id, name FROM brands WHERE is_active = 1 ORDER BY name'
            );

            if (brands.length === 0) {
                console.log('⚠️  No brands found in database.');
                return;
            }

            console.log(`📦 Found ${brands.length} brands\n`);

            // Get all products
            const [products] = await this.pool.execute(
                'SELECT id, name, brand_id FROM products ORDER BY name'
            );

            if (products.length === 0) {
                console.log('⚠️  No products found in database.');
                return;
            }

            console.log(`🛍️  Found ${products.length} products\n`);

            let matched = 0;
            let updated = 0;
            let notMatched = 0;
            const notMatchedProducts = [];

            // Process each product
            for (const product of products) {
                const productName = (product.name || '').trim();
                
                if (!productName) {
                    notMatched++;
                    notMatchedProducts.push({ id: product.id, name: productName, reason: 'Empty product name' });
                    continue;
                }

                // Try to find matching brand
                let matchedBrand = null;
                let bestMatch = null;
                let bestMatchLength = 0;

                // First, try exact prefix match (case-insensitive)
                for (const brand of brands) {
                    const brandName = (brand.name || '').trim();
                    if (!brandName) continue;

                    // Check if product name starts with brand name (case-insensitive)
                    if (productName.toLowerCase().startsWith(brandName.toLowerCase())) {
                        // Prefer longer brand names (more specific matches)
                        if (brandName.length > bestMatchLength) {
                            bestMatch = brand;
                            bestMatchLength = brandName.length;
                            matchedBrand = brand;
                        }
                    }
                }

                if (matchedBrand) {
                    matched++;
                    
                    // Only update if brand_id is different
                    if (product.brand_id !== matchedBrand.id) {
                        await this.pool.execute(
                            'UPDATE products SET brand_id = ?, updated_at = NOW() WHERE id = ?',
                            [matchedBrand.id, product.id]
                        );
                        updated++;
                        console.log(`✅ Matched: "${productName}" → ${matchedBrand.name} (ID: ${matchedBrand.id})`);
                    } else {
                        console.log(`✓ Already matched: "${productName}" → ${matchedBrand.name}`);
                    }
                } else {
                    notMatched++;
                    notMatchedProducts.push({ 
                        id: product.id, 
                        name: productName, 
                        reason: 'No brand name found at start of product name' 
                    });
                    console.log(`⚠️  No match: "${productName}"`);
                }
            }

            // Summary
            console.log('\n' + '='.repeat(60));
            console.log('📊 SUMMARY');
            console.log('='.repeat(60));
            console.log(`Total products processed: ${products.length}`);
            console.log(`✅ Matched: ${matched}`);
            console.log(`🔄 Updated: ${updated}`);
            console.log(`⚠️  Not matched: ${notMatched}`);

            if (notMatchedProducts.length > 0) {
                console.log('\n⚠️  Products that could not be matched:');
                notMatchedProducts.slice(0, 20).forEach(p => {
                    console.log(`   - ID ${p.id}: "${p.name}" (${p.reason})`);
                });
                if (notMatchedProducts.length > 20) {
                    console.log(`   ... and ${notMatchedProducts.length - 20} more`);
                }
            }

            console.log('\n✨ Matching complete!\n');

        } catch (error) {
            console.error('❌ Error matching products to brands:', error);
            throw error;
        } finally {
            await this.pool.end();
        }
    }
}

// Run the script
if (require.main === module) {
    const matcher = new ProductBrandMatcher();
    matcher.matchProductsToBrands()
        .then(() => {
            console.log('✅ Script completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = ProductBrandMatcher;

