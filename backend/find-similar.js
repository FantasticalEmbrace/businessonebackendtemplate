const mysql = require('mysql2/promise');
require('dotenv').config();

async function findSimilarDuplicates() {
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
        console.log('🔍 Searching for products with similar names...');
        const [rows] = await pool.execute('SELECT id, name, sku, price, created_at FROM products');
        
        const normalized = rows.map(r => ({
            ...r,
            norm: r.name.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
        }));

        const groups = {};
        normalized.forEach(r => {
            if (!groups[r.norm]) groups[r.norm] = [];
            groups[r.norm].push(r);
        });

        const duplicates = Object.entries(groups).filter(([norm, group]) => group.length > 1);
        console.log(`Found ${duplicates.length} groups with similar names.`);

        duplicates.slice(0, 20).forEach(([norm, group]) => {
            console.log(`\nGroup: "${group[0].name}" (Normalized: ${norm})`);
            group.forEach(r => {
                console.log(`  - ID: ${r.id}, SKU: ${r.sku}, Price: $${r.price}, Created: ${r.created_at}`);
            });
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

findSimilarDuplicates();

