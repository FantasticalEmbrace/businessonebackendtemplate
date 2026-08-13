const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkSlugs() {
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
        const names = ['Standard Enzyme', 'Newton Labs', 'Regalabs', 'Doctor\'s Blend'];
        for (const name of names) {
            const [rows] = await pool.execute('SELECT name, slug FROM brands WHERE name = ?', [name]);
            console.log(`${name}: ${rows[0] ? rows[0].slug : 'NOT FOUND'}`);
        }
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkSlugs();

