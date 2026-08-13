const mysql = require('mysql2/promise');
require('dotenv').config();

async function findSimilar() {
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
        console.log('🔍 Finding products with similar starts...');
        const [rows] = await pool.execute('SELECT id, name, sku, price FROM products ORDER BY name');
        
        for (let i = 0; i < rows.length - 1; i++) {
            const current = rows[i];
            const next = rows[i+1];
            
            // If they start the same (first 15 chars) and one contains the other
            if (current.name.substring(0, 15) === next.name.substring(0, 15)) {
                console.log(`\nPotential Match:`);
                console.log(`  1: ID ${current.id}, SKU: ${current.sku}, Name: "${current.name}", Price: $${current.price}`);
                console.log(`  2: ID ${next.id}, SKU: ${next.sku}, Name: "${next.name}", Price: $${next.price}`);
            }
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

findSimilar();

