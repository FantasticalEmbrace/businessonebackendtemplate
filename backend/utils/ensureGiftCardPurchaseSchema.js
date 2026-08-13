'use strict';

const logger = require('./logger');

const PRODUCT_PATCHES = [
    {
        column: 'gift_card_type',
        sql: "ALTER TABLE products ADD COLUMN gift_card_type ENUM('digital','physical') NULL AFTER is_featured"
    }
];

const ORDER_ITEM_PATCHES = [
    { column: 'metadata', sql: 'ALTER TABLE order_items ADD COLUMN metadata JSON NULL AFTER total' }
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
    return e.errno === 1060 || e.code === 'ER_DUP_FIELDNAME' || (e.message && /duplicate column name/i.test(e.message));
}

async function applyPatches(pool, tableName, patches) {
    if (!(await tableExists(pool, tableName))) return;
    for (const { column, sql } of patches) {
        try {
            if (await columnExists(pool, tableName, column)) continue;
            await pool.query(sql);
            logger.info(`Database: ${tableName} updated (added column ${column})`);
        } catch (e) {
            if (!isDuplicateColumnError(e)) {
                logger.warn(`Database: could not patch ${tableName}.${column} — ${logger.formatMysqlError(e)}`);
            }
        }
    }
}

async function ensureGiftCardPurchaseSchema(pool) {
    await applyPatches(pool, 'products', PRODUCT_PATCHES);
    await applyPatches(pool, 'order_items', ORDER_ITEM_PATCHES);
}

module.exports = { ensureGiftCardPurchaseSchema };
