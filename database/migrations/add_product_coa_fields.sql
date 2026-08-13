-- Certificate of Analysis (COA) for cannabis / hemp products
-- Run once: mysql -u ... -p hmherbs < database/migrations/add_product_coa_fields.sql

ALTER TABLE products
ADD COLUMN is_cannabis TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Hemp/cannabis-derived product requiring COA' AFTER is_featured,
ADD COLUMN coa_url VARCHAR(500) NULL COMMENT 'URL to current COA PDF (same-origin or https)' AFTER is_cannabis,
ADD COLUMN coa_updated_at DATE NULL COMMENT 'Date of COA / batch covered' AFTER coa_url;
