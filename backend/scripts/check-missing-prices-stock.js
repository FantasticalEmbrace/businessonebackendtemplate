const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
loadBackendEnv();

/**
 * Check products without price or stock
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

async function checkMissingPricesStock() {
    const pool = createPool({ connectionLimit: 5 });

    try {
        console.log('🔍 Checking products without price or stock...\n');

        // Find products with missing/zero price or stock
        const [products] = await pool.execute(`
            SELECT 
                p.id,
                p.sku,
                p.name,
                p.slug,
                p.price,
                p.inventory_quantity,
                b.name as brand_name
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            WHERE p.is_active = 1 
            AND (p.price IS NULL OR p.price = 0 OR p.inventory_quantity IS NULL OR p.inventory_quantity = 0)
            ORDER BY b.name, p.name
        `);

        console.log(`📊 Found ${products.length} products with missing/zero price or stock:\n`);

        if (products.length === 0) {
            console.log('✅ All products have prices and stock!');
            return [];
        }

        // Group by brand
        const productsByBrand = {};
        products.forEach(product => {
            const brandName = product.brand_name || 'Unknown Brand';
            if (!productsByBrand[brandName]) {
                productsByBrand[brandName] = [];
            }
            productsByBrand[brandName].push({
                id: product.id,
                sku: product.sku,
                name: product.name,
                slug: product.slug,
                price: product.price,
                inventory: product.inventory_quantity
            });
        });

        // Display results
        Object.keys(productsByBrand).sort().forEach(brandName => {
            console.log(`\n🏷️  ${brandName}`);
            productsByBrand[brandName].forEach(p => {
                console.log(`   - ID: ${p.id}, SKU: ${p.sku}`);
                console.log(`     Name: "${p.name}"`);
                console.log(`     Price: ${p.price || 'NULL/0'}, Stock: ${p.inventory !== null ? p.inventory : 'NULL'}`);
            });
        });

        // Save to JSON
        const fs = require('fs');
        const path = require('path');
        const outputPath = path.join(__dirname, '../../products-missing-price-stock.json');
        fs.writeFileSync(outputPath, JSON.stringify({
            total_count: products.length,
            generated_at: new Date().toISOString(),
            products_by_brand: productsByBrand
        }, null, 2));
        console.log(`\n💾 Results saved to: ${outputPath}`);

        return productsByBrand;

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    checkMissingPricesStock()
        .then(() => {
            console.log('\n✅ Script completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = { checkMissingPricesStock };

