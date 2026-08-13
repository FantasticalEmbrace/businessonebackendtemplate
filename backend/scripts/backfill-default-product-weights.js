#!/usr/bin/env node
/** Set a conservative default weight on active products still missing weight (for Shippo quotes). */
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
loadBackendEnv();
const DEFAULT_OZ = parseFloat(process.env.DEFAULT_PRODUCT_WEIGHT_OZ || '8');
(async () => {
    const p = createPool();
    const [r] = await p.execute(
        `UPDATE products SET weight = ?, weight_unit = 'oz', updated_at = NOW()
         WHERE is_active = 1 AND (weight IS NULL OR weight <= 0)`,
        [DEFAULT_OZ]
    );
    const [[c]] = await p.query(
        'SELECT COUNT(*) n FROM products WHERE is_active=1 AND weight IS NOT NULL AND weight > 0'
    );
    console.log(JSON.stringify({ defaulted: r.affectedRows, withWeight: c.n, defaultOz: DEFAULT_OZ }));
    await p.end();
})();
