const mysql = require('mysql2/promise');
require('dotenv').config();

async function updateApsLogo() {
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
        await pool.execute('UPDATE brands SET logo_url = "/images/brand-images/APS.jpg" WHERE slug = "aps"');
        console.log('Updated APS logo URL');
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

updateApsLogo();

