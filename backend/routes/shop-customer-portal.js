'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const shopJobs = require('../services/shopJobs');
const workflow = require('../services/shopCustomerWorkflow');
const shopPayments = require('../services/shopJobPayments');
const { loadPosShopSettings } = require('../services/posShopSettings');
const { loadPosStoreConfig } = require('../services/posStoreConfig');
const { loadPosReceiptSettings } = require('../services/posReceiptSettings');

/** Public customer portal — token auth only (no login). */
router.get('/track/:token', async (req, res) => {
    try {
        const token = String(req.params.token || '').trim();
        if (!token) return res.status(400).json({ error: 'Missing tracking token' });
        const jobResult = await shopJobs.getJobByPortalToken(req.pool, token);
        const job = jobResult?.job;
        if (!job) {
            return res.status(404).json({ error: 'Repair order not found for this link.' });
        }
        const [wfConfig, store, receipt] = await Promise.all([
            workflow.loadCustomerWorkflowConfig(req.pool),
            loadPosStoreConfig(req.pool),
            loadPosReceiptSettings(req.pool, null)
        ]);
        const vertical = job.jobType || job.mode || 'auto';
        const template = wfConfig.verticals?.[vertical] || workflow.DEFAULT_WORKFLOWS.auto;
        res.json(
            workflow.buildPortalPayload(job, template, {
                storeName: store.storeName,
                phone: receipt.storePhone || ''
            })
        );
    } catch (e) {
        logger.error('Customer portal track error:', e);
        res.status(500).json({ error: 'Could not load job status' });
    }
});

router.post('/track/:token/decision', async (req, res) => {
    try {
        const token = String(req.params.token || '').trim();
        const approved = Boolean(req.body?.approved);
        const notes = String(req.body?.notes || '').trim();
        const result = await shopJobs.recordCustomerDecision(req.pool, token, {
            approved,
            notes,
            selectedLineIds: req.body?.selectedLineIds
        });
        if (!result?.job) {
            return res.status(404).json({ error: result?.error || 'Repair order not found.' });
        }
        const wfConfig = await workflow.loadCustomerWorkflowConfig(req.pool);
        const [store, receipt] = await Promise.all([
            loadPosStoreConfig(req.pool),
            loadPosReceiptSettings(req.pool, null)
        ]);
        const vertical = result.job.jobType || result.job.mode || 'auto';
        const template = wfConfig.verticals?.[vertical] || workflow.DEFAULT_WORKFLOWS.auto;
        res.json(
            workflow.buildPortalPayload(result.job, template, {
                storeName: store.storeName,
                phone: receipt.storePhone || ''
            })
        );
    } catch (e) {
        logger.error('Customer portal decision error:', e);
        res.status(500).json({ error: 'Could not save decision' });
    }
});

router.post('/track/:token/payment-link', async (req, res) => {
    try {
        const token = String(req.params.token || '').trim();
        const jobResult = await shopJobs.getJobByPortalToken(req.pool, token);
        const link = await shopPayments.createShopJobPaymentLink(req.pool, {
            portalToken: token,
            amount: jobResult?.job?.total,
            job: jobResult?.job
        });
        if (!link.url) {
            return res.status(link.error ? 400 : 403).json(link);
        }
        res.json(link);
    } catch (e) {
        logger.error('Customer portal payment link error:', e);
        res.status(500).json({ error: 'Could not create payment link' });
    }
});

router.get('/pay/:token/info', async (req, res) => {
    try {
        const token = String(req.params.token || '').trim();
        const info = await shopPayments.loadShopPayInfo(req.pool, token, {
            signature: req.query.sig,
            expiresAt: req.query.exp
        });
        if (!info.ok) {
            return res.status(info.paid ? 409 : 400).json(info);
        }
        res.json(info);
    } catch (e) {
        logger.error('Shop pay info error:', e);
        res.status(500).json({ error: 'Could not load payment page' });
    }
});

router.post('/pay/:token/charge', async (req, res) => {
    try {
        const token = String(req.params.token || '').trim();
        const result = await shopPayments.chargeShopJobPayment(req.pool, token, req.body || {});
        res.json(result);
    } catch (e) {
        logger.error('Shop pay charge error:', e);
        const code = e.code || 'CHARGE_FAILED';
        const status =
            code === 'NOT_FOUND' ? 404 : code === 'ALREADY_PAID' ? 409 : code === 'INVALID_LINK' ? 403 : 400;
        res.status(status).json({ error: e.message, code });
    }
});

module.exports = router;
