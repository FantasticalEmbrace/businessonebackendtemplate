'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BACKEND_ROOT } = require('./dbConfig');

const MIGRATIONS_DIR = path.join(BACKEND_ROOT, '..', 'database', 'migrations');

const BENIGN_ERROR_CODES = new Set([
    'ER_DUP_FIELDNAME',
    'ER_DUP_KEYNAME',
    'ER_TABLE_EXISTS_ERROR',
    'ER_DUP_ENTRY',
    'ER_SP_ALREADY_EXISTS',
]);

function splitWithDelimiters(sql) {
    const lines = sql.split(/\r?\n/);
    const cleaned = [];
    let inBlock = false;
    for (const line of lines) {
        let l = line;
        if (inBlock) {
            const end = l.indexOf('*/');
            if (end >= 0) {
                inBlock = false;
                l = l.slice(end + 2);
            } else {
                continue;
            }
        }
        l = l.replace(/\/\*[\s\S]*?\*\//g, '');
        if (l.includes('/*')) {
            inBlock = true;
            l = l.slice(0, l.indexOf('/*'));
        }
        const m = l.match(/^(\s*)(--|#)/);
        if (m) continue;
        cleaned.push(l);
    }
    const text = cleaned.join('\n');

    const statements = [];
    let delimiter = ';';
    let buffer = '';
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine;
        const trimmed = line.trim();
        const dm = /^DELIMITER\s+(\S+)/i.exec(trimmed);
        if (dm) {
            const flushed = buffer.trim();
            if (flushed) statements.push(flushed);
            buffer = '';
            delimiter = dm[1];
            continue;
        }
        buffer += line + '\n';
        while (true) {
            const idx = buffer.indexOf(delimiter);
            if (idx < 0) break;
            const stmt = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + delimiter.length);
            if (stmt) statements.push(stmt);
        }
    }
    const tail = buffer.trim();
    if (tail) statements.push(tail);
    return statements;
}

function fileChecksum(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

async function ensureSchemaMigrationsTable(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            filename VARCHAR(255) NOT NULL,
            checksum VARCHAR(64) NULL,
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_schema_migrations_filename (filename)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function getAppliedMigrations(pool) {
    await ensureSchemaMigrationsTable(pool);
    const [rows] = await pool.query(
        'SELECT filename, checksum, applied_at FROM schema_migrations ORDER BY filename ASC'
    );
    const map = new Map();
    for (const row of rows) {
        map.set(row.filename, {
            checksum: row.checksum,
            appliedAt: row.applied_at,
        });
    }
    return map;
}

function listMigrationFiles() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        return [];
    }
    return fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.toLowerCase().endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b));
}

async function executeMigrationStatements(conn, statements, { filename = 'migration' } = {}) {
    let executed = 0;
    let skipped = 0;
    const details = [];

    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const preview = stmt.replace(/\s+/g, ' ').slice(0, 120);
        try {
            await conn.query(stmt);
            executed++;
            details.push({ index: i + 1, status: 'ok', preview });
        } catch (err) {
            const code = err.code || '';
            if (BENIGN_ERROR_CODES.has(code)) {
                skipped++;
                details.push({ index: i + 1, status: 'skipped', code, preview });
            } else {
                const message = err.message || String(err);
                details.push({ index: i + 1, status: 'failed', code, preview, message });
                throw new Error(`${filename}: statement ${i + 1} failed — ${message}`);
            }
        }
    }

    return { executed, skipped, total: statements.length, details };
}

async function runMigrationFile(pool, filename) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Migration file not found: ${filename}`);
    }

    const sql = fs.readFileSync(filePath, 'utf8');
    const checksum = fileChecksum(sql);
    const statements = splitWithDelimiters(sql);

    const conn = await pool.getConnection();
    try {
        const result = await executeMigrationStatements(conn, statements, { filename });
        await conn.query(
            `INSERT INTO schema_migrations (filename, checksum, applied_at)
             VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), applied_at = NOW()`,
            [filename, checksum]
        );
        return { filename, checksum, ...result };
    } finally {
        conn.release();
    }
}

async function getMigrationStatus(pool) {
    const applied = await getAppliedMigrations(pool);
    const files = listMigrationFiles();
    const migrations = files.map((filename) => {
        const filePath = path.join(MIGRATIONS_DIR, filename);
        const content = fs.readFileSync(filePath, 'utf8');
        const checksum = fileChecksum(content);
        const record = applied.get(filename);
        const status = record ? 'applied' : 'pending';
        const checksumMismatch = record && record.checksum && record.checksum !== checksum;
        return {
            filename,
            status,
            appliedAt: record?.appliedAt || null,
            checksumMismatch: Boolean(checksumMismatch),
        };
    });

    return {
        migrationsDir: MIGRATIONS_DIR,
        total: migrations.length,
        appliedCount: migrations.filter((m) => m.status === 'applied').length,
        pendingCount: migrations.filter((m) => m.status === 'pending').length,
        migrations,
    };
}

async function runPendingMigrations(pool) {
    await ensureSchemaMigrationsTable(pool);
    const status = await getMigrationStatus(pool);
    const pending = status.migrations.filter((m) => m.status === 'pending');
    const results = [];

    for (const item of pending) {
        results.push(await runMigrationFile(pool, item.filename));
    }

    return {
        ran: results.length,
        results,
        status: await getMigrationStatus(pool),
    };
}

module.exports = {
    MIGRATIONS_DIR,
    splitWithDelimiters,
    listMigrationFiles,
    getMigrationStatus,
    runPendingMigrations,
    runMigrationFile,
    executeMigrationStatements,
    ensureSchemaMigrationsTable,
};
