'use strict';

/**
 * Ensures vendor PO / receiving tables exist (idempotent).
 * Safe to call on server startup before mounting receiving routes.
 */
async function ensureColumn(pool, table, column, definition) {
    try {
        await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    } catch (err) {
        if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
    }
}

async function ensureVendorReceivingSchema(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS vendors (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL,
            status VARCHAR(32) NULL,
            catalog_url VARCHAR(1024) NULL,
            pos_ordering_enabled TINYINT(1) NOT NULL DEFAULT 1,
            last_catalog_sync_at DATETIME NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureColumn(pool, 'vendors', 'pos_ordering_enabled', 'TINYINT(1) NOT NULL DEFAULT 1');
    await ensureColumn(pool, 'vendors', 'last_catalog_sync_at', 'DATETIME NULL');
    await ensureColumn(pool, 'vendors', 'company_name', 'VARCHAR(255) NULL');
    await ensureColumn(pool, 'vendors', 'contact_person', 'VARCHAR(255) NULL');
    await ensureColumn(pool, 'vendors', 'email', 'VARCHAR(255) NULL');
    await ensureColumn(pool, 'vendors', 'phone', 'VARCHAR(50) NULL');
    await ensureColumn(pool, 'vendors', 'fax', 'VARCHAR(50) NULL');
    await ensureColumn(pool, 'vendors', 'website', 'VARCHAR(255) NULL');
    await ensureColumn(pool, 'vendors', 'address_line1', 'VARCHAR(255) NULL');
    await ensureColumn(pool, 'vendors', 'address_line2', 'VARCHAR(255) NULL');
    await ensureColumn(pool, 'vendors', 'city', 'VARCHAR(100) NULL');
    await ensureColumn(pool, 'vendors', 'state', 'VARCHAR(100) NULL');
    await ensureColumn(pool, 'vendors', 'postal_code', 'VARCHAR(20) NULL');
    await ensureColumn(pool, 'vendors', 'country', "VARCHAR(100) NULL DEFAULT 'United States'");
    await ensureColumn(pool, 'vendors', 'tax_id', 'VARCHAR(50) NULL');
    await ensureColumn(pool, 'vendors', 'business_license', 'VARCHAR(100) NULL');
    await ensureColumn(pool, 'vendors', 'account_number', 'VARCHAR(100) NULL');
    await ensureColumn(pool, 'vendors', 'payment_terms', "VARCHAR(32) NULL DEFAULT 'net_30'");
    await ensureColumn(pool, 'vendors', 'currency', "VARCHAR(3) NULL DEFAULT 'USD'");
    await ensureColumn(pool, 'vendors', 'catalog_format', "VARCHAR(16) NULL DEFAULT 'csv'");
    await ensureColumn(pool, 'vendors', 'catalog_auth_type', "VARCHAR(16) NULL DEFAULT 'none'");
    await ensureColumn(pool, 'vendors', 'catalog_auth_credentials', 'JSON NULL');
    await ensureColumn(pool, 'vendors', 'auto_sync_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn(pool, 'vendors', 'sync_frequency', "VARCHAR(16) NULL DEFAULT 'daily'");
    await ensureColumn(pool, 'vendors', 'rating', 'DECIMAL(3,2) NULL DEFAULT 0.00');
    await ensureColumn(pool, 'vendors', 'total_products', 'INT NULL DEFAULT 0');
    await ensureColumn(pool, 'vendors', 'last_catalog_sync', 'TIMESTAMP NULL');
    await ensureColumn(pool, 'vendors', 'created_by', 'INT NULL');
    await ensureColumn(pool, 'vendors', 'notes', 'TEXT NULL');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS vendor_products (
            id INT PRIMARY KEY AUTO_INCREMENT,
            vendor_id INT NOT NULL,
            product_id INT NOT NULL,
            vendor_sku VARCHAR(128) NULL,
            wholesale_price DECIMAL(12, 4) NULL,
            minimum_order_quantity INT NOT NULL DEFAULT 1,
            mapping_status VARCHAR(32) NULL,
            UNIQUE KEY uq_vendor_product (vendor_id, product_id),
            KEY idx_vp_vendor (vendor_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS vendor_purchase_orders (
            id INT PRIMARY KEY AUTO_INCREMENT,
            vendor_id INT NOT NULL,
            po_number VARCHAR(64) NOT NULL,
            vendor_reference VARCHAR(128) NULL,
            slip_barcode VARCHAR(128) NOT NULL,
            status ENUM('draft', 'submitted', 'open', 'partial', 'received', 'cancelled') NOT NULL DEFAULT 'draft',
            ordered_at DATETIME NULL,
            expected_at DATETIME NULL,
            received_at DATETIME NULL,
            notes TEXT NULL,
            created_by_admin_id INT NULL,
            order_source ENUM('admin', 'pos') NOT NULL DEFAULT 'admin',
            submitted_by_employee_id INT NULL,
            pos_device_id VARCHAR(64) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_vendor_po_number (vendor_id, po_number),
            UNIQUE KEY uq_slip_barcode (slip_barcode),
            KEY idx_vpo_status (status),
            KEY idx_vpo_vendor (vendor_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS vendor_purchase_order_lines (
            id INT PRIMARY KEY AUTO_INCREMENT,
            purchase_order_id INT NOT NULL,
            product_id INT NULL,
            variant_id INT NULL,
            vendor_sku VARCHAR(128) NULL,
            product_sku VARCHAR(128) NULL,
            description VARCHAR(512) NOT NULL,
            qty_ordered DECIMAL(12, 3) NOT NULL DEFAULT 0,
            qty_received DECIMAL(12, 3) NOT NULL DEFAULT 0,
            unit_cost DECIMAL(12, 4) NULL,
            sort_order INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_vpol_po (purchase_order_id),
            KEY idx_vpol_product (product_id),
            KEY idx_vpol_vendor_sku (vendor_sku),
            KEY idx_vpol_product_sku (product_sku)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS vendor_receiving_events (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            purchase_order_id INT NOT NULL,
            line_id INT NOT NULL,
            employee_id INT NULL,
            device_id VARCHAR(64) NULL,
            scan_code VARCHAR(128) NOT NULL,
            qty_delta DECIMAL(12, 3) NOT NULL DEFAULT 1,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_vre_po (purchase_order_id),
            KEY idx_vre_line (line_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

module.exports = { ensureVendorReceivingSchema };
