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
