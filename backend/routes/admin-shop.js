'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const shopJobs = require('../services/shopJobs');
const customerWorkflow = require('../services/shopCustomerWorkflow');
const { loadPosShopSettings } = require('../services/posShopSettings');

async function authenticateAdmin(req, res, next) {
    const jwt = require('jsonwebtoken');
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Admin access token required' });
    if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'Server configuration error' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [rows] = await req.pool.execute(
            'SELECT id, email, first_name, last_name, role FROM admin_users WHERE id = ? AND is_active = 1',
            [decoded.adminId]
        );
        if (!rows.length) return res.status(401).json({ error: 'Invalid admin token' });
        req.admin = rows[0];
        next();
    } catch {
        return res.status(403).json({ error: 'Invalid admin token' });
    }
}

router.use(authenticateAdmin);

router.get('/settings', async (req, res) => {
    try {
        const settings = await loadPosShopSettings(req.pool);
        res.json(settings);
    } catch (e) {
        logger.error('Shop settings error:', e);
        res.status(500).json({ error: 'Failed to load shop settings' });
    }
});

router.get('/jobs', async (req, res) => {
    try {
        const result = await shopJobs.listJobs(req.pool, {
            status: req.query.status,
            jobType: req.query.jobType
        });
        res.json(result);
    } catch (e) {
        logger.error('Admin shop jobs list error:', e);
        res.status(500).json({ error: 'Failed to list shop jobs' });
    }
});

router.get('/jobs/:id', async (req, res) => {
    try {
        const result = await shopJobs.getJob(req.pool, req.params.id);
        res.json(result);
    } catch (e) {
        logger.error('Admin shop job get error:', e);
        res.status(500).json({ error: 'Failed to load shop job' });
    }
});

router.get('/customer-workflows', async (req, res) => {
    try {
        const config = await customerWorkflow.loadCustomerWorkflowConfig(req.pool);
        res.json(config);
    } catch (e) {
        logger.error('Admin customer workflows load error:', e);
        res.status(500).json({ error: 'Failed to load customer workflows' });
    }
});

router.put('/customer-workflows', async (req, res) => {
    try {
        const config = await customerWorkflow.saveCustomerWorkflowConfig(req.pool, req.body || {});
        res.json(config);
    } catch (e) {
        logger.error('Admin customer workflows save error:', e);
        res.status(500).json({ error: 'Failed to save customer workflows' });
    }
});

router.get('/customer-workflows/defaults', (_req, res) => {
    res.json({
        processTypes: customerWorkflow.PROCESS_TYPES,
        verticals: customerWorkflow.DEFAULT_WORKFLOWS
    });
});

router.post('/jobs/:id/send-portal-link', async (req, res) => {
    try {
        const channel = String(req.body?.channel || 'link').toLowerCase();
        const jobResult = await shopJobs.getJob(req.pool, req.params.id);
        const portalUrl = String(req.body?.portalUrl || '').trim();
        const result = await customerWorkflow.sendCustomerPortalLink(req.pool, {
            jobId: req.params.id,
            channel,
            phone: req.body?.phone,
            email: req.body?.email,
            portalUrl
        });
        res.json({ ...result, job: jobResult?.job || null });
    } catch (e) {
        logger.error('Admin send portal link error:', e);
        res.status(500).json({ error: 'Failed to send portal link' });
    }
});

module.exports = router;
