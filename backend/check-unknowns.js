const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkUnknowns() {
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
        const [rows] = await pool.execute(`
            SELECT p.id, p.name, p.sku, p.price, b.name as brand_name
            FROM products p
            JOIN brands b ON p.brand_id = b.id
            WHERE b.name = 'Unknown'
        `);
        
        console.log('--- PRODUCTS WITH UNKNOWN BRAND ---');
        rows.forEach(r => console.log(`ID: ${r.id}, Name: "${r.name}", SKU: ${r.sku}, Price: $${r.price}`));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkUnknowns();

