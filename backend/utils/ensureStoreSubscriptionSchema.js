'use strict';

const logger = require('./logger');

const PRODUCT_PATCHES = [
    {
        column: 'subscription_eligible',
        sql: `ALTER TABLE products ADD COLUMN subscription_eligible TINYINT(1) NOT NULL DEFAULT 0
              COMMENT 'Customer may subscribe to auto-ship this product'`,
    },
    {
        column: 'subscription_interval_days',
        sql: `ALTER TABLE products ADD COLUMN subscription_interval_days INT NOT NULL DEFAULT 30
              COMMENT 'Default days between subscription shipments'`,
    },
    {
        column: 'subscription_discount_percent',
        sql: `ALTER TABLE products ADD COLUMN subscription_discount_percent DECIMAL(5,2) NULL DEFAULT NULL
              COMMENT 'Percent off unit price when customer subscribes (0-100)'`,
    },
];

async function columnExists(pool, tableName, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows[0].c) > 0;
}

async function tableExists(pool, tableName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return Number(rows[0].c) > 0;
}

async function ensureStoreSubscriptionSchema(pool) {
    for (const patch of PRODUCT_PATCHES) {
        try {
            if (await columnExists(pool, 'products', patch.column)) continue;
            await pool.execute(patch.sql);
        } catch (e) {
            logger.warn(`Database: products.${patch.column} — ${logger.formatMysqlError(e)}`);
        }
    }

    if (!(await tableExists(pool, 'customer_subscriptions'))) {
        try {
            await pool.execute(`
                CREATE TABLE customer_subscriptions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    product_id INT NOT NULL,
                    variant_id INT NULL,
                    quantity INT NOT NULL DEFAULT 1,
                    interval_days INT NOT NULL DEFAULT 30,
                    unit_price DECIMAL(10,2) NOT NULL,
                    payment_card_id INT NOT NULL,
                    status ENUM('active', 'paused', 'cancelled', 'past_due') NOT NULL DEFAULT 'active',
                    next_charge_at DATE NOT NULL,
                    initial_order_id INT NULL,
                    last_order_id INT NULL,
                    shipping_json JSON NULL,
                    failure_count INT NOT NULL DEFAULT 0,
                    last_failure_at DATETIME NULL,
                    last_failure_reason VARCHAR(255) NULL,
                    cancelled_at DATETIME NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_user_status (user_id, status),
                    INDEX idx_next_charge (status, next_charge_at),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
                    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL,
                    FOREIGN KEY (payment_card_id) REFERENCES payment_cards(id) ON DELETE RESTRICT,
                    FOREIGN KEY (initial_order_id) REFERENCES orders(id) ON DELETE SET NULL,
                    FOREIGN KEY (last_order_id) REFERENCES orders(id) ON DELETE SET NULL
                )
            `);
        } catch (e) {
            logger.warn(`Database: customer_subscriptions — ${logger.formatMysqlError(e)}`);
        }
    }
}

module.exports = { ensureStoreSubscriptionSchema };
