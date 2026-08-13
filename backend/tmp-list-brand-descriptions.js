const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
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
        const [rows] = await pool.execute(
            'SELECT id, name, slug, description FROM brands ORDER BY name'
        );

        const missing = rows.filter(r => !r.description || !r.description.trim());
        console.log(`Total brands: ${rows.length}`);
        console.log(`Missing descriptions: ${missing.length}`);
        missing.forEach(r => {
            console.log(`- [${r.id}] ${r.name} (slug: ${r.slug || 'n/a'})`);
        });
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

run();

