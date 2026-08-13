const mysql = require('mysql2/promise');
require('dotenv').config();

async function finalCategoryFix() {
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
        console.log('🏁 Final category mapping...');

        const mappings = [
            { junk: 'Advanced Blood Pressure Cherry', real: 'Blood Pressure' },
            { junk: 'Doctors Blend Blood Sugar', real: 'Blood Sugar' },
            { junk: 'Dr Tonys Blood Sugar', real: 'Blood Sugar' },
            { junk: 'Doctors Blend 5 1 Immune Bo', real: 'Immune' },
            { junk: 'Life Fortune Immune Pro 6', real: 'Immune' },
            { junk: 'Life Fortune Vitamins 2', real: 'Vitamins' },
            { junk: 'Natures P Immune', real: 'Immune' },
            { junk: 'Ns Herbal Trace Minerals', real: 'Minerals' },
            { junk: 'Regalabs Multi Vitamins', real: 'Vitamins' },
            { junk: 'Standard Enzyme Venus Fly Trap', real: 'General' }
        ];

        for (const m of mappings) {
            const [realCat] = await pool.execute('SELECT id FROM product_categories WHERE name = ?', [m.real]);
            if (realCat.length > 0) {
                const [junkCat] = await pool.execute('SELECT id FROM product_categories WHERE name = ?', [m.junk]);
                if (junkCat.length > 0) {
                    console.log(`Mapping "${m.junk}" -> "${m.real}"`);
                    await pool.execute('UPDATE products SET category_id = ? WHERE category_id = ?', [realCat[0].id, junkCat[0].id]);
                    await pool.execute('DELETE FROM product_categories WHERE id = ?', [junkCat[0].id]);
                }
            }
        }

        console.log('✅ Done.');
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

finalCategoryFix();

