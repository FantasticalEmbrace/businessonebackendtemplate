/**
 * Adds password reset token columns on `users` when missing (idempotent).
 * Uses pool.query for DDL — same rationale as ensureProductSchema.js.
 */
const logger = require('./logger');

async function usersTableExists(pool) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
    );
    return Number(rows[0].c) > 0;
}

async function columnExists(pool, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
        [columnName]
    );
    return Number(rows[0].c) > 0;
}

async function indexExists(pool, indexName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = ?`,
        [indexName]
    );
    return Number(rows[0].c) > 0;
}

async function ensureUserPasswordResetSchema(pool) {
    try {
        if (!(await usersTableExists(pool))) {
            logger.warn('Database: users table not found; skipping password reset column patches');
            return;
        }
    } catch (e) {
        logger.warn(`Database: could not inspect users table — ${logger.formatMysqlError(e)}`);
        return;
    }

    const patches = [
        {
            column: 'password_reset_token',
            sql: 'ALTER TABLE users ADD COLUMN password_reset_token VARCHAR(255) NULL'
        },
        {
            column: 'password_reset_token_expires',
            sql: 'ALTER TABLE users ADD COLUMN password_reset_token_expires TIMESTAMP NULL'
        }
    ];

    for (const { column, sql } of patches) {
        try {
            if (await columnExists(pool, column)) continue;
            await pool.query(sql);
            logger.info(`Database: users table updated (added column ${column})`);
        } catch (e) {
            logger.warn(`Database: could not add users.${column} — ${logger.formatMysqlError(e)}`);
        }
    }

    try {
        if (await indexExists(pool, 'idx_users_password_reset_token')) return;
        await pool.query('CREATE INDEX idx_users_password_reset_token ON users (password_reset_token)');
        logger.info('Database: users table updated (index idx_users_password_reset_token)');
    } catch (e) {
        logger.warn(`Database: could not create password_reset_token index — ${logger.formatMysqlError(e)}`);
    }
}

module.exports = { ensureUserPasswordResetSchema };
