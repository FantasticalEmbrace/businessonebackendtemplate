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
        console.log('🔍 Grouping products by core name...');
        
        const [rows] = await pool.execute(`
            SELECT id, sku, name, price, long_description
            FROM products
        `);

        const groups = {};
        rows.forEach(row => {
            // Normalize name: remove " SKU: ..." and trim
            let coreName = row.name.replace(/ SKU:.*$/i, '').trim();
            if (!groups[coreName]) groups[coreName] = [];
            groups[coreName].push(row);
        });

        const duplicates = Object.entries(groups).filter(([name, group]) => group.length > 1);
        console.log(`Found ${duplicates.length} groups with potential duplicates.`);

        for (const [name, group] of duplicates.slice(0, 10)) {
            console.log(`\nCore Name: "${name}" (${group.length} entries)`);
            group.forEach(row => {
                const hasDesc = row.long_description && row.long_description.length > 50 ? 'YES' : 'NO';
                console.log(`  - ID: ${row.id}, SKU: ${row.sku}, Price: $${row.price}, Has Desc: ${hasDesc}`);
            });
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

findDuplicates();

