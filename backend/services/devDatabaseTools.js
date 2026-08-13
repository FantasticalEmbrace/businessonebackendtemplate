'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const { buildDbConfig, resolveCaPath } = require('../utils/dbConfig');

function escapeSqlValue(value) {
    if (value === null || value === undefined) return 'NULL';
    if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
    if (value instanceof Date) {
        return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
    }
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'object') {
        return `'${JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }
    return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function findMysqldump() {
    const candidates = ['mysqldump'];
    if (process.platform === 'win32') {
        candidates.push(
            'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe',
            'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe',
            'C:\\xampp\\mysql\\bin\\mysqldump.exe'
        );
    }
    for (const bin of candidates) {
        if (bin === 'mysqldump') return bin;
        if (fs.existsSync(bin)) return bin;
    }
    return 'mysqldump';
}

function buildMysqldumpEnv(config) {
    const env = { ...process.env };
    if (config.password) {
        env.MYSQL_PWD = config.password;
    }
    return env;
}

function buildMysqldumpArgs(config, caPath) {
    const args = [
        '-h',
        config.host,
        '-P',
        String(config.port),
        '-u',
        config.user,
        '--single-transaction',
        '--routines',
        '--triggers',
        '--set-gtid-purged=OFF',
        '--default-character-set=utf8mb4',
        config.database,
    ];
    if (caPath) {
        args.push(`--ssl-ca=${caPath}`, '--ssl-mode=REQUIRED');
    }
    return args;
}

function mysqldumpAvailable() {
    return new Promise((resolve) => {
        const bin = findMysqldump();
        const proc = spawn(bin, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
        proc.on('error', () => resolve(false));
        proc.on('close', (code) => resolve(code === 0));
    });
}

async function streamMysqldump(config, caPath, writeChunk) {
    const bin = findMysqldump();
    const args = buildMysqldumpArgs(config, caPath);
    const env = buildMysqldumpEnv(config);

    return new Promise((resolve, reject) => {
        const proc = spawn(bin, args, { env });
        let stderr = '';

        proc.stdout.on('data', (chunk) => writeChunk(chunk));
        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        proc.on('error', (err) => reject(err));
        proc.on('close', (code) => {
            if (code === 0) resolve({ method: 'mysqldump' });
            else reject(new Error(stderr.trim() || `mysqldump exited with code ${code}`));
        });
    });
}

async function streamNodeBackup(pool, databaseName, writeChunk) {
    const header = `-- HM Herbs node backup\n-- Database: ${databaseName}\n-- Generated: ${new Date().toISOString()}\n\nSET FOREIGN_KEY_CHECKS=0;\n\n`;
    writeChunk(Buffer.from(header, 'utf8'));

    const [tables] = await pool.query('SHOW TABLES');
    const tableKey = `Tables_in_${databaseName}`;

    for (const row of tables) {
        const tableName = row[tableKey];
        const [createRows] = await pool.query(`SHOW CREATE TABLE \`${tableName}\``);
        const createSql = createRows[0]['Create Table'];
        writeChunk(Buffer.from(`DROP TABLE IF EXISTS \`${tableName}\`;\n${createSql};\n\n`, 'utf8'));

        const [countRows] = await pool.query(`SELECT COUNT(*) AS c FROM \`${tableName}\``);
        const total = Number(countRows[0].c);
        if (total === 0) continue;

        const batchSize = 200;
        for (let offset = 0; offset < total; offset += batchSize) {
            const [rows] = await pool.query(`SELECT * FROM \`${tableName}\` LIMIT ? OFFSET ?`, [
                batchSize,
                offset,
            ]);
            if (!rows.length) break;
            const columns = Object.keys(rows[0]).map((c) => `\`${c}\``).join(', ');
            for (const record of rows) {
                const values = Object.values(record).map(escapeSqlValue).join(', ');
                writeChunk(Buffer.from(`INSERT INTO \`${tableName}\` (${columns}) VALUES (${values});\n`, 'utf8'));
            }
        }
        writeChunk(Buffer.from('\n', 'utf8'));
    }

    writeChunk(Buffer.from('SET FOREIGN_KEY_CHECKS=1;\n', 'utf8'));
    return { method: 'node' };
}

async function createDatabaseBackupStream(pool, writeChunk) {
    const config = buildDbConfig();
    let caPath = null;
    try {
        caPath = resolveCaPath();
    } catch {
        caPath = null;
    }

    const available = await mysqldumpAvailable();
    if (available) {
        try {
            return await streamMysqldump(config, caPath, writeChunk);
        } catch {
            /* fall back to built-in exporter */
        }
    }
    return await streamNodeBackup(pool, config.database, writeChunk);
}

async function getDevToolsStatus(pool) {
    const { getMigrationStatus } = require('../utils/migrationRunner');
    const config = buildDbConfig();
    const migrationStatus = await getMigrationStatus(pool);
    const dumpAvailable = await mysqldumpAvailable();

    return {
        database: {
            host: config.host,
            name: config.database,
            ssl: Boolean(config.ssl),
        },
        backup: {
            mysqldumpAvailable: dumpAvailable,
            fallbackMethod: 'node',
        },
        migrations: migrationStatus,
    };
}

module.exports = {
    createDatabaseBackupStream,
    getDevToolsStatus,
};
