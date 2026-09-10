-- Product variant matrix: option groups on product, attributes on each variant row.
-- MySQL 8.0 does not support ADD COLUMN IF NOT EXISTS on all versions; use procedure-safe checks.

SET @db := DATABASE();

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'products' AND COLUMN_NAME = 'variant_option_groups'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE products ADD COLUMN variant_option_groups JSON NULL COMMENT ''Option dimensions e.g. Size, Form, Pack count''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'attributes'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE product_variants ADD COLUMN attributes JSON NULL COMMENT ''Selected option values for this SKU''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
