const mysql = require('mysql2/promise');
require('dotenv').config();

async function mergeAcGrace() {
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
        console.log('🔍 Checking AC Grace brands...');
        const [brands] = await pool.execute('SELECT id, name, slug, logo_url FROM brands WHERE name LIKE "%AC Grace%"');
        console.log(JSON.stringify(brands, null, 2));

        if (brands.length < 2) {
            console.log('Only one AC Grace brand found. Nothing to merge.');
            return;
        }

        // Identify the one to keep (the one with the logo)
        const toKeep = brands.find(b => b.logo_url && b.logo_url !== '') || brands[0];
        const toDelete = brands.filter(b => b.id !== toKeep.id);

        console.log(`\nKeeping: ${toKeep.name} (ID: ${toKeep.id})`);

        for (const brand of toDelete) {
            console.log(`Merging: ${brand.name} (ID: ${brand.id}) -> ${toKeep.name}`);

            // 1. Update products
            const [updateResult] = await pool.execute('UPDATE products SET brand_id = ? WHERE brand_id = ?', [toKeep.id, brand.id]);
            console.log(`Updated ${updateResult.affectedRows} products.`);

            // 2. Delete the extra brand
            await pool.execute('DELETE FROM brands WHERE id = ?', [brand.id]);
            console.log(`Deleted extra brand.`);
        }

        // Ensure the final name is clean
        await pool.execute('UPDATE brands SET name = "AC Grace", slug = "ac-grace" WHERE id = ?', [toKeep.id]);
        console.log('\n✅ Merged AC Grace brands successfully.');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

mergeAcGrace();

