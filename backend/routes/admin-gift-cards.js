// Admin gift card management routes.
// Mounted under /api/admin/gift-cards in server.js.
//
// Supports:
//   - Listing / searching gift cards
//   - Issuing digital gift cards (auto-generated code, optional customer assignment)
//   - Registering physical gift cards (single or bulk)
//   - Adjusting balance (admin reload, manual adjust)
//   - Manual redemption
//   - Status changes (cancel / mark lost / activate)
//   - Transaction history
//   - Balance lookup by code (also useful for kiosks/admin)

const express = require('express');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const {
    generateGiftCardCode,
    generateGiftCardPin,
    normalizeCode,
} = require('../utils/giftCardCodes');
const { jsonSafeDeep } = require('../utils/jsonSafeMysql');

const router = express.Router();

async function authenticateAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Admin access token required' });
    if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'Server configuration error' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [rows] = await req.pool.execute(
            'SELECT id, email, first_name, last_name, role FROM admin_users WHERE id = ? AND is_active = 1',
            [decoded.adminId]
        );
        if (!rows.length) return res.status(401).json({ error: 'Invalid admin token' });
        req.admin = rows[0];
        next();
    } catch {
        return res.status(403).json({ error: 'Invalid admin token' });
    }
}

router.use(authenticateAdmin);

async function recordTransaction(pool, {
    gift_card_id, transaction_type, amount, balance_before, balance_after,
    source = 'admin', order_id = null, customer_id = null, admin_user_id = null,
    description = null, metadata = null
}) {
    await pool.execute(
        `INSERT INTO gift_card_transactions
            (gift_card_id, transaction_type, amount, balance_before, balance_after,
             source, order_id, customer_id, admin_user_id,
             description, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            gift_card_id, transaction_type, amount, balance_before, balance_after,
            source, order_id, customer_id, admin_user_id,
            description, metadata ? JSON.stringify(metadata) : null
        ]
    );
}

// ---------------------------------------------------------------------------
// LIST gift cards
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
        const offset = (page - 1) * limit;
        const { search, status, card_type, customer_id } = req.query;

        const where = [];
        const params = [];
        if (search) {
            where.push(`(gc.code LIKE ? OR gc.physical_serial_number LIKE ? OR gc.recipient_email LIKE ? OR gc.recipient_name LIKE ?)`);
            const like = `%${normalizeCode(search) || search}%`;
            params.push(like, like, like, like);
        }
        if (status)      { where.push('gc.status = ?');     params.push(status); }
        if (card_type)   { where.push('gc.card_type = ?');  params.push(card_type); }
        if (customer_id) { where.push('gc.customer_id = ?'); params.push(parseInt(customer_id, 10)); }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const limitSql = String(Math.min(200, Math.max(1, parseInt(String(limit), 10) || 1)));
        const offsetSql = String(Math.max(0, parseInt(String(offset), 10) || 0));

        const [rows] = await req.pool.query(
            `SELECT gc.*,
                    u.first_name AS customer_first_name,
                    u.last_name AS customer_last_name,
                    u.email AS customer_email
               FROM gift_cards gc
               LEFT JOIN users u ON u.id = gc.customer_id
               ${whereSql}
              ORDER BY gc.created_at DESC
              LIMIT ${limitSql} OFFSET ${offsetSql}`,
            params
        );

        const [countRows] = await req.pool.query(
            `SELECT COUNT(*) AS total FROM gift_cards gc ${whereSql}`,
            params
        );

        const totalNum = Number(countRows[0].total) || 0;

        res.json(
            jsonSafeDeep({
                gift_cards: rows,
                pagination: { page, limit, total: totalNum, totalPages: Math.ceil(totalNum / limit) || 0 },
            })
        );
    } catch (err) {
        logger.error('List gift cards error', { error: err.message, code: err.code });

        // Compatibility fallback when gift card schema drifts.
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
        return res.json(
            jsonSafeDeep({
                gift_cards: [],
                pagination: { page, limit, total: 0, totalPages: 0 },
                schema_warning: 'Using compatibility mode: gift card tables unavailable.',
            })
        );
    }
});

// ---------------------------------------------------------------------------
// GIFT CARD STATS
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
    try {
        const [[stats]] = await req.pool.execute(
            `SELECT
                COUNT(*) AS total_cards,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_cards,
                SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive_cards,
                SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) AS redeemed_cards,
                SUM(CASE WHEN card_type = 'physical' THEN 1 ELSE 0 END) AS physical_cards,
                SUM(CASE WHEN card_type = 'digital' THEN 1 ELSE 0 END) AS digital_cards,
                COALESCE(SUM(CASE WHEN status='active' THEN current_balance ELSE 0 END),0) AS active_balance,
                COALESCE(SUM(initial_balance),0) AS lifetime_issued,
                COALESCE(SUM(initial_balance - current_balance),0) AS lifetime_redeemed
              FROM gift_cards`
        );
        res.json(jsonSafeDeep(stats));
    } catch (err) {
        return res.json({
            total_cards: 0,
            active_cards: 0,
            inactive_cards: 0,
            redeemed_cards: 0,
            physical_cards: 0,
            digital_cards: 0,
            active_balance: 0,
            lifetime_issued: 0,
            lifetime_redeemed: 0,
            schema_warning: 'Using compatibility mode: gift card tables unavailable.',
        });
    }
});

// ---------------------------------------------------------------------------
// LOOKUP by code (admin / kiosk)
// ---------------------------------------------------------------------------
router.get('/lookup/:code', async (req, res) => {
    try {
        const code = normalizeCode(req.params.code);
        const [[card]] = await req.pool.execute(
            `SELECT gc.*, u.first_name, u.last_name, u.email
               FROM gift_cards gc
               LEFT JOIN users u ON u.id = gc.customer_id
              WHERE gc.code = ?`,
            [code]
        );
        if (!card) return res.status(404).json({ error: 'Gift card not found' });
        res.json(jsonSafeDeep({ gift_card: card }));
    } catch (err) {
        res.status(500).json({ error: 'Failed to look up gift card' });
    }
});

// ---------------------------------------------------------------------------
// GET single gift card (with full transaction history)
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const [[card]] = await req.pool.execute(
            `SELECT gc.*, u.first_name AS customer_first_name, u.last_name AS customer_last_name,
                    u.email AS customer_email, u.customer_number
               FROM gift_cards gc
               LEFT JOIN users u ON u.id = gc.customer_id
              WHERE gc.id = ?`,
            [id]
        );
        if (!card) return res.status(404).json({ error: 'Gift card not found' });

        const [transactions] = await req.pool.execute(
            `SELECT t.*, au.first_name AS admin_first_name, au.last_name AS admin_last_name
               FROM gift_card_transactions t
               LEFT JOIN admin_users au ON au.id = t.admin_user_id
              WHERE gift_card_id = ?
              ORDER BY t.created_at DESC`,
            [id]
        );

        res.json(jsonSafeDeep({ gift_card: card, transactions }));
    } catch (err) {
        logger.error('Get gift card error', { error: err.message });
        res.status(500).json({ error: 'Failed to load gift card' });
    }
});

// ---------------------------------------------------------------------------
// ISSUE / CREATE gift card (digital or physical)
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
    try {
        const {
            card_type = 'digital',
            initial_balance,
            currency = 'USD',
            customer_id = null,
            recipient_name = null,
            recipient_email = null,
            recipient_phone = null,
            sender_name = null,
            personal_message = null,
            delivery_date = null,
            physical_serial_number = null,
            physical_batch_id = null,
            physical_design = null,
            notes = null,
            code: providedCode = null,
            pin: providedPin = null,
            activate = true,
        } = req.body || {};

        const balance = parseFloat(initial_balance);
        if (!balance || balance <= 0) return res.status(400).json({ error: 'initial_balance must be > 0' });
        if (!['digital', 'physical'].includes(card_type)) return res.status(400).json({ error: 'invalid card_type' });

        let code = providedCode ? normalizeCode(providedCode) : generateGiftCardCode();
        // Ensure uniqueness
        for (let i = 0; i < 5; i++) {
            const [[exists]] = await req.pool.execute(
                'SELECT id FROM gift_cards WHERE code = ? LIMIT 1', [code]
            );
            if (!exists) break;
            if (providedCode) return res.status(409).json({ error: 'Code already in use' });
            code = generateGiftCardCode();
        }
        const pin = providedPin || generateGiftCardPin();

        const status = activate ? 'active' : 'inactive';
        const issuedAt = new Date();
        const activatedAt = activate ? issuedAt : null;

        const [r] = await req.pool.execute(
            `INSERT INTO gift_cards (
                code, pin, card_type, status,
                initial_balance, current_balance, currency,
                customer_id,
                recipient_name, recipient_email, recipient_phone,
                sender_name, personal_message, delivery_date,
                physical_serial_number, physical_batch_id, physical_design,
                issued_at, activated_at, expires_at,
                issued_by_admin_id, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                code, pin, card_type, status,
                balance, balance, currency,
                customer_id,
                recipient_name, recipient_email, recipient_phone,
                sender_name, personal_message, delivery_date,
                physical_serial_number, physical_batch_id, physical_design,
                issuedAt, activatedAt, null,
                req.admin.id, notes
            ]
        );

        await recordTransaction(req.pool, {
            gift_card_id: r.insertId,
            transaction_type: 'issue',
            amount: balance,
            balance_before: 0,
            balance_after: balance,
            source: 'admin',
            customer_id,
            admin_user_id: req.admin.id,
            description: `Issued ${card_type} gift card`,
        });

        if (activate) {
            await recordTransaction(req.pool, {
                gift_card_id: r.insertId,
                transaction_type: 'activate',
                amount: 0,
                balance_before: balance,
                balance_after: balance,
                source: 'admin',
                admin_user_id: req.admin.id,
                description: 'Activated gift card',
            });
        }

        res.status(201).json({ success: true, id: r.insertId, code, pin });
    } catch (err) {
        logger.error('Create gift card error', { error: err.message });
        res.status(500).json({ error: 'Failed to create gift card' });
    }
});

// ---------------------------------------------------------------------------
// BULK register physical gift cards (e.g. an inventory shipment)
// ---------------------------------------------------------------------------
router.post('/bulk-physical', async (req, res) => {
    const conn = await req.pool.getConnection();
    try {
        const { cards = [], default_balance, batch_id, design, activate = false } = req.body || {};
        if (!Array.isArray(cards) || cards.length === 0) {
            return res.status(400).json({ error: 'cards[] required' });
        }
        await conn.beginTransaction();

        const created = [];
        for (const c of cards) {
            const code = c.code ? normalizeCode(c.code) : generateGiftCardCode();
            const balance = parseFloat(c.initial_balance ?? default_balance ?? 0);
            if (!balance || balance <= 0) continue;

            const [r] = await conn.execute(
                `INSERT INTO gift_cards
                    (code, pin, card_type, status, initial_balance, current_balance,
                     physical_serial_number, physical_batch_id, physical_design,
                     issued_at, activated_at, issued_by_admin_id)
                 VALUES (?, ?, 'physical', ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
                [
                    code,
                    c.pin || generateGiftCardPin(),
                    activate ? 'active' : 'inactive',
                    balance, balance,
                    c.physical_serial_number || null,
                    batch_id || c.physical_batch_id || null,
                    design || c.physical_design || null,
                    activate ? new Date() : null,
                    req.admin.id,
                ]
            );

            await conn.execute(
                `INSERT INTO gift_card_transactions
                    (gift_card_id, transaction_type, amount, balance_before, balance_after,
                     source, admin_user_id, description)
                 VALUES (?, 'issue', ?, 0, ?, 'admin', ?, 'Bulk physical issue')`,
                [r.insertId, balance, balance, req.admin.id]
            );
            created.push({ id: r.insertId, code });
        }

        await conn.commit();
        res.status(201).json({ success: true, created_count: created.length, cards: created });
    } catch (err) {
        await conn.rollback();
        logger.error('Bulk physical issue error', { error: err.message });
        res.status(500).json({ error: 'Bulk issue failed' });
    } finally {
        conn.release();
    }
});

// ---------------------------------------------------------------------------
// UPDATE gift card metadata (recipient, customer, notes)
// ---------------------------------------------------------------------------
router.put('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const allowed = ['customer_id','recipient_name','recipient_email','recipient_phone','sender_name','personal_message','delivery_date','physical_serial_number','physical_batch_id','physical_design','notes','status'];
        const fields = [];
        const params = [];
        for (const k of allowed) if (k in req.body) { fields.push(`${k} = ?`); params.push(req.body[k]); }
        if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
        params.push(id);
        await req.pool.execute(`UPDATE gift_cards SET ${fields.join(', ')} WHERE id = ?`, params);
        res.json({ success: true });
    } catch (err) {
        logger.error('Update gift card error', { error: err.message });
        res.status(500).json({ error: 'Failed to update gift card' });
    }
});

// ---------------------------------------------------------------------------
// ADJUST balance (admin reload / write-off)
// ---------------------------------------------------------------------------
router.post('/:id/adjust', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { amount, description } = req.body || {};
        const delta = parseFloat(amount);
        if (!delta || isNaN(delta)) return res.status(400).json({ error: 'amount required (positive=reload, negative=deduct)' });

        const [[card]] = await req.pool.execute('SELECT * FROM gift_cards WHERE id = ?', [id]);
        if (!card) return res.status(404).json({ error: 'Gift card not found' });

        const balance_before = parseFloat(card.current_balance);
        const balance_after = Math.max(0, +(balance_before + delta).toFixed(2));

        await req.pool.execute(
            'UPDATE gift_cards SET current_balance = ?, status = CASE WHEN ? > 0 AND status = "inactive" THEN "active" ELSE status END WHERE id = ?',
            [balance_after, balance_after, id]
        );

        await recordTransaction(req.pool, {
            gift_card_id: id,
            transaction_type: delta > 0 ? 'reload' : 'adjust',
            amount: delta,
            balance_before,
            balance_after,
            source: 'admin',
            customer_id: card.customer_id,
            admin_user_id: req.admin.id,
            description: description || (delta > 0 ? 'Admin reload' : 'Admin adjustment'),
        });

        res.json({ success: true, balance: balance_after });
    } catch (err) {
        logger.error('Adjust gift card error', { error: err.message });
        res.status(500).json({ error: 'Failed to adjust balance' });
    }
});

// ---------------------------------------------------------------------------
// REDEEM (manual)
// ---------------------------------------------------------------------------
router.post('/:id/redeem', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { amount, description, order_id } = req.body || {};
        const value = parseFloat(amount);
        if (!value || value <= 0) return res.status(400).json({ error: 'amount must be > 0' });

        const [[card]] = await req.pool.execute('SELECT * FROM gift_cards WHERE id = ? FOR UPDATE', [id]);
        if (!card) return res.status(404).json({ error: 'Gift card not found' });
        if (card.status !== 'active') return res.status(400).json({ error: `Card is ${card.status}` });
        if (parseFloat(card.current_balance) < value) return res.status(400).json({ error: 'Insufficient balance' });

        const balance_before = parseFloat(card.current_balance);
        const balance_after = +(balance_before - value).toFixed(2);
        const newStatus = balance_after === 0 ? 'redeemed' : card.status;

        await req.pool.execute(
            'UPDATE gift_cards SET current_balance = ?, last_used_at = NOW(), status = ?, redeemed_at = CASE WHEN ? = "redeemed" THEN NOW() ELSE redeemed_at END WHERE id = ?',
            [balance_after, newStatus, newStatus, id]
        );

        await recordTransaction(req.pool, {
            gift_card_id: id,
            transaction_type: 'redeem',
            amount: -value,
            balance_before,
            balance_after,
            source: 'admin',
            order_id: order_id || null,
            customer_id: card.customer_id,
            admin_user_id: req.admin.id,
            description: description || 'Manual redemption',
        });

        res.json({ success: true, balance: balance_after, status: newStatus });
    } catch (err) {
        logger.error('Redeem gift card error', { error: err.message });
        res.status(500).json({ error: 'Failed to redeem' });
    }
});

// ---------------------------------------------------------------------------
// CHANGE STATUS (cancel / lost / activate)
// ---------------------------------------------------------------------------
router.post('/:id/status', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { status, reason } = req.body || {};
        const valid = ['inactive','active','cancelled','lost','expired'];
        if (!valid.includes(status)) return res.status(400).json({ error: 'invalid status' });

        const [[card]] = await req.pool.execute('SELECT * FROM gift_cards WHERE id = ?', [id]);
        if (!card) return res.status(404).json({ error: 'Gift card not found' });

        await req.pool.execute(
            'UPDATE gift_cards SET status = ?, activated_at = CASE WHEN ? = "active" AND activated_at IS NULL THEN NOW() ELSE activated_at END WHERE id = ?',
            [status, status, id]
        );

        let txType = 'adjust';
        if (status === 'active')    txType = 'activate';
        if (status === 'cancelled') txType = 'cancel';
        if (status === 'expired')   txType = 'expire';

        await recordTransaction(req.pool, {
            gift_card_id: id,
            transaction_type: txType,
            amount: 0,
            balance_before: parseFloat(card.current_balance),
            balance_after: parseFloat(card.current_balance),
            source: 'admin',
            admin_user_id: req.admin.id,
            description: reason || `Status changed to ${status}`,
        });

        res.json({ success: true });
    } catch (err) {
        logger.error('Change gift card status error', { error: err.message });
        res.status(500).json({ error: 'Failed to change status' });
    }
});

// ---------------------------------------------------------------------------
// DELETE (soft - cancel)
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
    try {
        await req.pool.execute(
            "UPDATE gift_cards SET status = 'cancelled' WHERE id = ?",
            [parseInt(req.params.id, 10)]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to cancel gift card' });
    }
});

module.exports = router;
