-- Business One Menu System - Database Tables
-- Run this migration to create the necessary tables

-- API Keys table for authenticating menu API requests
CREATE TABLE IF NOT EXISTS menu_api_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL COMMENT 'Description/name for this API key',
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL,
    INDEX idx_api_key (api_key),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menu Items table
CREATE TABLE IF NOT EXISTS menu_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_id VARCHAR(100) UNIQUE NOT NULL COMMENT 'Unique identifier for the menu item',
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NULL,
    image_url VARCHAR(500) NULL,
    category VARCHAR(100) NULL,
    icon_class VARCHAR(100) NULL COMMENT 'Font Awesome icon class',
    overview TEXT NULL COMMENT 'Long-form service overview',
    features_json JSON NULL COMMENT 'Array of feature bullet strings',
    display_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_is_active (is_active),
    INDEX idx_display_order (display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default menu items for Business One
INSERT INTO menu_items (item_id, name, description, category, display_order) VALUES
('pos', 'Point of Sale (POS)', 'Modern, efficient POS systems to streamline your sales process and inventory management. Real-time inventory tracking, sales reporting and analytics, multi-location support, customer management, integration with payment processors, mobile and tablet compatible.', 'pos', 1),
('payment', 'Payment Processing', 'Secure, reliable payment processing solutions with competitive rates and excellent support. Competitive processing rates, secure payment gateway, multiple payment methods, 24/7 fraud monitoring, quick settlement times, dedicated account manager.', 'payment', 2),
('phone', 'Phone Service', 'Business phone systems with advanced features, including hold queues that ensure your customers never hear continuous ringing or a busy signal, allowing you to stay connected with clients and team members. Professional hold queues, voicemail to email, call forwarding and routing, conference calling, mobile app integration, unlimited calling plans.', 'phone', 3),
('website', 'Website Development', 'Professional website design and development to establish your online presence and attract customers. Responsive design, SEO optimization, content management system, e-commerce integration, mobile-first approach, ongoing support and maintenance.', 'website', 4)
ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description);

