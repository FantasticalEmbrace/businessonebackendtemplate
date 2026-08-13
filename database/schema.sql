-- H&M Herbs & Vitamins - Complete E-commerce Database Schema
-- Designed to handle 10,000+ products with dual categorization (health conditions + brands)

-- Users table for customer accounts
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    date_of_birth DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    email_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP NULL,
    password_reset_token VARCHAR(255) NULL,
    password_reset_token_expires TIMESTAMP NULL,
    INDEX idx_email (email),
    INDEX idx_password_reset_token (password_reset_token),
    INDEX idx_created_at (created_at)
);

-- User addresses for shipping/billing
CREATE TABLE user_addresses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    type ENUM('shipping', 'billing') NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    company VARCHAR(100),
    address_line_1 VARCHAR(255) NOT NULL,
    address_line_2 VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'United States',
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_type (type)
);

-- Health condition categories (Blood Pressure, Heart Health, etc.)
CREATE TABLE health_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    image_url VARCHAR(500),
    meta_title VARCHAR(255),
    meta_description TEXT,
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_slug (slug),
    INDEX idx_sort_order (sort_order)
);

-- Product brands
CREATE TABLE brands (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    logo_url VARCHAR(500),
    website_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_slug (slug),
    INDEX idx_name (name)
);

-- Product categories (traditional categories like Vitamins, Herbs, etc.)
CREATE TABLE product_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    parent_id INT NULL,
    description TEXT,
    image_url VARCHAR(500),
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES product_categories(id) ON DELETE SET NULL,
    INDEX idx_slug (slug),
    INDEX idx_parent_id (parent_id),
    INDEX idx_sort_order (sort_order)
);

-- Main products table
CREATE TABLE products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    sku VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    short_description TEXT,
    long_description LONGTEXT,
    brand_id INT NOT NULL,
    category_id INT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    compare_price DECIMAL(10,2) NULL,
    cost_price DECIMAL(10,2) NULL,
    weight DECIMAL(8,2),
    weight_unit ENUM('oz', 'lb', 'g', 'kg') DEFAULT 'oz',
    dimensions_length DECIMAL(8,2),
    dimensions_width DECIMAL(8,2),
    dimensions_height DECIMAL(8,2),
    dimension_unit ENUM('in', 'cm') DEFAULT 'in',
    requires_shipping BOOLEAN DEFAULT TRUE,
    is_taxable BOOLEAN DEFAULT TRUE,
    track_inventory BOOLEAN DEFAULT TRUE,
    inventory_quantity INT DEFAULT 0,
    low_stock_threshold INT DEFAULT 10,
    allow_backorder BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    show_on_web BOOLEAN DEFAULT TRUE,
    is_cannabis BOOLEAN DEFAULT FALSE,
    coa_url VARCHAR(500) NULL,
    coa_updated_at DATE NULL,
    meta_title VARCHAR(255),
    meta_description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brands(id),
    FOREIGN KEY (category_id) REFERENCES product_categories(id),
    INDEX idx_sku (sku),
    INDEX idx_slug (slug),
    INDEX idx_brand_id (brand_id),
    INDEX idx_category_id (category_id),
    INDEX idx_is_active (is_active),
    INDEX idx_is_featured (is_featured),
    INDEX idx_price (price),
    FULLTEXT idx_search (name, short_description, long_description)
);

-- Product images
CREATE TABLE product_images (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    alt_text VARCHAR(255),
    sort_order INT DEFAULT 0,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_product_id (product_id),
    INDEX idx_sort_order (sort_order)
);

-- Product variants (different sizes, formulations, etc.)
CREATE TABLE product_variants (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    sku VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    compare_price DECIMAL(10,2) NULL,
    inventory_quantity INT DEFAULT 0,
    weight DECIMAL(8,2),
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_product_id (product_id),
    INDEX idx_sku (sku),
    INDEX idx_sort_order (sort_order)
);

-- Junction table for products and health categories (many-to-many)
CREATE TABLE product_health_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    health_category_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (health_category_id) REFERENCES health_categories(id) ON DELETE CASCADE,
    UNIQUE KEY unique_product_health_category (product_id, health_category_id),
    INDEX idx_product_id (product_id),
    INDEX idx_health_category_id (health_category_id)
);

-- Shopping carts
CREATE TABLE shopping_carts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NULL,
    session_id VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_session_id (session_id),
    INDEX idx_updated_at (updated_at)
);

-- Shopping cart items
CREATE TABLE cart_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cart_id INT NOT NULL,
    product_id INT NOT NULL,
    variant_id INT NULL,
    quantity INT NOT NULL DEFAULT 1,
    price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (cart_id) REFERENCES shopping_carts(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
    INDEX idx_cart_id (cart_id),
    INDEX idx_product_id (product_id)
);

-- Orders
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_number VARCHAR(50) UNIQUE NOT NULL,
    user_id INT NULL,
    email VARCHAR(255) NOT NULL,
    status ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded') DEFAULT 'pending',
    payment_status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
    fulfillment_status ENUM('unfulfilled', 'partial', 'fulfilled') DEFAULT 'unfulfilled',
    
    -- Pricing
    subtotal DECIMAL(10,2) NOT NULL,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    shipping_amount DECIMAL(10,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL,
    
    -- Shipping address
    shipping_first_name VARCHAR(100),
    shipping_last_name VARCHAR(100),
    shipping_company VARCHAR(100),
    shipping_address_line_1 VARCHAR(255),
    shipping_address_line_2 VARCHAR(255),
    shipping_city VARCHAR(100),
    shipping_state VARCHAR(100),
    shipping_postal_code VARCHAR(20),
    shipping_country VARCHAR(100),
    
    -- Billing address
    billing_first_name VARCHAR(100),
    billing_last_name VARCHAR(100),
    billing_company VARCHAR(100),
    billing_address_line_1 VARCHAR(255),
    billing_address_line_2 VARCHAR(255),
    billing_city VARCHAR(100),
    billing_state VARCHAR(100),
    billing_postal_code VARCHAR(20),
    billing_country VARCHAR(100),
    
    -- Tracking
    tracking_number VARCHAR(255),
    tracking_url VARCHAR(500),
    shipped_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_order_number (order_number),
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    INDEX idx_email (email)
);

-- Order items
CREATE TABLE order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    variant_id INT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_sku VARCHAR(100) NOT NULL,
    variant_name VARCHAR(255),
    quantity INT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (variant_id) REFERENCES product_variants(id),
    INDEX idx_order_id (order_id),
    INDEX idx_product_id (product_id)
);

-- EDSA (Electro Dermal Stress Analysis) service bookings
CREATE TABLE edsa_bookings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    preferred_date DATE NOT NULL,
    preferred_time TIME NOT NULL,
    alternative_date DATE,
    alternative_time TIME,
    status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
    notes TEXT,
    admin_notes TEXT,
    confirmed_date DATE,
    confirmed_time TIME,
    customer_request_type VARCHAR(20) NOT NULL DEFAULT 'none',
    customer_request_notes TEXT,
    requested_date DATE,
    requested_time TIME,
    customer_request_at TIMESTAMP NULL,
    google_calendar_event_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_preferred_date (preferred_date),
    INDEX idx_email (email)
);

-- Wishlists
CREATE TABLE wishlists (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_product (user_id, product_id),
    INDEX idx_user_id (user_id),
    INDEX idx_product_id (product_id)
);

-- Product reviews
CREATE TABLE product_reviews (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    user_id INT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title VARCHAR(255),
    review_text TEXT,
    is_verified_purchase BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_product_id (product_id),
    INDEX idx_user_id (user_id),
    INDEX idx_rating (rating),
    INDEX idx_is_approved (is_approved)
);

-- Admin users
CREATE TABLE admin_users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role ENUM('developer', 'admin', 'manager', 'assistant_manager') DEFAULT 'assistant_manager',
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role (role)
);

-- System settings
CREATE TABLE settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    key_name VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_key_name (key_name)
);

-- Email templates
CREATE TABLE email_templates (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) UNIQUE NOT NULL,
    subject VARCHAR(255) NOT NULL,
    html_content LONGTEXT NOT NULL,
    text_content LONGTEXT,
    variables JSON,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name)
);

-- Inventory transactions log
CREATE TABLE inventory_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    variant_id INT NULL,
    type ENUM('sale', 'restock', 'adjustment', 'return') NOT NULL,
    quantity_change INT NOT NULL,
    quantity_after INT NOT NULL,
    reference_type ENUM('order', 'manual', 'import') NOT NULL,
    reference_id INT NULL,
    notes TEXT,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (variant_id) REFERENCES product_variants(id),
    FOREIGN KEY (created_by) REFERENCES admin_users(id),
    INDEX idx_product_id (product_id),
    INDEX idx_type (type),
    INDEX idx_created_at (created_at)
);

-- Vendor Management System
CREATE TABLE vendors (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(255),
    
    -- Address Information
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'United States',
    
    -- Business Information
    tax_id VARCHAR(50),
    business_license VARCHAR(100),
    payment_terms ENUM('net_15', 'net_30', 'net_45', 'net_60', 'cod', 'prepaid') DEFAULT 'net_30',
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Integration Settings
    catalog_url VARCHAR(500),
    catalog_format ENUM('csv', 'xml', 'json', 'api') DEFAULT 'csv',
    catalog_auth_type ENUM('none', 'basic', 'bearer', 'api_key') DEFAULT 'none',
    catalog_auth_credentials JSON,
    auto_sync_enabled BOOLEAN DEFAULT FALSE,
    sync_frequency ENUM('hourly', 'daily', 'weekly', 'manual') DEFAULT 'daily',
    
    -- Status and Tracking
    status ENUM('active', 'inactive', 'pending', 'suspended') DEFAULT 'pending',
    rating DECIMAL(3,2) DEFAULT 0.00,
    total_products INT DEFAULT 0,
    last_catalog_sync TIMESTAMP NULL,
    
    -- Audit Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    
    FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_name (name),
    INDEX idx_status (status),
    INDEX idx_email (email)
);

-- Vendor Catalog Import History
CREATE TABLE vendor_catalog_imports (
    id INT PRIMARY KEY AUTO_INCREMENT,
    vendor_id INT NOT NULL,
    import_type ENUM('manual', 'scheduled', 'webhook') DEFAULT 'manual',
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    
    -- Import Statistics
    total_records INT DEFAULT 0,
    processed_records INT DEFAULT 0,
    new_products INT DEFAULT 0,
    updated_products INT DEFAULT 0,
    failed_records INT DEFAULT 0,
    
    -- File Information
    source_file VARCHAR(255),
    file_size INT,
    
    -- Results and Errors
    import_log TEXT,
    error_details JSON,
    
    -- Timing
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
    INDEX idx_vendor_id (vendor_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);

-- Vendor Product Mapping
CREATE TABLE vendor_products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    vendor_id INT NOT NULL,
    product_id INT NOT NULL,
    vendor_sku VARCHAR(255),
    vendor_name VARCHAR(500),
    vendor_price DECIMAL(10,2),
    vendor_cost DECIMAL(10,2),
    minimum_order_quantity INT DEFAULT 1,
    lead_time_days INT DEFAULT 0,
    
    -- Mapping Status
    mapping_status ENUM('mapped', 'unmapped', 'conflict', 'discontinued') DEFAULT 'mapped',
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_vendor_product (vendor_id, product_id),
    INDEX idx_vendor_sku (vendor_sku),
    INDEX idx_mapping_status (mapping_status)
);

-- POS System Integration
CREATE TABLE pos_systems (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    system_type ENUM('square', 'shopify_pos', 'lightspeed', 'toast', 'clover', 'custom') NOT NULL,
    
    -- Connection Settings
    api_endpoint VARCHAR(500),
    api_version VARCHAR(50),
    auth_type ENUM('oauth', 'api_key', 'basic', 'bearer') DEFAULT 'api_key',
    auth_credentials JSON,
    
    -- Sync Configuration
    sync_inventory BOOLEAN DEFAULT TRUE,
    sync_orders BOOLEAN DEFAULT TRUE,
    sync_customers BOOLEAN DEFAULT FALSE,
    sync_frequency ENUM('real_time', 'every_5min', 'hourly', 'daily') DEFAULT 'hourly',
    
    -- Status
    status ENUM('active', 'inactive', 'error', 'testing') DEFAULT 'testing',
    last_sync TIMESTAMP NULL,
    last_error TEXT,
    
    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    
    FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_system_type (system_type),
    INDEX idx_status (status)
);

-- POS Transaction Log
CREATE TABLE pos_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    pos_system_id INT NOT NULL,
    transaction_type ENUM('inventory_sync', 'order_sync', 'customer_sync', 'webhook') NOT NULL,
    direction ENUM('inbound', 'outbound') NOT NULL,
    
    -- Transaction Details
    external_id VARCHAR(255),
    entity_type ENUM('product', 'order', 'customer', 'inventory') NOT NULL,
    entity_id INT,
    
    -- Status and Results
    status ENUM('pending', 'processing', 'completed', 'failed', 'retrying') DEFAULT 'pending',
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    
    -- Data
    request_data JSON,
    response_data JSON,
    error_message TEXT,
    
    -- Timing
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,
    
    FOREIGN KEY (pos_system_id) REFERENCES pos_systems(id) ON DELETE CASCADE,
    INDEX idx_pos_system_id (pos_system_id),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_status (status),
    INDEX idx_external_id (external_id)
);

-- POS Gift Card Integration (sync data from POS systems)
CREATE TABLE pos_gift_cards (
    id INT PRIMARY KEY AUTO_INCREMENT,
    pos_system_id INT NOT NULL,
    external_gift_card_id VARCHAR(255) NOT NULL,
    card_number VARCHAR(50),
    
    -- Card Details (synced from POS)
    current_balance DECIMAL(10,2) NOT NULL,
    initial_amount DECIMAL(10,2),
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Status and Dates (from POS)
    status VARCHAR(50) NOT NULL,
    issued_date DATE,
    expiry_date DATE,
    
    -- Customer Information (if available from POS)
    customer_email VARCHAR(255),
    customer_name VARCHAR(255),
    
    -- Sync Information
    last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    sync_status ENUM('synced', 'pending', 'error') DEFAULT 'synced',
    sync_error TEXT,
    
    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (pos_system_id) REFERENCES pos_systems(id) ON DELETE CASCADE,
    UNIQUE KEY unique_pos_gift_card (pos_system_id, external_gift_card_id),
    INDEX idx_card_number (card_number),
    INDEX idx_status (status),
    INDEX idx_customer_email (customer_email),
    INDEX idx_last_synced (last_synced)
);

-- POS Loyalty Programs Integration (sync data from POS systems)
CREATE TABLE pos_loyalty_programs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    pos_system_id INT NOT NULL,
    external_program_id VARCHAR(255) NOT NULL,
    
    -- Program Details (synced from POS)
    program_name VARCHAR(255) NOT NULL,
    program_type VARCHAR(100),
    description TEXT,
    
    -- Program Settings (from POS)
    is_active BOOLEAN DEFAULT TRUE,
    points_per_dollar DECIMAL(5,2),
    dollar_per_point DECIMAL(5,4),
    
    -- Sync Information
    last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    sync_status ENUM('synced', 'pending', 'error') DEFAULT 'synced',
    sync_error TEXT,
    
    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (pos_system_id) REFERENCES pos_systems(id) ON DELETE CASCADE,
    UNIQUE KEY unique_pos_program (pos_system_id, external_program_id),
    INDEX idx_program_name (program_name),
    INDEX idx_is_active (is_active),
    INDEX idx_last_synced (last_synced)
);

-- POS Customer Loyalty Accounts (sync customer loyalty data from POS)
CREATE TABLE pos_customer_loyalty (
    id INT PRIMARY KEY AUTO_INCREMENT,
    pos_system_id INT NOT NULL,
    pos_program_id INT NOT NULL,
    external_customer_id VARCHAR(255) NOT NULL,
    
    -- Customer Information (from POS)
    customer_email VARCHAR(255),
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    
    -- Loyalty Status (synced from POS)
    current_points INT DEFAULT 0,
    lifetime_points INT DEFAULT 0,
    current_tier VARCHAR(100),
    tier_level INT DEFAULT 0,
    
    -- Statistics (from POS)
    total_visits INT DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0.00,
    last_visit_date DATE,
    
    -- Sync Information
    last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    sync_status ENUM('synced', 'pending', 'error') DEFAULT 'synced',
    sync_error TEXT,
    
    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (pos_system_id) REFERENCES pos_systems(id) ON DELETE CASCADE,
    FOREIGN KEY (pos_program_id) REFERENCES pos_loyalty_programs(id) ON DELETE CASCADE,
    UNIQUE KEY unique_pos_customer_loyalty (pos_system_id, pos_program_id, external_customer_id),
    INDEX idx_customer_email (customer_email),
    INDEX idx_current_tier (current_tier),
    INDEX idx_last_synced (last_synced)
);

-- POS Discount Integration (sync discount data from POS systems)
CREATE TABLE pos_discounts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    pos_system_id INT NOT NULL,
    external_discount_id VARCHAR(255) NOT NULL,
    
    -- Discount Details (synced from POS)
    discount_name VARCHAR(255) NOT NULL,
    discount_type ENUM('percentage', 'fixed_amount', 'buy_x_get_y', 'free_shipping', 'tiered', 'custom') NOT NULL,
    discount_value DECIMAL(10,2),
    discount_percentage DECIMAL(5,2),
    
    -- Discount Rules (from POS)
    minimum_order_amount DECIMAL(10,2),
    maximum_discount_amount DECIMAL(10,2),
    applies_to ENUM('order', 'product', 'category', 'customer_group', 'shipping') DEFAULT 'order',
    target_selection JSON, -- Store product IDs, category IDs, etc.
    
    -- Usage Limits (from POS)
    usage_limit_total INT,
    usage_limit_per_customer INT,
    current_usage_count INT DEFAULT 0,
    
    -- Date Restrictions (from POS)
    starts_at DATETIME,
    ends_at DATETIME,
    
    -- Customer Restrictions (from POS)
    customer_eligibility ENUM('all', 'specific_customers', 'customer_groups', 'new_customers', 'returning_customers') DEFAULT 'all',
    eligible_customer_groups JSON,
    
    -- Status and Conditions (from POS)
    status VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    requires_code BOOLEAN DEFAULT FALSE,
    discount_code VARCHAR(100),
    stackable BOOLEAN DEFAULT FALSE,
    
    -- Sync Information
    last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    sync_status ENUM('synced', 'pending', 'error') DEFAULT 'synced',
    sync_error TEXT,
    
    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (pos_system_id) REFERENCES pos_systems(id) ON DELETE CASCADE,
    UNIQUE KEY unique_pos_discount (pos_system_id, external_discount_id),
    INDEX idx_discount_name (discount_name),
    INDEX idx_discount_type (discount_type),
    INDEX idx_discount_code (discount_code),
    INDEX idx_status (status),
    INDEX idx_starts_at (starts_at),
    INDEX idx_ends_at (ends_at),
    INDEX idx_last_synced (last_synced)
);

-- POS Discount Usage Tracking (sync usage data from POS systems)
CREATE TABLE pos_discount_usage (
    id INT PRIMARY KEY AUTO_INCREMENT,
    pos_discount_id INT NOT NULL,
    pos_system_id INT NOT NULL,
    external_usage_id VARCHAR(255),
    
    -- Usage Details (from POS)
    customer_email VARCHAR(255),
    customer_name VARCHAR(255),
    order_reference VARCHAR(255),
    discount_amount_applied DECIMAL(10,2) NOT NULL,
    order_total DECIMAL(10,2),
    
    -- Usage Context (from POS)
    usage_date DATETIME NOT NULL,
    pos_location VARCHAR(255),
    sales_channel ENUM('online', 'in_store', 'mobile', 'phone', 'other') DEFAULT 'online',
    
    -- Sync Information
    last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    sync_status ENUM('synced', 'pending', 'error') DEFAULT 'synced',
    sync_error TEXT,
    
    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (pos_discount_id) REFERENCES pos_discounts(id) ON DELETE CASCADE,
    FOREIGN KEY (pos_system_id) REFERENCES pos_systems(id) ON DELETE CASCADE,
    UNIQUE KEY unique_pos_usage (pos_system_id, external_usage_id),
    INDEX idx_customer_email (customer_email),
    INDEX idx_usage_date (usage_date),
    INDEX idx_order_reference (order_reference),
    INDEX idx_sales_channel (sales_channel),
    INDEX idx_last_synced (last_synced)
);

-- Email Collection Campaigns (customizable email signup prompts)
CREATE TABLE email_campaigns (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    -- Campaign Details
    campaign_name VARCHAR(255) NOT NULL,
    campaign_description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Display Settings
    prompt_title VARCHAR(255) NOT NULL DEFAULT 'Join Our Newsletter',
    prompt_message TEXT NOT NULL,
    button_text VARCHAR(100) NOT NULL DEFAULT 'Sign Me Up',
    
    -- Offer Configuration
    offer_type ENUM('discount_percentage', 'discount_fixed', 'free_shipping', 'exclusive_access', 'early_access', 'gift_with_purchase', 'loyalty_points', 'custom') NOT NULL,
    offer_value DECIMAL(10,2), -- For discount amounts or point values
    offer_description VARCHAR(255) NOT NULL, -- e.g., "10% off your first order"
    offer_code VARCHAR(50), -- Discount code to provide
    offer_expiry_days INT DEFAULT 30, -- How long the offer is valid
    
    -- Display Behavior
    display_type ENUM('popup', 'banner', 'inline', 'exit_intent') DEFAULT 'popup',
    display_delay INT DEFAULT 5, -- Seconds before showing
    display_frequency ENUM('once_per_session', 'once_per_day', 'once_per_week', 'always') DEFAULT 'once_per_session',
    
    -- Targeting Rules
    target_pages JSON, -- Which pages to show on (null = all pages)
    target_new_visitors BOOLEAN DEFAULT TRUE,
    target_returning_visitors BOOLEAN DEFAULT FALSE,
    min_time_on_site INT DEFAULT 0, -- Seconds
    
    -- A/B Testing
    ab_test_variant ENUM('A', 'B') DEFAULT 'A',
    ab_test_traffic_split INT DEFAULT 100, -- Percentage of traffic to show to
    
    -- Audit
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_is_active (is_active),
    INDEX idx_offer_type (offer_type),
    INDEX idx_display_type (display_type),
    INDEX idx_ab_variant (ab_test_variant)
);

-- Email Subscribers (collected emails with campaign tracking)
CREATE TABLE email_subscribers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    -- Subscriber Details
    email VARCHAR(255) NOT NULL UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    
    -- Subscription Details
    campaign_id INT, -- Which campaign they signed up from
    offer_claimed BOOLEAN DEFAULT FALSE,
    offer_code_sent VARCHAR(50), -- The specific code sent to them
    offer_expires_at DATETIME,
    
    -- Status and Preferences
    status ENUM('active', 'unsubscribed', 'bounced', 'complained') DEFAULT 'active',
    subscription_source VARCHAR(100) DEFAULT 'website',
    
    -- Engagement Tracking
    signup_ip VARCHAR(45),
    signup_user_agent TEXT,
    signup_referrer VARCHAR(500),
    
    -- Email Marketing Integration
    mailchimp_id VARCHAR(255),
    klaviyo_id VARCHAR(255),
    sendgrid_id VARCHAR(255),
    
    -- Audit
    subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    unsubscribed_at TIMESTAMP NULL,
    last_email_sent TIMESTAMP NULL,
    
    FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE SET NULL,
    INDEX idx_email (email),
    INDEX idx_status (status),
    INDEX idx_campaign_id (campaign_id),
    INDEX idx_subscribed_at (subscribed_at),
    INDEX idx_offer_claimed (offer_claimed)
);

-- Email Campaign Analytics (track performance)
CREATE TABLE email_campaign_analytics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    campaign_id INT NOT NULL,
    
    -- Daily Metrics
    date DATE NOT NULL,
    impressions INT DEFAULT 0, -- How many times shown
    signups INT DEFAULT 0, -- How many emails collected
    conversion_rate DECIMAL(5,2) DEFAULT 0.00, -- signups/impressions * 100
    
    -- Offer Metrics
    offers_claimed INT DEFAULT 0,
    offer_claim_rate DECIMAL(5,2) DEFAULT 0.00, -- claimed/signups * 100
    
    -- Revenue Impact (if trackable)
    attributed_orders INT DEFAULT 0,
    attributed_revenue DECIMAL(10,2) DEFAULT 0.00,
    
    -- A/B Testing Metrics
    variant ENUM('A', 'B') DEFAULT 'A',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE,
    UNIQUE KEY unique_campaign_date_variant (campaign_id, date, variant),
    INDEX idx_date (date),
    INDEX idx_campaign_id (campaign_id)
);
