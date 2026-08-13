const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixBrandsAndDuplicates() {
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
        console.log('🧹 Starting brand repair and duplicate removal...');

        const knownBrands = [
            { name: 'Standard Enzyme', keywords: ['Standard Enzyme'] },
            { name: 'Newton Labs', keywords: ['Newton Labs', 'Newton Homeopathics'] },
            { name: 'Terry Naturally', keywords: ['Terry Naturally', 'Terry Nat'] },
            { name: 'Dr. Tony', keywords: ['Dr. Tony', 'Dr Tonys'] },
            { name: "Doctor's Blend", keywords: ["Doctor's Blend", 'Doctors Blend', 'Doctor Blend'] },
            { name: 'Regalabs', keywords: ['Regalabs', 'Regal Labs'] },
            { name: 'Now Foods', keywords: ['Now Foods', 'Now C-1000', 'Now Liquid', 'Now Glutathione'] },
            { name: "Nature's Sunshine", keywords: ["Nature's Sunshine", 'Ns ', 'Natures Sunshine'] },
            { name: "Nature's Plus", keywords: ["Nature's Plus", 'Natures Plus', 'Natures P '] },
            { name: "Nature's Balance", keywords: ["Nature's Balance", 'Natures Balance'] },
            { name: "Life's Fortune", keywords: ["Life's Fortune", 'Life Fortune'] },
            { name: 'Life Extension', keywords: ['Life Extension', 'Life Ext ', 'Life Ext'] },
            { name: 'Global Healing', keywords: ['Global Healing'] },
            { name: 'Edom Labs', keywords: ['Edom Labs', 'Edom Chiro'] },
            { name: 'Flexcin', keywords: ['Flexcin'] },
            { name: 'BioNeurix', keywords: ['BioNeurix', 'Bioneurix'] },
            { name: 'AC Grace', keywords: ['AC Grace', 'A C Grace', 'C Grace'] },
            { name: 'Purple Tiger', keywords: ['Purple Tiger'] },
            { name: 'Skinny Magic', keywords: ['Skinny Magic'] },
            { name: 'HI-Tech', keywords: ['HI-Tech', 'Hi Tech', 'HI Tech Pharmaceutical'] },
            { name: 'Unicity', keywords: ['Unicity'] },
            { name: 'Vista Life', keywords: ['Vista Life'] },
            { name: 'Host Defence', keywords: ['Host Defence', 'Host Defense'] },
            { name: 'North American Herb & Spice', keywords: ['North American', 'Namerican'] },
            { name: "Perrin's Naturals", keywords: ["Perrin's Naturals", 'Perrins', "Perrin's"] },
            { name: "Our Father's Healing Herbs", keywords: ["Our Father's Healing Herbs", 'Our Fathers'] },
            { name: 'Carlson', keywords: ['Carlson'] },
            { name: 'Enzymedica', keywords: ['Enzymedica'] },
            { name: 'Gold Star', keywords: ['Gold Star'] },
            { name: 'Hippie Jacks', keywords: ['Hippie Jacks', 'Hippie Jack\'s'] },
            { name: 'Irwin', keywords: ['Irwin'] },
            { name: 'Life Flo', keywords: ['Life Flo'] },
            { name: 'MD Science', keywords: ['MD Science', 'Md Science'] },
            { name: 'Natural Balance', keywords: ['Natural Balance'] },
            { name: 'Oxylife', keywords: ['Oxylife', 'Oxy Life'] },
            { name: 'Buried Treasure', keywords: ['Buried Treasure'] },
            { name: 'Hemp Bombs', keywords: ['Hemp Bombs'] },
            { name: 'Herbs For Life', keywords: ['Herbs For Life', 'Herbs Life'] }
        ];

        // 1. Re-assign brands
        console.log('🏷️  Re-assigning brands...');
        const [products] = await pool.execute('SELECT id, name FROM products');
        let brandUpdates = 0;

        for (const product of products) {
            let targetBrandName = null;
            for (const brand of knownBrands) {
                if (brand.keywords.some(k => product.name.toLowerCase().includes(k.toLowerCase()))) {
                    targetBrandName = brand.name;
                    break;
                }
            }

            if (targetBrandName) {
                // Get or create brand ID
                const slug = targetBrandName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                await pool.execute('INSERT IGNORE INTO brands (name, slug) VALUES (?, ?)', [targetBrandName, slug]);
                const [[brandRow]] = await pool.execute('SELECT id FROM brands WHERE name = ?', [targetBrandName]);
                
                await pool.execute('UPDATE products SET brand_id = ? WHERE id = ?', [brandRow.id, product.id]);
                brandUpdates++;
            }
        }
        console.log(`✅ Updated ${brandUpdates} products with correct brands.`);

        // 2. Remove duplicates
        console.log('🔍 Identifying duplicates...');
        const [allRows] = await pool.execute('SELECT id, name, sku, price, long_description FROM products');
        const groups = {};
        allRows.forEach(r => {
            const norm = r.name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
            if (!groups[norm]) groups[norm] = [];
            groups[norm].push(r);
        });

        const idsToDelete = [];
        for (const [norm, group] of Object.entries(groups)) {
            if (group.length > 1) {
                // Keep the one with description and non-25 price
                const sorted = [...group].sort((a, b) => {
                    const aIs25 = parseFloat(a.price) === 25.00;
                    const bIs25 = parseFloat(b.price) === 25.00;
                    const aHasDesc = a.long_description && a.long_description.length > 50;
                    const bHasDesc = b.long_description && b.long_description.length > 50;

                    if (aIs25 !== bIs25) return aIs25 ? 1 : -1;
                    if (aHasDesc !== bHasDesc) return aHasDesc ? -1 : 1;
                    return b.id - a.id;
                });

                const kept = sorted[0];
                const dups = sorted.slice(1);
                console.log(`\nGroup: "${kept.name}"`);
                console.log(`  KEEP: ID ${kept.id}, Price: $${kept.price}, Desc: ${kept.long_description ? 'YES' : 'NO'}`);
                dups.forEach(d => {
                    console.log(`  DELETE: ID ${d.id}, Price: $${d.price}, Desc: ${d.long_description ? 'YES' : 'NO'}`);
                    idsToDelete.push(d.id);
                });
            }
        }

        if (idsToDelete.length > 0) {
            console.log(`\n🚀 Deleting ${idsToDelete.length} duplicates...`);
            await pool.execute(`DELETE FROM products WHERE id IN (${idsToDelete.join(',')})`);
            console.log('✅ Duplicates removed.');
        } else {
            console.log('No duplicates found.');
        }

        console.log('✨ Brand repair and duplicate removal complete!');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

fixBrandsAndDuplicates();

