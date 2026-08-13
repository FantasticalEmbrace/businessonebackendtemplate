'use strict';

const logger = require('./logger');
const { KEYS, DEFAULTS } = require('./inventorySettings');

const SEED_ROWS = [
    {
        key: KEYS.globalLowStockThreshold,
        value: String(DEFAULTS.globalLowStockThreshold),
        description: 'Default low-stock warning threshold when a product has no per-item threshold',
        type: 'number'
    },
    {
        key: KEYS.allowOversell,
        value: 'false',
        description: 'Allow website sales when inventory is zero (per-product allow_backorder can also enable)',
        type: 'boolean'
    },
    {
        key: KEYS.hideOutOfStock,
        value: 'false',
        description: 'Hide out-of-stock products from category/browse grids (product pages still work by direct link)',
        type: 'boolean'
    }
];

async function ensureInventorySettings(pool) {
    for (const row of SEED_ROWS) {
        try {
            await pool.query(
                `INSERT IGNORE INTO settings (key_name, value, description, type) VALUES (?, ?, ?, ?)`,
                [row.key, row.value, row.description, row.type]
            );
        } catch (e) {
            logger.warn(`Database: inventory setting ${row.key} — ${logger.formatMysqlError(e)}`);
        }
    }
}

module.exports = { ensureInventorySettings };
