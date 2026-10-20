'use strict';

const logger = require('./logger');

const CREATE_SQL = `
    CREATE TABLE IF NOT EXISTS admin_totp (
        admin_user_id INT NOT NULL PRIMARY KEY,
        secret_enc TEXT NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        backup_hashes TEXT NULL,
        failed_attempts INT NOT NULL DEFAULT 0,
        locked_until DATETIME NULL,
        last_step BIGINT NULL,
        enrolled_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

async function ensureAdminTotpSchema(pool) {
    await pool.query(CREATE_SQL);
    logger.info('Database: ensured table admin_totp');
}

module.exports = { ensureAdminTotpSchema };
