const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkBrands() {
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
        console.log('--- BRANDS ---');
        const [brands] = await pool.execute('SELECT id, name, slug FROM brands WHERE name NOT LIKE "%Paging%" AND name != "Unknown"');
        console.log(JSON.stringify(brands, null, 2));

        console.log('\n--- JUNK BRANDS ---');
        const [junk] = await pool.execute('SELECT id, name, slug FROM brands WHERE name LIKE "%Paging%"');
        console.log(JSON.stringify(junk, null, 2));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkBrands();

