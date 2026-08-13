'use strict';

const express = require('express');
const { PosVendorOrderingService } = require('../services/pos-vendor-ordering');

function createPosVendorOrderingRouter(pool, { posEmployeeAuth } = {}) {
    const router = express.Router();
    const service = new PosVendorOrderingService(pool);

    if (posEmployeeAuth) {
        router.use(posEmployeeAuth);
    }

    router.get('/vendors', async (req, res) => {
        try {
            const vendors = await service.listVendors();
            res.json({ vendors });
        } catch (err) {
            res.status(500).json({ error: err.message || 'Failed to list vendors' });
        }
    });

    router.get('/vendors/:id/catalog', async (req, res) => {
        try {
            const catalog = await service.getCatalog(Number(req.params.id), {
                q: req.query.q,
                page: req.query.page,
                limit: req.query.limit
            });
            res.json(catalog);
        } catch (err) {
            res.status(500).json({ error: err.message || 'Failed to load vendor catalog' });
        }
    });

    router.post('/vendors/:id/sync-catalog', async (req, res) => {
        try {
            const result = await service.syncCatalogFromUrl(Number(req.params.id));
            res.json({ success: true, ...result });
        } catch (err) {
            const status =
                err.code === 'NOT_FOUND' ? 404 : err.code === 'NO_CATALOG_URL' ? 400 : err.code === 'CATALOG_FETCH_FAILED' ? 502 : 400;
            res.status(status).json({ error: err.message, code: err.code });
        }
    });

    router.post('/vendors/:id/orders', async (req, res) => {
        try {
            const order = await service.submitOrder(Number(req.params.id), req.body, {
                employeeId: req.posEmployee?.id || null,
                deviceId: req.headers['x-pos-device-id'] || null
            });
            res.status(201).json({ success: true, order });
        } catch (err) {
            const status =
                err.code === 'NOT_IN_CATALOG' || err.code === 'BELOW_MOQ' || err.code === 'VALIDATION'
                    ? 400
                    : err.code === 'DUPLICATE_PO'
                      ? 409
                      : 500;
            res.status(status).json({ error: err.message, code: err.code });
        }
    });

    router.get('/orders', async (req, res) => {
        try {
            const orders = await service.listSubmittedOrders({
                vendorId: req.query.vendorId,
                limit: req.query.limit
            });
            res.json({ orders });
        } catch (err) {
            res.status(500).json({ error: err.message || 'Failed to list orders' });
        }
    });

    return router;
}

module.exports = { createPosVendorOrderingRouter };
