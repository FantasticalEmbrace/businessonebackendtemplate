const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
loadBackendEnv();

/**
 * Clean up local image paths and remove them so we can re-fetch with URLs
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

async function cleanLocalImages() {
    const pool = createPool({ connectionLimit: 5 });

    try {
        // Find products with local image paths (starting with /images/)
        const [rows] = await pool.execute(`
            SELECT p.id, p.name, pi.id as image_id, pi.image_url 
            FROM products p 
            JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1 
            WHERE pi.image_url LIKE '/images/%'
        `);

        console.log(`Found ${rows.length} products with local image paths:\n`);
        
        if (rows.length > 0) {
            for (const row of rows) {
                console.log(`- Removing local image for: ${row.name} (ID: ${row.id})`);
                await pool.execute('DELETE FROM product_images WHERE id = ?', [row.image_id]);
            }
            
            console.log(`\n✅ Removed ${rows.length} local image entries.`);
            console.log('You can now re-run fetch-product-images-from-brands.js to get URLs instead.');
        } else {
            console.log('✅ No local image paths found!');
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

cleanLocalImages();

