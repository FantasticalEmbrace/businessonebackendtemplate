'use strict';

const logger = require('./logger');

const PRODUCT_PATCHES = [
    {
        column: 'show_on_web',
        sql: `ALTER TABLE products ADD COLUMN show_on_web TINYINT(1) NOT NULL DEFAULT 1
              COMMENT '1=visible on website catalog; 0=in-store/POS only' AFTER is_featured`
    }
];

async function tableExists(pool, tableName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return Number(rows[0].c) > 0;
}

async function columnExists(pool, tableName, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows[0].c) > 0;
}

function isDuplicateColumnError(e) {
    if (!e) return false;
    return e.errno === 1060 || e.code === 'ER_BAD_FIELDNAME' || (e.message && /duplicate column name/i.test(e.message));
}

async function ensureProductStorefrontSchema(pool) {
    if (!(await tableExists(pool, 'products'))) return;

    for (const { column, sql } of PRODUCT_PATCHES) {
        try {
            if (await columnExists(pool, 'products', column)) continue;
            await pool.query(sql);
            logger.info(`Database: products updated (added column ${column})`);
        } catch (e) {
            if (!isDuplicateColumnError(e)) {
                logger.warn(`Database: could not patch products.${column} — ${logger.formatMysqlError(e)}`);
            }
        }
    }
}

module.exports = { ensureProductStorefrontSchema };
