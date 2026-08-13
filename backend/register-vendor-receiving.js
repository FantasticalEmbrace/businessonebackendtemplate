'use strict';

const express = require('express');
const { ensureVendorReceivingSchema } = require('./utils/ensureVendorReceivingSchema');
const { createPosReceivingRouter } = require('./routes/pos-receiving');
const { createAdminVendorReceivingRouter } = require('./routes/admin-vendor-receiving');
const { createPosVendorOrderingRouter } = require('./routes/pos-vendor-ordering');
const { authenticatePosDevice } = require('./middleware/posDeviceAuth');

/**
 * Mount vendor receiving routes (call before /api/admin catch-all).
 */
function mountVendorReceivingRoutes(app, { pool, posEmployeeAuth, requireAdmin } = {}) {
    if (!pool) throw new Error('mountVendorReceivingRoutes requires a database pool');

    const adminRouter = createAdminVendorReceivingRouter(pool, { requireAdmin });
    app.use('/api/admin/vendor-receiving', adminRouter);

    const posReceivingInner = createPosReceivingRouter(pool, { posEmployeeAuth });
    const posReceivingRouter = express.Router();
    posReceivingRouter.use(authenticatePosDevice);
    posReceivingRouter.use(posReceivingInner);
    app.use('/api/pos/v1/receiving', posReceivingRouter);

    const vendorOrderingInner = createPosVendorOrderingRouter(pool, { posEmployeeAuth });
    const vendorOrderingRouter = express.Router();
    vendorOrderingRouter.use(authenticatePosDevice);
    vendorOrderingRouter.use(vendorOrderingInner);
    app.use('/api/pos/v1/vendor-ordering', vendorOrderingRouter);
}

async function ensureVendorReceivingReady(pool) {
    await ensureVendorReceivingSchema(pool);
}

/** @deprecated use mountVendorReceivingRoutes + ensureVendorReceivingReady */
async function registerVendorReceiving(app, opts) {
    mountVendorReceivingRoutes(app, opts);
    await ensureVendorReceivingReady(opts.pool);
}

module.exports = { mountVendorReceivingRoutes, ensureVendorReceivingReady, registerVendorReceiving };
