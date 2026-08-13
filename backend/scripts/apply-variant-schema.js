const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { ensureProductVariantSchema } = require('../utils/ensureProductVariantSchema');
loadBackendEnv();
(async () => {
    const pool = createPool();
    await ensureProductVariantSchema(pool);
    console.log('variant schema patches applied');
    await pool.end();
})();
