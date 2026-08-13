'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { normalizeAdminRole, hasMinAdminRole } = require('../utils/adminRoles');
const {
    parseDiscountPayload,
    syncLinkedPromotions,
    loadGroupDetail
} = require('../services/customerGroupDiscount');

const router = express.Router();

function slugify(name) {
    return String(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function formatGroupListRow(row) {
    const discountType = row.discount_type || 'none';
    const hasDiscount = discountType !== 'none' && row.discount_value != null;
    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        is_active: Boolean(row.is_active),
        member_count: Number(row.member_count) || 0,
        linked_promotion_count: Number(row.linked_promotion_count) || 0,
        discount_summary: hasDiscount
            ? discountType === 'percent'
                ? `${Number(row.discount_value)}% off`
                : `$${Number(row.discount_value).toFixed(2)} off`
            : null,
        discount_applies_web: Boolean(row.discount_applies_web),
        discount_applies_pos: Boolean(row.discount_applies_pos),
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function authenticateAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Admin access token required' });
    if (!process.env.JWT_SECRET) {
        logger.error('JWT_SECRET missing');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [rows] = await req.pool.execute(
            'SELECT id, email, first_name, last_name, role, is_active FROM admin_users WHERE id = ? AND is_active = 1',
            [decoded.adminId]
        );
        if (!rows.length) return res.status(401).json({ error: 'Invalid admin token' });
        req.admin = { ...rows[0], role: normalizeAdminRole(rows[0].role) };
        next();
    } catch {
        return res.status(403).json({ error: 'Invalid admin token' });
    }
}

function requireManager(req, res, next) {
    if (!hasMinAdminRole(req.admin.role, 'manager')) {
        return res.status(403).json({ error: 'Manager access required' });
    }
    next();
}

router.use(authenticateAdmin);

router.get('/', async (req, res) => {
    try {
        const [rows] = await req.pool.execute(`
            SELECT cg.id, cg.name, cg.slug, cg.description, cg.is_active, cg.created_at, cg.updated_at,
                   cg.discount_type, cg.discount_value, cg.discount_applies_web, cg.discount_applies_pos,
                   COUNT(DISTINCT ucg.user_id) AS member_count,
                   COUNT(DISTINCT cgp.promotion_id) AS linked_promotion_count
              FROM customer_groups cg
              LEFT JOIN user_customer_groups ucg ON ucg.customer_group_id = cg.id
              LEFT JOIN customer_group_promotions cgp ON cgp.customer_group_id = cg.id
             GROUP BY cg.id
             ORDER BY cg.name ASC
        `);
        res.json(rows.map(formatGroupListRow));
    } catch (err) {
        logger.error('List customer groups error', { error: err.message });
        res.status(500).json({ error: 'Failed to load customer groups' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const detail = await loadGroupDetail(req.pool, id);
        if (!detail) return res.status(404).json({ error: 'Customer group not found' });

        const [members] = await req.pool.execute(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.customer_number
               FROM user_customer_groups ucg
               JOIN users u ON u.id = ucg.user_id
              WHERE ucg.customer_group_id = ?
              ORDER BY u.last_name, u.first_name
              LIMIT 500`,
            [id]
        );

        res.json({ ...detail, members });
    } catch (err) {
        logger.error('Get customer group error', { error: err.message });
        res.status(500).json({ error: 'Failed to load customer group' });
    }
});

router.post('/', requireManager, async (req, res) => {
    try {
        const { name, description, is_active = true, linked_promotions } = req.body || {};
        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'Group name is required' });
        }

        const slug = slugify(name);
        const [existing] = await req.pool.execute('SELECT id FROM customer_groups WHERE slug = ?', [slug]);
        if (existing.length) {
            return res.status(400).json({ error: 'A group with this name already exists' });
        }

        const discount = parseDiscountPayload(req.body || {});

        const [result] = await req.pool.execute(
            `INSERT INTO customer_groups (
                name, slug, description, is_active,
                discount_type, discount_value, discount_label,
                discount_applies_web, discount_applies_pos
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(name).trim(),
                slug,
                description || null,
                is_active ? 1 : 0,
                discount.discount_type,
                discount.discount_value,
                discount.discount_label,
                discount.discount_applies_web,
                discount.discount_applies_pos
            ]
        );

        await syncLinkedPromotions(req.pool, result.insertId, linked_promotions);
        const created = await loadGroupDetail(req.pool, result.insertId);
        res.status(201).json(created);
    } catch (err) {
        logger.error('Create customer group error', { error: err.message });
        res.status(500).json({ error: 'Failed to create customer group' });
    }
});

router.put('/:id', requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { name, description, is_active, linked_promotions } = req.body || {};

        const [[existing]] = await req.pool.execute(
            'SELECT id, name, slug FROM customer_groups WHERE id = ?',
            [id]
        );
        if (!existing) return res.status(404).json({ error: 'Customer group not found' });

        const fields = [];
        const params = [];

        if (name !== undefined) {
            const trimmed = String(name).trim();
            if (!trimmed) return res.status(400).json({ error: 'Group name cannot be empty' });
            const slug = slugify(trimmed);
            const [conflict] = await req.pool.execute(
                'SELECT id FROM customer_groups WHERE slug = ? AND id <> ?',
                [slug, id]
            );
            if (conflict.length) {
                return res.status(400).json({ error: 'A group with this name already exists' });
            }
            fields.push('name = ?', 'slug = ?');
            params.push(trimmed, slug);
        }
        if (description !== undefined) {
            fields.push('description = ?');
            params.push(description || null);
        }
        if (is_active !== undefined) {
            fields.push('is_active = ?');
            params.push(is_active ? 1 : 0);
        }

        if (
            req.body?.discount !== undefined ||
            req.body?.discount_type !== undefined ||
            req.body?.discount_value !== undefined
        ) {
            const discount = parseDiscountPayload(req.body || {});
            fields.push(
                'discount_type = ?',
                'discount_value = ?',
                'discount_label = ?',
                'discount_applies_web = ?',
                'discount_applies_pos = ?'
            );
            params.push(
                discount.discount_type,
                discount.discount_value,
                discount.discount_label,
                discount.discount_applies_web,
                discount.discount_applies_pos
            );
        }

        if (fields.length) {
            params.push(id);
            await req.pool.execute(`UPDATE customer_groups SET ${fields.join(', ')} WHERE id = ?`, params);
        }

        if (linked_promotions !== undefined) {
            await syncLinkedPromotions(req.pool, id, linked_promotions);
        }

        const updated = await loadGroupDetail(req.pool, id);
        res.json(updated);
    } catch (err) {
        logger.error('Update customer group error', { error: err.message });
        res.status(500).json({ error: 'Failed to update customer group' });
    }
});

router.delete('/:id', requireManager, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const [result] = await req.pool.execute('DELETE FROM customer_groups WHERE id = ?', [id]);
        if (!result.affectedRows) {
            return res.status(404).json({ error: 'Customer group not found' });
        }
        res.json({ success: true });
    } catch (err) {
        logger.error('Delete customer group error', { error: err.message });
        res.status(500).json({ error: 'Failed to delete customer group' });
    }
});

module.exports = router;
