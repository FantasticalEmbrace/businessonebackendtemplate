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

async function ensureShopJobsSchema(pool) {
    if (!pool) return;
    try {
        if (await tableExists(pool, 'pos_shop_jobs')) return;
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_shop_jobs (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                portal_token VARCHAR(96) NOT NULL,
                ro_number VARCHAR(32) NOT NULL,
                job_type VARCHAR(32) NOT NULL DEFAULT 'auto',
                status VARCHAR(32) NOT NULL DEFAULT 'estimate',
                customer_name VARCHAR(200) NOT NULL DEFAULT '',
                phone VARCHAR(32) NULL,
                email VARCHAR(200) NULL,
                vehicle VARCHAR(200) NULL,
                concern TEXT NULL,
                total DECIMAL(12,2) NOT NULL DEFAULT 0,
                approved TINYINT(1) NOT NULL DEFAULT 0,
                paid TINYINT(1) NOT NULL DEFAULT 0,
                alignment_type VARCHAR(16) NULL,
                alignment_done TINYINT(1) NOT NULL DEFAULT 0,
                alignment_skipped TINYINT(1) NOT NULL DEFAULT 0,
                customer_workflow_json JSON NULL,
                job_data_json JSON NOT NULL,
                payment_transaction_id VARCHAR(64) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_pos_shop_jobs_portal_token (portal_token),
                KEY idx_pos_shop_jobs_status (status),
                KEY idx_pos_shop_jobs_job_type (job_type),
                KEY idx_pos_shop_jobs_ro_number (ro_number)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        logger.info('Database: created table pos_shop_jobs');
    } catch (e) {
        logger.warn(`Database: pos_shop_jobs — ${logger.formatMysqlError?.(e) || e.message}`);
    }
}

module.exports = { ensureShopJobsSchema };
