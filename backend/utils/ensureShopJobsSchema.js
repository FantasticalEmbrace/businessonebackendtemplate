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

async function ensureColumn(pool, tableName, columnName, ddl) {
    if (await columnExists(pool, tableName, columnName)) return;
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`);
    logger.info(`Database: added ${tableName}.${columnName}`);
}

async function ensureShopJobsSchema(pool) {
    if (!pool) return;
    try {
        if (!(await tableExists(pool, 'pos_shop_jobs'))) {
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
                    customer_id BIGINT UNSIGNED NULL,
                    appointment_id BIGINT UNSIGNED NULL,
                    released_at DATETIME NULL,
                    customer_workflow_json JSON NULL,
                    job_data_json JSON NOT NULL,
                    payment_transaction_id VARCHAR(64) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uk_pos_shop_jobs_portal_token (portal_token),
                    KEY idx_pos_shop_jobs_status (status),
                    KEY idx_pos_shop_jobs_job_type (job_type),
                    KEY idx_pos_shop_jobs_ro_number (ro_number),
                    KEY idx_pos_shop_jobs_customer_id (customer_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            logger.info('Database: created table pos_shop_jobs');
        } else {
            await ensureColumn(pool, 'pos_shop_jobs', 'customer_id', 'customer_id BIGINT UNSIGNED NULL');
            await ensureColumn(pool, 'pos_shop_jobs', 'appointment_id', 'appointment_id BIGINT UNSIGNED NULL');
            await ensureColumn(pool, 'pos_shop_jobs', 'released_at', 'released_at DATETIME NULL');
        }

        if (!(await tableExists(pool, 'pos_shop_appointments'))) {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS pos_shop_appointments (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    job_type VARCHAR(32) NOT NULL DEFAULT 'auto',
                    bay VARCHAR(64) NULL,
                    starts_at DATETIME NOT NULL,
                    ends_at DATETIME NOT NULL,
                    customer_name VARCHAR(200) NOT NULL DEFAULT '',
                    phone VARCHAR(32) NULL,
                    email VARCHAR(200) NULL,
                    vehicle VARCHAR(200) NULL,
                    vin VARCHAR(32) NULL,
                    notes TEXT NULL,
                    job_id BIGINT UNSIGNED NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
                    technician_id BIGINT UNSIGNED NULL,
                    technician_name VARCHAR(200) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    KEY idx_pos_shop_appt_starts (starts_at),
                    KEY idx_pos_shop_appt_job_type (job_type),
                    KEY idx_pos_shop_appt_job_id (job_id),
                    KEY idx_pos_shop_appt_tech (technician_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            logger.info('Database: created table pos_shop_appointments');
        } else {
            await ensureColumn(pool, 'pos_shop_appointments', 'vin', 'vin VARCHAR(32) NULL');
            await ensureColumn(
                pool,
                'pos_shop_appointments',
                'technician_id',
                'technician_id BIGINT UNSIGNED NULL'
            );
            await ensureColumn(
                pool,
                'pos_shop_appointments',
                'technician_name',
                'technician_name VARCHAR(200) NULL'
            );
        }
    } catch (e) {
        logger.warn(`Database: pos_shop_jobs — ${logger.formatMysqlError?.(e) || e.message}`);
    }
}

module.exports = { ensureShopJobsSchema };
