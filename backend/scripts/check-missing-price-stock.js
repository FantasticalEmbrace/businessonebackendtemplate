const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
loadBackendEnv();

/**
 * Check products without price or stock
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

async function checkMissingPriceStock() {
    const pool = createPool({ connectionLimit: 5 });

    try {
        console.log('🔍 Checking products without price or stock...\n');

        // Find products with no price (0, NULL, or empty)
        const [noPrice] = await pool.execute(`
            SELECT id, sku, name, price, inventory_quantity
            FROM products
            WHERE is_active = 1 
            AND (price IS NULL OR price = 0 OR price = '0.00')
            ORDER BY name
        `);

        // Find products with no stock/inventory
        const [noStock] = await pool.execute(`
            SELECT id, sku, name, price, inventory_quantity
            FROM products
            WHERE is_active = 1 
            AND (inventory_quantity IS NULL OR inventory_quantity = 0)
            ORDER BY name
        `);

        console.log(`📊 Products without price (${noPrice.length}):`);
        if (noPrice.length > 0) {
            noPrice.forEach(p => {
                console.log(`  - ID: ${p.id}, SKU: ${p.sku}, Name: "${p.name}", Price: ${p.price || 'NULL'}, Stock: ${p.inventory_quantity || 'NULL'}`);
            });
        } else {
            console.log('  ✅ All products have prices');
        }

        console.log(`\n📊 Products without stock (${noStock.length}):`);
        if (noStock.length > 0) {
            noStock.forEach(p => {
                console.log(`  - ID: ${p.id}, SKU: ${p.sku}, Name: "${p.name}", Price: ${p.price || 'NULL'}, Stock: ${p.inventory_quantity || 'NULL'}`);
            });
        } else {
            console.log('  ✅ All products have stock');
        }

        // Find products with both issues
        const [bothIssues] = await pool.execute(`
            SELECT id, sku, name, price, inventory_quantity
            FROM products
            WHERE is_active = 1 
            AND (price IS NULL OR price = 0 OR price = '0.00')
            AND (inventory_quantity IS NULL OR inventory_quantity = 0)
            ORDER BY name
        `);

        console.log(`\n📊 Products with BOTH missing price AND stock (${bothIssues.length}):`);
        if (bothIssues.length > 0) {
            bothIssues.forEach(p => {
                console.log(`  - ID: ${p.id}, SKU: ${p.sku}, Name: "${p.name}"`);
            });
        }

        // Save to JSON for reference
        const fs = require('fs');
        const path = require('path');
        const outputPath = path.join(__dirname, '../../products-missing-price-stock.json');
        fs.writeFileSync(outputPath, JSON.stringify({
            no_price: noPrice,
            no_stock: noStock,
            both_issues: bothIssues,
            generated_at: new Date().toISOString()
        }, null, 2));
        console.log(`\n💾 Results saved to: ${outputPath}`);

        return { noPrice, noStock, bothIssues };

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    checkMissingPriceStock()
        .then(() => {
            console.log('\n✅ Check completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Check failed:', error);
            process.exit(1);
        });
}

module.exports = { checkMissingPriceStock };
