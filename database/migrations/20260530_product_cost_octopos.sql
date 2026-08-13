-- Product cost + Octopos link (idempotent via INFORMATION_SCHEMA)

SET @db = DATABASE();

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'products' AND COLUMN_NAME = 'cost_price') = 0,
    'ALTER TABLE products ADD COLUMN cost_price DECIMAL(10,2) NULL DEFAULT NULL AFTER compare_price',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'products' AND COLUMN_NAME = 'octopos_product_id') = 0,
    'ALTER TABLE products ADD COLUMN octopos_product_id INT NULL DEFAULT NULL AFTER cost_price',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'products' AND COLUMN_NAME = 'cost_synced_at') = 0,
    'ALTER TABLE products ADD COLUMN cost_synced_at TIMESTAMP NULL DEFAULT NULL AFTER octopos_product_id',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
