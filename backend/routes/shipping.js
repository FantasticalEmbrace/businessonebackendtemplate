'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const shipping = require('../services/shippingService');
const { handleTrackWebhook } = require('../services/shippoTracking');
const { adminAuth } = require('../middleware/adminAuth');

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
        if (e.code === 'MISSING_PRODUCT_WEIGHTS') {
            return res.status(400).json({ error: 'Enter weights for new products first', missing: e.missing });
        }
        if (e.code === 'INVALID_PACKAGE_WEIGHT') {
            return res.status(400).json({ error: 'Cannot calculate package weight — add product weights or enter scale weight' });
        }
        if (e.code === 'LABEL_PURCHASE_FAILED') {
            return res.status(400).json({ error: e.message, code: e.code });
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
        logger.error('Label purchase error:', e);
        res.status(500).json({ error: e.message || 'Unable to create label' });
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

module.exports = router;
