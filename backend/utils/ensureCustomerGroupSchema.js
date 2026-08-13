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
    if (await columnExists(pool, tableName, columnName)) return;
    await pool.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

/**
 * Ensures customer_groups + user_customer_groups tables exist, plus discount columns.
 * @param {import('mysql2/promise').Pool} pool
 */
async function ensureCustomerGroupSchema(pool) {
    if (!(await tableExists(pool, 'users'))) return;

    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS customer_groups (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL,
                slug VARCHAR(100) NOT NULL UNIQUE,
                description TEXT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_customer_groups_slug (slug),
                INDEX idx_customer_groups_active (is_active)
            )
        `);

        await addColumnIfMissing(
            pool,
            'customer_groups',
            'discount_type',
            "ENUM('none','percent','fixed') NOT NULL DEFAULT 'none'"
        );
        await addColumnIfMissing(pool, 'customer_groups', 'discount_value', 'DECIMAL(10,2) NULL');
        await addColumnIfMissing(pool, 'customer_groups', 'discount_label', 'VARCHAR(100) NULL');
        await addColumnIfMissing(
            pool,
            'customer_groups',
            'discount_applies_web',
            'TINYINT(1) NOT NULL DEFAULT 1'
        );
        await addColumnIfMissing(
            pool,
            'customer_groups',
            'discount_applies_pos',
            'TINYINT(1) NOT NULL DEFAULT 1'
        );

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS user_customer_groups (
                user_id INT NOT NULL,
                customer_group_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, customer_group_id),
                INDEX idx_ucg_group (customer_group_id),
                CONSTRAINT fk_ucg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_ucg_group FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
            )
        `);

        if (await tableExists(pool, 'web_promotions')) {
            await pool.execute(`
                CREATE TABLE IF NOT EXISTS customer_group_promotions (
                    customer_group_id INT NOT NULL,
                    promotion_id INT NOT NULL,
                    auto_apply TINYINT(1) NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (customer_group_id, promotion_id),
                    INDEX idx_cgp_promotion (promotion_id),
                    CONSTRAINT fk_cgp_group FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id) ON DELETE CASCADE,
                    CONSTRAINT fk_cgp_promotion FOREIGN KEY (promotion_id) REFERENCES web_promotions(id) ON DELETE CASCADE
                )
            `);
        }
    } catch (err) {
        logger.warn(`[customer-groups] schema ensure skipped — ${logger.formatMysqlError(err)}`);
    }
}

module.exports = { ensureCustomerGroupSchema };
