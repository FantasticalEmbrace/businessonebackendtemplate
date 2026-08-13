const mysql = require('mysql2/promise');
require('dotenv').config();

async function lastCleanup() {
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
        const mappings = [
            { junk: 'Ns Blood Pressurex', real: 'Blood Pressure' },
            { junk: 'Newton Labs Indigestion Gas', real: 'Digestion' }
        ];

        for (const m of mappings) {
            const [[real]] = await pool.execute('SELECT id FROM product_categories WHERE name = ?', [m.real]);
            const [[junk]] = await pool.execute('SELECT id FROM product_categories WHERE name = ?', [m.junk]);
            if (real && junk) {
                await pool.execute('UPDATE products SET category_id = ? WHERE category_id = ?', [real.id, junk.id]);
                await pool.execute('DELETE FROM product_categories WHERE id = ?', [junk.id]);
                console.log(`Merged ${m.junk} -> ${m.real}`);
            }
        }
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

lastCleanup();

