// Public promotion preview — server-priced cart totals with promo rules
'use strict';

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const promoEngine = require('../services/webPromotionEngine');

async function authUserLite(pool, req) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = Number(decoded?.userId);
        if (!Number.isInteger(userId) || userId <= 0) return null;
        const [rows] = await pool.execute(
            'SELECT id, email, tax_exempt, tax_exempt_id, customer_type FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        return rows[0] || null;
    } catch {
        return null;
    }
}

/** POST body: cartItems[{ id|product_id, variant_id?, price, quantity }], promoCode?, email? */
router.post('/preview', async (req, res) => {
    try {
        const { cartItems, promoCode, email: bodyEmail, shippingMethod, shippingAmount } = req.body || {};
        const authUser = await authUserLite(req.pool, req);

        const hasTaxExemptProof = Boolean(
            authUser?.tax_exempt_id && String(authUser.tax_exempt_id).trim().length >= 3
        );
        const applyTaxExemption = Boolean(authUser?.tax_exempt) && hasTaxExemptProof;

        const emailResolved =
            (authUser?.email ? String(authUser.email).trim() : '') ||
            (bodyEmail ? String(bodyEmail).trim() : '');

        const result = await promoEngine.previewOrApplyTotals(req.pool, {
            cartItems,
            promoCode,
            email: emailResolved || null,
            applyTaxExemption,
            customerType: authUser?.customer_type,
            userId: authUser?.id,
            shippingMethod: shippingMethod ? String(shippingMethod).trim() : undefined,
            shippingAmount: shippingAmount != null ? Number(shippingAmount) : undefined,
        });

        res.json({
            ok: true,
            promoApplied: !!result.promotion,
            promoCode: result.promotion ? String(result.promotion.code) : null,
            description: result.promotion ? String(result.promotion.description || '') : '',
            employeeDiscountApplied: Boolean(result.employeeDiscountApplied),
            employeeDiscountAmount: Number(result.employeeDiscountAmount) || 0,
            groupDiscountApplied: Boolean(result.groupDiscountApplied),
            groupDiscountAmount: Number(result.groupDiscountAmount) || 0,
            groupDiscountLabel: result.groupDiscountLabel || null,
            groupAutoPromotionApplied: Boolean(result.groupAutoPromotionApplied),
            groupAutoPromotionCode: result.groupAutoPromotionCode || null,
            customerGroups: result.customerGroups || [],
            availableGroupPromotions: result.availableGroupPromotions || [],
            totals: result.totals,
            baselineTotals: result.baselineTotals,
            serverLineItems: result.enrichment.map((r) => ({
                product_id: r.product_id,
                variant_id: r.variant_id,
                quantity: r.quantity,
                unitPrice: r.unitPrice,
                lineTotal: promoEngine.roundMoney(r.unitPrice * r.quantity),
                name: r.name,
                sku: r.sku
            })),
            taxExemptApplied: applyTaxExemption
        });
    } catch (e) {
        const code = e.code || '';
        if (code === 'INVALID_PROMO_CODE' || code === 'MALFORMED_PROMO_RULES' || code === 'PROMO_NO_EFFECTS') {
            return res.status(400).json({ error: e.message.replace(/_/g, ' '), code });
        }
        if (code === 'TOTAL_USAGE' || code === 'EMAIL_USAGE' || code === 'PROMO_USAGE_EXCEEDED') {
            return res.status(400).json({ error: 'This promotion code is no longer available for use.', code });
        }
        if (code === 'EMPTY_CART') {
            return res.status(400).json({ error: 'Cart is empty', code });
        }
        if (code === 'INVALID_CART_PRODUCT' || code === 'INVALID_CART_VARIANT') {
            return res.status(400).json({ error: 'One or more cart items could not be priced.', code });
        }
        logger.error('Promotion preview error:', e);
        res.status(500).json({ error: 'Promotion preview failed' });
    }
});

module.exports = router;
