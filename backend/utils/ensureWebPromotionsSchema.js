'use strict';

const logger = require('./logger');

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

async function addColumnIfMissing(pool, tableName, columnName, definition) {
    if (await columnExists(pool, tableName, columnName)) return false;
    await pool.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    return true;
}

/**
 * Ensures web_promotions (+ channel columns) exist for Marketing → Promotions.
 * Covers clean DBs that only applied 20260509 without 20260701.
 * @param {import('mysql2/promise').Pool} pool
 */
async function ensureWebPromotionsSchema(pool) {
    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS web_promotions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                code VARCHAR(64) NOT NULL,
                description VARCHAR(500) DEFAULT '',
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                starts_at DATETIME NULL,
                ends_at DATETIME NULL,
                usage_limit_total INT NULL,
                usage_limit_per_email INT NULL,
                rules JSON NOT NULL,
                applies_web TINYINT(1) NOT NULL DEFAULT 1,
                applies_pos TINYINT(1) NOT NULL DEFAULT 1,
                auto_apply_pos TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_web_promotions_code (code)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const added = [];
        if (
            await addColumnIfMissing(
                pool,
                'web_promotions',
                'applies_pos',
                'TINYINT(1) NOT NULL DEFAULT 1'
            )
        ) {
            added.push('applies_pos');
        }
        if (
            await addColumnIfMissing(
                pool,
                'web_promotions',
                'auto_apply_pos',
                'TINYINT(1) NOT NULL DEFAULT 1'
            )
        ) {
            added.push('auto_apply_pos');
        }
        if (
            await addColumnIfMissing(
                pool,
                'web_promotions',
                'applies_web',
                'TINYINT(1) NOT NULL DEFAULT 1'
            )
        ) {
            added.push('applies_web');
        }
        if (added.length) {
            logger.info(`Database: web_promotions added column(s) ${added.join(', ')}`);
        }

        if (await tableExists(pool, 'orders')) {
            await pool.execute(`
                CREATE TABLE IF NOT EXISTS web_promotion_redemptions (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT,
                    promotion_id INT NOT NULL,
                    order_id INT NULL,
                    email VARCHAR(255) NOT NULL,
                    user_id INT NULL,
                    discount_merchandise DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                    discount_shipping DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (promotion_id) REFERENCES web_promotions(id) ON DELETE CASCADE,
                    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
                    INDEX idx_promo_created (promotion_id, created_at),
                    INDEX idx_promo_email (promotion_id, email(190))
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        }
    } catch (err) {
        logger.warn(`[web-promotions] schema ensure skipped — ${logger.formatMysqlError(err)}`);
    }
}

module.exports = { ensureWebPromotionsSchema };
