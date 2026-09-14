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

async function ensureAbandonedCartSchema(pool) {
    if (!(await tableExists(pool, 'abandoned_cart_programs'))) {
        try {
            await pool.execute(`
                CREATE TABLE abandoned_cart_programs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(120) NOT NULL,
                    is_active TINYINT(1) NOT NULL DEFAULT 1,
                    is_starter_guide TINYINT(1) NOT NULL DEFAULT 0,
                    sort_order INT NOT NULL DEFAULT 0,
                    min_subtotal DECIMAL(10,2) NULL,
                    max_subtotal DECIMAL(10,2) NULL,
                    delay_value INT NOT NULL DEFAULT 1,
                    delay_unit ENUM('hours', 'days', 'weeks') NOT NULL DEFAULT 'days',
                    trigger_type ENUM('time', 'item_on_sale') NOT NULL DEFAULT 'time',
                    discount_type ENUM('none', 'percent', 'fixed') NOT NULL DEFAULT 'none',
                    discount_value DECIMAL(10,2) NULL,
                    promo_code VARCHAR(64) NULL,
                    email_subject VARCHAR(255) NOT NULL DEFAULT 'You left something in your cart',
                    email_intro TEXT NULL,
                    require_marketing_opt_in TINYINT(1) NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_active_sort (is_active, sort_order)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        } catch (e) {
            logger.warn(`Database: abandoned_cart_programs — ${logger.formatMysqlError(e)}`);
        }
    } else if (!(await columnExists(pool, 'abandoned_cart_programs', 'is_starter_guide'))) {
        try {
            await pool.execute(
                `ALTER TABLE abandoned_cart_programs ADD COLUMN is_starter_guide TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active`
            );
        } catch (e) {
            logger.warn(`Database: abandoned_cart_programs.is_starter_guide — ${logger.formatMysqlError(e)}`);
        }
    }

    if (!(await tableExists(pool, 'abandoned_cart_snapshots'))) {
        try {
            await pool.execute(`
                CREATE TABLE abandoned_cart_snapshots (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NULL,
                    session_id VARCHAR(64) NULL,
                    email VARCHAR(255) NOT NULL,
                    first_name VARCHAR(120) NULL,
                    cart_json JSON NOT NULL,
                    subtotal DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                    abandoned_at DATETIME NOT NULL,
                    last_activity_at DATETIME NOT NULL,
                    status ENUM('active', 'converted', 'suppressed') NOT NULL DEFAULT 'active',
                    converted_at DATETIME NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_email_status (email(190), status),
                    INDEX idx_session_status (session_id, status),
                    INDEX idx_active_activity (status, last_activity_at),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        } catch (e) {
            logger.warn(`Database: abandoned_cart_snapshots — ${logger.formatMysqlError(e)}`);
        }
    } else if (!(await columnExists(pool, 'abandoned_cart_snapshots', 'session_id'))) {
        try {
            await pool.execute(
                `ALTER TABLE abandoned_cart_snapshots
                    ADD COLUMN session_id VARCHAR(64) NULL AFTER user_id,
                    ADD INDEX idx_session_status (session_id, status)`
            );
        } catch (e) {
            logger.warn(`Database: abandoned_cart_snapshots.session_id — ${logger.formatMysqlError(e)}`);
        }
    }

    if (!(await tableExists(pool, 'abandoned_cart_sends'))) {
        try {
            await pool.execute(`
                CREATE TABLE abandoned_cart_sends (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    program_id INT NOT NULL,
                    snapshot_id BIGINT NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    send_status ENUM('sent', 'failed') NOT NULL DEFAULT 'sent',
                    failure_reason VARCHAR(255) NULL,
                    promo_code VARCHAR(64) NULL,
                    discount_type VARCHAR(16) NULL,
                    discount_value DECIMAL(10,2) NULL,
                    subtotal_at_send DECIMAL(10,2) NULL,
                    FOREIGN KEY (program_id) REFERENCES abandoned_cart_programs(id) ON DELETE CASCADE,
                    FOREIGN KEY (snapshot_id) REFERENCES abandoned_cart_snapshots(id) ON DELETE CASCADE,
                    UNIQUE KEY uq_program_snapshot (program_id, snapshot_id),
                    INDEX idx_snapshot (snapshot_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        } catch (e) {
            logger.warn(`Database: abandoned_cart_sends — ${logger.formatMysqlError(e)}`);
        }
    } else {
        if (!(await columnExists(pool, 'abandoned_cart_sends', 'send_status'))) {
            try {
                await pool.execute(
                    `ALTER TABLE abandoned_cart_sends
                        ADD COLUMN send_status ENUM('sent', 'failed') NOT NULL DEFAULT 'sent' AFTER sent_at,
                        ADD COLUMN failure_reason VARCHAR(255) NULL AFTER send_status`
                );
            } catch (e) {
                logger.warn(`Database: abandoned_cart_sends.send_status — ${logger.formatMysqlError(e)}`);
            }
        }
    }

    if (await tableExists(pool, 'shopping_carts')) {
        if (!(await columnExists(pool, 'shopping_carts', 'customer_email'))) {
            try {
                await pool.execute(
                    `ALTER TABLE shopping_carts ADD COLUMN customer_email VARCHAR(255) NULL AFTER session_id`
                );
            } catch (e) {
                logger.warn(`Database: shopping_carts.customer_email — ${logger.formatMysqlError(e)}`);
            }
        }
    }
}

module.exports = { ensureAbandonedCartSchema };
