const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkAPS() {
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
        console.log('🔍 Checking APS brand data...');

        // 1. Find all APS-related brands
        const [brands] = await pool.execute('SELECT id, name, slug FROM brands WHERE name LIKE "%APS%" OR name LIKE "%Mesomorph%"');
        console.log('Brands found:', JSON.stringify(brands, null, 2));

        // 2. Count products for each brand
        for (const b of brands) {
            const [products] = await pool.execute('SELECT COUNT(*) as count FROM products WHERE brand_id = ?', [b.id]);
            console.log(`Brand "${b.name}" (ID: ${b.id}, Slug: ${b.slug}) has ${products[0].count} products.`);
        }

        // 3. Find products with "APS" or "Mesomorph" in name
        const [productsByName] = await pool.execute('SELECT id, name, brand_id FROM products WHERE name LIKE "%APS%" OR name LIKE "%Mesomorph%"');
        console.log('\nProducts matching APS/Mesomorph by name:');
        productsByName.forEach(p => console.log(`- [${p.id}] ${p.name} (Brand ID: ${p.brand_id})`));

        // 4. Fix if necessary
        if (brands.length > 0 && productsByName.length > 0) {
            const primaryBrand = brands.find(b => b.name === 'APS Mesomorph') || brands[0];
            console.log(`\n🔧 Fixing: Setting brand_id to ${primaryBrand.id} for these products...`);
            for (const p of productsByName) {
                await pool.execute('UPDATE products SET brand_id = ? WHERE id = ?', [primaryBrand.id, p.id]);
            }
            console.log('✅ Updated products.');
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkAPS();

