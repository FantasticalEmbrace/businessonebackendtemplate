'use strict';

const logger = require('./logger');

let ensured = false;

async function tableExists(pool, tableName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return Number(rows[0].c) > 0;
}

async function columnExists(pool, tableName, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows[0].c) > 0;
}

const SERVICE_METADATA = {
    pos: {
        icon_class: 'fas fa-cash-register',
        overview:
            'Our Point of Sale systems are designed to help businesses of all sizes manage their sales operations efficiently. With real-time inventory tracking, comprehensive reporting, and seamless payment integration, you can focus on growing your business while we handle the technology.',
        features: [
            'Real-time inventory tracking',
            'Sales reporting and analytics',
            'Multi-location support',
            'Customer management',
            'Integration with payment processors',
            'Mobile and tablet compatible'
        ]
    },
    payment: {
        icon_class: 'fas fa-credit-card',
        overview:
            'Accept payments seamlessly with our secure payment processing solutions. We offer competitive rates, multiple payment methods including credit cards, debit cards, and digital wallets. Our 24/7 fraud monitoring ensures your transactions are always secure.',
        features: [
            'Competitive processing rates',
            'Secure payment gateway',
            'Multiple payment methods',
            '24/7 fraud monitoring',
            'Quick settlement times',
            'Dedicated account manager'
        ]
    },
    phone: {
        icon_class: 'fas fa-phone-alt',
        overview:
            'Stay connected with clients and team members using our advanced business phone systems. Our hold queue technology ensures customers never hear continuous ringing or busy signals, providing a professional experience. Features include voicemail to email, call forwarding, conference calling, and mobile app integration.',
        features: [
            'Professional hold queues',
            'Voicemail to email',
            'Call forwarding and routing',
            'Conference calling',
            'Mobile app integration',
            'Unlimited calling plans'
        ]
    },
    website: {
        icon_class: 'fas fa-globe',
        overview:
            'Establish a strong online presence with our professional website development services. We create responsive, SEO-optimized websites that work seamlessly across all devices. Whether you need a simple business site or a full e-commerce platform, we have the expertise to bring your vision to life.',
        features: [
            'Responsive design',
            'SEO optimization',
            'Content management system',
            'E-commerce integration',
            'Mobile-first approach',
            'Ongoing support and maintenance'
        ]
    }
};

async function ensureMenuSchema(pool) {
    if (ensured || !pool) return;
    ensured = true;

    try {
        if (!(await tableExists(pool, 'menu_api_keys'))) {
            await pool.query(`
                CREATE TABLE menu_api_keys (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    api_key VARCHAR(255) UNIQUE NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    is_active TINYINT(1) DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_used_at TIMESTAMP NULL,
                    INDEX idx_api_key (api_key),
                    INDEX idx_is_active (is_active)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        }

        if (!(await tableExists(pool, 'menu_items'))) {
            await pool.query(`
                CREATE TABLE menu_items (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    item_id VARCHAR(100) UNIQUE NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    price DECIMAL(10, 2) NULL,
                    image_url VARCHAR(500) NULL,
                    category VARCHAR(100) NULL,
                    icon_class VARCHAR(100) NULL,
                    overview TEXT NULL,
                    features_json JSON NULL,
                    display_order INT DEFAULT 0,
                    is_active TINYINT(1) DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_category (category),
                    INDEX idx_is_active (is_active),
                    INDEX idx_display_order (display_order)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        }

        for (const col of ['icon_class', 'overview', 'features_json']) {
            if (!(await columnExists(pool, 'menu_items', col))) {
                if (col === 'icon_class') {
                    await pool.query(
                        `ALTER TABLE menu_items ADD COLUMN icon_class VARCHAR(100) NULL AFTER category`
                    );
                } else if (col === 'overview') {
                    await pool.query(`ALTER TABLE menu_items ADD COLUMN overview TEXT NULL AFTER description`);
                } else {
                    await pool.query(
                        `ALTER TABLE menu_items ADD COLUMN features_json JSON NULL AFTER overview`
                    );
                }
            }
        }

        await pool.query(`
            INSERT INTO menu_items (item_id, name, description, category, display_order) VALUES
            ('pos', 'Point of Sale (POS)', 'Modern, efficient POS systems to streamline your sales process and inventory management.', 'pos', 1),
            ('payment', 'Payment Processing', 'Secure, reliable payment processing solutions with competitive rates and excellent support.', 'payment', 2),
            ('phone', 'Phone Service', 'Business phone systems with advanced features, including hold queues that ensure your customers never hear continuous ringing or a busy signal.', 'phone', 3),
            ('website', 'Website Development', 'Professional website design and development to establish your online presence and attract customers.', 'website', 4)
            ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)
        `);

        for (const [itemId, meta] of Object.entries(SERVICE_METADATA)) {
            await pool.query(
                `UPDATE menu_items SET
                    icon_class = ?,
                    overview = ?,
                    features_json = CAST(? AS JSON)
                 WHERE item_id = ?
                   AND (
                       icon_class IS NULL
                       OR overview IS NULL
                       OR features_json IS NULL
                       OR JSON_LENGTH(COALESCE(features_json, JSON_ARRAY())) = 0
                   )`,
                [meta.icon_class, meta.overview, JSON.stringify(meta.features), itemId]
            );
        }

        logger.info('Database: ensured Business One menu tables');
    } catch (err) {
        ensured = false;
        logger.warn('Database: ensureMenuSchema failed', { err: err.message });
    }
}

module.exports = { ensureMenuSchema };
