-- =============================================================================
-- H&M Herbs - Customer Database, Gift Cards, and Loyalty/Rewards
-- Migration: 20260427
-- =============================================================================
-- Adds:
--   1. Extended customer profile fields on `users`
--   2. `customer_loyalty` (web-side mirror of POS loyalty for each customer)
--   3. `loyalty_transactions` (point earn/redeem/adjust ledger)
--   4. `gift_cards` (physical + digital, assignable to customers)
--   5. `gift_card_transactions` (issue/redeem/adjust/refund ledger)
--   6. `customer_notes` (admin-only notes on a customer)
--   7. `customer_communications` (email/SMS history)
--   8. `customer_octopos_link` (mapping table between web users and Octopos)
--
-- All statements are idempotent (safe to re-run) using INFORMATION_SCHEMA checks
-- where possible. MySQL 5.7+ / MariaDB compatible.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend `users` with customer-profile fields
-- -----------------------------------------------------------------------------

-- Helper: a stored procedure to add a column only if it does not already exist
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

CALL hmherbs_add_column_if_missing('users', 'customer_number',        "VARCHAR(20) NULL UNIQUE AFTER id");
CALL hmherbs_add_column_if_missing('users', 'middle_name',            "VARCHAR(100) NULL AFTER first_name");
CALL hmherbs_add_column_if_missing('users', 'preferred_name',         "VARCHAR(100) NULL AFTER last_name");
CALL hmherbs_add_column_if_missing('users', 'gender',                 "ENUM('male','female','non_binary','prefer_not_to_say','other') NULL AFTER date_of_birth");
CALL hmherbs_add_column_if_missing('users', 'customer_status',        "ENUM('active','vip','inactive','blocked') NOT NULL DEFAULT 'active' AFTER is_active");
CALL hmherbs_add_column_if_missing('users', 'customer_type',          "ENUM('retail','employee') NOT NULL DEFAULT 'retail' AFTER customer_status");
CALL hmherbs_add_column_if_missing('users', 'tags',                   "JSON NULL");
CALL hmherbs_add_column_if_missing('users', 'marketing_email_opt_in', "BOOLEAN NOT NULL DEFAULT FALSE");
CALL hmherbs_add_column_if_missing('users', 'marketing_sms_opt_in',   "BOOLEAN NOT NULL DEFAULT FALSE");
CALL hmherbs_add_column_if_missing('users', 'marketing_postal_opt_in',"BOOLEAN NOT NULL DEFAULT FALSE");
CALL hmherbs_add_column_if_missing('users', 'preferred_contact',      "ENUM('email','sms','phone','none') NOT NULL DEFAULT 'email'");
CALL hmherbs_add_column_if_missing('users', 'referral_source',        "VARCHAR(100) NULL");
CALL hmherbs_add_column_if_missing('users', 'referral_code',          "VARCHAR(40) NULL");
CALL hmherbs_add_column_if_missing('users', 'referred_by_user_id',    "INT NULL");
CALL hmherbs_add_column_if_missing('users', 'lifetime_value',         "DECIMAL(12,2) NOT NULL DEFAULT 0.00");
CALL hmherbs_add_column_if_missing('users', 'total_orders',           "INT NOT NULL DEFAULT 0");
CALL hmherbs_add_column_if_missing('users', 'last_order_at',          "TIMESTAMP NULL");
CALL hmherbs_add_column_if_missing('users', 'avg_order_value',        "DECIMAL(10,2) NOT NULL DEFAULT 0.00");
CALL hmherbs_add_column_if_missing('users', 'octopos_customer_id',    "VARCHAR(64) NULL");
CALL hmherbs_add_column_if_missing('users', 'octopos_synced_at',      "TIMESTAMP NULL");
CALL hmherbs_add_column_if_missing('users', 'tax_exempt',             "BOOLEAN NOT NULL DEFAULT FALSE");
CALL hmherbs_add_column_if_missing('users', 'tax_exempt_id',          "VARCHAR(64) NULL");
CALL hmherbs_add_column_if_missing('users', 'admin_notes',            "TEXT NULL");

-- Helper: add an index only if missing
DROP PROCEDURE IF EXISTS hmherbs_add_index_if_missing;
DELIMITER $$
CREATE PROCEDURE hmherbs_add_index_if_missing(
    IN p_table   VARCHAR(64),
    IN p_index   VARCHAR(64),
    IN p_columns VARCHAR(255)
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = p_table
          AND INDEX_NAME   = p_index
    ) THEN
        SET @sql = CONCAT('CREATE INDEX ', p_index, ' ON ', p_table, ' (', p_columns, ')');
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

CALL hmherbs_add_index_if_missing('users', 'idx_users_customer_number',  'customer_number');
CALL hmherbs_add_index_if_missing('users', 'idx_users_phone',            'phone');
CALL hmherbs_add_index_if_missing('users', 'idx_users_status',           'customer_status');
CALL hmherbs_add_index_if_missing('users', 'idx_users_octopos_customer', 'octopos_customer_id');
CALL hmherbs_add_index_if_missing('users', 'idx_users_referral_code',    'referral_code');

-- -----------------------------------------------------------------------------
-- 2. Customer loyalty (web-side mirror, 1:1 with users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_loyalty (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL UNIQUE,
    points_balance INT NOT NULL DEFAULT 0,
    points_pending INT NOT NULL DEFAULT 0,
    lifetime_points_earned INT NOT NULL DEFAULT 0,
    lifetime_points_redeemed INT NOT NULL DEFAULT 0,
    tier VARCHAR(50) NULL,
    tier_progress INT NOT NULL DEFAULT 0,
    member_since DATE NULL,
    last_earned_at TIMESTAMP NULL,
    last_redeemed_at TIMESTAMP NULL,
    -- Octopos linkage
    octopos_reward_card_id VARCHAR(64) NULL,
    octopos_reward_card_number VARCHAR(64) NULL,
    octopos_program_id VARCHAR(64) NULL,
    last_synced_at TIMESTAMP NULL,
    sync_status ENUM('synced','pending','error','never') NOT NULL DEFAULT 'never',
    sync_error TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_loyalty_card (octopos_reward_card_number),
    INDEX idx_loyalty_octopos_id (octopos_reward_card_id),
    INDEX idx_loyalty_tier (tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. Loyalty transactions ledger
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    transaction_type ENUM('earn','redeem','adjust','expire','refund','signup_bonus','referral_bonus','birthday_bonus') NOT NULL,
    points_change INT NOT NULL,
    points_balance_after INT NOT NULL,
    source ENUM('web','pos','manual','sync','system') NOT NULL DEFAULT 'web',
    order_id INT NULL,
    description VARCHAR(255) NULL,
    octopos_transaction_id VARCHAR(64) NULL,
    admin_user_id INT NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_loyalty_tx_user (user_id),
    INDEX idx_loyalty_tx_type (transaction_type),
    INDEX idx_loyalty_tx_created (created_at),
    INDEX idx_loyalty_tx_order (order_id),
    INDEX idx_loyalty_tx_octopos (octopos_transaction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. Gift cards (physical + digital)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gift_cards (
    id INT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL UNIQUE,
    pin VARCHAR(10) NULL,
    card_type ENUM('digital','physical') NOT NULL,
    status ENUM('inactive','active','redeemed','expired','cancelled','lost') NOT NULL DEFAULT 'inactive',

    initial_balance DECIMAL(10,2) NOT NULL,
    current_balance DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',

    -- Assignment / ownership
    customer_id INT NULL,
    purchaser_user_id INT NULL,

    -- Digital recipient details
    recipient_name VARCHAR(150) NULL,
    recipient_email VARCHAR(255) NULL,
    recipient_phone VARCHAR(20) NULL,
    sender_name VARCHAR(150) NULL,
    personal_message TEXT NULL,
    delivery_date DATE NULL,

    -- Physical card details
    physical_serial_number VARCHAR(100) NULL,
    physical_batch_id VARCHAR(50) NULL,
    physical_design VARCHAR(100) NULL,

    -- Octopos linkage
    octopos_gift_card_id VARCHAR(64) NULL,
    octopos_synced_at TIMESTAMP NULL,
    sync_status ENUM('synced','pending','error','never','local_only') NOT NULL DEFAULT 'never',

    -- Lifecycle
    issued_at TIMESTAMP NULL,
    activated_at TIMESTAMP NULL,
    redeemed_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    last_used_at TIMESTAMP NULL,

    -- Audit
    issued_by_admin_id INT NULL,
    order_id INT NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_gc_code (code),
    INDEX idx_gc_customer (customer_id),
    INDEX idx_gc_type (card_type),
    INDEX idx_gc_status (status),
    INDEX idx_gc_octopos (octopos_gift_card_id),
    INDEX idx_gc_serial (physical_serial_number),
    INDEX idx_gc_recipient_email (recipient_email),
    INDEX idx_gc_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. Gift card transactions ledger
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gift_card_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    gift_card_id INT NOT NULL,
    transaction_type ENUM('issue','activate','reload','redeem','refund','adjust','transfer','cancel','expire') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    balance_before DECIMAL(10,2) NOT NULL,
    balance_after DECIMAL(10,2) NOT NULL,
    source ENUM('web','pos','admin','sync','system') NOT NULL DEFAULT 'admin',

    order_id INT NULL,
    customer_id INT NULL,
    admin_user_id INT NULL,
    octopos_transaction_id VARCHAR(64) NULL,

    description VARCHAR(255) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE CASCADE,
    INDEX idx_gct_card (gift_card_id),
    INDEX idx_gct_type (transaction_type),
    INDEX idx_gct_created (created_at),
    INDEX idx_gct_customer (customer_id),
    INDEX idx_gct_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. Customer notes (admin-facing; multiple notes per customer)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_notes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    admin_user_id INT NULL,
    note_type ENUM('general','complaint','support','vip','warning','follow_up') NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_cn_user (user_id),
    INDEX idx_cn_type (note_type),
    INDEX idx_cn_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. Customer communications log (email / SMS history)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_communications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    channel ENUM('email','sms','phone','postal','in_person') NOT NULL,
    direction ENUM('outbound','inbound') NOT NULL DEFAULT 'outbound',
    subject VARCHAR(255) NULL,
    body TEXT NULL,
    template_key VARCHAR(100) NULL,
    status ENUM('queued','sent','delivered','opened','clicked','failed','bounced','replied') NOT NULL DEFAULT 'queued',
    related_order_id INT NULL,
    related_gift_card_id INT NULL,
    sent_by_admin_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_cc_user (user_id),
    INDEX idx_cc_channel (channel),
    INDEX idx_cc_status (status),
    INDEX idx_cc_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. Octopos external link table (for non-user POS-only customers)
-- -----------------------------------------------------------------------------
-- Used when a POS customer exists but has NOT yet linked to a website account.
-- A web user is linked via users.octopos_customer_id; this table stores the
-- full POS profile so admins can match/import them later.
CREATE TABLE IF NOT EXISTS octopos_customers_cache (
    id INT PRIMARY KEY AUTO_INCREMENT,
    octopos_customer_id VARCHAR(64) NOT NULL UNIQUE,
    octopos_reward_card_number VARCHAR(64) NULL,
    first_name VARCHAR(100) NULL,
    last_name VARCHAR(100) NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(20) NULL,
    points_balance INT NULL,
    tier VARCHAR(50) NULL,
    raw JSON NULL,
    web_user_id INT NULL,
    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_occ_email (email),
    INDEX idx_occ_phone (phone),
    INDEX idx_occ_card (octopos_reward_card_number),
    INDEX idx_occ_web_user (web_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 9. Backfill customer_number for existing rows
-- -----------------------------------------------------------------------------
-- Format: HM-CUST-{padded id} (e.g. HM-CUST-000123)
UPDATE users
   SET customer_number = CONCAT('HM-CUST-', LPAD(id, 6, '0'))
 WHERE customer_number IS NULL;

-- -----------------------------------------------------------------------------
-- 10. Backfill customer_loyalty rows for existing users (so every user has one)
-- -----------------------------------------------------------------------------
INSERT INTO customer_loyalty (user_id, member_since)
SELECT u.id, DATE(u.created_at)
  FROM users u
  LEFT JOIN customer_loyalty cl ON cl.user_id = u.id
 WHERE cl.id IS NULL;

-- Cleanup helper procedures
DROP PROCEDURE IF EXISTS hmherbs_add_column_if_missing;
DROP PROCEDURE IF EXISTS hmherbs_add_index_if_missing;
