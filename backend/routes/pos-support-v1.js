'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const {
    registerSupportAgent,
    findAgentByToken,
    agentHeartbeat,
    isEnrollConfigured,
    rustDeskServerConfig
} = require('../services/posSupportAgent');

function readAgentToken(req) {
    const auth = String(req.headers.authorization || '');
    if (auth.toLowerCase().startsWith('bearer ')) {
        return auth.slice(7).trim();
    }
    return String(req.headers['x-pos-support-key'] || req.body?.agent_key || '').trim();
}

async function authenticateSupportAgent(req, res, next) {
    const token = readAgentToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Support agent key required', code: 'AGENT_AUTH_REQUIRED' });
    }
    try {
        const row = await findAgentByToken(req.pool, token);
        if (!row) {
            return res.status(401).json({ error: 'Invalid support agent key', code: 'AGENT_AUTH_INVALID' });
        }
        req.supportAgent = row;
        next();
    } catch (error) {
        next(error);
    }
}

router.get('/config', (req, res) => {
    const servers = rustDeskServerConfig();
    res.json({
        enrolled: isEnrollConfigured(),
        rustdesk: servers,
        heartbeatSeconds: Math.max(15, Number(process.env.POS_SUPPORT_HEARTBEAT_SECONDS) || 30)
    });
});

router.post('/register', async (req, res) => {
    try {
        const enrollKey =
            req.headers['x-pos-support-enroll'] ||
            req.body?.enroll_key ||
            req.body?.enrollKey;
        const result = await registerSupportAgent(req.pool, req.body || {}, { enrollKey });
        res.status(201).json({
            success: true,
            agentId: result.agentId,
            agentKey: result.agentKey,
            keyPrefix: result.keyPrefix,
            rustdeskId: result.rustdeskId,
            rustdesk: rustDeskServerConfig(),
            message: 'Save agentKey securely — it is shown only once.'
        });
    } catch (e) {
        const status =
            e.code === 'INVALID_ENROLL_KEY' || e.code === 'RUSTDESK_ID_REQUIRED' || e.code === 'INVALID_LABEL'
                ? 400
                : e.code === 'SUPPORT_NOT_CONFIGURED'
                  ? 503
                  : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.post('/heartbeat', authenticateSupportAgent, async (req, res) => {
    try {
        const agent = await agentHeartbeat(req.pool, req.supportAgent, req.body || {});
        res.json({ ok: true, agent });
    } catch (e) {
        logger.error('POS support heartbeat error', { message: e.message });
        res.status(500).json({ error: 'Heartbeat failed' });
    }
});

module.exports = router;
