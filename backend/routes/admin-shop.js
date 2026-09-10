'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const shopJobs = require('../services/shopJobs');
const shopAppointments = require('../services/shopAppointments');
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
            jobType: req.query.jobType,
            inStorage: req.query.inStorage
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

router.get('/appointments', async (req, res) => {
    try {
        const result = await shopAppointments.listAppointments(req.pool, {
            from: req.query.from,
            to: req.query.to,
            jobType: req.query.jobType,
            includeTechnician: true
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: 'Failed to list appointments' });
    }
});

router.get('/bay-availability', async (req, res) => {
    try {
        const result = await shopAppointments.getBayAvailability(req.pool, {
            date: req.query.date,
            time: req.query.time,
            durationMins: req.query.durationMins,
            jobType: req.query.jobType || req.query.job_type
        });
        res.json(result);
    } catch (e) {
        logger.error('Admin bay availability error:', e);
        res.status(500).json({ error: 'Failed to load bay availability' });
    }
});

router.post('/appointments', async (req, res) => {
    try {
        const result = await shopAppointments.createAppointment(req.pool, req.body || {});
        res.status(201).json(result);
    } catch (e) {
        if (
            e.status === 409 ||
            e.code === 'NO_BAY_AVAILABLE' ||
            e.code === 'BAY_BUSY'
        ) {
            return res.status(409).json({ error: e.message, code: e.code || 'NO_BAY_AVAILABLE' });
        }
        logger.error('Admin appointment create error:', e);
        res.status(500).json({ error: 'Failed to create appointment' });
    }
});

router.patch('/appointments/:id', async (req, res) => {
    try {
        const result = await shopAppointments.updateAppointment(req.pool, req.params.id, req.body || {});
        if (!result.appointment) return res.status(404).json({ error: result.error || 'Not found' });
        res.json(result);
    } catch (e) {
        if (e.status === 409 || e.code === 'NO_BAY_AVAILABLE' || e.code === 'BAY_BUSY') {
            return res.status(409).json({ error: e.message, code: e.code || 'NO_BAY_AVAILABLE' });
        }
        logger.error('Admin appointment update error:', e);
        res.status(500).json({ error: 'Failed to update appointment' });
    }
});

router.get('/analytics/cycle-time', async (req, res) => {
    try {
        const result = await shopJobs.listJobs(req.pool, { jobType: req.query.jobType || 'body' });
        const rows = (result.jobs || []).map((job) => {
            const stages = job.stageTimestamps || {};
            const keys = Object.keys(stages).sort((a, b) => new Date(stages[a]) - new Date(stages[b]));
            const durations = {};
            for (let i = 0; i < keys.length - 1; i++) {
                const ms = new Date(stages[keys[i + 1]]) - new Date(stages[keys[i]]);
                durations[keys[i]] = Math.round(ms / 3600000 * 10) / 10;
            }
            return {
                id: job.id,
                roNumber: job.roNumber,
                status: job.status,
                stages,
                durationsHours: durations
            };
        });
        res.json({ jobs: rows });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load cycle time' });
    }
});

router.get('/analytics/alignment', async (req, res) => {
    try {
        const result = await shopJobs.listJobs(req.pool, { jobType: 'tire' });
        let quoted = 0;
        let completed = 0;
        let declined = 0;
        for (const job of result.jobs || []) {
            const t = job.alignmentType || 'none';
            if (t === '2wheel' || t === '4wheel') {
                quoted += 1;
                if (job.alignmentDone) completed += 1;
                else if (job.alignmentSkipped) declined += 1;
            }
        }
        res.json({ alignment: { quoted, completed, declined } });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load alignment analytics' });
    }
});

router.get('/analytics/tech-time', async (req, res) => {
    try {
        const result = await shopJobs.listJobs(req.pool, {});
        const rows = [];
        for (const job of result.jobs || []) {
            const entries = Array.isArray(job.techTime) ? job.techTime : [];
            let actualMinutes = 0;
            entries.forEach((e) => {
                if (!e.startedAt) return;
                const end = e.endedAt ? new Date(e.endedAt) : new Date();
                actualMinutes += Math.max(0, (end - new Date(e.startedAt)) / 60000);
            });
            const soldHours = (job.lines || [])
                .filter((l) => /labor/i.test(String(l.sku || '')) || /labor/i.test(String(l.categoryName || '')))
                .reduce((s, l) => s + Number(l.qty || 0), 0);
            if (actualMinutes > 0 || soldHours > 0) {
                rows.push({
                    id: job.id,
                    roNumber: job.roNumber,
                    soldHours,
                    actualHours: Math.round((actualMinutes / 60) * 10) / 10
                });
            }
        }
        res.json({ jobs: rows });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load tech time' });
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

router.post('/jobs/:id/send-review', async (req, res) => {
    try {
        const result = await customerWorkflow.sendReviewRequest(req.pool, {
            jobId: req.params.id,
            channel: req.body?.channel,
            phone: req.body?.phone,
            email: req.body?.email,
            reviewUrl: req.body?.reviewUrl
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: 'Failed to send review request' });
    }
});

module.exports = router;
