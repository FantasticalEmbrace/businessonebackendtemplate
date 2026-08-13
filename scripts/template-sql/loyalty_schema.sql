-- Loyalty Program Template — database schema
-- Requires: users table
-- Idempotent (safe to re-run)

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

-- Optional: cache POS-only customers for matching/import
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

-- POS loyalty sync tables
CREATE TABLE IF NOT EXISTS pos_loyalty_programs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    pos_system_id INT NOT NULL,
    pos_program_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    points_per_dollar DECIMAL(10,4) NULL,
    tier_rules JSON NULL,
    raw_data JSON NULL,
    last_synced_at TIMESTAMP NULL,
    sync_status ENUM('synced','pending','error','never') NOT NULL DEFAULT 'never',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pos_loyalty_program (pos_system_id, pos_program_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pos_customer_loyalty (
    id INT PRIMARY KEY AUTO_INCREMENT,
    pos_system_id INT NOT NULL,
    pos_customer_id VARCHAR(100) NOT NULL,
    pos_program_id VARCHAR(100) NULL,
    points_balance INT NOT NULL DEFAULT 0,
    tier VARCHAR(50) NULL,
    lifetime_points INT NULL,
    visit_count INT NULL,
    total_spend DECIMAL(12,2) NULL,
    customer_email VARCHAR(255) NULL,
    customer_phone VARCHAR(20) NULL,
    raw_data JSON NULL,
    last_synced_at TIMESTAMP NULL,
    sync_status ENUM('synced','pending','error','never') NOT NULL DEFAULT 'never',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pos_customer_loyalty (pos_system_id, pos_customer_id),
    INDEX idx_pcl_email (customer_email),
    INDEX idx_pcl_tier (tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill loyalty rows for existing users
INSERT INTO customer_loyalty (user_id, member_since)
SELECT u.id, DATE(u.created_at)
  FROM users u
  LEFT JOIN customer_loyalty cl ON cl.user_id = u.id
 WHERE cl.id IS NULL;
