'use strict';

const express = require('express');
const {
    getProviderStatus,
    googleOAuthClient,
    fetchGoogleProfile,
    getGoogleRedirectUri,
    GOOGLE_SCOPES,
    createOAuthState,
    verifyOAuthState
} = require('../services/socialOAuth');
const {
    verifyTechnicianCredentials,
    signTechnicianToken,
    verifyTechnicianToken,
    authorizeGoogleTechnician,
    isTechnicianAuthConfigured
} = require('../services/platformSupportTechnicianAuth');
const {
    upsertQueueEntry,
    listSupportQueue,
    purgeExpiredQueueEntries
} = require('../services/posPlatformSupportHub');
const { authenticatePlatformHubSecret } = require('../middleware/platformSupportAuth');
const { getPlatformHubSecret } = require('../utils/platformSupportEnv');
const logger = require('../utils/logger');

const router = express.Router();

function safeReturnPath(raw, fallback = '/support-desk') {
    const value = String(raw || '').trim();
    if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
    if (value.includes('://')) return fallback;
    return value;
}

function encodeTechnicianParam(technician) {
    const json = JSON.stringify(technician || {});
    return Buffer.from(json, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function authenticateTechnician(req, res, next) {
    const auth = String(req.headers.authorization || '');
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const technician = verifyTechnicianToken(token);
    if (!technician) {
        return res.status(401).json({ error: 'Technician session required' });
    }
    req.supportTechnician = technician;
    next();
}

router.get('/info', (_req, res) => {
    const google = getProviderStatus().google;
    res.json({
        technicianLoginConfigured: isTechnicianAuthConfigured(),
        googleLoginConfigured: google.enabled,
        hubTitle: 'Business One Support Desk',
        hubPublicUrl: String(process.env.PLATFORM_SUPPORT_HUB_URL || process.env.STOREFRONT_PUBLIC_URL || '').trim(),
        merchantStoreUrl: String(process.env.STOREFRONT_PUBLIC_URL || '').trim()
    });
});

router.post('/sync', authenticatePlatformHubSecret, async (req, res) => {
    try {
        await purgeExpiredQueueEntries(req.pool);
        const payload = req.body || {};
        if (!payload.merchantId || !payload.storeSessionId) {
            return res.status(400).json({ error: 'merchantId and storeSessionId required' });
        }
        const entry = await upsertQueueEntry(req.pool, payload);
        res.json({ ok: true, entry });
    } catch (e) {
        logger.error('[platform-support] sync error', { message: e.message });
        res.status(500).json({ error: 'Sync failed' });
    }
});

router.post('/technician/login', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim();
        const password = String(req.body?.password || '');
        const technician = verifyTechnicianCredentials(email, password);
        if (!technician) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const token = signTechnicianToken(technician);
        res.json({ token, technician });
    } catch (e) {
        const status = e.code === 'NO_JWT_SECRET' ? 503 : 500;
        res.status(status).json({ error: e.message || 'Login failed' });
    }
});

router.get('/queue', authenticateTechnician, async (req, res) => {
    try {
        await purgeExpiredQueueEntries(req.pool);
        const queue = await listSupportQueue(req.pool);
        res.json({
            ...queue,
            platformViewerKey: getPlatformHubSecret()
        });
    } catch (e) {
        logger.error('[platform-support] queue error', { message: e.message });
        res.status(500).json({ error: 'Failed to load queue' });
    }
});

router.post('/connect', authenticateTechnician, async (req, res) => {
    try {
        const storeSessionId = Number(req.body?.storeSessionId);
        const merchantId = String(req.body?.merchantId || '').trim();
        if (!storeSessionId || !merchantId) {
            return res.status(400).json({ error: 'storeSessionId and merchantId required' });
        }

        const [rows] = await req.pool.execute(
            `SELECT * FROM pos_platform_support_queue
             WHERE merchant_id = ? AND store_session_id = ? LIMIT 1`,
            [merchantId, storeSessionId]
        );
        const row = rows[0];
        if (!row) {
            return res.status(404).json({ error: 'Queue entry not found' });
        }

        const claimedBy = req.supportTechnician.name || req.supportTechnician.email;
        await req.pool.execute(
            `UPDATE pos_platform_support_queue SET claimed_by = ?, synced_at = CURRENT_TIMESTAMP
             WHERE merchant_id = ? AND store_session_id = ?`,
            [String(claimedBy).slice(0, 200), merchantId, storeSessionId]
        );

        const storeBase = String(row.store_base_url || '').replace(/\/+$/, '');
        const viewerUrl =
            `${storeBase}/support-viewer.html?session=${storeSessionId}` +
            `&store=${encodeURIComponent(storeBase)}` +
            `&mode=platform` +
            `&merchant=${encodeURIComponent(row.merchant_name || '')}`;

        res.json({ viewerUrl, platformViewerKey: getPlatformHubSecret() });
    } catch (e) {
        logger.error('[platform-support] connect error', { message: e.message });
        res.status(500).json({ error: 'Connect failed' });
    }
});

router.get('/google/start', (req, res) => {
    const google = getProviderStatus().google;
    if (!google.enabled) {
        return res.status(503).json({ error: 'Google sign-in is not configured on the server' });
    }
    const returnTo = safeReturnPath(req.query.returnTo, '/support-desk');
    const redirectUri = getGoogleRedirectUri(req, 'support');
    const state = createOAuthState('support_desk_google_oauth', { returnTo });
    const client = googleOAuthClient(redirectUri);
    const authUrl = client.generateAuthUrl({
        access_type: 'online',
        scope: GOOGLE_SCOPES,
        state,
        prompt: 'select_account',
        include_granted_scopes: true
    });
    res.redirect(authUrl);
});

router.get('/google/callback', async (req, res) => {
    const returnTo = safeReturnPath(req.query.returnTo, '/support-desk');
    try {
        const { code, state, error: oauthError } = req.query;
        if (oauthError) {
            return res.redirect(`${returnTo}#error=${encodeURIComponent(String(oauthError))}`);
        }
        if (!code || !state) {
            return res.redirect(`${returnTo}#error=${encodeURIComponent('Missing Google authorization code')}`);
        }
        const decoded = verifyOAuthState(state, 'support_desk_google_oauth');
        const redirectUri = getGoogleRedirectUri(req, 'support');
        const profile = await fetchGoogleProfile(String(code), redirectUri);
        const technician = authorizeGoogleTechnician(profile);
        if (!technician) {
            return res.redirect(`${returnTo}#error=${encodeURIComponent('Google account is not authorized for support desk access')}`);
        }
        const token = signTechnicianToken(technician);
        const techParam = encodeTechnicianParam(technician);
        res.redirect(`${decoded.returnTo || returnTo}#token=${encodeURIComponent(token)}&technician=${techParam}`);
    } catch (e) {
        logger.error('[platform-support] google callback failed', { message: e.message });
        res.redirect(`${returnTo}#error=${encodeURIComponent(e.message || 'Google sign-in failed')}`);
    }
});

module.exports = router;
