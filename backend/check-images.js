const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkImages() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    try {
        console.log('🖼️ Checking image status for products...');
        
        const [stats] = await pool.execute(`
            SELECT 
                COUNT(*) as total_products,
                SUM(CASE WHEN EXISTS (SELECT 1 FROM product_images WHERE product_id = products.id) THEN 1 ELSE 0 END) as products_with_images
            FROM products
        `);

        console.log(`Total Products: ${stats[0].total_products}`);
        console.log(`Products with Images: ${stats[0].products_with_images}`);
        
        if (stats[0].total_products > 0) {
            const percentage = (stats[0].products_with_images / stats[0].total_products * 100).toFixed(1);
            console.log(`Coverage: ${percentage}%`);
        }

        console.log('\n📝 Sample products WITHOUT images:');
        const [noImages] = await pool.execute(`
            SELECT id, sku, name, price
            FROM products 
            WHERE NOT EXISTS (SELECT 1 FROM product_images WHERE product_id = products.id)
            LIMIT 10
        `);
        noImages.forEach(row => {
            console.log(`  - ID: ${row.id}, SKU: ${row.sku}, Name: "${row.name}"`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkImages();

