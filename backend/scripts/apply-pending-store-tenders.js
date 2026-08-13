#!/usr/bin/env node
'use strict';
const { createPool } = require('../utils/dbConfig');

async function main() {
    const pool = createPool({ connectionLimit: 1 });
    const [cols] = await pool.execute(
        "SHOW COLUMNS FROM orders LIKE 'pending_store_tenders'"
    );
    if (cols.length) {
        console.log('Column already exists');
        await pool.end();
        return;
    }
    await pool.execute(
        "ALTER TABLE orders ADD COLUMN pending_store_tenders JSON NULL COMMENT 'Wallet tenders to apply when card payment captures'"
    );
    console.log('Migration applied: pending_store_tenders');
    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
