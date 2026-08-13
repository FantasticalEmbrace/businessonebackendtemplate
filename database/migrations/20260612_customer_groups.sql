-- Customer groups for promotions, pricing rules, and admin segmentation

CREATE TABLE IF NOT EXISTS customer_groups (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_customer_groups_slug (slug),
    INDEX idx_customer_groups_active (is_active)
);

CREATE TABLE IF NOT EXISTS user_customer_groups (
    user_id INT NOT NULL,
    customer_group_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, customer_group_id),
    INDEX idx_ucg_group (customer_group_id),
    CONSTRAINT fk_ucg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_ucg_group FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
);
