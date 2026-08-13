/**
 * Adds variant matrix columns when missing (JSON option groups + variant attributes).
 */
const logger = require('./logger');

const PRODUCT_PATCHES = [
    {
        column: 'variant_option_groups',
        sql: 'ALTER TABLE products ADD COLUMN variant_option_groups JSON NULL',
    },
];

const VARIANT_PATCHES = [
    {
        column: 'attributes',
        sql: 'ALTER TABLE product_variants ADD COLUMN attributes JSON NULL',
    },
    {
        column: 'cost_price',
        sql: 'ALTER TABLE product_variants ADD COLUMN cost_price DECIMAL(10,2) NULL DEFAULT NULL AFTER compare_price',
    },
    {
        column: 'image_url',
        sql: 'ALTER TABLE product_variants ADD COLUMN image_url VARCHAR(500) NULL DEFAULT NULL AFTER cost_price',
    },
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
    return e.errno === 1060 || e.code === 'ER_DUP_FIELDNAME' || /duplicate column name/i.test(e.message || '');
}

async function applyPatches(pool, tableName, patches) {
    if (!(await tableExists(pool, tableName))) {
        logger.warn(`Database: ${tableName} table not found; skipping variant schema patches`);
        return;
    }
    for (const { column, sql } of patches) {
        try {
            if (await columnExists(pool, tableName, column)) continue;
            await pool.query(sql);
            logger.info(`Database: ${tableName} updated (added column ${column})`);
        } catch (e) {
            if (isDuplicateColumnError(e)) continue;
            logger.warn(`Database: variant schema patch failed — ${logger.formatMysqlError(e)}`);
        }
    }
}

async function ensureProductVariantSchema(pool) {
    await applyPatches(pool, 'products', PRODUCT_PATCHES);
    await applyPatches(pool, 'product_variants', VARIANT_PATCHES);
}

module.exports = { ensureProductVariantSchema };
