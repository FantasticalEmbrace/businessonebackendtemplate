#!/usr/bin/env node
'use strict';

const { loadBackendEnv } = require('../utils/dbConfig');
loadBackendEnv();

async function main() {
    const mysql = require('mysql2/promise');
    const { buildDbConfig } = require('../utils/dbConfig');
    const pool = mysql.createPool(buildDbConfig({ connectionLimit: 1 }));

    const [rows] = await pool.execute(
        `SELECT key_name, value FROM settings
         WHERE key_name LIKE 'gcal_%' OR key_name LIKE 'gbp_%'
         ORDER BY key_name`
    );

    for (const row of rows) {
        const key = row.key_name;
        const val = String(row.value || '');
        if (key.includes('token')) {
            console.log(`${key}: ${val.length ? `[present, len=${val.length}]` : '[empty]'}`);
        } else {
            console.log(`${key}: ${val || '[empty]'}`);
        }
    }

    if (!rows.length) console.log('(no gcal_/gbp_ settings in DB)');

    await pool.end();
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
