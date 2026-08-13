'use strict';

const logger = require('../utils/logger');
const { normalizeDateYmd } = require('../utils/storeTimezone');

async function tableExists(pool) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edsa_blocked_dates'`
    );
    return Number(rows[0].c) > 0;
}

async function listBlockedDates(pool, fromYmd = null, toYmd = null) {
    if (!(await tableExists(pool))) return [];

    const conditions = [];
    const params = [];
    const from = normalizeDateYmd(fromYmd);
    const to = normalizeDateYmd(toYmd);

    if (from) {
        conditions.push('block_date >= ?');
        params.push(from);
    }
    if (to) {
        conditions.push('block_date <= ?');
        params.push(to);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
        `SELECT id, block_date, reason, created_at
           FROM edsa_blocked_dates
          ${where}
          ORDER BY block_date ASC`,
        params
    );

    return rows.map((row) => ({
        id: row.id,
        date: normalizeDateYmd(row.block_date) || String(row.block_date).slice(0, 10),
        reason: row.reason || null,
        createdAt: row.created_at,
    }));
}

async function blockedDateSet(pool, fromYmd = null, toYmd = null) {
    const rows = await listBlockedDates(pool, fromYmd, toYmd);
    return new Set(rows.map((r) => r.date));
}

async function addBlockedDate(pool, dateYmd, reason = null, adminId = null) {
    const ymd = normalizeDateYmd(dateYmd);
    if (!ymd) {
        const err = new Error('Invalid date');
        err.status = 400;
        throw err;
    }

    if (!(await tableExists(pool))) {
        const err = new Error('Blocked dates are not available yet');
        err.status = 503;
        throw err;
    }

    try {
        await pool.execute(
            `INSERT INTO edsa_blocked_dates (block_date, reason, created_by_admin_id)
             VALUES (?, ?, ?)`,
            [ymd, reason ? String(reason).trim().slice(0, 500) : null, adminId || null]
        );
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            const err = new Error('That date is already blocked');
            err.status = 409;
            throw err;
        }
        throw e;
    }

    return { date: ymd, reason: reason || null };
}

async function removeBlockedDate(pool, dateYmd) {
    const ymd = normalizeDateYmd(dateYmd);
    if (!ymd) {
        const err = new Error('Invalid date');
        err.status = 400;
        throw err;
    }

    if (!(await tableExists(pool))) {
        const err = new Error('Blocked dates are not available yet');
        err.status = 503;
        throw err;
    }

    const [result] = await pool.execute('DELETE FROM edsa_blocked_dates WHERE block_date = ?', [ymd]);
    if (!result.affectedRows) {
        const err = new Error('Blocked date not found');
        err.status = 404;
        throw err;
    }
    return { date: ymd };
}

async function ensureEdsaBlockedDatesTable(pool) {
    try {
        if (await tableExists(pool)) return;

        await pool.query(`
            CREATE TABLE edsa_blocked_dates (
                id INT PRIMARY KEY AUTO_INCREMENT,
                block_date DATE NOT NULL,
                reason VARCHAR(500) NULL,
                created_by_admin_id INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_edsa_blocked_date (block_date),
                INDEX idx_block_date (block_date)
            )
        `);
        logger.info('Database: created edsa_blocked_dates table');
    } catch (e) {
        logger.warn(`Database: could not create edsa_blocked_dates — ${logger.formatMysqlError(e)}`);
    }
}

module.exports = {
    listBlockedDates,
    blockedDateSet,
    addBlockedDate,
    removeBlockedDate,
    ensureEdsaBlockedDatesTable,
};
