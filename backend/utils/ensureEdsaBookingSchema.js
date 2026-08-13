/**
 * Adds customer change-request columns on edsa_bookings when missing (idempotent).
 */
const logger = require('./logger');

async function tableExists(pool) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edsa_bookings'`
    );
    return Number(rows[0].c) > 0;
}

async function columnExists(pool, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edsa_bookings' AND COLUMN_NAME = ?`,
        [columnName]
    );
    return Number(rows[0].c) > 0;
}

async function ensureEdsaBookingSchema(pool) {
    try {
        if (!(await tableExists(pool))) {
            logger.warn('Database: edsa_bookings table not found; skipping EDSA column patches');
            return;
        }
    } catch (e) {
        logger.warn(`Database: could not inspect edsa_bookings — ${logger.formatMysqlError(e)}`);
        return;
    }

    const patches = [
        {
            column: 'customer_request_type',
            sql: `ALTER TABLE edsa_bookings ADD COLUMN customer_request_type
                  VARCHAR(20) NOT NULL DEFAULT 'none'
                  COMMENT 'none, cancel, reschedule'`,
        },
        {
            column: 'customer_request_notes',
            sql: 'ALTER TABLE edsa_bookings ADD COLUMN customer_request_notes TEXT NULL',
        },
        {
            column: 'requested_date',
            sql: 'ALTER TABLE edsa_bookings ADD COLUMN requested_date DATE NULL',
        },
        {
            column: 'requested_time',
            sql: 'ALTER TABLE edsa_bookings ADD COLUMN requested_time TIME NULL',
        },
        {
            column: 'customer_request_at',
            sql: 'ALTER TABLE edsa_bookings ADD COLUMN customer_request_at TIMESTAMP NULL',
        },
        {
            column: 'google_calendar_event_id',
            sql: 'ALTER TABLE edsa_bookings ADD COLUMN google_calendar_event_id VARCHAR(255) NULL',
        },
        {
            column: 'payment_status',
            sql: `ALTER TABLE edsa_bookings ADD COLUMN payment_status
                  ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending'`,
        },
        {
            column: 'payment_reference',
            sql: 'ALTER TABLE edsa_bookings ADD COLUMN payment_reference VARCHAR(128) NULL',
        },
        {
            column: 'amount_charged',
            sql: 'ALTER TABLE edsa_bookings ADD COLUMN amount_charged DECIMAL(10,2) NULL',
        },
    ];

    for (const patch of patches) {
        try {
            if (await columnExists(pool, patch.column)) continue;
            await pool.query(patch.sql);
            logger.info(`Database: added edsa_bookings.${patch.column}`);
        } catch (e) {
            logger.warn(
                `Database: could not add edsa_bookings.${patch.column} — ${logger.formatMysqlError(e)}`
            );
        }
    }
}

module.exports = { ensureEdsaBookingSchema };
