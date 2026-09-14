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



async function ensureProgramIntroEmailType(pool) {

    try {

        const [rows] = await pool.query(

            `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS

             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loyalty_email_sends' AND COLUMN_NAME = 'email_type'`

        );

        const colType = String(rows[0]?.COLUMN_TYPE || '');

        if (colType.includes("'program_intro'")) return;

        await pool.execute(

            `ALTER TABLE loyalty_email_sends

             MODIFY COLUMN email_type ENUM('near_tier','promotion','winback','manual','birthday','anniversary','program_intro') NOT NULL`

        );

    } catch (e) {

        logger.warn(`Database: loyalty_email_sends.email_type program_intro — ${logger.formatMysqlError(e)}`);

    }

}



async function ensureLoyaltyTiersSchema(pool) {

    if (!(await tableExists(pool, 'loyalty_tiers'))) {

        try {

            await pool.execute(`

                CREATE TABLE loyalty_tiers (

                    id INT AUTO_INCREMENT PRIMARY KEY,

                    tier_key ENUM('bronze','silver','gold','platinum') NOT NULL,

                    display_name VARCHAR(64) NOT NULL,

                    sort_order INT NOT NULL DEFAULT 0,

                    min_lifetime_spend DECIMAL(10,2) NOT NULL DEFAULT 0.00,

                    min_order_count INT NOT NULL DEFAULT 0,

                    min_points INT NOT NULL DEFAULT 0,

                    require_both_spend_and_orders TINYINT(1) NOT NULL DEFAULT 0,

                    discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,

                    free_shipping TINYINT(1) NOT NULL DEFAULT 0,

                    free_shipping_min_order DECIMAL(10,2) NULL,

                    frequency_bonus_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,

                    perks_json JSON NULL,

                    is_active TINYINT(1) NOT NULL DEFAULT 1,

                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                    UNIQUE KEY uq_loyalty_tier_key (tier_key),

                    INDEX idx_tier_sort (sort_order)

                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

            `);

        } catch (e) {

            logger.warn(`Database: loyalty_tiers — ${logger.formatMysqlError(e)}`);

        }

    }



    if (!(await tableExists(pool, 'loyalty_tier_history'))) {

        try {

            await pool.execute(`

                CREATE TABLE loyalty_tier_history (

                    id BIGINT AUTO_INCREMENT PRIMARY KEY,

                    user_id INT NOT NULL,

                    from_tier VARCHAR(50) NULL,

                    to_tier VARCHAR(50) NOT NULL,

                    reason ENUM('upgrade','downgrade','manual','initial') NOT NULL DEFAULT 'upgrade',

                    lifetime_spend DECIMAL(10,2) NULL,

                    order_count INT NULL,

                    points_balance INT NULL,

                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

                    INDEX idx_tier_hist_user (user_id),

                    INDEX idx_tier_hist_created (created_at)

                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

            `);

        } catch (e) {

            logger.warn(`Database: loyalty_tier_history — ${logger.formatMysqlError(e)}`);

        }

    }



    if (!(await tableExists(pool, 'loyalty_email_sends'))) {

        try {

            await pool.execute(`

                CREATE TABLE loyalty_email_sends (

                    id BIGINT AUTO_INCREMENT PRIMARY KEY,

                    user_id INT NOT NULL,

                    email VARCHAR(255) NOT NULL,

                    email_type ENUM('near_tier','promotion','winback','manual','birthday','anniversary','program_intro') NOT NULL,

                    tier_key VARCHAR(50) NULL,

                    subject VARCHAR(255) NOT NULL,

                    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

                    metadata JSON NULL,

                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

                    INDEX idx_loyalty_email_user_type (user_id, email_type),

                    INDEX idx_loyalty_email_sent (sent_at)

                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

            `);

        } catch (e) {

            logger.warn(`Database: loyalty_email_sends — ${logger.formatMysqlError(e)}`);

        }

    } else {

        await ensureProgramIntroEmailType(pool);

    }



    const settings = [
        ['loyalty_tiers_enabled', 'false', 'Enable Bronze/Silver/Gold/Platinum loyalty tiers', 'boolean'],
        ['loyalty_tiers_enabled_at', '', 'ISO timestamp when loyalty tiers were last enabled (pre-enable backfill anchor)', 'string'],
        ['loyalty_tiers_program_mode', 'cashback', 'Reward program type: cashback or points', 'string'],
        ['loyalty_tiers_mode', 'spend', 'Legacy tier mode alias (spend or points)', 'string'],
        ['loyalty_tiers_email_near_enabled', 'true', 'Send emails when customer is close to next tier', 'boolean'],
        ['loyalty_tiers_email_promotion_enabled', 'true', 'Send emails on tier promotion', 'boolean'],
        ['loyalty_tiers_email_winback_enabled', 'true', 'Send win-back emails based on order frequency', 'boolean'],
        ['loyalty_tiers_email_intro_enabled', 'false', 'Legacy intro toggle — intro sends on program enable transition', 'boolean'],
        ['loyalty_tiers_near_threshold_percent', '85', 'Percent toward next tier to trigger near-tier email', 'number'],
        ['loyalty_tiers_winback_days', '60', 'Days without order before win-back email', 'number'],
        ['loyalty_tiers_points_per_dollar', '1', 'Points earned per dollar (points program)', 'number'],
        ['loyalty_tiers_dollar_per_point', '0.01', 'Dollar value per point when redeeming (points program)', 'number'],
        ['loyalty_tiers_combined_spend_frequency_bonus', 'true', 'Extra cash-back % when lifetime spend and order-count goals are both met (cashback program)', 'boolean'],
        ['loyalty_tiers_min_cashback_redeem', '0', 'Minimum store credit balance required to apply at checkout ($)', 'number'],
        ['loyalty_tiers_birthday_enabled', 'false', 'Birthday bonus emails (stub)', 'boolean'],
        ['loyalty_tiers_referral_enabled', 'false', 'Referral program hook (stub)', 'boolean'],
    ];

    for (const [key, value, description, type] of settings) {

        await pool.execute(

            `INSERT INTO settings (key_name, value, description, type) VALUES (?, ?, ?, ?)

             ON DUPLICATE KEY UPDATE description = VALUES(description)`,

            [key, value, description, type]

        );

    }

}



module.exports = { ensureLoyaltyTiersSchema };


