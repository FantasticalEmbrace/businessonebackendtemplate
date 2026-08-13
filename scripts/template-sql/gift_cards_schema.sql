-- Gift Card Template — database schema
-- Requires: users, products, orders, order_items tables
-- Idempotent (safe to re-run)

CREATE TABLE IF NOT EXISTS gift_cards (
    id INT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL UNIQUE,
    pin VARCHAR(10) NULL,
    card_type ENUM('digital','physical') NOT NULL,
    status ENUM('inactive','active','redeemed','expired','cancelled','lost') NOT NULL DEFAULT 'inactive',

    initial_balance DECIMAL(10,2) NOT NULL,
    current_balance DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',

    customer_id INT NULL,
    purchaser_user_id INT NULL,

    recipient_name VARCHAR(150) NULL,
    recipient_email VARCHAR(255) NULL,
    recipient_phone VARCHAR(20) NULL,
    sender_name VARCHAR(150) NULL,
    personal_message TEXT NULL,
    delivery_date DATE NULL,

    physical_serial_number VARCHAR(100) NULL,
    physical_batch_id VARCHAR(50) NULL,
    physical_design VARCHAR(100) NULL,

    octopos_gift_card_id VARCHAR(64) NULL,
    octopos_synced_at TIMESTAMP NULL,
    sync_status ENUM('synced','pending','error','never','local_only') NOT NULL DEFAULT 'never',

    issued_at TIMESTAMP NULL,
    activated_at TIMESTAMP NULL,
    redeemed_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    last_used_at TIMESTAMP NULL,

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

-- Optional: POS-synced gift cards (separate from web-issued cards)
CREATE TABLE IF NOT EXISTS pos_gift_cards (
    id INT PRIMARY KEY AUTO_INCREMENT,
    pos_system_id INT NOT NULL,
    pos_card_id VARCHAR(100) NOT NULL,
    card_number VARCHAR(50) NOT NULL,
    balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(50) NULL,
    customer_email VARCHAR(255) NULL,
    customer_phone VARCHAR(20) NULL,
    raw_data JSON NULL,
    last_synced_at TIMESTAMP NULL,
    sync_status ENUM('synced','pending','error','never') NOT NULL DEFAULT 'never',
    sync_error TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pos_gift_card (pos_system_id, pos_card_id),
    INDEX idx_pgc_card_number (card_number),
    INDEX idx_pgc_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
