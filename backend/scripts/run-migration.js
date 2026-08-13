// Run a single MySQL migration file using the server's DB credentials.
// Handles client-side DELIMITER directives (which the mysql2 driver does not).
// Usage:
//   node scripts/run-migration.js ../database/migrations/<file>.sql

const { loadBackendEnv, createConnection } = require('../utils/dbConfig');
const fs = require('fs');
const path = require('path');
const {
    splitWithDelimiters,
    executeMigrationStatements,
    ensureSchemaMigrationsTable,
} = require('../utils/migrationRunner');
const crypto = require('crypto');

async function main() {
    loadBackendEnv();
    const arg = process.argv[2];
    if (!arg) {
        console.error('Usage: node scripts/run-migration.js <path-to-sql-file>');
        process.exit(1);
    }
    const filePath = path.resolve(process.cwd(), arg);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }
    const sql = fs.readFileSync(filePath, 'utf8');
    const statements = splitWithDelimiters(sql);
    const filename = path.basename(filePath);
    const checksum = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');

    const conn = await createConnection();
    await ensureSchemaMigrationsTable(conn);

    console.log(`Running ${statements.length} statement(s) from ${filename}...`);
    try {
        const result = await executeMigrationStatements(conn, statements, { filename });
        await conn.query(
            `INSERT INTO schema_migrations (filename, checksum, applied_at)
             VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), applied_at = NOW()`,
            [filename, checksum]
        );
        console.log(
            `\nDone. Executed: ${result.executed}, Skipped: ${result.skipped}, Total: ${result.total}`
        );
    } catch (err) {
        console.error(err.message || err);
        process.exit(1);
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
