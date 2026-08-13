// Quick test to check if database tables exist
const { loadBackendEnv, createPool } = require('./utils/dbConfig');

loadBackendEnv();
const pool = createPool({ connectionLimit: 2 });

async function testTables() {
    const tables = ['products', 'brands', 'product_categories', 'admin_users'];
    
    for (const table of tables) {
        try {
            await pool.execute(`SELECT 1 FROM ${table} LIMIT 1`);
            console.log(`✅ Table '${table}' exists`);
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE' || error.errno === 1146) {
                console.log(`❌ Table '${table}' does NOT exist`);
            } else {
                console.log(`⚠️  Error checking '${table}': ${error.message}`);
            }
        }
    }
    
    await pool.end();
}

testTables().catch(console.error);

