const mysql = require('mysql2/promise');
require('dotenv').config();

async function updateApsSlug() {
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
        await pool.execute('UPDATE brands SET slug = "aps" WHERE name = "APS Mesomorph"');
        console.log('Updated APS Mesomorph slug to "aps"');
        
        // Also ensure any other brands don't have this slug
        const [rows] = await pool.execute('SELECT id, name, slug FROM brands WHERE slug = "aps"');
        console.log('Current brands with slug "aps":', JSON.stringify(rows, null, 2));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

updateApsSlug();

