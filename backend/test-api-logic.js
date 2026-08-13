const mysql = require('mysql2/promise');
require('dotenv').config();

async function testApiLogic() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs'
    });

    try {
        const brand = 'aps';
        const query = `
            SELECT 
                p.id, p.name, b.slug as brand_slug
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            WHERE b.slug = ?
        `;
        const [rows] = await pool.execute(query, [brand]);
        console.log(`Found ${rows.length} products for brand slug "${brand}":`);
        console.log(JSON.stringify(rows, null, 2));
    } catch (e) { console.error(e); } finally { await pool.end(); }
}
testApiLogic();

