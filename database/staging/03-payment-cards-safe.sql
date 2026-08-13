-- Payment cards (hosting-safe: no ADD FOREIGN KEY IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS payment_cards (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    payment_processor ENUM('stripe', 'square', 'paypal') DEFAULT 'stripe',
    payment_token VARCHAR(255) NOT NULL,
    payment_method_id VARCHAR(255),
    last4 VARCHAR(4) NOT NULL,
    brand VARCHAR(50),
    exp_month INT,
    exp_year INT,
    cardholder_name VARCHAR(255),
    billing_address_id INT,
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    fingerprint VARCHAR(255),
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (billing_address_id) REFERENCES user_addresses(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_payment_token (payment_token),
    INDEX idx_is_default (is_default),
    INDEX idx_is_active (is_active),
    INDEX idx_deleted_at (deleted_at)
);

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'payment_method_id') = 0,
    'ALTER TABLE orders ADD COLUMN payment_method_id INT NULL',
    'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'payment_token') = 0,
    'ALTER TABLE orders ADD COLUMN payment_token VARCHAR(255) NULL',
    'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'payment_processor') = 0,
    'ALTER TABLE orders ADD COLUMN payment_processor VARCHAR(50) NULL',
    'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
