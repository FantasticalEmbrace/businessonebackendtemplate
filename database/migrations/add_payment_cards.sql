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
ADD COLUMN IF NOT EXISTS payment_method_id INT NULL,
ADD COLUMN IF NOT EXISTS payment_token VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS payment_processor VARCHAR(50) NULL,
ADD FOREIGN KEY IF NOT EXISTS (payment_method_id) REFERENCES payment_cards(id) ON DELETE SET NULL;

