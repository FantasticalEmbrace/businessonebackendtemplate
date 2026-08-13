'use strict';

const express = require('express');
const { VendorReceivingService } = require('../services/vendor-receiving');

/**
 * Admin routes for vendor purchase orders (package slip setup).
 * Mount at /api/admin/vendor-receiving
 */
function createAdminVendorReceivingRouter(pool, { requireAdmin } = {}) {
    const router = express.Router();
    const service = new VendorReceivingService(pool);

    if (requireAdmin) {
        router.use(requireAdmin);
    }

    router.get('/vendors', async (req, res) => {
        try {
            const vendors = await service.listVendors();
            res.json({ vendors });
        } catch (err) {
            res.status(500).json({ error: err.message || 'Failed to list vendors' });
        }
    });

    router.get('/orders', async (req, res) => {
        try {
            const orders = await service.listOrders({
                status: req.query.status,
                vendorId: req.query.vendorId,
                limit: req.query.limit
            });
            res.json({ orders });
        } catch (err) {
            res.status(500).json({ error: err.message || 'Failed to list purchase orders' });
        }
    });

    router.get('/orders/:id', async (req, res) => {
        try {
            const order = await service.getOrderById(Number(req.params.id));
            if (!order) return res.status(404).json({ error: 'Purchase order not found' });
            res.json({ order });
        } catch (err) {
            res.status(500).json({ error: err.message || 'Failed to load purchase order' });
        }
    });

    router.post('/orders', async (req, res) => {
        try {
            const order = await service.createOrder(req.body, req.admin?.id || req.adminUser?.id || null);
            res.status(201).json({ order });
        } catch (err) {
            const status = err.code === 'DUPLICATE_PO' ? 409 : err.code === 'VALIDATION' ? 400 : 500;
            res.status(status).json({ error: err.message, code: err.code });
        }
    });

    router.post('/orders/import-csv', async (req, res) => {
        try {
            const vendorId = Number(req.body?.vendorId);
            if (!vendorId) return res.status(400).json({ error: 'vendorId is required' });
            const lines = await service.importCsvLines(vendorId, req.body?.csv || req.body?.text || '');
            res.json({ lines });
        } catch (err) {
            res.status(400).json({ error: err.message, code: err.code });
        }
    });

    router.post('/orders/:id/open', async (req, res) => {
        try {
            const order = await service.openOrder(Number(req.params.id));
            res.json({ order });
        } catch (err) {
            res.status(400).json({ error: err.message, code: err.code });
        }
    });

    router.put('/vendors/:id/catalog', async (req, res) => {
        try {
            const vendorId = Number(req.params.id);
            const catalogUrl = String(req.body?.catalogUrl || req.body?.catalog_url || '').trim();
            const posOrderingEnabled = req.body?.posOrderingEnabled !== false;
            await service.updateVendorCatalogSettings(vendorId, { catalogUrl, posOrderingEnabled });
            res.json({ success: true });
        } catch (err) {
            res.status(400).json({ error: err.message, code: err.code });
        }
    });

    return router;
}

module.exports = { createAdminVendorReceivingRouter };
