'use strict';

const express = require('express');
const router = express.Router();
const { authenticatePlatformHubSecret } = require('../middleware/platformSupportAuth');
const { buildMerchantOverview } = require('../services/posMerchantOverview');
const { getStoreBaseUrl } = require('../utils/platformSupportEnv');
const logger = require('../utils/logger');

router.use(authenticatePlatformHubSecret);

router.get('/merchant-overview', async (req, res) => {
    try {
        const overview = await buildMerchantOverview(req.pool);
        res.json(overview);
    } catch (e) {
        logger.error('Merchant overview error:', e);
        res.status(500).json({ error: 'Failed to load merchant overview' });
    }
});

/** Business One ops remote support — not merchant-store admin. */
router.get('/support', async (req, res) => {
    try {
        const registerSupport = require('../services/posRegisterSupport');
        const {
            listSupportAgents,
            isEnrollConfigured,
            rustDeskServerConfig
        } = require('../services/posSupportAgent');
        const [registers, agents] = await Promise.all([
            registerSupport.listRegistersForSupport(req.pool),
            listSupportAgents(req.pool)
        ]);
        const base = getStoreBaseUrl() || '';
        res.json({
            registers,
            windowsAgents: agents,
            rustdesk: rustDeskServerConfig(),
            windowsAgentDownloadUrl: base
                ? `${base}/support-agent/downloads/BusinessOneSupportAgent-Setup.exe`
                : '/support-agent/downloads/BusinessOneSupportAgent-Setup.exe',
            viewerPage: base ? `${base}/support-viewer.html` : '/support-viewer.html',
            enrollConfigured: isEnrollConfigured(),
            storeBaseUrl: base || null
        });
    } catch (e) {
        logger.error('Platform ops support list error:', e);
        res.status(500).json({ error: 'Failed to load support targets' });
    }
});

router.post('/support/registers/:deviceId/session', async (req, res) => {
    try {
        const registerSupport = require('../services/posRegisterSupport');
        const deviceId = Number(req.params.deviceId);
        const [devices] = await req.pool.execute(
            `SELECT id, platform FROM pos_devices WHERE id = ? AND is_active = 1 LIMIT 1`,
            [deviceId]
        );
        if (!devices[0]) return res.status(404).json({ error: 'Register not found' });

        let sessionRow = await registerSupport.getActiveSessionForDevice(req.pool, deviceId);
        if (!sessionRow) {
            const platform = devices[0].platform || 'windows';
            await registerSupport.requestSupportSession(req.pool, deviceId, {
                platform,
                diagnostics: {
                    initiatedBy: 'business-one-ops',
                    claimedBy: String(req.body?.claimedBy || 'Business One ops').slice(0, 200)
                }
            });
            sessionRow = await registerSupport.getActiveSessionForDevice(req.pool, deviceId);
        }
        if (!sessionRow) {
            return res.status(500).json({ error: 'Could not create support session' });
        }

        const session = await registerSupport.platformJoinSession(req.pool, sessionRow.id, {
            claimedBy: String(req.body?.claimedBy || 'Business One ops').slice(0, 200)
        });
        const base = getStoreBaseUrl() || '';
        const viewerUrl =
            `${base}/support-viewer.html?session=${session.id}` +
            `&store=${encodeURIComponent(base)}` +
            `&mode=platform`;
        res.json({ session, viewerUrl, storeBaseUrl: base || null });
    } catch (e) {
        const status =
            e.code === 'SESSION_UNAVAILABLE' || e.code === 'SESSION_EXPIRED' ? 400 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.post('/support/agents/:id/connect', async (req, res) => {
    try {
        const { beginRemoteSession } = require('../services/posSupportAgent');
        const session = await beginRemoteSession(req.pool, req.params.id, 0);
        res.json(session);
    } catch (e) {
        const status = e.code === 'NOT_FOUND' || e.code === 'NO_RUSTDESK_ID' ? 404 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

module.exports = router;
