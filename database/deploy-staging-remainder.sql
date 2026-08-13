-- ########## Web promotions ##########
-- Source: 20260509_web_promotions_marketing.sql

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
CALL hmherbs_wp_add_column_if_missing('orders', 'promo_code', 'VARCHAR(64) NULL');
CALL hmherbs_wp_add_column_if_missing('orders', 'discount_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');

DROP PROCEDURE IF EXISTS hmherbs_wp_add_column_if_missing;


-- ########## CBD category and product assignments ##########
-- Source: 20260612_cbd_category.sql

-- CBD category: product + health taxonomy, assign existing hemp/CBD catalog items

INSERT INTO product_categories (name, slug, description, sort_order, is_active)
SELECT 'CBD', 'cbd', 'Hemp-derived CBD oils, gummies, topicals, and wellness products', 16, 1
WHERE NOT EXISTS (SELECT 1 FROM product_categories WHERE slug = 'cbd');

INSERT INTO health_categories (name, slug, description, sort_order, is_active)
SELECT 'CBD', 'cbd', 'Premium hemp and CBD products for natural wellness support', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM health_categories WHERE slug = 'cbd');

-- Categories display alphabetically by name; clear legacy sort_order on CBD if re-run
UPDATE health_categories SET sort_order = 0 WHERE slug = 'cbd';

UPDATE products p
JOIN product_categories pc ON pc.slug = 'cbd'
SET p.category_id = pc.id, p.is_cannabis = 1
WHERE p.slug IN (
    'hemp-bombs-cbd-gummies-w-mushroom',
    'herbs-for-life-cbd-gummies-30mg',
    'herbs-for-life-cbd-gummies-sleep',
    'herbs-for-life-delta-9-gummies-10mg-ea',
    'hippie-jack-s-cbd-extreme-1000mg-pain-cream',
    'hippie-jack-s-yummy-hemp-gummie',
    'regalabs-cannabis-care-cream-free-shipping',
    'regalabs-cannabis-care-roll-on',
    'regalabs-cannabis-oil-for-pets',
    'regalabs-full-spectrum-cbd-gummies',
    'regalabs-organic-cbd-oils'
)
OR p.is_cannabis = 1
OR LOWER(p.name) LIKE '%cbd%'
OR LOWER(p.name) LIKE '%cannabis%'
OR LOWER(p.slug) LIKE '%cbd%'
OR LOWER(p.slug) LIKE '%cannabis%'
OR LOWER(p.slug) LIKE '%delta-9%'
OR LOWER(p.slug) LIKE '%hemp-gumm%';

INSERT IGNORE INTO product_health_categories (product_id, health_category_id)
SELECT p.id, hc.id
FROM products p
JOIN health_categories hc ON hc.slug = 'cbd'
WHERE p.category_id = (SELECT id FROM product_categories WHERE slug = 'cbd' LIMIT 1);


-- ########## CBD COA URLs (Hemp Bombs, Hippie Jack Yummy Hemp) ##########
-- Source: 20260612_cbd_coa_urls.sql

-- COA files pulled from legacy hmherbs.com (see backend/scripts/fetch-coa-from-old-site.js).
-- Only sets coa_url when not already populated.

UPDATE products SET coa_url = '/images/coa/hippie-jacks-yummy-hemp-gummie-coa.pdf', coa_updated_at = '2026-06-12', is_cannabis = 1
WHERE slug = 'hippie-jack-s-yummy-hemp-gummie' AND (coa_url IS NULL OR TRIM(coa_url) = '');

UPDATE products SET coa_url = '/images/coa/hemp-bombs-cbd-gummies-w-mushroom-coas.html', coa_updated_at = '2026-06-12', is_cannabis = 1
WHERE slug = 'hemp-bombs-cbd-gummies-w-mushroom' AND (coa_url IS NULL OR TRIM(coa_url) = '');


-- ########## Remove Vista Life CBD products from catalog ##########
-- Source: 20260604_remove_vista_life_cbd_products.sql

-- Remove Vista Life CBD products from the public catalog (non-CBD Vista Life items remain).

UPDATE products
SET is_active = 0,
    is_cannabis = 0,
    is_featured = 0
WHERE slug IN (
    'vista-life-cbd-25mg-capsules',
    'vista-life-cbd-25mg-gummies',
    'vista-life-cbd-dead-sea-mud-mask',
    'vista-life-cbd-oil-full-spectrum'
);

DELETE phc
FROM product_health_categories phc
INNER JOIN products p ON p.id = phc.product_id
INNER JOIN health_categories hc ON hc.id = phc.health_category_id
WHERE hc.slug = 'cbd'
  AND p.slug IN (
    'vista-life-cbd-25mg-capsules',
    'vista-life-cbd-25mg-gummies',
    'vista-life-cbd-dead-sea-mud-mask',
    'vista-life-cbd-oil-full-spectrum'
);


-- ########## Regal Labs COA URLs (Cannabis Care + Organic CBD Oils) ##########
-- Source: 20260604_regal_labs_coa_urls.sql

-- Regal Labs COA assets are hosted under /images/coa/ (HTML index + PDF/JPG files).

UPDATE products
SET coa_url = '/images/coa/regalabs-cannabis-care-coa.html',
    coa_updated_at = '2026-06-04',
    is_cannabis = 1
WHERE slug IN ('regalabs-cannabis-care-cream-free-shipping', 'regalabs-cannabis-care-roll-on');

UPDATE products
SET coa_url = '/images/coa/regalabs-organic-cbd-oils-coas.html',
    coa_updated_at = '2026-06-04',
    is_cannabis = 1
WHERE slug = 'regalabs-organic-cbd-oils';


-- ########## Regal Labs CBD Gummies COA ##########
-- Source: 20260603_regal_labs_cbd_gummies_coa.sql

-- Regal Labs Full Spectrum CBD Gummies COA (PDF in /images/coa/).

UPDATE products
SET coa_url = '/images/coa/Regal Labs - CBD Gummies COA.pdf',
    coa_updated_at = '2026-06-03',
    is_cannabis = 1
WHERE slug = 'regalabs-full-spectrum-cbd-gummies';


-- ########## Regal Labs Pet CBD Oil COA ##########
-- Source: 20260619_regal_labs_pet_cbd_oil_coa.sql

-- Regal Labs Cannabis Oil for Pets COA (PDF in /images/coa/).

UPDATE products
SET coa_url = '/images/coa/Pet CBD Oil.pdf',
    coa_updated_at = '2026-06-19',
    is_cannabis = 1
WHERE slug = 'regalabs-cannabis-oil-for-pets';


-- ########## Customer groups ##########
-- Source: 20260612_customer_groups.sql

-- Customer groups for promotions, pricing rules, and admin segmentation

CREATE TABLE IF NOT EXISTS customer_groups (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_customer_groups_slug (slug),
    INDEX idx_customer_groups_active (is_active)
);

CREATE TABLE IF NOT EXISTS user_customer_groups (
    user_id INT NOT NULL,
    customer_group_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, customer_group_id),
    INDEX idx_ucg_group (customer_group_id),
    CONSTRAINT fk_ucg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_ucg_group FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
);


-- ########## Customer password reset (hosting-safe) ##########
-- Source: 14-users-password-reset-safe.sql

-- Customer password reset columns (idempotent)

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_reset_token') = 0,
    'ALTER TABLE users ADD COLUMN password_reset_token VARCHAR(255) NULL',
    'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_reset_token_expires') = 0,
    'ALTER TABLE users ADD COLUMN password_reset_token_expires TIMESTAMP NULL',
    'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_password_reset_token') = 0,
    'CREATE INDEX idx_users_password_reset_token ON users (password_reset_token)',
    'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ########## add_product_coa_fields ##########
-- Source: add_product_coa_fields.sql

-- Certificate of Analysis (COA) for cannabis / hemp products
-- Run once: mysql -u ... -p hmherbs < database/migrations/add_product_coa_fields.sql

ALTER TABLE products
ADD COLUMN is_cannabis TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Hemp/cannabis-derived product requiring COA' AFTER is_featured,
ADD COLUMN coa_url VARCHAR(500) NULL COMMENT 'URL to current COA PDF (same-origin or https)' AFTER is_cannabis,
ADD COLUMN coa_updated_at DATE NULL COMMENT 'Date of COA / batch covered' AFTER coa_url;


-- ########## add_payment_cards ##########
-- Source: add_payment_cards.sql

-- Payment Card Tokenization Table
-- Stores tokenized payment cards securely (PCI compliant)
-- Never stores actual card numbers - only tokens from payment processors

CREATE TABLE IF NOT EXISTS payment_cards (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    
    -- Payment Processor Information
    payment_processor ENUM('stripe', 'square', 'paypal') DEFAULT 'stripe',
    payment_token VARCHAR(255) NOT NULL, -- Token from payment processor (e.g., Stripe card ID)
    payment_method_id VARCHAR(255), -- Payment method ID from processor
    
    -- Card Display Information (last 4 digits only, safe to store)
    last4 VARCHAR(4) NOT NULL,
    brand VARCHAR(50), -- visa, mastercard, amex, discover, etc.
    exp_month INT,
    exp_year INT,
    
    -- Cardholder Information
    cardholder_name VARCHAR(255),
    billing_address_id INT, -- Reference to user_addresses table
    
    -- Status
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    fingerprint VARCHAR(255), -- Processor's card fingerprint for duplicate detection
    metadata JSON, -- Additional processor-specific data
    
    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL, -- Soft delete
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (billing_address_id) REFERENCES user_addresses(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_payment_token (payment_token),
    INDEX idx_is_default (is_default),
    INDEX idx_is_active (is_active),
    INDEX idx_deleted_at (deleted_at)
);

-- Add payment method reference to orders table
ALTER TABLE orders 
ADD COLUMN payment_method_id INT NULL,
ADD COLUMN payment_token VARCHAR(255) NULL,
ADD COLUMN payment_processor VARCHAR(50) NULL,
ADD FOREIGN KEY (payment_method_id) REFERENCES payment_cards(id) ON DELETE SET NULL;


-- ########## 20260623_pending_store_tenders ##########
-- Source: 20260623_pending_store_tenders.sql

-- Defer wallet redemptions until card payment succeeds (web split checkout)
-- Migration: 20260623

ALTER TABLE orders
    ADD COLUMN pending_store_tenders JSON NULL
        COMMENT 'Wallet tenders to apply when card payment captures';


-- ########## 20260622_pos_split_payment_tenders ##########
-- Source: 20260622_pos_split_payment_tenders.sql

-- Split / partial payment tenders for in-store POS orders
-- Migration: 20260622

CREATE TABLE IF NOT EXISTS order_payment_tenders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    tender_type ENUM('cash','card_terminal','check','gift_card','loyalty_cash','loyalty_points') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    loyalty_points INT NULL,
    gift_card_id INT NULL,
    payment_reference VARCHAR(120) NULL,
    cash_tendered DECIMAL(10,2) NULL,
    cash_change DECIMAL(10,2) NULL,
    check_number VARCHAR(32) NULL,
    terminal_last_four VARCHAR(4) NULL,
    terminal_auth_code VARCHAR(64) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    INDEX idx_order_tenders_order (order_id),
    INDEX idx_order_tenders_type (tender_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ########## 20260621_loyalty_cash_back ##########
-- Source: 20260621_loyalty_cash_back.sql

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


-- ########## 20260620_menu_services_metadata ##########
-- Source: 20260620_menu_services_metadata.sql

-- Extended metadata for Business One public service menu
ALTER TABLE menu_items
    ADD COLUMN icon_class VARCHAR(100) NULL COMMENT 'Font Awesome icon class' AFTER category,
    ADD COLUMN overview TEXT NULL COMMENT 'Long-form service overview' AFTER description,
    ADD COLUMN features_json JSON NULL COMMENT 'Array of feature bullet strings' AFTER overview;

UPDATE menu_items SET
    icon_class = 'fas fa-cash-register',
    overview = 'Our Point of Sale systems are designed to help businesses of all sizes manage their sales operations efficiently. With real-time inventory tracking, comprehensive reporting, and seamless payment integration, you can focus on growing your business while we handle the technology.',
    features_json = JSON_ARRAY(
        'Real-time inventory tracking',
        'Sales reporting and analytics',
        'Multi-location support',
        'Customer management',
        'Integration with payment processors',
        'Mobile and tablet compatible'
    )
WHERE item_id = 'pos';

UPDATE menu_items SET
    icon_class = 'fas fa-credit-card',
    overview = 'Accept payments seamlessly with our secure payment processing solutions. We offer competitive rates, multiple payment methods including credit cards, debit cards, and digital wallets. Our 24/7 fraud monitoring ensures your transactions are always secure.',
    features_json = JSON_ARRAY(
        'Competitive processing rates',
        'Secure payment gateway',
        'Multiple payment methods',
        '24/7 fraud monitoring',
        'Quick settlement times',
        'Dedicated account manager'
    )
WHERE item_id = 'payment';

UPDATE menu_items SET
    icon_class = 'fas fa-phone-alt',
    overview = 'Stay connected with clients and team members using our advanced business phone systems. Our hold queue technology ensures customers never hear continuous ringing or busy signals, providing a professional experience. Features include voicemail to email, call forwarding, conference calling, and mobile app integration.',
    features_json = JSON_ARRAY(
        'Professional hold queues',
        'Voicemail to email',
        'Call forwarding and routing',
        'Conference calling',
        'Mobile app integration',
        'Unlimited calling plans'
    )
WHERE item_id = 'phone';

UPDATE menu_items SET
    icon_class = 'fas fa-globe',
    overview = 'Establish a strong online presence with our professional website development services. We create responsive, SEO-optimized websites that work seamlessly across all devices. Whether you need a simple business site or a full e-commerce platform, we have the expertise to bring your vision to life.',
    features_json = JSON_ARRAY(
        'Responsive design',
        'SEO optimization',
        'Content management system',
        'E-commerce integration',
        'Mobile-first approach',
        'Ongoing support and maintenance'
    )
WHERE item_id = 'website';


-- ########## 20260619_pos_gift_cards_parent ##########
-- Source: 20260619_pos_gift_cards_parent.sql

-- POS hierarchy: Gift Cards as a top-level parent (alongside Supplements and CBD).

UPDATE product_categories
SET parent_id = NULL
WHERE slug = 'gift-cards';


-- ########## 20260619_pos_employee_can_open_drawer ##########
-- Source: 20260619_pos_employee_can_open_drawer.sql

ALTER TABLE pos_employees
    ADD COLUMN can_open_drawer TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'May manually open cash drawer from register (Admin/Developer sets)';


-- ########## 20260619_customer_group_discounts ##########
-- Source: 20260619_customer_group_discounts.sql

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

CALL hmherbs_cg_add_column_if_missing('customer_groups', 'discount_type', 'ENUM(''none'',''percent'',''fixed'') NOT NULL DEFAULT ''none''');
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


-- ########## 20260618_pos_supplements_parent ##########
-- Source: 20260618_pos_supplements_parent.sql

-- POS / catalog hierarchy: Supplements parent with existing categories nested under it.
-- CBD stays a top-level category (slug cbd).

INSERT INTO product_categories (name, slug, description, sort_order, is_active, parent_id)
SELECT 'Supplements', 'supplements', 'Vitamins, herbs, minerals, and wellness products', 0, 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM product_categories WHERE slug = 'supplements');

UPDATE product_categories child
JOIN product_categories parent ON parent.slug = 'supplements'
SET child.parent_id = parent.id
WHERE child.slug <> 'supplements'
  AND child.slug <> 'cbd'
  AND child.slug <> 'gift-cards'
  AND child.parent_id IS NULL;


-- ########## 20260618_pos_employee_can_process_refunds ##########
-- Source: 20260618_pos_employee_can_process_refunds.sql

-- Per-employee permission to process POS refunds (granted in Personnel profile).
ALTER TABLE pos_employees
    ADD COLUMN can_process_refunds TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'May process in-store POS refunds with their register PIN';

-- Preserve refund ability for employees who already had manager approval.
UPDATE pos_employees SET can_process_refunds = 1 WHERE can_authorize = 1;


-- ########## 20260617_product_show_on_web ##########
-- Source: 20260617_product_show_on_web.sql

-- Products can be sold in-store (POS) but hidden from the public website.
ALTER TABLE products
  ADD COLUMN show_on_web TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '1=visible on website catalog; 0=in-store/POS only'
  AFTER is_featured;


-- ########## 20260617_pos_payment_methods ##########
-- Source: 20260617_pos_payment_methods.sql

-- POS payment method toggles + website (host) cash discount settings
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_payment_cash_enabled', 'true', 'Allow cash payments on Business One POS', 'boolean'),
('pos_payment_check_enabled', 'true', 'Allow check payments on Business One POS', 'boolean'),
('pos_payment_card_enabled', 'true', 'Allow card terminal payments on Business One POS', 'boolean'),
('store_cash_discount_enabled', 'false', 'Enable website/host cash discount (card price vs lower cash price)', 'boolean'),
('store_cash_discount_percent', '0', 'Website cash discount percent off merchandise (max 15)', 'number');


-- ########## 20260616_pos_security_controls ##########
-- Source: 20260616_pos_security_controls.sql

-- POS manager controls: sign-out after sale, discount limits, void/refund PIN policy
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_sign_out_after_sale', 'false', 'Sign cashier out after each completed sale (shared registers)', 'boolean'),
('pos_require_manager_pin_discounts', 'true', 'Require manager PIN for line discounts above threshold', 'boolean'),
('pos_require_manager_pin_void_refund', 'true', 'Require manager PIN to void sales or process refunds', 'boolean'),
('pos_max_line_discount_percent', '10', 'Max line discount percent without manager PIN (0 = manager required for any discount)', 'number');


-- ########## 20260616_pos_register_experience ##########
-- Source: 20260616_pos_register_experience.sql

-- POS register experience: touch mode, scan beep, quick keys, display hours, personnel mode, return policy
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_large_touch_mode', 'false', 'Larger category and product buttons on POS register', 'boolean'),
('pos_scan_beep_enabled', 'true', 'Play beep when barcode scan finds a product', 'boolean'),
('pos_quick_keys', '[]', 'Pinned quick keys JSON: SKU or category shortcuts on register', 'string'),
('pos_display_store_hours_idle', 'true', 'Show store hours on idle customer display', 'boolean'),
('pos_personnel_mode', 'time_clock_and_pos', 'Personnel mode: time_clock_only or time_clock_and_pos', 'string'),
('pos_receipt_return_policy', '', 'Return policy line printed on POS receipts (text only)', 'string'),
('pos_show_cost_in_cart', 'false', 'Show product cost in POS cart for manual discount decisions', 'boolean');


-- ########## 20260616_pos_receipt_options ##########
-- Source: 20260616_pos_receipt_options.sql

-- POS receipt display and print options (no card data on receipt)
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_receipt_show_cashier', 'true', 'Show cashier name on POS receipts', 'boolean'),
('pos_receipt_show_cash_savings', 'true', 'Show cash savings line on POS receipts', 'boolean'),
('pos_receipt_auto_print', 'true', 'Auto-open print dialog after each sale', 'boolean'),
('pos_receipt_copy_count', '2', 'Number of receipt copies to print (1–3)', 'number'),
('pos_receipt_show_order_barcode', 'true', 'Show order number as barcode on receipts', 'boolean');


-- ########## 20260616_pos_operations_settings ##########
-- Source: 20260616_pos_operations_settings.sql

-- POS operations, reporting, and register help settings
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_daily_sales_email_enabled', 'false', 'Email daily in-store sales summary to owner', 'boolean'),
('pos_daily_sales_email_to', '', 'Recipient for daily POS sales email (defaults to store email)', 'string'),
('pos_daily_sales_email_hour', '21', 'Hour to send daily sales email (0-23 local server time)', 'number'),
('pos_daily_sales_email_minute', '0', 'Minute to send daily sales email', 'number'),
('pos_eod_reminder_enabled', 'true', 'Remind register if shift still open after end-of-day time', 'boolean'),
('pos_eod_reminder_hour', '20', 'End-of-day reminder hour (0-23)', 'number'),
('pos_eod_reminder_minute', '0', 'End-of-day reminder minute', 'number'),
('pos_support_phone', '', 'Support phone shown on POS register help', 'string'),
('pos_help_url', '', 'Help URL shown on POS register', 'string'),
('pos_remote_support_notice', 'Authorized IT or Business One support may connect to this register remotely only with your permission. You will be asked to approve each session.', 'Remote support notice on register', 'string'),
('pos_catalog_refresh_minutes', '60', 'Auto-refresh product catalog interval in minutes (15-1440)', 'number');


-- ########## 20260616_pos_employee_can_authorize ##########
-- Source: 20260616_pos_employee_can_authorize.sql

-- Managers who can approve discounts, voids, and refunds at the register
ALTER TABLE pos_employees
    ADD COLUMN can_authorize TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'May approve POS discounts, voids, and refunds with their PIN'
    AFTER is_active;


-- ########## 20260616_pos_cash_discount_display ##########
-- Source: 20260616_pos_cash_discount_display.sql

-- POS cash discount settings + customer display sync
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('pos_cash_discount_enabled', 'true', 'Enable in-store cash discount (card price vs lower cash price)', 'boolean'),
('pos_cash_discount_percent', '3.5', 'Cash discount percent off merchandise (max 15)', 'number');

CREATE TABLE IF NOT EXISTS pos_display_snapshots (
    device_id VARCHAR(64) NOT NULL PRIMARY KEY,
    payload JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);


-- ########## 20260616_inventory_settings ##########
-- Source: 20260616_inventory_settings.sql

-- Global inventory behavior for the web store
INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
('inventory_global_low_stock_threshold', '5', 'Default low-stock warning threshold when a product has no per-item threshold', 'number'),
('inventory_allow_oversell', 'false', 'Allow website sales when inventory is zero (per-product allow_backorder can also enable)', 'boolean'),
('inventory_hide_out_of_stock', 'false', 'Hide out-of-stock products from category/browse grids (product pages still work by direct link)', 'boolean');


-- ########## 20260615_remove_marketing_role ##########
-- Source: 20260615_remove_marketing_role.sql

-- Remove marketing admin role; migrate existing accounts to assistant_manager

UPDATE admin_users SET role = 'assistant_manager' WHERE role = 'marketing';

ALTER TABLE admin_users
  MODIFY COLUMN role ENUM(
    'developer',
    'admin',
    'manager',
    'assistant_manager'
  ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'assistant_manager';


-- ########## 20260615_pos_device_sync ##########
-- Source: 20260615_pos_device_sync.sql

-- Business One POS device sync columns on orders
ALTER TABLE orders ADD COLUMN pos_client_transaction_id VARCHAR(64) NULL
  COMMENT 'Idempotency key from Business One POS offline queue';
ALTER TABLE orders ADD COLUMN pos_device_id VARCHAR(64) NULL
  COMMENT 'Register/device identifier from POS';

CREATE UNIQUE INDEX idx_orders_pos_client_tx ON orders (pos_client_transaction_id);


-- ########## 20260615_personnel_pos ##########
-- Source: 20260615_personnel_pos.sql

-- Business One POS personnel, shifts, timesheets, cash drawer
-- Applied automatically via ensurePersonnelSchema on server start

CREATE TABLE IF NOT EXISTS pos_employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_code VARCHAR(8) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NULL,
    pin_hash VARCHAR(255) NOT NULL,
    admin_user_id INT NULL,
    hourly_rate DECIMAL(8,2) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pos_employee_code (employee_code)
);

CREATE TABLE IF NOT EXISTS pos_scheduled_shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    notes VARCHAR(500) NULL,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos_shift_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    scheduled_shift_id INT NULL,
    device_id VARCHAR(64) NULL,
    status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
    opened_at DATETIME NOT NULL,
    closed_at DATETIME NULL,
    opening_cash DECIMAL(10,2) NOT NULL DEFAULT 0,
    closing_cash DECIMAL(10,2) NULL,
    expected_cash DECIMAL(10,2) NULL,
    over_short_amount DECIMAL(10,2) NULL,
    cash_sales_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    card_sales_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    check_sales_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos_cash_drawer_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shift_session_id INT NOT NULL,
    event_type ENUM('paid_out', 'drop', 'cash_in') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    reason VARCHAR(255) NULL,
    recorded_by_employee_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos_time_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    shift_session_id INT NULL,
    clock_in DATETIME NOT NULL,
    clock_out DATETIME NULL,
    source ENUM('pos', 'admin') NOT NULL DEFAULT 'pos',
    notes VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ########## 20260612_orders_sales_channel ##########
-- Source: 20260612_orders_sales_channel.sql

-- Order channel: online (website) vs in_store (POS/retail) for admin visibility and tax sync filtering
CALL hmherbs_add_column_if_missing(
    'orders',
    'sales_channel',
    "ENUM('online', 'in_store', 'mobile', 'phone', 'other') NOT NULL DEFAULT 'online' COMMENT 'online=website; in_store=POS'"
);


-- ########## 20260605_shippo_shipping ##########
-- Source: 20260605_shippo_shipping.sql

-- Shippo shipping integration: predefined boxes + order shipment metadata

CREATE TABLE IF NOT EXISTS shipping_boxes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    length DECIMAL(8,2) NOT NULL,
    width DECIMAL(8,2) NOT NULL,
    height DECIMAL(8,2) NOT NULL,
    empty_weight_oz DECIMAL(8,2) NOT NULL DEFAULT 0,
    dimension_unit ENUM('in', 'cm') NOT NULL DEFAULT 'in',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

ALTER TABLE orders
    ADD COLUMN shipping_method VARCHAR(64) NULL,
    ADD COLUMN shipping_carrier VARCHAR(32) NULL,
    ADD COLUMN shipping_service VARCHAR(128) NULL,
    ADD COLUMN shippo_shipment_id VARCHAR(64) NULL,
    ADD COLUMN shippo_rate_id VARCHAR(64) NULL,
    ADD COLUMN shippo_transaction_id VARCHAR(64) NULL,
    ADD COLUMN label_url VARCHAR(500) NULL,
    ADD COLUMN package_weight_oz DECIMAL(10,2) NULL,
    ADD COLUMN shipping_box_id INT NULL;

INSERT INTO shipping_boxes (name, length, width, height, empty_weight_oz, sort_order) VALUES
    ('Small Mailer', 6, 4, 2, 1.5, 1),
    ('Herb Bottle Box', 8, 6, 4, 2.5, 2),
    ('Medium Flat Box', 10, 8, 4, 3.5, 3),
    ('Large Multi-Item', 12, 10, 6, 5.0, 4)
ON DUPLICATE KEY UPDATE name = VALUES(name);


-- ########## 20260604_product_variant_matrix ##########
-- Source: 20260604_product_variant_matrix.sql

-- Product variant matrix: option groups on product, attributes on each variant row.
ALTER TABLE products
    ADD COLUMN variant_option_groups JSON NULL COMMENT 'Option dimensions e.g. Size, Form, Pack count';

ALTER TABLE product_variants
    ADD COLUMN attributes JSON NULL COMMENT 'Selected option values for this SKU';


-- ########## 20260604_gift_card_purchase ##########
-- Source: 20260604_gift_card_purchase.sql

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

CALL hmherbs_add_column_if_missing('products', 'gift_card_type', 'ENUM(''digital'',''physical'') NULL AFTER is_featured');
CALL hmherbs_add_column_if_missing('order_items', 'metadata', 'JSON NULL AFTER total');

DROP PROCEDURE IF EXISTS hmherbs_add_column_if_missing;


-- ########## 20260603_developer_role ##########
-- Source: 20260603_developer_role.sql

-- Add developer role for admin panel (Developer Tools access)

ALTER TABLE admin_users
  MODIFY COLUMN role ENUM(
    'developer',
    'admin',
    'manager',
    'assistant_manager',
    'marketing'
  ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'assistant_manager';


-- ########## 20260602_social_oauth ##########
-- Source: 20260602_social_oauth.sql

-- =============================================================================
-- H&M Herbs - Social OAuth (Google / Apple) for customers and admins
-- Migration: 20260602
-- =============================================================================

ALTER TABLE users
    MODIFY COLUMN password_hash VARCHAR(255) NULL,
    ADD COLUMN auth_provider VARCHAR(20) NOT NULL DEFAULT 'local' AFTER password_hash,
    ADD COLUMN oauth_subject VARCHAR(255) NULL AFTER auth_provider;

CREATE INDEX idx_users_oauth ON users (auth_provider, oauth_subject);

ALTER TABLE admin_users
    MODIFY COLUMN password_hash VARCHAR(255) NULL,
    ADD COLUMN auth_provider VARCHAR(20) NOT NULL DEFAULT 'local' AFTER password_hash,
    ADD COLUMN oauth_subject VARCHAR(255) NULL AFTER auth_provider;

CREATE INDEX idx_admin_users_oauth ON admin_users (auth_provider, oauth_subject);


-- ########## 20260601_tax_accountant_report ##########
-- Source: 20260601_tax_accountant_report.sql

-- =============================================================================
-- H&M Herbs - Tax accountant monthly report (county + delivery log)
-- Migration: 20260601
-- =============================================================================

ALTER TABLE tax_entries
    ADD COLUMN county_name VARCHAR(100) NULL AFTER zip_code,
    ADD INDEX idx_tax_entries_county (county_name);

CREATE TABLE IF NOT EXISTS tax_report_deliveries (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    trigger_type ENUM('scheduled', 'manual') NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    row_count INT NOT NULL DEFAULT 0,
    sent_at DATETIME NOT NULL,
    INDEX idx_tax_report_deliveries_period (period_start, period_end),
    INDEX idx_tax_report_deliveries_sent (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ########## 20260530_product_cost_octopos ##########
-- Source: 20260530_product_cost_octopos.sql

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


-- ########## 20260530_customer_type_retail_employee ##########
-- Source: 20260530_customer_type_retail_employee.sql

-- Customer type: retail and employee only (employee discount eligibility)
UPDATE users SET customer_type = 'retail' WHERE customer_type IN ('wholesale', 'staff');
UPDATE users SET customer_type = 'employee' WHERE customer_type = 'employee';

ALTER TABLE users
  MODIFY COLUMN customer_type ENUM('retail', 'employee') NOT NULL DEFAULT 'retail';

INSERT INTO settings (key_name, value, description, type) VALUES
('employee_discount_enabled', 'false', 'Apply a merchandise discount for customers marked Employee', 'boolean'),
('employee_discount_percent', '0', 'Employee merchandise discount percentage (0–100)', 'number')
ON DUPLICATE KEY UPDATE key_name = key_name;


-- ########## 20260529_remove_admin_hmherbs_user ##########
-- Source: 20260529_remove_admin_hmherbs_user.sql

-- Remove placeholder admin account (email does not exist)
DELETE FROM admin_users WHERE email = 'admin@hmherbs.com';


-- ########## 20260529_admin_roles ##########
-- Source: 20260529_admin_roles.sql

-- Admin roles: admin (top), manager, assistant_manager, marketing
-- Migrates super_admin → admin, staff → assistant_manager

ALTER TABLE admin_users
  MODIFY COLUMN role ENUM(
    'admin',
    'manager',
    'assistant_manager',
    'marketing',
    'super_admin',
    'staff'
  ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'assistant_manager';

UPDATE admin_users SET role = 'admin' WHERE role = 'super_admin';
UPDATE admin_users SET role = 'assistant_manager' WHERE role = 'staff';

ALTER TABLE admin_users
  MODIFY COLUMN role ENUM(
    'admin',
    'manager',
    'assistant_manager',
    'marketing'
  ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'assistant_manager';


-- ########## 20260514_users_password_reset ##########
-- Source: 20260514_users_password_reset.sql

-- Customer storefront password reset (token columns on `users`).
-- The Node server also runs ensureUserPasswordResetSchema on startup; this file is for manual DBA runs.

ALTER TABLE users
    ADD COLUMN password_reset_token VARCHAR(255) NULL,
    ADD COLUMN password_reset_token_expires TIMESTAMP NULL;

CREATE INDEX idx_users_password_reset_token ON users (password_reset_token);


-- ########## Postamble ##########
-- Source: 99-postamble.sql

-- =============================================================================
-- HM Herbs — Staging database import (postamble)
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 1;
SET UNIQUE_CHECKS = 1;

-- Staging import complete. Point backend DB_* at this database and restart the API.

