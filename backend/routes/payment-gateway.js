'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { adminAuth } = require('../middleware/adminAuth');
const paymentGateway = require('../services/paymentGateway');
const { listStoreProcessors } = require('../services/storePaymentProcessor');
const { testTerminalConnection } = require('../services/mxmerchantTerminal');

const router = express.Router();

/** GET /api/payment-gateway/capabilities — template feature matrix */
router.get('/capabilities', ...adminAuth, (req, res) => {
    const processors = listStoreProcessors().map((p) => ({
        ...p,
        capabilities: paymentGateway.getCapabilities(p.id),
    }));
    res.json({ processors, all: paymentGateway.listAllCapabilities() });
});

/**
 * POST /api/payment-gateway/reverse
 * Body: { processor, scope, transactionId, paymentId, amount, operation: void|refund|auto }
 */
router.post('/reverse', ...adminAuth, async (req, res) => {
    try {
        const result = await paymentGateway.reversePayment(req.body || {});
        if (!result.ok) {
            return res.status(402).json({ success: false, ...result });
        }
        res.json({ success: true, ...result });
    } catch (e) {
        logger.error('Payment gateway reverse error:', e);
        res.status(500).json({ error: e.message || 'Reverse failed' });
    }
});

/**
 * POST /api/payment-gateway/orders/:orderId/reverse
 * Void/refund using order.payment_reference and payment_processor.
 */
router.post('/orders/:orderId/reverse', ...adminAuth, async (req, res) => {
    try {
        const orderId = parseInt(req.params.orderId, 10);
        const [rows] = await req.pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [orderId]);
        if (!rows.length) return res.status(404).json({ error: 'Order not found' });
        const result = await paymentGateway.reverseOrderPayment(rows[0], req.body || {}, req.pool);
        if (result.skipped) {
            return res.json({ success: true, skipped: true, message: result.responseText });
        }
        if (!result.ok) {
            return res.status(402).json({ success: false, ...result });
        }
        res.json({ success: true, ...result });
    } catch (e) {
        logger.error('Order payment reverse error:', e);
        res.status(500).json({ error: e.message || 'Reverse failed' });
    }
});

/** GET /api/payment-gateway/mx/terminals — list MX physical terminals */
router.get('/mx/terminals', ...adminAuth, async (req, res) => {
    try {
        const scope = req.query.scope === 'website' ? 'website' : 'pos';
        const { listTerminals } = require('../services/mxmerchantTerminal');
        const result = await listTerminals(scope);
        res.json(result);
    } catch (e) {
        logger.error('MX list terminals error:', e);
        res.status(500).json({ error: e.message || 'Failed to list terminals' });
    }
});

/** POST /api/payment-gateway/mx/terminal/test — verify Terminal API JWT */
router.post('/mx/terminal/test', ...adminAuth, async (req, res) => {
    try {
        const scope = req.body?.scope === 'website' ? 'website' : 'pos';
        const result = await testTerminalConnection(scope);
        res.json(result);
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

/** POST /api/payment-gateway/webhooks/mx — MX notifications (configure in MX portal) */
router.post('/webhooks/mx', async (req, res) => {
    try {
        logger.info('MX webhook received', {
            event: req.body?.eventType || req.body?.type || 'unknown',
        });
        res.json({ ok: true });
    } catch (e) {
        logger.error('MX webhook error:', e);
        res.status(500).json({ ok: false });
    }
});

module.exports = router;
