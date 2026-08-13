/**
 * Adds columns expected by current API code when an older `products` table is in use.
 * Safe to run on every startup (skips when column already exists).
 *
 * Uses pool.query() for DDL — pool.execute() uses the binary prepared-statement
 * protocol, which commonly fails on ALTER TABLE (seen as repeated patch warnings).
 */
const logger = require('./logger');

const PATCHES = [
    { column: 'is_cannabis', sql: 'ALTER TABLE products ADD COLUMN is_cannabis BOOLEAN NOT NULL DEFAULT FALSE' },
    { column: 'coa_url', sql: 'ALTER TABLE products ADD COLUMN coa_url VARCHAR(500) NULL' },
    { column: 'coa_updated_at', sql: 'ALTER TABLE products ADD COLUMN coa_updated_at DATE NULL' }
];

async function productsTableExists(pool) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'`
    );
    return Number(rows[0].c) > 0;
}

async function columnExists(pool, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = ?`,
        [columnName]
    );
    return Number(rows[0].c) > 0;
}

function isDuplicateColumnError(e) {
    if (!e) return false;
    if (e.errno === 1060) return true;
    if (e.code === 'ER_DUP_FIELDNAME') return true;
    if (e.sqlState === '42S21') return true;
    if (e.message && /duplicate column name/i.test(e.message)) return true;
    return false;
}

async function ensureProductSchema(pool) {
    try {
        if (!(await productsTableExists(pool))) {
            logger.warn('Database: products table not found; skipping column patches');
            return;
        }
    } catch (e) {
        logger.warn(
            `Database: could not inspect schema for products table — ${logger.formatMysqlError(e)}`
        );
        return;
    }

    for (const { column, sql } of PATCHES) {
        try {
            if (await columnExists(pool, column)) {
                continue;
            }
            await pool.query(sql);
            logger.info(`Database: products table updated (added column ${column})`);
        } catch (e) {
            if (isDuplicateColumnError(e)) {
                continue;
            }
            logger.warn(`Database: could not apply products column patch — ${logger.formatMysqlError(e)}`);
        }
    }
}

module.exports = { ensureProductSchema };
