const mysql = require('mysql2/promise');
require('dotenv').config();

async function cleanAcGrace() {
    const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

    try {
        console.log('🧹 Cleaning up AC Grace brands...');

        // 1. Rename ID 646 to have the logo and correct name
        await pool.execute('UPDATE brands SET name = "AC Grace", slug = "ac-grace", logo_url = "/images/brand-images/ac-grace.png" WHERE id = 646');
        
        // 2. Move products from ID 2097 to 646
        const [updateResult] = await pool.execute('UPDATE products SET brand_id = 646 WHERE brand_id = 2097');
        console.log(`Moved ${updateResult.affectedRows} products from ID 2097 to 646.`);

        // 3. Delete ID 2097
        await pool.execute('DELETE FROM brands WHERE id = 2097');
        console.log('Deleted duplicate brand ID 2097.');

        // 4. Verify other Grace variations
        const [remaining] = await pool.execute('SELECT id, name FROM brands WHERE name LIKE "%Grace%"');
        console.log('Remaining Grace brands:', JSON.stringify(remaining, null, 2));

        // If ID 664 (AC Grace) exists and is a duplicate, merge it too
        const acGrace664 = remaining.find(b => b.id === 664);
        if (acGrace664) {
            console.log('Merging ID 664 as well...');
            await pool.execute('UPDATE products SET brand_id = 646 WHERE brand_id = 664');
            await pool.execute('DELETE FROM brands WHERE id = 664');
        }

        console.log('✅ AC Grace brands consolidated into one entry with image.');

    } catch (e) { console.error(e); } finally { await pool.end(); }
}
cleanAcGrace();

