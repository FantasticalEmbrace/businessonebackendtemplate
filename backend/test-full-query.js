const mysql = require('mysql2/promise');
require('dotenv').config();

async function testFullQuery() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs'
    });

    try {
        const brand = 'aps';
        const query = `
            SELECT DISTINCT
                p.id,
                p.sku,
                p.name,
                p.slug,
                p.short_description,
                p.price,
                p.compare_price,
                p.inventory_quantity,
                p.is_featured,
                b.name as brand_name,
                b.slug as brand_slug,
                pc.name as category_name,
                pc.slug as category_slug,
                pi.image_url,
                pi.alt_text
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN product_categories pc ON p.category_id = pc.id
            LEFT JOIN product_health_categories phc ON p.id = phc.product_id
            LEFT JOIN health_categories hc ON phc.health_category_id = hc.id
            LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
            WHERE b.slug = ?
            ORDER BY p.name ASC
            LIMIT 20 OFFSET 0
        `;
        const [rows] = await pool.query(query, [brand]);
        console.log(`Found ${rows.length} products for brand slug "${brand}":`);
        console.log(JSON.stringify(rows, null, 2));
    } catch (e) { console.error(e); } finally { await pool.end(); }
}
testFullQuery();

