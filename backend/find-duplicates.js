const mysql = require('mysql2/promise');
require('dotenv').config();

async function findDuplicates() {
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
        console.log('🔍 Searching for potential duplicate products...');
        
        // Find products with similar names or SKUs that might be duplicates
        // We'll look for products that share the same name (ignoring case)
        const [duplicates] = await pool.execute(`
            SELECT name, COUNT(*) as count, MIN(id) as first_id, MAX(id) as last_id
            FROM products
            GROUP BY name
            HAVING count > 1
        `);

        console.log(`Found ${duplicates.length} names with multiple entries.`);

        for (const dup of duplicates) {
            const [rows] = await pool.execute(`
                SELECT id, sku, name, price, long_description, created_at 
                FROM products 
                WHERE name = ?
                ORDER BY price DESC, long_description DESC
            `, [dup.name]);

            console.log(`\nProduct: "${dup.name}" (${rows.length} entries)`);
            rows.forEach(row => {
                const hasDesc = row.long_description && row.long_description.length > 50 ? 'YES' : 'NO';
                console.log(`  - ID: ${row.id}, SKU: ${row.sku}, Price: $${row.price}, Has Desc: ${hasDesc}, Created: ${row.created_at}`);
            });
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

findDuplicates();

