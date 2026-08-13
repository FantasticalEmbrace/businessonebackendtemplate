'use strict';
/**
 * Customer-facing account API routes.
 *
 * Mounted at /api/user. All endpoints require an authenticated customer
 * (the JWT carrying { id, email } is verified by the parent app's
 * `authenticateToken` middleware, which is passed in through `mountUserRoutes`).
 *
 * Owns:
 *   - Address CRUD (multi-address with default flag)
 *   - Change password
 *   - Order detail (line items)
 *   - Wishlist collections (multiple named lists per customer)
 *   - Wishlist items (move/copy between lists supported)
 */

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { jsonSafeDeep } = require('../utils/jsonSafeMysql');
const { syncOrderTracking } = require('../services/shippoTracking');
const { enrichOrderTracking } = require('../utils/trackingUrl');

function buildRouter({ pool, authenticateToken, logger }) {
    const router = express.Router();
    const log = logger || console;

    // ----- helpers --------------------------------------------------------
    const handle = (fn) => async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            log.error('user route error:', err);
            if (res.headersSent) return;
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    const requireAuth = authenticateToken; // alias for readability

    // ===================================================================
    // ADDRESSES (multi-address book)
    // ===================================================================

    // POST /api/user/addresses — create
    router.post('/addresses', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const a = req.body || {};
        const required = ['type', 'first_name', 'last_name', 'address_line_1', 'city', 'state', 'postal_code'];
        for (const k of required) {
            if (!a[k] || String(a[k]).trim() === '') {
                return res.status(400).json({ error: `${k} is required` });
            }
        }
        if (!['shipping', 'billing'].includes(a.type)) {
            return res.status(400).json({ error: 'type must be shipping or billing' });
        }

        const isDefault = a.is_default === true || a.is_default === 1 || a.is_default === '1';

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            if (isDefault) {
                await conn.execute(
                    'UPDATE user_addresses SET is_default = 0 WHERE user_id = ? AND type = ?',
                    [userId, a.type]
                );
            }
            const [result] = await conn.execute(
                `INSERT INTO user_addresses
                    (user_id, type, first_name, last_name, company,
                     address_line_1, address_line_2, city, state, postal_code,
                     country, is_default)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId, a.type,
                    a.first_name, a.last_name, a.company || null,
                    a.address_line_1, a.address_line_2 || null,
                    a.city, a.state, a.postal_code,
                    a.country || 'United States',
                    isDefault ? 1 : 0,
                ]
            );
            await conn.commit();
            const [[address]] = await conn.execute(
                'SELECT * FROM user_addresses WHERE id = ?',
                [result.insertId]
            );
            res.status(201).json({ address });
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }));

    // PUT /api/user/addresses/:id — update
    router.put('/addresses/:id', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid address id' });

        const [[existing]] = await pool.execute(
            'SELECT * FROM user_addresses WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        if (!existing) return res.status(404).json({ error: 'Address not found' });

        const a = req.body || {};
        if (a.type && !['shipping', 'billing'].includes(a.type)) {
            return res.status(400).json({ error: 'type must be shipping or billing' });
        }
        const merged = {
            type: a.type || existing.type,
            first_name: a.first_name ?? existing.first_name,
            last_name: a.last_name ?? existing.last_name,
            company: a.company ?? existing.company,
            address_line_1: a.address_line_1 ?? existing.address_line_1,
            address_line_2: a.address_line_2 ?? existing.address_line_2,
            city: a.city ?? existing.city,
            state: a.state ?? existing.state,
            postal_code: a.postal_code ?? existing.postal_code,
            country: a.country ?? existing.country,
            is_default: a.is_default !== undefined
                ? (a.is_default === true || a.is_default === 1 || a.is_default === '1')
                : !!existing.is_default,
        };

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            if (merged.is_default) {
                await conn.execute(
                    'UPDATE user_addresses SET is_default = 0 WHERE user_id = ? AND type = ? AND id != ?',
                    [userId, merged.type, id]
                );
            }
            await conn.execute(
                `UPDATE user_addresses SET
                    type=?, first_name=?, last_name=?, company=?,
                    address_line_1=?, address_line_2=?, city=?, state=?, postal_code=?,
                    country=?, is_default=?
                 WHERE id=? AND user_id=?`,
                [
                    merged.type, merged.first_name, merged.last_name, merged.company,
                    merged.address_line_1, merged.address_line_2, merged.city,
                    merged.state, merged.postal_code, merged.country,
                    merged.is_default ? 1 : 0,
                    id, userId,
                ]
            );
            await conn.commit();
            const [[address]] = await pool.execute(
                'SELECT * FROM user_addresses WHERE id = ?',
                [id]
            );
            res.json({ address });
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }));

    // DELETE /api/user/addresses/:id
    router.delete('/addresses/:id', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const id = Number(req.params.id);
        const [result] = await pool.execute(
            'DELETE FROM user_addresses WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Address not found' });
        res.json({ success: true });
    }));

    // POST /api/user/addresses/:id/default
    router.post('/addresses/:id/default', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const id = Number(req.params.id);
        const [[address]] = await pool.execute(
            'SELECT id, type FROM user_addresses WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        if (!address) return res.status(404).json({ error: 'Address not found' });

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            await conn.execute(
                'UPDATE user_addresses SET is_default = 0 WHERE user_id = ? AND type = ?',
                [userId, address.type]
            );
            await conn.execute(
                'UPDATE user_addresses SET is_default = 1 WHERE id = ? AND user_id = ?',
                [id, userId]
            );
            await conn.commit();
            res.json({ success: true });
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }));

    // ===================================================================
    // CHANGE PASSWORD
    // ===================================================================
    router.put('/password', requireAuth, handle(async (req, res) => {
        const { current_password, new_password } = req.body || {};
        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'current_password and new_password are required' });
        }
        if (String(new_password).length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }
        const [[user]] = await pool.execute(
            'SELECT id, password_hash FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        const ok = await bcrypt.compare(current_password, user.password_hash || '');
        if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
        const newHash = await bcrypt.hash(new_password, 12);
        await pool.execute(
            'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newHash, user.id]
        );
        res.json({ success: true });
    }));

    // ===================================================================
    // ORDER DETAIL (line items)
    // ===================================================================
    router.get('/orders/:id', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const id = Number(req.params.id);
        const [[pre]] = await pool.execute(
            'SELECT id, status, tracking_number, shipping_carrier FROM orders WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        if (!pre) return res.status(404).json({ error: 'Order not found' });
        if (pre.tracking_number && ['label_created', 'shipped', 'in_transit'].includes(String(pre.status || '').toLowerCase())) {
            await syncOrderTracking(pool, id);
        }
        const [[raw]] = await pool.execute(
            `SELECT id, order_number, status, subtotal,
                    tax_amount, shipping_amount, discount_amount, total_amount,
                    payment_status, payment_method, sales_channel, notes, created_at, updated_at,
                    tracking_number, tracking_url, shipping_carrier, shipping_service,
                    label_url, shipped_at, delivered_at, label_created_at,
                    fulfillment_status, shipping_method,
                    tracking_status, tracking_status_detail, tracking_status_updated_at,
                    shipping_first_name, shipping_last_name, shipping_company,
                    shipping_address_line_1, shipping_address_line_2, shipping_city,
                    shipping_state, shipping_postal_code, shipping_country,
                    billing_first_name, billing_last_name, billing_company,
                    billing_address_line_1, billing_address_line_2, billing_city,
                    billing_state, billing_postal_code, billing_country
               FROM orders
              WHERE id = ? AND user_id = ?`,
            [id, userId]
        );
        if (!raw) return res.status(404).json({ error: 'Order not found' });

        const addrFromOrder = (prefix) => {
            const line1 = raw[`${prefix}_address_line_1`];
            const city = raw[`${prefix}_city`];
            if (!line1 && !city) return null;
            return {
                first_name: raw[`${prefix}_first_name`] || '',
                last_name: raw[`${prefix}_last_name`] || '',
                company: raw[`${prefix}_company`] || null,
                address_line_1: raw[`${prefix}_address_line_1`] || '',
                address_line_2: raw[`${prefix}_address_line_2`] || '',
                city: raw[`${prefix}_city`] || '',
                state: raw[`${prefix}_state`] || '',
                postal_code: raw[`${prefix}_postal_code`] || '',
                country: raw[`${prefix}_country`] || '',
            };
        };

        const order = {
            id: raw.id,
            order_number: raw.order_number,
            status: raw.status,
            subtotal: raw.subtotal,
            tax: raw.tax_amount,
            shipping_cost: raw.shipping_amount,
            discount: raw.discount_amount,
            total: raw.total_amount,
            payment_status: raw.payment_status,
            payment_method: raw.payment_method,
            sales_channel: raw.sales_channel || 'online',
            notes: raw.notes,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            tracking_number: raw.tracking_number,
            tracking_url: raw.tracking_url,
            shipping_carrier: raw.shipping_carrier,
            shipping_service: raw.shipping_service,
            label_url: raw.label_url,
            shipped_at: raw.shipped_at,
            delivered_at: raw.delivered_at,
            label_created_at: raw.label_created_at,
            fulfillment_status: raw.fulfillment_status,
            shipping_method: raw.shipping_method,
            tracking_status: raw.tracking_status,
            tracking_status_detail: raw.tracking_status_detail,
            tracking_status_updated_at: raw.tracking_status_updated_at,
        };

        const [items] = await pool.execute(
            `SELECT oi.id, oi.product_id, oi.product_name, oi.quantity,
                    oi.price AS unit_price, oi.total AS total_price, pi.image_url
               FROM order_items oi
          LEFT JOIN products p ON p.id = oi.product_id
          LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
              WHERE oi.order_id = ?
              ORDER BY oi.id ASC`,
            [id]
        );

        const shipping = addrFromOrder('shipping');
        const billing = addrFromOrder('billing');

        let payment_tenders = [];
        try {
            const [tenderRows] = await pool.execute(
                `SELECT tender_type, amount, loyalty_points, gift_card_id, cash_tendered, cash_change, check_number
                   FROM order_payment_tenders
                  WHERE order_id = ?
                  ORDER BY id ASC`,
                [id]
            );
            payment_tenders = tenderRows || [];
        } catch (e) {
            if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
        }

        res.json(jsonSafeDeep({
            order: enrichOrderTracking(order),
            items,
            shipping_address: shipping,
            billing_address: billing,
            payment_tenders
        }));
    }));

    // ===================================================================
    // WISHLIST COLLECTIONS
    // ===================================================================
    async function ensureDefaultCollection(userId) {
        const [[def]] = await pool.execute(
            'SELECT id FROM wishlist_collections WHERE user_id = ? AND is_default = 1 LIMIT 1',
            [userId]
        );
        if (def) return def.id;
        const [r] = await pool.execute(
            'INSERT INTO wishlist_collections (user_id, name, is_default, sort_order) VALUES (?, ?, 1, 0)',
            [userId, 'My Wishlist']
        );
        return r.insertId;
    }

    // GET /api/user/wishlists — list all collections (with item counts)
    router.get('/wishlists', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        await ensureDefaultCollection(userId);
        const [collections] = await pool.execute(
            `SELECT wc.id, wc.name, wc.description, wc.is_default, wc.is_public, wc.share_token,
                    wc.sort_order, wc.created_at, wc.updated_at,
                    (SELECT COUNT(*) FROM wishlists w WHERE w.collection_id = wc.id) AS item_count
               FROM wishlist_collections wc
              WHERE wc.user_id = ?
           ORDER BY wc.is_default DESC, wc.sort_order ASC, wc.created_at ASC`,
            [userId]
        );
        res.json({ collections: jsonSafeDeep(collections) });
    }));

    // POST /api/user/wishlists — create new list
    router.post('/wishlists', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const { name, description, is_public } = req.body || {};
        if (!name || String(name).trim() === '') {
            return res.status(400).json({ error: 'name is required' });
        }
        const cleanName = String(name).trim().slice(0, 120);
        const [[def]] = await pool.execute(
            'SELECT COUNT(*) AS cnt FROM wishlist_collections WHERE user_id = ? AND is_default = 1',
            [userId]
        );
        const isFirst = (def && def.cnt === 0);
        const shareToken = is_public ? crypto.randomBytes(20).toString('hex') : null;
        const [r] = await pool.execute(
            `INSERT INTO wishlist_collections (user_id, name, description, is_default, is_public, share_token)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, cleanName, description || null, isFirst ? 1 : 0, is_public ? 1 : 0, shareToken]
        );
        const [[collection]] = await pool.execute(
            'SELECT * FROM wishlist_collections WHERE id = ?',
            [r.insertId]
        );
        res.status(201).json(jsonSafeDeep({ collection }));
    }));

    // PUT /api/user/wishlists/:id — rename / toggle public / set default
    router.put('/wishlists/:id', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const id = Number(req.params.id);
        const [[existing]] = await pool.execute(
            'SELECT * FROM wishlist_collections WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        if (!existing) return res.status(404).json({ error: 'Wishlist not found' });

        const body = req.body || {};
        const updates = [];
        const params = [];

        if (typeof body.name === 'string' && body.name.trim()) {
            updates.push('name = ?');
            params.push(body.name.trim().slice(0, 120));
        }
        if (body.description !== undefined) {
            updates.push('description = ?');
            params.push(body.description ? String(body.description).slice(0, 500) : null);
        }
        if (body.is_public !== undefined) {
            const pub = body.is_public === true || body.is_public === 1 || body.is_public === '1';
            updates.push('is_public = ?');
            params.push(pub ? 1 : 0);
            if (pub && !existing.share_token) {
                updates.push('share_token = ?');
                params.push(crypto.randomBytes(20).toString('hex'));
            }
            if (!pub) {
                updates.push('share_token = NULL');
            }
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            if (body.is_default === true || body.is_default === 1 || body.is_default === '1') {
                await conn.execute(
                    'UPDATE wishlist_collections SET is_default = 0 WHERE user_id = ?',
                    [userId]
                );
                updates.push('is_default = 1');
            }
            if (updates.length) {
                params.push(id, userId);
                await conn.execute(
                    `UPDATE wishlist_collections SET ${updates.join(', ')}
                      WHERE id = ? AND user_id = ?`,
                    params
                );
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
        const [[collection]] = await pool.execute(
            'SELECT * FROM wishlist_collections WHERE id = ?',
            [id]
        );
        res.json({ collection });
    }));

    // DELETE /api/user/wishlists/:id
    router.delete('/wishlists/:id', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const id = Number(req.params.id);
        const [[existing]] = await pool.execute(
            'SELECT id, is_default FROM wishlist_collections WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        if (!existing) return res.status(404).json({ error: 'Wishlist not found' });
        if (existing.is_default) {
            return res.status(400).json({ error: 'Cannot delete the default wishlist. Make a different list default first.' });
        }
        await pool.execute('DELETE FROM wishlist_collections WHERE id = ? AND user_id = ?', [id, userId]);
        res.json({ success: true });
    }));

    // GET /api/user/wishlists/:id/items
    router.get('/wishlists/:id/items', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const id = Number(req.params.id);
        const [[wl]] = await pool.execute(
            'SELECT id, name FROM wishlist_collections WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        if (!wl) return res.status(404).json({ error: 'Wishlist not found' });
        const [items] = await pool.execute(
            `SELECT /* hmherbs-wishlist-items-v3 */
                    w.id, w.product_id, w.notes, w.priority, w.added_at,
                    p.name AS product_name, p.slug AS product_slug, p.price,
                    p.compare_price, pi.image_url, p.inventory_quantity AS stock_quantity,
                    p.is_active, p.short_description
               FROM wishlists w
               JOIN products p ON p.id = w.product_id
          LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
              WHERE w.collection_id = ? AND w.user_id = ?
              ORDER BY w.priority DESC, w.added_at DESC`,
            [id, userId]
        );
        res.json({ wishlist: jsonSafeDeep(wl), items: jsonSafeDeep(items) });
    }));

    // POST /api/user/wishlists/:id/items  body: { product_id, notes, priority }
    router.post('/wishlists/:id/items', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const id = Number(req.params.id);
        const { product_id, notes, priority } = req.body || {};
        if (!product_id) return res.status(400).json({ error: 'product_id is required' });
        const [[wl]] = await pool.execute(
            'SELECT id FROM wishlist_collections WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        if (!wl) return res.status(404).json({ error: 'Wishlist not found' });
        const [[product]] = await pool.execute(
            'SELECT id FROM products WHERE id = ? AND is_active = 1',
            [product_id]
        );
        if (!product) return res.status(404).json({ error: 'Product not found' });

        try {
            await pool.execute(
                `INSERT INTO wishlists (user_id, collection_id, product_id, notes, priority)
                 VALUES (?, ?, ?, ?, ?)`,
                [userId, id, product_id, notes ? String(notes).slice(0, 500) : null, Number(priority) || 0]
            );
        } catch (err) {
            if (err && err.code === 'ER_DUP_ENTRY') {
                // 200 (not 409): duplicate add is success for UX; browsers log 4xx on fetch in the console.
                return res.status(200).json({ success: true, already: true });
            }
            throw err;
        }
        res.status(201).json({ success: true });
    }));

    // DELETE /api/user/wishlists/:id/items/:itemId
    router.delete('/wishlists/:id/items/:itemId', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const collectionId = Number(req.params.id);
        const itemId = Number(req.params.itemId);
        const [r] = await pool.execute(
            'DELETE FROM wishlists WHERE id = ? AND collection_id = ? AND user_id = ?',
            [itemId, collectionId, userId]
        );
        if (r.affectedRows === 0) return res.status(404).json({ error: 'Item not found' });
        res.json({ success: true });
    }));

    // POST /api/user/wishlists/:id/items/:itemId/move  body: { target_collection_id, mode: 'move'|'copy' }
    router.post('/wishlists/:id/items/:itemId/move', requireAuth, handle(async (req, res) => {
        const userId = req.user.id;
        const fromId = Number(req.params.id);
        const itemId = Number(req.params.itemId);
        const { target_collection_id, mode } = req.body || {};
        const targetId = Number(target_collection_id);
        if (!targetId) return res.status(400).json({ error: 'target_collection_id is required' });
        if (mode && !['move', 'copy'].includes(mode)) {
            return res.status(400).json({ error: "mode must be 'move' or 'copy'" });
        }

        const [[item]] = await pool.execute(
            `SELECT w.id, w.product_id, w.notes, w.priority
               FROM wishlists w
               JOIN wishlist_collections wc ON wc.id = w.collection_id
              WHERE w.id = ? AND w.collection_id = ? AND wc.user_id = ?`,
            [itemId, fromId, userId]
        );
        if (!item) return res.status(404).json({ error: 'Item not found' });
        const [[target]] = await pool.execute(
            'SELECT id FROM wishlist_collections WHERE id = ? AND user_id = ?',
            [targetId, userId]
        );
        if (!target) return res.status(404).json({ error: 'Target wishlist not found' });

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            if (mode === 'copy') {
                await conn.execute(
                    `INSERT IGNORE INTO wishlists (user_id, collection_id, product_id, notes, priority)
                     VALUES (?, ?, ?, ?, ?)`,
                    [userId, targetId, item.product_id, item.notes, item.priority]
                );
            } else {
                // move: update collection_id; if a duplicate exists in the target, just delete the source
                try {
                    await conn.execute(
                        'UPDATE wishlists SET collection_id = ? WHERE id = ? AND user_id = ?',
                        [targetId, itemId, userId]
                    );
                } catch (err) {
                    if (err && err.code === 'ER_DUP_ENTRY') {
                        await conn.execute(
                            'DELETE FROM wishlists WHERE id = ? AND user_id = ?',
                            [itemId, userId]
                        );
                    } else {
                        throw err;
                    }
                }
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
        res.json({ success: true });
    }));

    return router;
}

module.exports = buildRouter;
