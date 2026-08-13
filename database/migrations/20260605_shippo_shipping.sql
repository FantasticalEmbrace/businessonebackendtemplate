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
