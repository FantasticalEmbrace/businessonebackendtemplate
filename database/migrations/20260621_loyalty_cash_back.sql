-- Cash-back store credit loyalty alongside points-based rewards
-- Migration: 20260621

DROP PROCEDURE IF EXISTS hmherbs_add_column_if_missing;
DELIMITER $$
CREATE PROCEDURE hmherbs_add_column_if_missing(
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

CALL hmherbs_add_column_if_missing('customer_loyalty', 'cash_balance',
    "DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER points_balance");
CALL hmherbs_add_column_if_missing('customer_loyalty', 'lifetime_cash_earned',
    "DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER lifetime_points_redeemed");
CALL hmherbs_add_column_if_missing('customer_loyalty', 'lifetime_cash_redeemed',
    "DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER lifetime_cash_earned");
CALL hmherbs_add_column_if_missing('customer_loyalty', 'loyalty_enrollment',
    "ENUM('cash','points','both') NOT NULL DEFAULT 'cash' AFTER lifetime_cash_redeemed");

CALL hmherbs_add_column_if_missing('loyalty_transactions', 'reward_type',
    "ENUM('points','cash') NOT NULL DEFAULT 'points' AFTER transaction_type");
CALL hmherbs_add_column_if_missing('loyalty_transactions', 'cash_change',
    "DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER points_balance_after");
CALL hmherbs_add_column_if_missing('loyalty_transactions', 'cash_balance_after',
    "DECIMAL(10,2) NULL AFTER cash_change");

INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('loyalty_cash_enabled', 'true', 'Enable cash-back store credit loyalty rewards', 'boolean'),
('loyalty_points_enabled', 'true', 'Enable points-based loyalty rewards', 'boolean'),
('loyalty_cashback_percent', '5', 'Cash-back percent earned on eligible purchase subtotals', 'number');

DROP PROCEDURE IF EXISTS hmherbs_add_column_if_missing;
