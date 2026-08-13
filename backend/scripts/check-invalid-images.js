const { loadBackendEnv, createPool } = require('../utils/dbConfig');

loadBackendEnv();

/**
 * Check for invalid image URLs in database
 */

async function checkInvalidImages() {
    const pool = createPool({ connectionLimit: 5 });

    try {
        // Find products with invalid image URLs
        const [rows] = await pool.execute(`
            SELECT p.id, p.name, pi.image_url 
            FROM products p 
            JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1 
            WHERE pi.image_url LIKE '%bat.bing.com%' 
               OR pi.image_url LIKE '%data:image%' 
               OR pi.image_url LIKE '%pixel.gif%'
               OR pi.image_url LIKE '%tracking%'
               OR pi.image_url LIKE '%placeholder%'
               OR pi.image_url LIKE '%bbb.org%'
               OR LOWER(pi.image_url) LIKE '%accredited-business%'
               OR LOWER(pi.image_url) LIKE '%better-business%'
        `);
        
        // Also check Life Extension products specifically
        const [lifeExtRows] = await pool.execute(`
            SELECT p.id, p.name, pi.image_url 
            FROM products p 
            LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1 
            WHERE p.name LIKE 'Life Ext%'
            ORDER BY p.id
        `);

        console.log(`Found ${rows.length} products with invalid image URLs:\n`);
        
        if (rows.length > 0) {
            rows.forEach(row => {
                console.log(`- ID: ${row.id}, Name: "${row.name}"`);
                console.log(`  URL: ${row.image_url}\n`);
            });
            
            // Ask if we should delete these invalid images
            console.log('\nThese invalid image URLs should be removed from the database.');
        } else {
            console.log('✅ No invalid image URLs found!');
        }
        
        console.log('\n\nLife Extension Products:');
        console.log('='.repeat(60));
        lifeExtRows.forEach(row => {
            console.log(`\nID: ${row.id}`);
            console.log(`Name: "${row.name}"`);
            console.log(`Image URL: ${row.image_url || 'NULL'}`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkInvalidImages();

