'use strict';

const logger = require('./logger');

async function columnExists(pool, tableName, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows[0].c) > 0;
}

async function ensureTableOAuthColumns(pool, tableName) {
    if (!(await columnExists(pool, tableName, 'auth_provider'))) {
        await pool.query(
            `ALTER TABLE ${tableName}
             ADD COLUMN auth_provider VARCHAR(20) NOT NULL DEFAULT 'local',
             ADD COLUMN oauth_subject VARCHAR(255) NULL`
        );
        logger.info(`Database: added OAuth columns on ${tableName}`);
    }
    try {
        await pool.query(
            `ALTER TABLE ${tableName} MODIFY COLUMN password_hash VARCHAR(255) NULL`
        );
    } catch (e) {
        logger.warn(`Database: could not nullable password_hash on ${tableName}`, e.message);
    }
    try {
        await pool.query(
            `CREATE INDEX idx_${tableName}_oauth ON ${tableName} (auth_provider, oauth_subject)`
        );
    } catch (e) {
        if (e.code !== 'ER_DUP_KEYNAME') throw e;
    }
}

async function ensureSocialOAuthSchema(pool) {
    try {
        await ensureTableOAuthColumns(pool, 'users');
        await ensureTableOAuthColumns(pool, 'admin_users');
    } catch (e) {
        logger.warn(`ensureSocialOAuthSchema: ${logger.formatMysqlError(e)}`);
    }
}

module.exports = { ensureSocialOAuthSchema };
