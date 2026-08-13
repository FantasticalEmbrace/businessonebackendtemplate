const mysql = require('mysql2/promise');
require('dotenv').config();

async function cleanupDuplicates() {
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
        console.log('🧹 Starting cleanup of duplicate products...');
        
        const [rows] = await pool.execute(`
            SELECT id, sku, name, price, long_description
            FROM products
        `);

        const groups = {};
        rows.forEach(row => {
            // Normalize name: remove " SKU: ..." and trim
            let coreName = row.name.replace(/ SKU:.*$/i, '').trim().toLowerCase();
            if (!groups[coreName]) groups[coreName] = [];
            groups[coreName].push(row);
        });

        const idsToDelete = [];
        let totalProcessed = 0;
        let totalDuplicates = 0;

        for (const [coreName, group] of Object.entries(groups)) {
            if (group.length > 1) {
                totalDuplicates++;
                
                // Sort group to help identify the best one
                // Priority: 
                // 1. Price is NOT 25.00
                // 2. Has long_description
                // 3. Higher ID (likely more recent/accurate scrape)
                
                const sorted = [...group].sort((a, b) => {
                    const aIs25 = parseFloat(a.price) === 25.00;
                    const bIs25 = parseFloat(b.price) === 25.00;
                    
                    const aHasDesc = a.long_description && a.long_description.length > 20;
                    const bHasDesc = b.long_description && b.long_description.length > 20;

                    // If one is 25 and other isn't, non-25 wins
                    if (aIs25 !== bIs25) {
                        return aIs25 ? 1 : -1;
                    }
                    
                    // If one has desc and other doesn't, has-desc wins
                    if (aHasDesc !== bHasDesc) {
                        return aHasDesc ? -1 : 1;
                    }
                    
                    // Otherwise higher ID wins
                    return b.id - a.id;
                });

                const kept = sorted[0];
                const duplicates = sorted.slice(1);

                console.log(`\nGroup: "${coreName}"`);
                console.log(`  KEEPing: ID ${kept.id}, SKU: ${kept.sku}, Price: $${kept.price}, Has Desc: ${kept.long_description && kept.long_description.length > 20 ? 'YES' : 'NO'}`);
                
                duplicates.forEach(dup => {
                    console.log(`  DELETE: ID ${dup.id}, SKU: ${dup.sku}, Price: $${dup.price}, Has Desc: ${dup.long_description && dup.long_description.length > 20 ? 'YES' : 'NO'}`);
                    idsToDelete.push(dup.id);
                });
            }
            totalProcessed++;
        }

        console.log(`\nFound ${idsToDelete.length} duplicate entries to delete across ${totalDuplicates} product groups.`);

        if (idsToDelete.length > 0) {
            // Actually delete
            console.log('\n🚀 Applying deletions...');
            
            // Delete in chunks to avoid large query issues
            const chunkSize = 50;
            for (let i = 0; i < idsToDelete.length; i += chunkSize) {
                const chunk = idsToDelete.slice(i, i + chunkSize);
                await pool.execute(`
                    DELETE FROM products 
                    WHERE id IN (${chunk.join(',')})
                `);
                console.log(`Deleted ${i + chunk.length}/${idsToDelete.length}...`);
            }
            
            console.log('✅ Cleanup complete!');
        } else {
            console.log('No duplicates found to delete.');
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

cleanupDuplicates();

