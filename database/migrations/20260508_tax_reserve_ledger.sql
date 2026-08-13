-- =============================================================================
-- H&M Herbs - Daily Tax Reserve Ledger
-- Migration: 20260508
-- =============================================================================

CREATE TABLE IF NOT EXISTS tax_entries (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id VARCHAR(100) NOT NULL,
    source ENUM('webstore', 'pos') NOT NULL,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    taxable_amount DECIMAL(12,2) NULL,
    state_code VARCHAR(2) NOT NULL,
    zip_code VARCHAR(20) NULL,
    created_at DATETIME NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tax_entries_source_order (source, order_id),
    INDEX idx_tax_entries_created (created_at),
    INDEX idx_tax_entries_state (state_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_tax_reserves (
    date DATE PRIMARY KEY,
    webstore_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    pos_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    combined_reserve_needed DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status ENUM('pending', 'transferred') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
