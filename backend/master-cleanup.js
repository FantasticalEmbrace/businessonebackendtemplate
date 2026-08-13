const mysql = require('mysql2/promise');
require('dotenv').config();

async function masterCleanup() {
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
        console.log('🚀 Starting Master Database Cleanup...');

        // 1. Expanded Brand Keywords
        const brandRules = [
            { name: 'Standard Enzyme', keywords: ['Standard Enzyme', 'SE '] },
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
            { name: 'North American Herb & Spice', keywords: ['North American', 'Namerican', 'THRES. N.'] },
            { name: "Perrin's Naturals", keywords: ["Perrin's Naturals", 'Perrins', "Perrin's"] },
            { name: "Our Father's Healing Herbs", keywords: ["Our Father's Healing Herbs", 'Our Fathers'] },
            { name: 'Carlson', keywords: ['Carlson'] },
            { name: 'Enzymedica', keywords: ['Enzymedica'] },
            { name: 'Gold Star', keywords: ['Gold Star'] },
            { name: 'Hippie Jacks', keywords: ['Hippie Jacks', 'Hippie Jack\'s'] },
            { name: 'Irwin', keywords: ['Irwin'] },
            { name: 'Life Flo', keywords: ['Life Flo'] },
            { name: 'MD Science', keywords: ['MD Science', 'Md Science', 'MD Swiss'] },
            { name: 'Natural Balance', keywords: ['Natural Balance'] },
            { name: 'Oxylife', keywords: ['Oxylife', 'Oxy Life'] },
            { name: 'Buried Treasure', keywords: ['Buried Treasure'] },
            { name: 'Hemp Bombs', keywords: ['Hemp Bombs'] },
            { name: 'Herbs For Life', keywords: ['Herbs For Life', 'Herbs Life'] }
        ];

        // 2. Identify Junk Products
        console.log('🗑️  Removing junk products...');
        const [junk] = await pool.execute(`
            SELECT id FROM products 
            WHERE sku LIKE 'HM-%CCMPAGINGP%' 
            OR name IN ('Shop', 'Featured Products', 'Search', 'All Products')
        `);
        if (junk.length > 0) {
            await pool.execute(`DELETE FROM products WHERE id IN (${junk.map(j => j.id).join(',')})`);
            console.log(`✅ Deleted ${junk.length} junk entries.`);
        }

        // 3. Re-assign Brands
        console.log('🏷️  Re-assigning brands...');
        const [products] = await pool.execute('SELECT id, name FROM products');
        let brandUpdates = 0;
        for (const p of products) {
            let found = null;
            for (const b of brandRules) {
                if (b.keywords.some(k => p.name.toLowerCase().includes(k.toLowerCase()))) {
                    found = b.name;
                    break;
                }
            }
            if (found) {
                const slug = found.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                await pool.execute('INSERT IGNORE INTO brands (name, slug) VALUES (?, ?)', [found, slug]);
                const [[br]] = await pool.execute('SELECT id FROM brands WHERE name = ?', [found]);
                await pool.execute('UPDATE products SET brand_id = ? WHERE id = ?', [br.id, p.id]);
                brandUpdates++;
            }
        }
        console.log(`✅ Updated ${brandUpdates} brands.`);

        // 4. Duplicate Removal (Smart Sorting)
        console.log('🔍 Identifying duplicates...');
        const [all] = await pool.execute('SELECT id, name, sku, price, long_description FROM products');
        const groups = {};
        all.forEach(r => {
            const norm = r.name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
            if (!groups[norm]) groups[norm] = [];
            groups[norm].push(r);
        });

        const toDel = [];
        for (const [norm, group] of Object.entries(groups)) {
            if (group.length > 1) {
                const sorted = [...group].sort((a, b) => {
                    const ap = parseFloat(a.price);
                    const bp = parseFloat(b.price);
                    
                    // 1. Prefer non-zero price
                    if ((ap === 0) !== (bp === 0)) return ap === 0 ? 1 : -1;
                    
                    // 2. Prefer non-25 price (unless all are 25)
                    if ((ap === 25) !== (bp === 25)) return ap === 25 ? 1 : -1;
                    
                    // 3. Prefer having description
                    const ad = a.long_description && a.long_description.length > 50;
                    const bd = b.long_description && b.long_description.length > 50;
                    if (ad !== bd) return ad ? -1 : 1;
                    
                    // 4. Prefer higher ID (more recent)
                    return b.id - a.id;
                });
                
                sorted.slice(1).forEach(d => toDel.push(d.id));
            }
        }

        if (toDel.length > 0) {
            await pool.execute(`DELETE FROM products WHERE id IN (${toDel.join(',')})`);
            console.log(`✅ Deleted ${toDel.length} duplicate entries.`);
        }

        console.log('✨ Cleanup complete!');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

masterCleanup();

