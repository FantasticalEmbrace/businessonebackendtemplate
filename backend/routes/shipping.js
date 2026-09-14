'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const shipping = require('../services/shippingService');
const { handleTrackWebhook } = require('../services/shippoTracking');
const { adminAuth } = require('../middleware/adminAuth');
const { merchantIdFromReq } = require('../utils/merchantScope');

/** POST /api/shipping/options — checkout shipping methods */
router.post('/options', async (req, res) => {
    try {
        const { cartItems, postalCode, state, country, merchandiseSubtotal } = req.body || {};
        if (!Array.isArray(cartItems) || !cartItems.length) {
            return res.status(400).json({ error: 'Cart is empty' });
        }
        const sub = Number(merchandiseSubtotal) || cartItems.reduce(
            (s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1),
            0
        );
        const result = await shipping.getCheckoutOptions(req.pool, {
            cartItems,
            postalCode,
            state,
            country: country || 'US',
            merchandiseSubtotal: sub,
        });
        res.json({
            ok: true,
            options: result.options,
            weightsKnown: result.weightInfo.allWeightsKnown,
            estimatedWeightOz: result.weightInfo.totalWeightOz,
            shippoEnabled: result.shippoEnabled,
            freeShippingThreshold: shipping.FREE_SHIPPING_THRESHOLD,
            firstClassRate: shipping.FIRST_CLASS_SHIPPING,
        });
    } catch (e) {
        logger.error('Shipping options error:', e);
        res.status(500).json({ error: 'Unable to load shipping options' });
    }
});

/** GET /api/shipping/boxes — admin predefined boxes */
router.get('/boxes', ...adminAuth, async (req, res) => {
    try {
        const boxes = await shipping.listBoxes(req.pool);
        res.json({ boxes });
    } catch (e) {
        logger.error('List shipping boxes error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/** GET /api/shipping/orders/:orderId/fulfillment — admin prep context */
router.get('/orders/:orderId/fulfillment', ...adminAuth, async (req, res) => {
    try {
        const orderId = parseInt(req.params.orderId, 10);
        const ctx = await shipping.getOrderFulfillmentContext(req.pool, orderId);
        res.json(ctx);
    } catch (e) {
        if (e.code === 'ORDER_NOT_FOUND') return res.status(404).json({ error: 'Order not found' });
        logger.error('Fulfillment context error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/** POST /api/shipping/orders/:orderId/rates — quote carrier rates for fulfillment */
router.post('/orders/:orderId/rates', ...adminAuth, async (req, res) => {
    try {
        const orderId = parseInt(req.params.orderId, 10);
        const { boxId, packageWeightOz, itemWeights } = req.body || {};
        if (itemWeights?.length) await shipping.saveLearnedWeights(req.pool, itemWeights);
        const quote = await shipping.getRatesForOrder(req.pool, orderId, { boxId, packageWeightOz });
        res.json(quote);
    } catch (e) {
        if (e.code === 'MISSING_PRODUCT_WEIGHTS') {
            return res.status(400).json({ error: 'Enter weights for new products first', missing: e.missing });
        }
        if (e.code === 'INVALID_PACKAGE_WEIGHT') {
            return res.status(400).json({ error: 'Cannot calculate package weight — add product weights or enter scale weight' });
        }
        if (e.code === 'SHIPPO_NOT_CONFIGURED') {
            logger.error('Shippo API token missing or invalid — set SHIPPO_API_TOKEN in backend .env');
            return res.status(503).json({ error: 'Unable to fetch shipping rates' });
        }
        if (e.code === 'SHIP_ORIGIN_NOT_CONFIGURED') {
            logger.error('Ship-from address not configured — set SHIPPO_FROM_* in backend .env');
            return res.status(503).json({
                error: e.message || 'Ship-from address incomplete for carrier rates',
                issues: e.issues || [],
            });
        }
        logger.error('Shipping rates error:', e);
        res.status(500).json({ error: e.message || 'Unable to fetch rates' });
    }
});

/** Shippo track_updated webhook — advances order to shipped/delivered automatically */
router.post('/webhooks/track', async (req, res) => {
    try {
        const result = await handleTrackWebhook(req.pool, req.body);
        res.json(result);
    } catch (e) {
        logger.error('Shippo track webhook error:', e);
        res.status(500).json({ ok: false });
    }
});

/** POST /api/shipping/orders/:orderId/label — purchase label (tracking + status automated) */
router.post('/orders/:orderId/label', ...adminAuth, async (req, res) => {
    try {
        const orderId = parseInt(req.params.orderId, 10);
        const { rateId, boxId, packageWeightOz, itemWeights } = req.body || {};
        const result = await shipping.purchaseLabel(req.pool, orderId, {
            rateId,
            boxId,
            packageWeightOz,
            itemWeights,
        });

        res.json({ ok: true, ...result });
    } catch (e) {
        if (e.code === 'LABEL_ALREADY_EXISTS') {
            return res.status(409).json({ error: 'A label already exists for this order' });
        }
        if (e.code === 'ORDER_VOIDED_OR_REFUNDED') {
            return res.status(400).json({
                error: e.message || 'Cannot create a shipping label for a voided, refunded, or cancelled order',
                code: e.code,
            });
        }
        if (e.code === 'ORDER_NOT_PAID') {
            return res.status(400).json({
                error: e.message || 'Only paid orders can get a shipping label',
                code: e.code,
            });
        }
        if (e.code === 'MISSING_PRODUCT_WEIGHTS') {
            return res.status(400).json({ error: 'Enter weights for new products first', missing: e.missing });
        }
        if (e.code === 'INVALID_PACKAGE_WEIGHT') {
            return res.status(400).json({ error: 'Cannot calculate package weight — add product weights or enter scale weight' });
        }
        if (e.code === 'LABEL_PURCHASE_FAILED') {
            return res.status(400).json({ error: e.message, code: e.code });
        }
        if (e.code === 'ORDER_NOT_FOUND') {
            return res.status(404).json({ error: 'Order not found' });
        }
        if (e.code === 'SHIPPO_NOT_CONFIGURED') {
            logger.error('Shippo API token missing or invalid — set SHIPPO_API_TOKEN in backend .env');
            return res.status(503).json({ error: 'Unable to create shipping label' });
        }
        if (e.code === 'NO_RATES_AVAILABLE') {
            return res.status(400).json({ error: 'No carrier rates available for this package' });
        }
        if (e.message && e.message.includes('Bind parameters must not contain undefined')) {
            logger.error('Label purchase SQL bind error:', e);
            return res.status(500).json({ error: 'Unable to save label — check Shippo configuration in server logs' });
        }
        if (e.response?.status >= 400 && e.response?.status < 500) {
            const data = e.response?.data;
            const shippoMsg =
                (typeof data === 'string' && data) ||
                data?.detail ||
                data?.message ||
                (Array.isArray(data?.messages)
                    ? data.messages.map((m) => m.text || m.message).filter(Boolean).join('; ')
                    : null) ||
                (e.response?.status === 400 ? 'Shippo rejected this rate or label request' : null) ||
                e.message;
            logger.warn('Label purchase Shippo client error:', shippoMsg);
            return res.status(400).json({
                error: shippoMsg,
                code: 'LABEL_PURCHASE_FAILED',
            });
        }
        logger.error('Label purchase error:', e);
        res.status(500).json({ error: e.message || 'Unable to create label' });
    }
});

/** POST /api/shipping/orders/:orderId/manual-tracking — dropship / vendor tracking (no Shippo label) */
router.post('/orders/:orderId/manual-tracking', ...adminAuth, async (req, res) => {
    try {
        const orderId = parseInt(req.params.orderId, 10);
        const body = req.body || {};
        const result = await shipping.setManualTracking(req.pool, orderId, {
            trackingNumber: body.trackingNumber ?? body.tracking_number,
            shippingCarrier: body.shippingCarrier ?? body.shipping_carrier,
            shippingService: body.shippingService ?? body.shipping_service,
            trackingUrl: body.trackingUrl ?? body.tracking_url,
            markShipped: body.markShipped !== false && body.mark_shipped !== false,
        });
        res.json({ ok: true, ...result });
    } catch (e) {
        if (e.code === 'ORDER_NOT_FOUND') {
            return res.status(404).json({ error: 'Order not found', code: e.code });
        }
        if (
            e.code === 'TRACKING_REQUIRED' ||
            e.code === 'TRACKING_INVALID' ||
            e.code === 'CARRIER_REQUIRED' ||
            e.code === 'ORDER_VOIDED_OR_REFUNDED' ||
            e.code === 'ORDER_NOT_PAID' ||
            e.code === 'SHIPPO_LABEL_EXISTS'
        ) {
            return res.status(400).json({ error: e.message || e.code, code: e.code });
        }
        logger.error('Manual tracking error:', e);
        res.status(500).json({ error: e.message || 'Unable to save tracking' });
    }
});

/** POST /api/shipping/orders/:orderId/weights — save learned product weights */
router.post('/orders/:orderId/weights', ...adminAuth, async (req, res) => {
    try {
        const itemWeights = req.body?.itemWeights || req.body?.weights || [];
        const saved = await shipping.saveLearnedWeights(req.pool, itemWeights);
        res.json({ ok: true, saved });
    } catch (e) {
        logger.error('Save weights error:', e);
        res.status(500).json({ error: 'Unable to save weights' });
    }
});

/** GET /api/shipping/labels/unprinted — labels ready to print */
router.get('/labels/unprinted', ...adminAuth, async (req, res) => {
    try {
        const orders = await shipping.listUnprintedLabels(req.pool, {
            limit: req.query.limit,
            merchantId: merchantIdFromReq(req),
        });
        res.json({ orders, count: orders.length });
    } catch (e) {
        logger.error('List unprinted labels error:', e);
        res.status(500).json({ error: 'Unable to load unprinted labels' });
    }
});

/** POST /api/shipping/labels/mark-printed — mark label PDFs as printed */
router.post('/labels/mark-printed', ...adminAuth, async (req, res) => {
    try {
        const orderIds = req.body?.orderIds || req.body?.ids || [];
        const result = await shipping.markLabelsPrinted(req.pool, orderIds, {
            merchantId: merchantIdFromReq(req),
        });
        res.json({ ok: true, ...result });
    } catch (e) {
        logger.error('Mark labels printed error:', e);
        res.status(500).json({ error: 'Unable to mark labels printed' });
    }
});

/** GET /api/shipping/labels/needs-create — paid orders still needing a label */
router.get('/labels/needs-create', ...adminAuth, async (req, res) => {
    try {
        const orders = await shipping.listOrdersNeedingLabels(req.pool, {
            limit: req.query.limit,
            merchantId: merchantIdFromReq(req),
        });
        res.json({ orders, count: orders.length });
    } catch (e) {
        logger.error('List needs-create labels error:', e);
        res.status(500).json({ error: 'Unable to load orders needing labels' });
    }
});

/**
 * POST /api/shipping/labels/bulk-create
 * Auto-picks the first/cheapest quoted rate for each ready order.
 */
router.post('/labels/bulk-create', ...adminAuth, async (req, res) => {
    try {
        const orderIds = req.body?.orderIds || req.body?.ids || null;
        const result = await shipping.bulkPurchaseLabels(req.pool, {
            orderIds,
            limit: req.body?.limit,
            merchantId: merchantIdFromReq(req),
        });
        res.json({ ok: true, ...result });
    } catch (e) {
        logger.error('Bulk label create error:', e);
        res.status(500).json({ error: e.message || 'Unable to create labels in bulk' });
    }
});

module.exports = router;
