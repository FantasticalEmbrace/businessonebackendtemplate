'use strict';

const logger = require('./logger');

async function ensurePlatformSupportSchema(pool) {
    const hubEnabled =
        String(process.env.POS_PLATFORM_HUB_ENABLED || '').trim().toLowerCase() === 'true';
    if (!hubEnabled) return;

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_platform_support_queue (
                id INT AUTO_INCREMENT PRIMARY KEY,
                merchant_id VARCHAR(64) NOT NULL,
                merchant_name VARCHAR(200) NOT NULL DEFAULT '',
                store_base_url VARCHAR(512) NOT NULL,
                store_session_id INT NOT NULL,
                store_device_id INT NOT NULL,
                device_label VARCHAR(64) NOT NULL DEFAULT '',
                platform VARCHAR(16) NULL,
                session_code VARCHAR(8) NOT NULL,
                status VARCHAR(24) NOT NULL DEFAULT 'pending',
                register_online TINYINT(1) NOT NULL DEFAULT 0,
                claimed_by VARCHAR(200) NULL,
                session_created_at TIMESTAMP NULL,
                expires_at TIMESTAMP NULL,
                synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_platform_support_merchant_session (merchant_id, store_session_id),
                INDEX idx_platform_support_status (status),
                INDEX idx_platform_support_created (session_created_at)
            )`);
        logger.info('Database: pos_platform_support_queue ready');
    } catch (e) {
        logger.warn(`Database: pos_platform_support_queue — ${logger.formatMysqlError(e)}`);
    }
}

module.exports = { ensurePlatformSupportSchema };
