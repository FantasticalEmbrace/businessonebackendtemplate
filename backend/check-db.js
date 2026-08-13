const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkDatabase() {
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
        console.log('📊 Database Overview:');
        
        const [total] = await pool.execute('SELECT COUNT(*) as count FROM products');
        console.log(`Total Products: ${total[0].count}`);

        const [price25] = await pool.execute('SELECT COUNT(*) as count FROM products WHERE price = 25.00');
        console.log(`Products with price $25.00: ${price25[0].count}`);

        console.log('\n📝 Sample of products with price $25.00:');
        const [rows] = await pool.execute(`
            SELECT id, sku, name, price, SUBSTRING(long_description, 1, 50) as desc_start
            FROM products 
            WHERE price = 25.00
            LIMIT 10
        `);
        rows.forEach(row => {
            console.log(`  - ID: ${row.id}, SKU: ${row.sku}, Name: "${row.name}", Desc: ${row.desc_start ? 'YES' : 'NO'}`);
        });

        console.log('\n📝 Searching for products with similar names:');
        const [similar] = await pool.execute(`
            SELECT p1.name, p1.id as id1, p1.price as price1, p2.id as id2, p2.price as price2
            FROM products p1
            JOIN products p2 ON p1.name = p2.name AND p1.id < p2.id
            LIMIT 10
        `);
        console.log(`Found ${similar.length} exact name matches.`);
        similar.forEach(s => {
            console.log(`  - Name: "${s.name}", ID1: ${s.id1} ($${s.price1}), ID2: ${s.id2} ($${s.price2})`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkDatabase();

