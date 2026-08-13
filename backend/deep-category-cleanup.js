const mysql = require('mysql2/promise');
require('dotenv').config();

async function cleanupCategories() {
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
        console.log('🧹 Starting deep category cleanup...');

        // 1. Get all categories
        const [categories] = await pool.execute('SELECT id, name FROM product_categories');
        
        const validCategories = [
            'Antioxidants', 'Blood Pressure', 'Blood Sugar', 'Bodybuilding Pre-Workout', 
            'Digestion', 'Fat Burners', 'Immune', 'Joint Pain', 'Men Products', 
            'Mood Support', 'Sleep Health', 'Vision Health Support', 'Women Products',
            'CBD Shop', 'General', 'Herbs & Botanicals', 'Vitamins', 'Minerals', 
            'Homeopathic', 'Enzymes', 'Probiotics', 'Amino Acids', 'Specialty Formulas',
            'Liquid Supplements', 'Topical Products', 'Pet Supplements'
        ].map(c => c.toLowerCase());

        // 2. Find "General" category ID or create it
        let generalCategoryId;
        const [generalResult] = await pool.execute('SELECT id FROM product_categories WHERE name = "General"');
        if (generalResult.length > 0) {
            generalCategoryId = generalResult[0].id;
        } else {
            const [insertResult] = await pool.execute('INSERT INTO product_categories (name, slug) VALUES ("General", "general")');
            generalCategoryId = insertResult.insertId;
        }

        console.log(`General category ID: ${generalCategoryId}`);

        // 3. Merge junk categories
        let mergedCount = 0;
        for (const cat of categories) {
            if (cat.name === 'General') continue;

            const nameLower = cat.name.toLowerCase();
            const isJunk = !validCategories.some(valid => nameLower.includes(valid)) || 
                           cat.name.length > 30 || 
                           cat.name.includes('Paging') ||
                           cat.name.includes('Standard Enzyme') && cat.name.length > 20;

            if (isJunk) {
                console.log(`Merging junk category: "${cat.name}" -> General`);
                await pool.execute('UPDATE products SET category_id = ? WHERE category_id = ?', [generalCategoryId, cat.id]);
                await pool.execute('DELETE FROM product_categories WHERE id = ?', [cat.id]);
                mergedCount++;
            }
        }

        // 4. Clean up brands too (remove Paging brands)
        const [pagingBrands] = await pool.execute('SELECT id, name FROM brands WHERE name LIKE "%Paging%"');
        for (const brand of pagingBrands) {
            console.log(`Deleting junk brand: "${brand.name}"`);
            await pool.execute('UPDATE products SET brand_id = 32 WHERE brand_id = ?', [brand.id]); // 32 is Unknown
            await pool.execute('DELETE FROM brands WHERE id = ?', [brand.id]);
        }

        console.log(`\n✅ Finished! Merged ${mergedCount} junk categories and cleaned up brands.`);

    } catch (error) {
        console.error('Cleanup failed:', error.message);
    } finally {
        await pool.end();
    }
}

cleanupCategories();

