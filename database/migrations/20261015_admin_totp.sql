-- Additive: authenticator secrets and one-time backup codes for admin accounts.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
