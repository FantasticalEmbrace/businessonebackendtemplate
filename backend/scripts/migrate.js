#!/usr/bin/env node
/**
 * Run all pending SQL migrations tracked in schema_migrations.
 * Usage: npm run migrate
 */
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { runPendingMigrations } = require('../utils/migrationRunner');

async function main() {
    loadBackendEnv();
    const pool = await createPool();
    try {
        const result = await runPendingMigrations(pool);
        if (!result.ran) {
            console.log('No pending migrations.');
        } else {
            console.log(`Applied ${result.ran} migration(s):`);
            for (const row of result.results) {
                console.log(
                    `  - ${row.filename} (executed ${row.executed}, skipped ${row.skipped})`
                );
            }
        }
        const pending = result.status.migrations.filter((m) => m.status === 'pending');
        if (pending.length) {
            console.warn(`Warning: ${pending.length} migration(s) still pending.`);
            process.exit(1);
        }
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
