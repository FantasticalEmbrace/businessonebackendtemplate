'use strict';

const { normalizeCustomerEmail } = require('../utils/customerEmail');

const SETTINGS_KEY = 'abandoned_cart_master_enabled';

function roundMoney(n) {
    return Math.round(Number(n) * 100) / 100;
}

function normalizeEmail(email) {
    return normalizeCustomerEmail(email);
}

function delayToMs(program) {
    const value = Math.max(1, Number(program.delay_value) || 1);
    const unit = String(program.delay_unit || 'days').toLowerCase();
    if (unit === 'hours') return value * 60 * 60 * 1000;
    if (unit === 'weeks') return value * 7 * 24 * 60 * 60 * 1000;
    return value * 24 * 60 * 60 * 1000;
}

function matchesSubtotalThreshold(program, subtotal) {
    const amount = roundMoney(subtotal);
    if (program.min_subtotal != null && amount < roundMoney(program.min_subtotal)) return false;
    if (program.max_subtotal != null && amount > roundMoney(program.max_subtotal)) return false;
    return true;
}

function sanitizeProgramInput(raw = {}) {
    const name = String(raw.name || '').trim();
    if (!name) {
        const err = new Error('Program name is required');
        err.code = 'INVALID_PROGRAM';
        throw err;
    }

    const delayValue = Math.max(1, parseInt(raw.delay_value, 10) || 1);
    const delayUnit = ['hours', 'days', 'weeks'].includes(String(raw.delay_unit || '').toLowerCase())
        ? String(raw.delay_unit).toLowerCase()
        : 'days';
    const triggerType = ['time', 'item_on_sale'].includes(String(raw.trigger_type || '').toLowerCase())
        ? String(raw.trigger_type).toLowerCase()
        : 'time';
    const discountType = ['none', 'percent', 'fixed'].includes(String(raw.discount_type || '').toLowerCase())
        ? String(raw.discount_type).toLowerCase()
        : 'none';

    let minSubtotal = raw.min_subtotal;
    if (minSubtotal === '' || minSubtotal == null) minSubtotal = null;
    else minSubtotal = roundMoney(minSubtotal);

    let maxSubtotal = raw.max_subtotal;
    if (maxSubtotal === '' || maxSubtotal == null) maxSubtotal = null;
    else maxSubtotal = roundMoney(maxSubtotal);

    if (minSubtotal != null && maxSubtotal != null && minSubtotal > maxSubtotal) {
        const err = new Error('Minimum cart subtotal cannot exceed maximum');
        err.code = 'INVALID_PROGRAM';
        throw err;
    }

    let discountValue = raw.discount_value;
    if (discountType === 'none') discountValue = null;
    else if (discountValue == null || discountValue === '') {
        const err = new Error('Discount value is required when a discount type is selected');
        err.code = 'INVALID_PROGRAM';
        throw err;
    } else {
        discountValue = roundMoney(discountValue);
        if (discountType === 'percent' && (discountValue <= 0 || discountValue > 100)) {
            const err = new Error('Percent discount must be between 0 and 100');
            err.code = 'INVALID_PROGRAM';
            throw err;
        }
    }

    return {
        name: name.slice(0, 120),
        is_active: raw.is_active === false || raw.is_active === 0 || raw.is_active === '0' ? 0 : 1,
        sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
        min_subtotal: minSubtotal,
        max_subtotal: maxSubtotal,
        delay_value: delayValue,
        delay_unit: delayUnit,
        trigger_type: triggerType,
        discount_type: discountType,
        discount_value: discountValue,
        promo_code: raw.promo_code ? String(raw.promo_code).trim().slice(0, 64) : null,
        email_subject: String(raw.email_subject || 'You left something in your cart').trim().slice(0, 255),
        email_intro: raw.email_intro != null ? String(raw.email_intro).trim().slice(0, 4000) : null,
        require_marketing_opt_in:
            raw.require_marketing_opt_in === true ||
            raw.require_marketing_opt_in === 1 ||
            raw.require_marketing_opt_in === '1'
                ? 1
                : 0,
    };
}

function rowToProgram(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        isActive: Boolean(row.is_active),
        isStarterGuide: Boolean(row.is_starter_guide),
        sortOrder: row.sort_order,
        minSubtotal: row.min_subtotal != null ? Number(row.min_subtotal) : null,
        maxSubtotal: row.max_subtotal != null ? Number(row.max_subtotal) : null,
        delayValue: row.delay_value,
        delayUnit: row.delay_unit,
        triggerType: row.trigger_type,
        discountType: row.discount_type,
        discountValue: row.discount_value != null ? Number(row.discount_value) : null,
        promoCode: row.promo_code || null,
        emailSubject: row.email_subject,
        emailIntro: row.email_intro || '',
        requireMarketingOptIn: Boolean(row.require_marketing_opt_in),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

async function getMasterEnabled(pool) {
    const [rows] = await pool.execute(
        'SELECT value FROM settings WHERE key_name = ? LIMIT 1',
        [SETTINGS_KEY]
    );
    if (!rows.length) return true;
    const v = String(rows[0].value || '').trim().toLowerCase();
    return v !== 'false' && v !== '0';
}

async function setMasterEnabled(pool, enabled) {
    await pool.execute(
        `INSERT INTO settings (key_name, value, description, type)
         VALUES (?, ?, 'Send abandoned cart emails when programs match', 'boolean')
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [SETTINGS_KEY, enabled ? 'true' : 'false']
    );
}

async function listPrograms(pool) {
    const [rows] = await pool.execute(
        `SELECT * FROM abandoned_cart_programs ORDER BY sort_order ASC, id ASC`
    );
    return rows.map(rowToProgram);
}

async function getProgramById(pool, id) {
    const [rows] = await pool.execute('SELECT * FROM abandoned_cart_programs WHERE id = ? LIMIT 1', [id]);
    return rowToProgram(rows[0]);
}

async function createProgram(pool, input) {
    const p = sanitizeProgramInput(input);
    const [result] = await pool.execute(
        `INSERT INTO abandoned_cart_programs (
            name, is_active, sort_order, min_subtotal, max_subtotal,
            delay_value, delay_unit, trigger_type, discount_type, discount_value,
            promo_code, email_subject, email_intro, require_marketing_opt_in
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            p.name,
            p.is_active,
            p.sort_order,
            p.min_subtotal,
            p.max_subtotal,
            p.delay_value,
            p.delay_unit,
            p.trigger_type,
            p.discount_type,
            p.discount_value,
            p.promo_code,
            p.email_subject,
            p.email_intro,
            p.require_marketing_opt_in,
        ]
    );
    return getProgramById(pool, result.insertId);
}

async function updateProgram(pool, id, input) {
    const existing = await getProgramById(pool, id);
    if (!existing) return null;
    const p = sanitizeProgramInput({
        ...existing,
        ...input,
        min_subtotal: input.min_subtotal !== undefined ? input.min_subtotal : existing.minSubtotal,
        max_subtotal: input.max_subtotal !== undefined ? input.max_subtotal : existing.maxSubtotal,
        name: input.name ?? existing.name,
    });
    await pool.execute(
        `UPDATE abandoned_cart_programs SET
            name = ?, is_active = ?, sort_order = ?, min_subtotal = ?, max_subtotal = ?,
            delay_value = ?, delay_unit = ?, trigger_type = ?, discount_type = ?, discount_value = ?,
            promo_code = ?, email_subject = ?, email_intro = ?, require_marketing_opt_in = ?
         WHERE id = ?`,
        [
            p.name,
            p.is_active,
            p.sort_order,
            p.min_subtotal,
            p.max_subtotal,
            p.delay_value,
            p.delay_unit,
            p.trigger_type,
            p.discount_type,
            p.discount_value,
            p.promo_code,
            p.email_subject,
            p.email_intro,
            p.require_marketing_opt_in,
            id,
        ]
    );
    return getProgramById(pool, id);
}

async function deleteProgram(pool, id) {
    const [result] = await pool.execute('DELETE FROM abandoned_cart_programs WHERE id = ?', [id]);
    return result.affectedRows > 0;
}

async function getProgramStats(pool, programId) {
    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS sends, MAX(sent_at) AS last_sent_at
           FROM abandoned_cart_sends WHERE program_id = ?`,
        [programId]
    );
    return {
        sends: Number(rows[0]?.sends) || 0,
        lastSentAt: rows[0]?.last_sent_at || null,
    };
}

module.exports = {
    SETTINGS_KEY,
    roundMoney,
    normalizeEmail,
    delayToMs,
    matchesSubtotalThreshold,
    sanitizeProgramInput,
    getMasterEnabled,
    setMasterEnabled,
    listPrograms,
    getProgramById,
    createProgram,
    updateProgram,
    deleteProgram,
    getProgramStats,
};
