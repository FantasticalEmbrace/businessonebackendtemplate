-- Per-employee manual discount permission (default off; automatic promotions still apply)

DROP PROCEDURE IF EXISTS hmherbs_pos_emp_add_column;
DELIMITER $$
CREATE PROCEDURE hmherbs_pos_emp_add_column(
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

CALL hmherbs_pos_emp_add_column(
    'pos_employees',
    'allow_manual_discounts',
    'TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''May apply manual line or cart discounts at register'''
);

DROP PROCEDURE IF EXISTS hmherbs_pos_emp_add_column;

-- Preserve prior store-wide setting for existing employees
UPDATE pos_employees e
SET e.allow_manual_discounts = 1
WHERE EXISTS (
    SELECT 1 FROM settings s
    WHERE s.key_name = 'pos_allow_manual_discounts'
      AND LOWER(TRIM(s.value)) IN ('true', '1')
);
