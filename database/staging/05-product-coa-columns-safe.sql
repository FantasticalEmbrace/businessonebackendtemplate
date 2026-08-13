-- Idempotent COA columns (hosting-safe; skips when column already exists)

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'is_cannabis') = 0,
    'ALTER TABLE products ADD COLUMN is_cannabis TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''Hemp/cannabis product'' AFTER is_featured',
    'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'coa_url') = 0,
    'ALTER TABLE products ADD COLUMN coa_url VARCHAR(500) NULL COMMENT ''COA URL'' AFTER is_cannabis',
    'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'coa_updated_at') = 0,
    'ALTER TABLE products ADD COLUMN coa_updated_at DATE NULL COMMENT ''COA date'' AFTER coa_url',
    'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
