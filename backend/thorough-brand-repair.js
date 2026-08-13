const mysql = require('mysql2/promise');
require('dotenv').config();

async function thoroughBrandRepair() {
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
        console.log('🔧 Starting thorough brand repair...');

        // 1. Get all brands
        const [brands] = await pool.execute('SELECT id, name FROM brands');
        
        // 2. Get all products with Unknown brand or potentially misidentified brand
        const [products] = await pool.execute('SELECT id, name FROM products');

        // 3. Define brand keywords
        const brandKeywords = [
            { name: 'Standard Enzyme', keywords: ['Standard Enzyme'] },
            { name: 'Newton Labs', keywords: ['Newton Labs', 'Newton\'s Homeopathics', 'Newton Homeopathics'] },
            { name: 'Regalabs', keywords: ['Regalabs', 'Regal Labs', 'Foster Regal'] },
            { name: 'Doctor\'s Blend', keywords: ['Doctor\'s Blend', 'Doctors Blend', 'Dr Tony', 'Dr. Tony'] },
            { name: 'Nature\'s Sunshine', keywords: ['Nature\'s Sunshine', 'Natures Sunshine'] },
            { name: 'Nature\'s Plus', keywords: ['Nature\'s Plus', 'Natures Plus'] },
            { name: 'Now Foods', keywords: ['Now Foods', 'Now'] },
            { name: 'Life Extension', keywords: ['Life Extension'] },
            { name: 'Vista Life', keywords: ['Vista Life'] },
            { name: 'Global Healing', keywords: ['Global Healing'] },
            { name: 'Skinny Magic', keywords: ['Skinny Magic'] },
            { name: 'Terry Naturally', keywords: ['Terry Naturally'] },
            { name: 'Purple Tiger', keywords: ['Purple Tiger'] },
            { name: 'Perrin\'s Naturals', keywords: ['Perrin\'s', 'Perrins'] },
            { name: 'HI-Tech', keywords: ['HI-Tech', 'HI Tech'] },
            { name: 'Edom Labs', keywords: ['Edom Labs', 'Edom'] },
            { name: 'Unicity', keywords: ['Unicity'] },
            { name: 'Host Defence', keywords: ['Host Defence', 'Host Defense'] },
            { name: 'HM Enterprise', keywords: ['HM Enterprise', 'H&M Herbs', 'HM Herbs'] },
            { name: 'MD Science', keywords: ['MD Science', 'M.D. Science', 'Swiss Navy'] },
            { name: 'Life-Flo', keywords: ['Life-Flo', 'Life Flo'] },
            { name: 'Michael\'s Health', keywords: ['Michael\'s Health', 'Michael\'s'] },
            { name: 'APS Mesomorph', keywords: ['APS Mesomorph', 'APS'] },
            { name: 'A C Grace', keywords: ['A C Grace', 'AC Grace'] },
            { name: 'ForMor International', keywords: ['ForMor'] },
            { name: 'Irwin Naturals', keywords: ['Irwin'] },
            { name: 'Natural Balance', keywords: ['Natural Balance'] },
            { name: 'North American Herb & Spice', keywords: ['North American Herb', 'Oreganol'] }
        ];

        // 4. Update products
        let updatedCount = 0;
        for (const product of products) {
            let matchedBrandName = null;
            const productName = product.name;

            for (const bk of brandKeywords) {
                if (bk.keywords.some(k => productName.toLowerCase().includes(k.toLowerCase()))) {
                    matchedBrandName = bk.name;
                    break;
                }
            }

            if (matchedBrandName) {
                // Find brand ID or create it
                let brandId;
                const [brandResult] = await pool.execute('SELECT id FROM brands WHERE name = ?', [matchedBrandName]);
                if (brandResult.length > 0) {
                    brandId = brandResult[0].id;
                } else {
                    const slug = matchedBrandName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    const [insertResult] = await pool.execute('INSERT INTO brands (name, slug) VALUES (?, ?)', [matchedBrandName, slug]);
                    brandId = insertResult.insertId;
                }

                await pool.execute('UPDATE products SET brand_id = ? WHERE id = ?', [brandId, product.id]);
                updatedCount++;
            }
        }

        console.log(`\n✅ Finished! Re-assigned brands for ${updatedCount} products.`);

    } catch (error) {
        console.error('Repair failed:', error.message);
    } finally {
        await pool.end();
    }
}

thoroughBrandRepair();

