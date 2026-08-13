'use strict';

const express = require('express');
const { VendorReceivingService } = require('../services/vendor-receiving');

/**
 * Creates POS receiving routes for /api/pos/v1/receiving/*
 *
 * Expected middleware on parent router:
 * - posDeviceAuth (validates X-POS-API-Key + X-POS-Device-Id)
 * - posEmployeeAuth (validates Bearer employee token)
 */
function createPosReceivingRouter(pool, { posEmployeeAuth } = {}) {
    const router = express.Router();
    const service = new VendorReceivingService(pool);

    if (posEmployeeAuth) {
        router.use(posEmployeeAuth);
    }

    router.get('/orders', async (req, res) => {
        try {
            const orders = await service.listOrders({
                status: req.query.status || 'open,partial',
                vendorId: req.query.vendorId,
                limit: req.query.limit
            });
            res.json({ orders });
        } catch (err) {
            res.status(500).json({ error: err.message || 'Failed to list receiving orders' });
        }
    });

    router.get('/orders/by-slip', async (req, res) => {
        try {
            const code = req.query.code || req.query.q;
            const order = await service.findOrderBySlipCode(code);
            if (!order) return res.status(404).json({ error: 'Order slip not found', code: 'NOT_FOUND' });
            res.json({ order });
        } catch (err) {
            res.status(500).json({ error: err.message || 'Failed to find order slip' });
        }
    });

    router.get('/orders/:id', async (req, res) => {
        try {
            const order = await service.getOrderById(Number(req.params.id));
            if (!order) return res.status(404).json({ error: 'Purchase order not found', code: 'NOT_FOUND' });
            res.json({ order });
        } catch (err) {
            res.status(500).json({ error: err.message || 'Failed to load purchase order' });
        }
    });

    router.post('/orders/:id/scan', async (req, res) => {
        try {
            const orderId = Number(req.params.id);
            const code = req.body?.code || req.body?.scan || req.body?.barcode;
            const qty = req.body?.qty != null ? Number(req.body.qty) : 1;
            const allowOverReceive = Boolean(req.body?.allowOverReceive);
            const result = await service.scanReceive(orderId, {
                code,
                qty,
                allowOverReceive,
                employeeId: req.posEmployee?.id || null,
                deviceId: req.headers['x-pos-device-id'] || null
            });
            res.json({ success: true, ...result });
        } catch (err) {
            const status =
                err.code === 'NOT_FOUND' ? 404 : err.code === 'LINE_NOT_FOUND' ? 404 : err.code === 'OVER_RECEIVE' ? 409 : 400;
            res.status(status).json({ error: err.message, code: err.code, lineId: err.lineId });
        }
    });

    router.post('/orders/:id/complete', async (req, res) => {
        try {
            const orderId = Number(req.params.id);
            const allowOverReceive = Boolean(req.body?.allowOverReceive);
            const order = await service.completeReceiving(orderId, {
                allowOverReceive,
                employeeId: req.posEmployee?.id || null,
                deviceId: req.headers['x-pos-device-id'] || null
            });
            res.json({ success: true, order });
        } catch (err) {
            const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'OVER_RECEIVE' ? 409 : 400;
            res.status(status).json({ error: err.message, code: err.code, lines: err.lines });
        }
    });

    return router;
}

module.exports = { createPosReceivingRouter };
