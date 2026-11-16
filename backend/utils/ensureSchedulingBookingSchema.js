/**
 * Adds customer change-request columns on scheduling_bookings when missing (idempotent).
 */
const logger = require('./logger');

async function tableExists(pool) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduling_bookings'`
    );
    return Number(rows[0].c) > 0;
}

async function columnExists(pool, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduling_bookings' AND COLUMN_NAME = ?`,
        [columnName]
    );
    return Number(rows[0].c) > 0;
}

async function ensureSchedulingBookingSchema(pool) {
    try {
        if (!(await tableExists(pool))) {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS scheduling_bookings (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    user_id INT NULL,
                    first_name VARCHAR(100) NOT NULL,
                    last_name VARCHAR(100) NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    phone VARCHAR(20) NOT NULL,
                    preferred_date DATE NOT NULL,
                    preferred_time TIME NOT NULL,
                    alternative_date DATE NULL,
                    alternative_time TIME NULL,
                    status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
                    notes TEXT NULL,
                    admin_notes TEXT NULL,
                    confirmed_date DATE NULL,
                    confirmed_time TIME NULL,
                    customer_request_type VARCHAR(20) NOT NULL DEFAULT 'none',
                    customer_request_notes TEXT NULL,
                    requested_date DATE NULL,
                    requested_time TIME NULL,
                    customer_request_at TIMESTAMP NULL,
                    google_calendar_event_id VARCHAR(255) NULL,
                    payment_status ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
                    payment_reference VARCHAR(128) NULL,
                    amount_charged DECIMAL(10,2) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_user_id (user_id),
                    INDEX idx_status (status),
                    INDEX idx_preferred_date (preferred_date),
                    INDEX idx_email (email)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            logger.info('Database: created scheduling_bookings table');
        }
    } catch (e) {
        logger.warn(`Database: could not ensure scheduling_bookings — ${logger.formatMysqlError(e)}`);
        return;
    }

    try {
        if (!(await tableExists(pool))) {
            logger.warn('Database: scheduling_bookings still missing after create attempt');
            return;
        }
    } catch (e) {
        logger.warn(`Database: could not inspect scheduling_bookings — ${logger.formatMysqlError(e)}`);
        return;
    }

    const patches = [
        {
            column: 'customer_request_type',
            sql: `ALTER TABLE scheduling_bookings ADD COLUMN customer_request_type
                  VARCHAR(20) NOT NULL DEFAULT 'none'
                  COMMENT 'none, cancel, reschedule'`,
        },
        {
            column: 'customer_request_notes',
            sql: 'ALTER TABLE scheduling_bookings ADD COLUMN customer_request_notes TEXT NULL',
        },
        {
            column: 'requested_date',
            sql: 'ALTER TABLE scheduling_bookings ADD COLUMN requested_date DATE NULL',
        },
        {
            column: 'requested_time',
            sql: 'ALTER TABLE scheduling_bookings ADD COLUMN requested_time TIME NULL',
        },
        {
            column: 'customer_request_at',
            sql: 'ALTER TABLE scheduling_bookings ADD COLUMN customer_request_at TIMESTAMP NULL',
        },
        {
            column: 'google_calendar_event_id',
            sql: 'ALTER TABLE scheduling_bookings ADD COLUMN google_calendar_event_id VARCHAR(255) NULL',
        },
        {
            column: 'payment_status',
            sql: `ALTER TABLE scheduling_bookings ADD COLUMN payment_status
                  ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending'`,
        },
        {
            column: 'payment_reference',
            sql: 'ALTER TABLE scheduling_bookings ADD COLUMN payment_reference VARCHAR(128) NULL',
        },
        {
            column: 'amount_charged',
            sql: 'ALTER TABLE scheduling_bookings ADD COLUMN amount_charged DECIMAL(10,2) NULL',
        },
    ];

    for (const patch of patches) {
        try {
            if (await columnExists(pool, patch.column)) continue;
            await pool.query(patch.sql);
            logger.info(`Database: added scheduling_bookings.${patch.column}`);
        } catch (e) {
            logger.warn(
                `Database: could not add scheduling_bookings.${patch.column} — ${logger.formatMysqlError(e)}`
            );
        }
    }
}

module.exports = { ensureSchedulingBookingSchema };
