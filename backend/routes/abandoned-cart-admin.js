'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const programs = require('../services/abandonedCartPrograms');
const { processAbandonedCartEmails } = require('../services/abandonedCartEngine');
const { resolveStoreBranding, brandingForPublicApi } = require('../services/storeBranding');
const { seedAbandonedCartStarterProgramsIfEmpty } = require('../services/abandonedCartStarterPrograms');
const { requireEcommerceStoreAccess } = require('../middleware/requireEcommerceStore');

router.use(requireEcommerceStoreAccess);

router.get('/settings', async (req, res) => {
    try {
        await seedAbandonedCartStarterProgramsIfEmpty(req.pool);
        const enabled = await programs.getMasterEnabled(req.pool);
        const branding = brandingForPublicApi(await resolveStoreBranding(req.pool));
        const list = await programs.listPrograms(req.pool);
        const withStats = await Promise.all(
            list.map(async (p) => ({
                ...p,
                stats: await programs.getProgramStats(req.pool, p.id),
            }))
        );
        res.json({
            enabled,
            branding,
            starterGuideNote: '',
            programs: withStats,
        });
    } catch (err) {
        logger.error('[abandoned-cart] get settings error:', err);
        res.status(500).json({ error: 'Failed to load abandoned cart settings' });
    }
});

router.put('/settings', async (req, res) => {
    try {
        if ('enabled' in (req.body || {})) {
            await programs.setMasterEnabled(req.pool, Boolean(req.body.enabled));
        }
        const enabled = await programs.getMasterEnabled(req.pool);
        res.json({ ok: true, enabled });
    } catch (err) {
        logger.error('[abandoned-cart] put settings error:', err);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

router.post('/programs', async (req, res) => {
    try {
        const created = await programs.createProgram(req.pool, req.body || {});
        res.status(201).json({ program: created });
    } catch (err) {
        if (err.code === 'INVALID_PROGRAM') {
            return res.status(400).json({ error: err.message, code: err.code });
        }
        logger.error('[abandoned-cart] create program error:', err);
        res.status(500).json({ error: 'Failed to create program' });
    }
});

router.put('/programs/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const updated = await programs.updateProgram(req.pool, id, req.body || {});
        if (!updated) return res.status(404).json({ error: 'Program not found' });
        res.json({ program: updated });
    } catch (err) {
        if (err.code === 'INVALID_PROGRAM') {
            return res.status(400).json({ error: err.message, code: err.code });
        }
        logger.error('[abandoned-cart] update program error:', err);
        res.status(500).json({ error: 'Failed to update program' });
    }
});

router.delete('/programs/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const ok = await programs.deleteProgram(req.pool, id);
        if (!ok) return res.status(404).json({ error: 'Program not found' });
        res.json({ ok: true });
    } catch (err) {
        logger.error('[abandoned-cart] delete program error:', err);
        res.status(500).json({ error: 'Failed to delete program' });
    }
});

router.post('/run-now', async (req, res) => {
    try {
        const dryRun = Boolean(req.body?.dryRun);
        const result = await processAbandonedCartEmails(req.pool, { dryRun });
        res.json({ ok: true, result });
    } catch (err) {
        logger.error('[abandoned-cart] run-now error:', err);
        res.status(500).json({ error: 'Failed to process abandoned carts' });
    }
});

module.exports = router;
