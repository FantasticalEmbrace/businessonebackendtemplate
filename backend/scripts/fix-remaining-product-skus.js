#!/usr/bin/env node
/**
 * Resolve remaining SKU conflicts after bulk catalog fix.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { buildDbConfig } = require('../utils/dbConfig');

/** id -> correct manufacturer/catalog SKU */
const MANUAL_FIXES = {
    59: '00060',
    208: '60',
    354: 'HS-03-ANTI',
    389: '0778',
    579: '85000120-H',
    93: 'DRTONYS-BPS',
    818: 'VL-CBD-FULL',
};

const DEACTIVATE_IDS = [822];

(async () => {
    const apply = process.argv.includes('--apply');
    const conn = await mysql.createConnection(buildDbConfig());

    for (const [id, sku] of Object.entries(MANUAL_FIXES)) {
        const [rows] = await conn.query('SELECT id, sku, name FROM products WHERE id = ?', [id]);
        if (!rows.length) continue;
        console.log(`${apply ? 'UPDATE' : 'PLAN'} #${id}: ${rows[0].sku} -> ${sku} (${rows[0].name})`);
        if (apply) {
            await conn.query('UPDATE products SET sku = ? WHERE id = ?', [sku, id]);
        }
    }

    for (const id of DEACTIVATE_IDS) {
        const [rows] = await conn.query('SELECT id, name FROM products WHERE id = ?', [id]);
        if (!rows.length) continue;
        console.log(`${apply ? 'DEACTIVATE' : 'PLAN DEACTIVATE'} #${id} ${rows[0].name}`);
        if (apply) {
            await conn.query(
                'UPDATE products SET is_active = 0, show_on_web = 0 WHERE id = ?',
                [id]
            );
        }
    }

    await conn.end();
    console.log('Done.');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
