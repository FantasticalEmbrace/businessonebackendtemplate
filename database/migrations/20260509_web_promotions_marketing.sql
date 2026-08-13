-- Web store promotions (codes, rules JSON, usage ledger) + order linkage
-- Safe to re-run (idempotent column adds via INFORMATION_SCHEMA).

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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_web_promotions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS hmherbs_wp_add_column_if_missing;
DELIMITER $$
CREATE PROCEDURE hmherbs_wp_add_column_if_missing(
    IN p_table   VARCHAR(64),
    IN p_column  VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = p_table
          AND COLUMN_NAME  = p_column
    ) THEN
        SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_column, ' ', p_definition);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

CALL hmherbs_wp_add_column_if_missing('orders', 'web_promotion_id', 'INT NULL');
CALL hmherbs_wp_add_column_if_missing('orders', 'promo_code', "VARCHAR(64) NULL");
CALL hmherbs_wp_add_column_if_missing('orders', 'discount_amount', "DECIMAL(10,2) NOT NULL DEFAULT 0.00");

DROP PROCEDURE IF EXISTS hmherbs_wp_add_column_if_missing;
