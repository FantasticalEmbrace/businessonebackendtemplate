const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixApsBrandFinal() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs'
    });

    try {
        console.log('🛠️  Starting final APS brand correction...');

        // 1. Rename the brand "APS Mesomorph" to "APS"
        const [[apsBrand]] = await pool.execute('SELECT id FROM brands WHERE name = "APS Mesomorph" OR slug = "aps"');
        if (apsBrand) {
            console.log(`Renaming brand ID ${apsBrand.id} to "APS"`);
            await pool.execute('UPDATE brands SET name = "APS", slug = "aps" WHERE id = ?', [apsBrand.id]);
        }

        const brandId = apsBrand.id;

        // 2. Get all products currently assigned to this brand
        const [products] = await pool.execute('SELECT id, name FROM products WHERE brand_id = ?', [brandId]);
        console.log(`Found ${products.length} products to re-verify.`);

        // 3. Define the major brands for re-assignment
        const brandMap = [
            { name: "Standard Enzyme", keywords: ["Standard Enzyme"] },
            { name: "Nature's Sunshine", keywords: ["Nature's Sunshine", "Natures Sunshine"] },
            { name: "Vista Life", keywords: ["Vista Life"] },
            { name: "Host Defence", keywords: ["Host Defense", "Host Defence"] },
            { name: "Newton Labs", keywords: ["Newton Labs", "Newton's Homeopathics"] },
            { name: "Doctor's Blend", keywords: ["Doctor's Blend", "Doctors Blend", "Dr. Tony"] }
        ];

        let reassignedCount = 0;
        for (const product of products) {
            let newBrandId = null;
            let matchedBrandName = null;

            // Check against major brands first
            for (const b of brandMap) {
                if (b.keywords.some(k => product.name.toLowerCase().includes(k.toLowerCase()))) {
                    matchedBrandName = b.name;
                    break;
                }
            }

            if (matchedBrandName) {
                const [[targetBrand]] = await pool.execute('SELECT id FROM brands WHERE name = ?', [matchedBrandName]);
                if (targetBrand) {
                    newBrandId = targetBrand.id;
                    console.log(`Re-assigning "${product.name}" from APS to "${matchedBrandName}"`);
                    await pool.execute('UPDATE products SET brand_id = ? WHERE id = ?', [newBrandId, product.id]);
                    reassignedCount++;
                }
            } else if (!product.name.toLowerCase().includes('mesomorph')) {
                // If it doesn't have "Mesomorph", it might be a generic "Unknown" product that got caught by "APS" keyword
                console.log(`Checking "${product.name}" for generic re-assignment...`);
                // If it doesn't look like an APS product, move it to Unknown (32)
                const [[unknownBrand]] = await pool.execute('SELECT id FROM brands WHERE name = "Unknown"');
                if (unknownBrand) {
                    await pool.execute('UPDATE products SET brand_id = ? WHERE id = ?', [unknownBrand.id, product.id]);
                    console.log(`Moved "${product.name}" to Unknown`);
                    reassignedCount++;
                }
            }
        }

        console.log(`\n✅ Finished! Corrected brand names and re-assigned ${reassignedCount} misidentified products.`);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

fixApsBrandFinal();

