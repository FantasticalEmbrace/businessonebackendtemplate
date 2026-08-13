#!/usr/bin/env node
/**
 * Test MySQL connectivity using backend/.env (local or Linode Managed MySQL).
 *
 *   cd backend && node scripts/test-db-connection.js
 */
'use strict';

const { loadBackendEnv, buildDbConfig, createConnection, shouldUseSsl } = require('../utils/dbConfig');

async function main() {
    loadBackendEnv();
    const cfg = buildDbConfig();

    console.log('MySQL connection test');
    console.log('  host:', cfg.host);
    console.log('  port:', cfg.port);
    console.log('  user:', cfg.user);
    console.log('  database:', cfg.database);
    console.log('  ssl:', shouldUseSsl() ? 'yes' : 'no');

    const conn = await createConnection();
    try {
        const [rows] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db');
        console.log('\nOK — connected');
        console.log('  version:', rows[0].version);
        console.log('  database:', rows[0].db);

        const [counts] = await conn.query('SELECT COUNT(*) AS n FROM products');
        console.log('  products:', counts[0].n);
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error('\nConnection failed:', err.message);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
        console.error('Check DB_USER and DB_PASSWORD in backend/.env');
    } else if (err.code === 'ECONNREFUSED') {
        console.error('Check DB_HOST, DB_PORT, and that MySQL is running / allow list includes your IP');
    } else if (String(err.message).includes('SSL') || String(err.message).includes('certificate')) {
        console.error('For Linode: set DB_SSL=true and DB_SSL_CA_PATH=./certs/ca-certificate.crt');
    }
    process.exit(1);
});
