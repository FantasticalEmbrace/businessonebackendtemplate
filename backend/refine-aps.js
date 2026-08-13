const mysql = require('mysql2/promise');
require('dotenv').config();

async function refineAPS() {
    const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

    try {
        console.log('🔄 Refining APS brand associations...');

        // APS is specifically for Mesomorph products
        const [products] = await pool.execute('SELECT id, name FROM products WHERE name LIKE "%Mesomorph%"');
        
        // Find APS brand
        const [[apsBrand]] = await pool.execute('SELECT id FROM brands WHERE name = "APS Mesomorph"');

        if (apsBrand) {
            for (const p of products) {
                console.log(`Linking ${p.name} to APS Mesomorph`);
                await pool.execute('UPDATE products SET brand_id = ? WHERE id = ?', [apsBrand.id, p.id]);
            }
        }

        // Re-assign mistakenly tagged products from previous broad sweep
        const [wronglyTagged] = await pool.execute(`
            SELECT p.id, p.name 
            FROM products p 
            WHERE p.brand_id = ? AND p.name NOT LIKE "%Mesomorph%" AND p.name NOT LIKE "%APS%"
        `, [apsBrand.id]);

        for (const p of wronglyTagged) {
             // Let the general repair handle these later or fix them now
             if (p.name.includes('Nature\'s Sunshine')) {
                 const [[nsBrand]] = await pool.execute('SELECT id FROM brands WHERE name = "Nature\'s Sunshine"');
                 if (nsBrand) await pool.execute('UPDATE products SET brand_id = ? WHERE id = ?', [nsBrand.id, p.id]);
             } else if (p.name.includes('Standard Enzyme')) {
                 const [[seBrand]] = await pool.execute('SELECT id FROM brands WHERE name = "Standard Enzyme"');
                 if (seBrand) await pool.execute('UPDATE products SET brand_id = ? WHERE id = ?', [seBrand.id, p.id]);
             }
        }

        console.log('✅ Refined APS connections.');
    } catch (e) { console.error(e); } finally { await pool.end(); }
}
refineAPS();

