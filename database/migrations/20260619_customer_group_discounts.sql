-- Customer group standing discounts + linked checkout promotions

DROP PROCEDURE IF EXISTS hmherbs_cg_add_column_if_missing;
DELIMITER $$
CREATE PROCEDURE hmherbs_cg_add_column_if_missing(
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

CALL hmherbs_cg_add_column_if_missing('customer_groups', 'discount_type', "ENUM('none','percent','fixed') NOT NULL DEFAULT 'none'");
CALL hmherbs_cg_add_column_if_missing('customer_groups', 'discount_value', 'DECIMAL(10,2) NULL');
CALL hmherbs_cg_add_column_if_missing('customer_groups', 'discount_label', 'VARCHAR(100) NULL');
CALL hmherbs_cg_add_column_if_missing('customer_groups', 'discount_applies_web', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL hmherbs_cg_add_column_if_missing('customer_groups', 'discount_applies_pos', 'TINYINT(1) NOT NULL DEFAULT 1');

DROP PROCEDURE IF EXISTS hmherbs_cg_add_column_if_missing;

CREATE TABLE IF NOT EXISTS customer_group_promotions (
    customer_group_id INT NOT NULL,
    promotion_id INT NOT NULL,
    auto_apply TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_group_id, promotion_id),
    INDEX idx_cgp_promotion (promotion_id),
    CONSTRAINT fk_cgp_group FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_cgp_promotion FOREIGN KEY (promotion_id) REFERENCES web_promotions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
