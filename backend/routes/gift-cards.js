'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { CATEGORY_SLUG } = require('../utils/ensureGiftCardCatalog');

const router = express.Router();

async function hasGiftCardTypeColumn(pool) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'gift_card_type'`
    );
    return Number(rows[0].c) > 0;
}

async function getGiftCardCatalog(req, res) {
    try {
        if (!(await hasGiftCardTypeColumn(req.pool))) {
            return res.json({ category: CATEGORY_SLUG, products: [] });
        }

        const [products] = await req.pool.execute(
            `SELECT p.id, p.sku, p.name, p.slug, p.short_description, p.gift_card_type,
                    p.requires_shipping, pc.slug AS category_slug
               FROM products p
               JOIN product_categories pc ON pc.id = p.category_id
              WHERE p.is_active = 1 AND p.gift_card_type IS NOT NULL
              ORDER BY p.gift_card_type, p.name`
        );

        const ids = products.map((p) => p.id);
        let variants = [];
        if (ids.length) {
            const [vrows] = await req.pool.execute(
                `SELECT id, product_id, sku, name, price, sort_order
                   FROM product_variants
                  WHERE product_id IN (${ids.map(() => '?').join(',')}) AND is_active = 1
                  ORDER BY sort_order, price`,
                ids
            );
            variants = vrows;
        }

        const byProduct = new Map();
        for (const v of variants) {
            if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
            byProduct.get(v.product_id).push({
                id: v.id,
                sku: v.sku,
                name: v.name,
                price: Number(v.price)
            });
        }

        res.json({
            category: CATEGORY_SLUG,
            products: products.map((p) => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                slug: p.slug,
                description: p.short_description,
                cardType: p.gift_card_type,
                requiresShipping: Boolean(p.requires_shipping),
                variants: byProduct.get(p.id) || []
            }))
        });
    } catch (err) {
        logger.error('Gift card catalog error:', err);
        res.status(500).json({ error: 'Failed to load gift card catalog' });
    }
}

router.get('/catalog', getGiftCardCatalog);

module.exports = router;
module.exports.getGiftCardCatalog = getGiftCardCatalog;
