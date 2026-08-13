-- Gift card purchase support: product flag + order line metadata
-- Idempotent via INFORMATION_SCHEMA checks (MySQL 5.7+ / MariaDB)

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

CALL hmherbs_add_column_if_missing('products', 'gift_card_type', "ENUM('digital','physical') NULL AFTER is_featured");
CALL hmherbs_add_column_if_missing('order_items', 'metadata', 'JSON NULL AFTER total');

DROP PROCEDURE IF EXISTS hmherbs_add_column_if_missing;
