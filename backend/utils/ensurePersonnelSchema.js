'use strict';

const logger = require('./logger');

const TABLES = {
    pos_employees: `
        CREATE TABLE IF NOT EXISTS pos_employees (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_code VARCHAR(8) NOT NULL COMMENT 'Unique employee ID for shifts/reports',
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            email VARCHAR(255) NULL,
            pin_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt hash of 4-digit POS PIN',
            admin_user_id INT NULL,
            hourly_rate DECIMAL(8,2) NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_pos_employee_code (employee_code),
            INDEX idx_pos_employee_active (is_active),
            FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
        )`,

    pos_scheduled_shifts: `
        CREATE TABLE IF NOT EXISTS pos_scheduled_shifts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            starts_at DATETIME NOT NULL,
            ends_at DATETIME NOT NULL,
            notes VARCHAR(500) NULL,
            created_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_scheduled_employee (employee_id),
            INDEX idx_scheduled_starts (starts_at),
            FOREIGN KEY (employee_id) REFERENCES pos_employees(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
        )`,

    pos_shift_sessions: `
        CREATE TABLE IF NOT EXISTS pos_shift_sessions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            scheduled_shift_id INT NULL,
            device_id VARCHAR(64) NULL,
            status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
            opened_at DATETIME NOT NULL,
            closed_at DATETIME NULL,
            opening_cash DECIMAL(10,2) NOT NULL DEFAULT 0,
            closing_cash DECIMAL(10,2) NULL,
            expected_cash DECIMAL(10,2) NULL,
            over_short_amount DECIMAL(10,2) NULL,
            cash_sales_total DECIMAL(10,2) NOT NULL DEFAULT 0,
            card_sales_total DECIMAL(10,2) NOT NULL DEFAULT 0,
            check_sales_total DECIMAL(10,2) NOT NULL DEFAULT 0,
            notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_shift_employee (employee_id),
            INDEX idx_shift_status (status),
            INDEX idx_shift_opened (opened_at),
            FOREIGN KEY (employee_id) REFERENCES pos_employees(id) ON DELETE CASCADE,
            FOREIGN KEY (scheduled_shift_id) REFERENCES pos_scheduled_shifts(id) ON DELETE SET NULL
        )`,

    pos_cash_drawer_events: `
        CREATE TABLE IF NOT EXISTS pos_cash_drawer_events (
            id INT AUTO_INCREMENT PRIMARY KEY,
            shift_session_id INT NOT NULL,
            event_type ENUM('paid_out', 'drop', 'cash_in') NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            reason VARCHAR(255) NULL,
            recorded_by_employee_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_cash_shift (shift_session_id),
            FOREIGN KEY (shift_session_id) REFERENCES pos_shift_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (recorded_by_employee_id) REFERENCES pos_employees(id) ON DELETE SET NULL
        )`,

    pos_time_entries: `
        CREATE TABLE IF NOT EXISTS pos_time_entries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            shift_session_id INT NULL,
            clock_in DATETIME NOT NULL,
            clock_out DATETIME NULL,
            source ENUM('pos', 'admin') NOT NULL DEFAULT 'pos',
            notes VARCHAR(500) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_time_employee (employee_id),
            INDEX idx_time_clock_in (clock_in),
            FOREIGN KEY (employee_id) REFERENCES pos_employees(id) ON DELETE CASCADE,
            FOREIGN KEY (shift_session_id) REFERENCES pos_shift_sessions(id) ON DELETE SET NULL
        )`
};

const ORDER_PATCHES = [
    {
        column: 'pos_employee_id',
        sql: 'ALTER TABLE orders ADD COLUMN pos_employee_id INT NULL'
    },
    {
        column: 'pos_shift_session_id',
        sql: 'ALTER TABLE orders ADD COLUMN pos_shift_session_id INT NULL'
    }
];

const PAYMENT_CARD_PATCHES = [
    {
        column: 'nmi_customer_vault_id',
        sql: 'ALTER TABLE payment_cards ADD COLUMN nmi_customer_vault_id VARCHAR(64) NULL'
    },
    {
        column: 'nmi_billing_id',
        sql: 'ALTER TABLE payment_cards ADD COLUMN nmi_billing_id VARCHAR(64) NULL'
    }
];

async function columnExists(pool, tableName, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows[0].c) > 0;
}

async function tableExists(pool, tableName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return Number(rows[0].c) > 0;
}

function isDuplicateError(e) {
    return (
        e?.errno === 1060 ||
        e?.errno === 1061 ||
        e?.code === 'ER_DUP_FIELDNAME' ||
        /duplicate/i.test(e?.message || '')
    );
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
            logger.warn(`Database: personnel patch failed — ${logger.formatMysqlError(e)}`);
        }
    }
}

async function ensurePersonnelSchema(pool) {
    for (const [name, sql] of Object.entries(TABLES)) {
        try {
            await pool.query(sql);
            logger.info(`Database: ensured table ${name}`);
        } catch (e) {
            logger.warn(`Database: ${name} — ${logger.formatMysqlError(e)}`);
        }
    }
    await applyColumnPatches(pool, 'orders', ORDER_PATCHES);
    await applyColumnPatches(pool, 'payment_cards', PAYMENT_CARD_PATCHES);
    await applyColumnPatches(pool, 'admin_users', [
        {
            column: 'can_manage_store_hours',
            sql: `ALTER TABLE admin_users ADD COLUMN can_manage_store_hours TINYINT(1) NOT NULL DEFAULT 0
                  COMMENT 'When 1, Manager role may edit store hours and holidays'`,
        },
    ]);
    await applyColumnPatches(pool, 'pos_employees', [
        {
            column: 'can_authorize',
            sql: `ALTER TABLE pos_employees ADD COLUMN can_authorize TINYINT(1) NOT NULL DEFAULT 0
                  COMMENT 'May approve POS discounts with their PIN'`,
        },
        {
            column: 'can_process_refunds',
            sql: `ALTER TABLE pos_employees ADD COLUMN can_process_refunds TINYINT(1) NOT NULL DEFAULT 0
                  COMMENT 'May process in-store POS refunds with their register PIN'`,
        },
        {
            column: 'can_open_drawer',
            sql: `ALTER TABLE pos_employees ADD COLUMN can_open_drawer TINYINT(1) NOT NULL DEFAULT 0
                  COMMENT 'May manually open cash drawer from register'`,
        },
        {
            column: 'allow_manual_discounts',
            sql: `ALTER TABLE pos_employees ADD COLUMN allow_manual_discounts TINYINT(1) NOT NULL DEFAULT 0
                  COMMENT 'May apply manual line or cart discounts at register'`,
        },
        {
            column: 'can_view_cost',
            sql: `ALTER TABLE pos_employees ADD COLUMN can_view_cost TINYINT(1) NOT NULL DEFAULT 0
                  COMMENT 'May see product cost in POS cart when store cost display is enabled'`,
        },
    ]);
    try {
        if (await tableExists(pool, 'payment_cards')) {
            await pool.query(
                `ALTER TABLE payment_cards MODIFY payment_processor VARCHAR(32) NOT NULL DEFAULT 'nmi'`
            );
        }
    } catch (e) {
        if (!isDuplicateError(e)) {
            logger.warn(`Database: payment_processor column — ${logger.formatMysqlError(e)}`);
        }
    }
}

module.exports = { ensurePersonnelSchema };
