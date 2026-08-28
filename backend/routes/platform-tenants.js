'use strict';

const express = require('express');
const { tenancyShared } = require('../utils/ensureTenantsSchema');
const {
    provisionTenant,
    registerDeviceKey,
    resolveByKey,
    publicMerchant,
    findById
} = require('../services/tenantProvision');

const router = express.Router();

function provisionSecretOk(req) {
    const expected = String(
        process.env.PLATFORM_PROVISION_SECRET ||
            process.env.MERCHANT_ACCOUNTS_ADMIN_SECRET ||
            process.env.POS_PLATFORM_HUB_SECRET ||
            ''
    ).trim();
    if (!expected) {
        // Local default: allow when tenancy is on and no secret configured
        return process.env.NODE_ENV !== 'production';
    }
    const got = String(
        req.get('X-Platform-Provision-Secret') ||
            req.get('X-Merchant-Accounts-Admin') ||
            ''
    ).trim();
    return got && got === expected;
}

function requireProvisionAuth(req, res, next) {
    if (!tenancyShared()) {
        return res.status(503).json({ error: 'Shared tenancy is not enabled', code: 'TENANCY_DISABLED' });
    }
    if (!provisionSecretOk(req)) {
        return res.status(401).json({ error: 'Provision secret required', code: 'UNAUTHORIZED' });
    }
    return next();
}

/** Idempotent shop tenant create (called from ops signup). */
router.post('/tenants', requireProvisionAuth, async (req, res) => {
    try {
        const result = await provisionTenant(req.pool, req.body || {});
        res.status(result.alreadyProvisioned ? 200 : 201).json({
            success: true,
            alreadyProvisioned: result.alreadyProvisioned,
            account: {
                id: result.merchant.id,
                slug: result.merchant.slug,
                businessName: result.merchant.businessName,
                billingEmail: result.merchant.billingEmail,
                websiteApiKeyPrefix: result.websiteApiKeyPrefix || null,
                sharedPosApiOrigin: result.sharedPosApiOrigin,
                status: result.merchant.status
            },
            secrets: result.websiteApiKey
                ? {
                      websiteApiKey: result.websiteApiKey,
                      tempAdminPassword: result.tempAdminPassword || null,
                      note: 'Website key shown once. Temp admin password shown once if a new owner was created.'
                  }
                : null
        });
    } catch (e) {
        const status = e.code === 'VALIDATION' ? 400 : e.code === 'TENANCY_DISABLED' ? 503 : 500;
        res.status(status).json({ error: e.message || 'Provision failed', code: e.code });
    }
});

router.post('/tenants/:id/device-keys', requireProvisionAuth, async (req, res) => {
    try {
        const result = await registerDeviceKey(
            req.pool,
            req.params.id,
            req.body?.deviceKey,
            req.body?.label
        );
        res.status(201).json(result);
    } catch (e) {
        const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'VALIDATION' ? 400 : 500;
        res.status(status).json({ error: e.message || 'Register failed', code: e.code });
    }
});

router.post('/directory/resolve', async (req, res) => {
    try {
        if (!tenancyShared()) {
            return res.status(503).json({ error: 'Shared tenancy is not enabled', code: 'TENANCY_DISABLED' });
        }
        const row = await resolveByKey(req.pool, req.body || {});
        if (!row) {
            return res.status(404).json({ error: 'Shop not found', code: 'NOT_FOUND' });
        }
        res.json({
            account: publicMerchant(row),
            resolvedVia: req.body?.websiteApiKey
                ? 'website_key'
                : req.body?.deviceKey
                  ? 'device_key'
                  : 'slug'
        });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Resolve failed' });
    }
});

router.get('/tenants/:id', requireProvisionAuth, async (req, res) => {
    try {
        const row = await findById(req.pool, req.params.id);
        if (!row) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
        res.json({ account: publicMerchant(row) });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Lookup failed' });
    }
});

module.exports = router;
