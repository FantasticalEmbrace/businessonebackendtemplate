'use strict';

const express = require('express');
const router = express.Router();
const { authenticatePlatformHubSecret } = require('../middleware/platformSupportAuth');
const registerSupport = require('../services/posRegisterSupport');
const { scheduleSupportSessionSync } = require('../services/posPlatformSupportSync');

router.use(authenticatePlatformHubSecret);

router.post('/sessions/:id/join', async (req, res) => {
    try {
        const claimedBy = String(req.body?.claimedBy || req.body?.claimed_by || 'Platform support').slice(0, 200);
        const session = await registerSupport.platformJoinSession(req.pool, req.params.id, { claimedBy });
        scheduleSupportSessionSync(req.pool, session.id, { claimedBy });
        res.json({ session });
    } catch (e) {
        const status = e.code === 'SESSION_UNAVAILABLE' || e.code === 'SESSION_EXPIRED' ? 400 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.post('/sessions/:id/answer', async (req, res) => {
    try {
        const session = await registerSupport.setPlatformAnswerSdp(req.pool, req.params.id, req.body?.sdp);
        scheduleSupportSessionSync(req.pool, session.id);
        res.json({ session });
    } catch (e) {
        res.status(400).json({ error: e.message, code: e.code });
    }
});

router.post('/sessions/:id/ice', async (req, res) => {
    try {
        await registerSupport.appendIceCandidate(req.pool, req.params.id, 'admin', req.body?.candidate);
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.post('/sessions/:id/frame', async (req, res) => {
    try {
        const frameStore = require('../services/posSupportFrameStore');
        const row = await registerSupport.getSessionById(req.pool, req.params.id);
        if (!row) return res.status(404).json({ error: 'Session not found' });
        if (['ended', 'denied', 'expired'].includes(String(row.status || ''))) {
            return res.status(400).json({ error: 'Session is closed' });
        }
        const first = !frameStore.hasFrame(req.params.id);
        const ok = frameStore.setFrame(req.params.id, {
            data: req.body?.data,
            mime: req.body?.mime,
            width: req.body?.width,
            height: req.body?.height
        });
        if (!ok) return res.status(400).json({ error: 'Invalid frame' });
        if (first) {
            await req.pool.execute(
                `UPDATE pos_register_support_sessions
                 SET status = CASE WHEN status IN ('pending', 'awaiting_consent') THEN 'connecting' ELSE status END,
                     signal_version = signal_version + 1
                 WHERE id = ?`,
                [req.params.id]
            );
        }
        res.json({ ok: true, first });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Frame upload failed' });
    }
});

router.get('/sessions/:id/frame', async (req, res) => {
    try {
        const frameStore = require('../services/posSupportFrameStore');
        const since = Number(req.query.since) || 0;
        const frame = frameStore.getFrame(req.params.id, since);
        if (!frame) return res.status(404).json({ error: 'No frame' });
        if (frame.unchanged) return res.json({ unchanged: true, updatedAt: frame.updatedAt });
        res.json(frame);
    } catch (e) {
        res.status(500).json({ error: e.message || 'Frame read failed' });
    }
});

router.get('/sessions/:id/signal', async (req, res) => {
    try {
        const sinceVersion = Number(req.query.since) || 0;
        const state = await registerSupport.getSignalState(req.pool, req.params.id, { sinceVersion });
        res.json(state);
    } catch (e) {
        res.status(404).json({ error: e.message, code: e.code });
    }
});

router.post('/sessions/:id/end', async (req, res) => {
    try {
        await registerSupport.endSession(req.pool, req.params.id, { byAdmin: true });
        scheduleSupportSessionSync(req.pool, req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to end session' });
    }
});

module.exports = router;
