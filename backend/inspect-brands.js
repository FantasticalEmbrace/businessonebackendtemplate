const mysql = require('mysql2/promise');
require('dotenv').config();

async function inspectBrands() {
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
        console.log('--- BRAND TABLE ---');
        const [brands] = await pool.execute('SELECT * FROM brands');
        brands.forEach(b => console.log(`ID: ${b.id}, Name: "${b.name}"`));

        console.log('\n--- PRODUCTS WITH UNKNOWN BRAND ---');
        const [unknown] = await pool.execute(`
            SELECT p.id, p.name, p.sku, b.name as brand_name
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            WHERE b.name = 'Unknown' OR b.name IS NULL
            LIMIT 20
        `);
        unknown.forEach(p => console.log(`ID: ${p.id}, SKU: ${p.sku}, Name: "${p.name}", Brand: ${p.brand_name}`));

        console.log('\n--- POTENTIAL DUPLICATES BY NORMALIZED NAME ---');
        const [rows] = await pool.execute('SELECT id, name, sku, price, long_description FROM products');
        const groups = {};
        rows.forEach(r => {
            const norm = r.name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
            if (!groups[norm]) groups[norm] = [];
            groups[norm].push(r);
        });

        Object.entries(groups).forEach(([norm, group]) => {
            if (group.length > 1) {
                console.log(`\nGroup: "${norm}" (${group.length} entries)`);
                group.forEach(p => {
                    const hasDesc = p.long_description && p.long_description.length > 20 ? 'YES' : 'NO';
                    console.log(`  - ID: ${p.id}, SKU: ${p.sku}, Price: $${p.price}, Has Desc: ${hasDesc}`);
                });
            }
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

inspectBrands();

