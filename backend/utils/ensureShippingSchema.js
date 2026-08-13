'use strict';

const logger = require('./logger');

const ORDER_PATCHES = [
    { column: 'tracking_status', sql: 'ALTER TABLE orders ADD COLUMN tracking_status VARCHAR(64) NULL' },
    { column: 'tracking_status_detail', sql: 'ALTER TABLE orders ADD COLUMN tracking_status_detail VARCHAR(500) NULL' },
    { column: 'tracking_status_updated_at', sql: 'ALTER TABLE orders ADD COLUMN tracking_status_updated_at DATETIME NULL' },
    { column: 'label_created_at', sql: 'ALTER TABLE orders ADD COLUMN label_created_at TIMESTAMP NULL' },
    { column: 'shipped_email_sent', sql: 'ALTER TABLE orders ADD COLUMN shipped_email_sent TINYINT(1) NOT NULL DEFAULT 0' },
    { column: 'label_email_sent', sql: 'ALTER TABLE orders ADD COLUMN label_email_sent TINYINT(1) NOT NULL DEFAULT 0' },
    { column: 'shipping_method', sql: 'ALTER TABLE orders ADD COLUMN shipping_method VARCHAR(64) NULL' },
    { column: 'shipping_carrier', sql: 'ALTER TABLE orders ADD COLUMN shipping_carrier VARCHAR(32) NULL' },
    { column: 'shipping_service', sql: 'ALTER TABLE orders ADD COLUMN shipping_service VARCHAR(128) NULL' },
    { column: 'shippo_shipment_id', sql: 'ALTER TABLE orders ADD COLUMN shippo_shipment_id VARCHAR(64) NULL' },
    { column: 'shippo_rate_id', sql: 'ALTER TABLE orders ADD COLUMN shippo_rate_id VARCHAR(64) NULL' },
    { column: 'shippo_transaction_id', sql: 'ALTER TABLE orders ADD COLUMN shippo_transaction_id VARCHAR(64) NULL' },
    { column: 'label_url', sql: 'ALTER TABLE orders ADD COLUMN label_url VARCHAR(500) NULL' },
    { column: 'package_weight_oz', sql: 'ALTER TABLE orders ADD COLUMN package_weight_oz DECIMAL(10,2) NULL' },
    { column: 'shipping_box_id', sql: 'ALTER TABLE orders ADD COLUMN shipping_box_id INT NULL' },
    { column: 'payment_method', sql: 'ALTER TABLE orders ADD COLUMN payment_method VARCHAR(32) NULL' },
    { column: 'payment_reference', sql: 'ALTER TABLE orders ADD COLUMN payment_reference VARCHAR(128) NULL' },
    {
        column: 'sales_channel',
        sql: `ALTER TABLE orders ADD COLUMN sales_channel
              ENUM('online', 'in_store', 'mobile', 'phone', 'other') NOT NULL DEFAULT 'online'
              COMMENT 'online=website checkout; in_store=POS/retail'`
    },
];

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

function isDuplicateError(e) {
    return e?.errno === 1060 || e?.code === 'ER_DUP_FIELDNAME' || /duplicate column/i.test(e?.message || '');
}

async function applyColumnPatches(pool, tableName, patches) {
    if (!(await tableExists(pool, tableName))) return;
    for (const { column, sql } of patches) {
        try {
            if (await columnExists(pool, tableName, column)) continue;
            await pool.query(sql);
            logger.info(`Database: ${tableName} added column ${column}`);
        } catch (e) {
            if (isDuplicateError(e)) continue;
            logger.warn(`Database: shipping patch failed — ${logger.formatMysqlError(e)}`);
        }
    }
}

async function ensureShippingBoxesTable(pool) {
    await pool.query(`
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
        )
    `);

    const [existing] = await pool.query('SELECT COUNT(*) AS c FROM shipping_boxes');
    if (Number(existing[0].c) === 0) {
        await pool.query(`
            INSERT INTO shipping_boxes (name, length, width, height, empty_weight_oz, sort_order) VALUES
            ('Small Mailer', 6, 4, 2, 1.5, 1),
            ('Herb Bottle Box', 8, 6, 4, 2.5, 2),
            ('Medium Flat Box', 10, 8, 4, 3.5, 3),
            ('Large Multi-Item', 12, 10, 6, 5.0, 4)
        `);
        logger.info('Database: seeded default shipping_boxes');
    }
}

async function extendOrderStatusEnum(pool) {
    if (!(await tableExists(pool, 'orders'))) return;
    try {
        const [cols] = await pool.query(
            `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'status'`
        );
        const colType = cols[0]?.COLUMN_TYPE || '';
        if (colType.includes('label_created') && colType.includes('in_transit')) return;

        await pool.query(`
            ALTER TABLE orders MODIFY COLUMN status
            ENUM('pending','processing','label_created','shipped','in_transit','delivered','cancelled','refunded')
            NOT NULL DEFAULT 'pending'
        `);
        logger.info('Database: orders.status enum extended for automated shipping');
    } catch (e) {
        logger.warn(`Database: orders.status enum extension — ${logger.formatMysqlError(e)}`);
    }
}

async function ensureShippingSchema(pool) {
    await ensureShippingBoxesTable(pool);
    await applyColumnPatches(pool, 'orders', ORDER_PATCHES);
    await extendOrderStatusEnum(pool);
}

module.exports = { ensureShippingSchema };
