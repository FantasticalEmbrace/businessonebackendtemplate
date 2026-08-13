const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkSpecificProductCategory() {
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
            SELECT p.id, p.name, p.category_id, pc.name as category_name 
            FROM products p 
            LEFT JOIN product_categories pc ON p.category_id = pc.id 
            WHERE p.name LIKE ?
        `, ['%Venus Fly Trap%']);
        
        console.log(JSON.stringify(rows, null, 2));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkSpecificProductCategory();

