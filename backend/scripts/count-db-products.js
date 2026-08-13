const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
loadBackendEnv();

// Quick script to count products in the database

const mysql = require('mysql2/promise');

async function countProducts() {
    let connection;
    
    try {
        // Create database connection
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'hmherbs'
        });

        console.log('🔍 Counting products in database...\n');

        // Count total products
        const [totalResult] = await connection.execute('SELECT COUNT(*) as total FROM products');
        const totalProducts = totalResult[0].total;

        // Count active products
        const [activeResult] = await connection.execute('SELECT COUNT(*) as total FROM products WHERE is_active = 1');
        const activeProducts = activeResult[0].total;

        // Count inactive products
        const [inactiveResult] = await connection.execute('SELECT COUNT(*) as total FROM products WHERE is_active = 0');
        const inactiveProducts = inactiveResult[0].total;

        console.log('📊 PRODUCT COUNT SUMMARY:');
        console.log(`   Total Products: ${totalProducts}`);
        console.log(`   Active Products: ${activeProducts}`);
        console.log(`   Inactive Products: ${inactiveProducts}`);
        
        if (totalProducts === 0) {
            console.log('\n⚠️  No products found in database!');
            console.log('   You may need to import products from the scraped JSON file.');
        } else if (totalProducts < 700) {
            console.log(`\n⚠️  Expected ~749 products, but only found ${totalProducts} in database.`);
            console.log('   You may need to import the scraped products.');
        } else {
            console.log(`\n✅ Found ${totalProducts} products in database!`);
        }

    } catch (error) {
        console.error('❌ Error counting products:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('   Database connection refused. Is MySQL running?');
        } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('   Database access denied. Check your DB credentials in .env file.');
        }
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

countProducts();

