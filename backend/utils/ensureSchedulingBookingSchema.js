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
            logger.warn('Database: scheduling_bookings table not found; skipping Scheduling column patches');
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
