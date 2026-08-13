-- POS auto-apply promotions + manual discount toggle (default off at register)

DROP PROCEDURE IF EXISTS hmherbs_pos_promo_add_column;
DELIMITER $$
CREATE PROCEDURE hmherbs_pos_promo_add_column(
    IN p_table VARCHAR(64),
    IN p_column VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table
          AND COLUMN_NAME = p_column
    ) THEN
        SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_column, ' ', p_definition);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

CALL hmherbs_pos_promo_add_column('web_promotions', 'applies_pos', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL hmherbs_pos_promo_add_column('web_promotions', 'auto_apply_pos', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL hmherbs_pos_promo_add_column('web_promotions', 'applies_web', 'TINYINT(1) NOT NULL DEFAULT 1');

DROP PROCEDURE IF EXISTS hmherbs_pos_promo_add_column;

INSERT INTO settings (key_name, value, description, type)
SELECT 'pos_allow_manual_discounts', 'false', 'Allow cashiers to apply manual line or cart discounts on the register', 'boolean'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key_name = 'pos_allow_manual_discounts');
