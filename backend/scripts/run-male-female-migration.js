#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');

loadBackendEnv();

(async () => {
    const sqlPath = path.join(__dirname, '../../database/migrations/20260630_male_female_categories.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const pool = createPool();
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        try {
            await pool.query(stmt);
        } catch (e) {
            if (!/duplicate/i.test(e.message)) console.error(e.message);
        }
    }
    await pool.end();
    console.log('migration ok');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
