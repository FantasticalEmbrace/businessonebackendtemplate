const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkApsSlug() {
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
        const [rows] = await pool.execute('SELECT id, name, slug FROM brands WHERE slug = "aps" OR name = "APS" OR name = "APS Mesomorph"');
        console.log(JSON.stringify(rows, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkApsSlug();

