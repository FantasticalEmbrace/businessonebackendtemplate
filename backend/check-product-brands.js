const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkProductBrands() {
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
        const [total] = await pool.execute('SELECT COUNT(*) as count FROM products');
        const [unknown] = await pool.execute('SELECT COUNT(*) as count FROM products WHERE brand_id = 32 OR brand_id IS NULL');
        
        console.log(`Total Products: ${total[0].count}`);
        console.log(`Products with Unknown/Null Brand: ${unknown[0].count}`);

        const [dist] = await pool.execute(`
            SELECT b.name, COUNT(*) as count 
            FROM products p 
            JOIN brands b ON p.brand_id = b.id 
            GROUP BY b.name 
            ORDER BY count DESC
        `);
        console.log('\n--- BRAND DISTRIBUTION ---');
        dist.forEach(d => console.log(`${d.name}: ${d.count}`));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkProductBrands();

