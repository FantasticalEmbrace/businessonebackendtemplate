'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateAdmin, requireDeveloperRole } = require('../middleware/adminAuth');
const { createDatabaseBackupStream, getDevToolsStatus } = require('../services/devDatabaseTools');
const { runPendingMigrations } = require('../utils/migrationRunner');
const { buildDbConfig } = require('../utils/dbConfig');
const integrationCredentials = require('../services/integrationCredentials');
const {
    nmiResolveTokenizationCollectJs,
    getNmiPublicTokenizationKey,
    getNmiPrivateApiKey,
    getPosNmiPublicTokenizationKey,
} = require('../utils/nmiEnv');
const shippo = require('../services/shippoClient');
const { auditShippoCarriers } = require('../services/shippoCarrierAudit');
const mxmerchant = require('../services/mxmerchantGateway');

const devAuth = [authenticateAdmin, requireDeveloperRole];

router.get('/status', ...devAuth, async (req, res) => {
    try {
        const status = await getDevToolsStatus(req.pool);
        res.json(status);
    } catch (error) {
        logger.error('Dev tools status error:', error);
        res.status(500).json({ error: error.message || 'Failed to load developer tools status' });
    }
});

router.get('/backup', ...devAuth, async (req, res) => {
    const config = buildDbConfig();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `business-one-backup-${config.database}-${stamp}.sql`;

    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    try {
        const result = await createDatabaseBackupStream(req.pool, (chunk) => {
            res.write(chunk);
        });
        res.setHeader('X-Backup-Method', result.method);
        res.end();
    } catch (error) {
        logger.error('Database backup error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message || 'Backup failed' });
        } else {
            res.end(`\n-- Backup failed: ${error.message}\n`);
        }
    }
});

router.post('/run-migrations', ...devAuth, async (req, res) => {
    try {
        const confirm = String(req.body?.confirm || '').trim().toUpperCase();
        if (confirm !== 'RUN MIGRATIONS') {
            return res.status(400).json({
                error: 'Confirmation required. Send { "confirm": "RUN MIGRATIONS" } in the request body.',
            });
        }

        const result = await runPendingMigrations(req.pool);
        res.json({
            message:
                result.ran === 0
                    ? 'No pending migrations — database is up to date.'
                    : `Applied ${result.ran} migration file(s).`,
            ...result,
        });
    } catch (error) {
        logger.error('Run migrations error:', error);
        res.status(500).json({ error: error.message || 'Failed to run migrations' });
    }
});

router.get('/integrations', ...devAuth, async (req, res) => {
    try {
        await integrationCredentials.hydrateFromDatabase(req.pool);
        res.json(integrationCredentials.buildApiPayload());
    } catch (error) {
        logger.error('Integration credentials load error:', error);
        res.status(500).json({ error: error.message || 'Failed to load integration credentials' });
    }
});

router.put('/integrations', ...devAuth, async (req, res) => {
    try {
        const result = await integrationCredentials.saveCredentials(req.pool, req.body || {});
        const envCount = Array.isArray(result.envSync?.keys) ? result.envSync.keys.length : 0;
        res.json({
            message: envCount
                ? `Integration credentials saved (database + backend/.env, ${envCount} env key${envCount === 1 ? '' : 's'}).`
                : 'Integration credentials saved.',
            ...result,
        });
    } catch (error) {
        logger.error('Integration credentials save error:', error);
        if (error && error.code === 'ENV_SYNC_FAILED') {
            return res.status(500).json({
                error: error.message || 'Failed to update backend/.env',
                saved: error.saved || [],
                payload: error.payload,
            });
        }
        res.status(500).json({ error: error.message || 'Failed to save integration credentials' });
    }
});

router.post('/integrations/test', ...devAuth, async (req, res) => {
    try {
        await integrationCredentials.hydrateFromDatabase(req.pool);
        const target = String(req.body?.target || 'all').trim().toLowerCase();
        const results = {};

        if (target === 'all' || target === 'nmi') {
            const publicKey = getNmiPublicTokenizationKey();
            const privateKey = getNmiPrivateApiKey();
            if (!publicKey || !privateKey) {
                results.nmiWebsite = { ok: false, message: 'Website NMI keys missing' };
            } else {
                const probe = await nmiResolveTokenizationCollectJs(publicKey);
                results.nmiWebsite = {
                    ok: probe.ok,
                    message: probe.ok ? 'Website tokenization key accepted' : 'Website tokenization key rejected',
                };
            }
            const posPublic = getPosNmiPublicTokenizationKey();
            const posPrivate = integrationCredentials.getPosNmiPrivateApiKey();
            const posDeployment = integrationCredentials.getNmiDeploymentMode();
            if (!posPublic || !posPrivate) {
                results.nmiPos = { ok: false, message: 'In-store POS keys missing' };
            } else if (posDeployment === 'virtual') {
                const probe = await nmiResolveTokenizationCollectJs(posPublic, {
                    collectJsUrl: process.env.POS_NMI_COLLECT_JS_URL || '',
                    sandbox: integrationCredentials.isPosNmiSandboxHint()
                });
                results.nmiPos = {
                    ok: probe.ok,
                    message: probe.ok
                        ? 'In-store virtual terminal ready (Collect.js)'
                        : 'In-store POS tokenization key rejected',
                };
            } else {
                results.nmiPos = {
                    ok: true,
                    message: posPublic && posPrivate
                        ? 'In-store POS keys present (physical terminal mode)'
                        : 'In-store POS keys missing',
                };
            }
        }

        if (target === 'all' || target === 'epi') {
            const pub = integrationCredentials.getEpiPublicTokenizationKey();
            const priv = integrationCredentials.getEpiPrivateApiKey();
            results.epi = {
                ok: Boolean(pub && priv),
                message: pub && priv ? 'EPI keys present' : 'EPI keys missing',
            };
        }

        if (target === 'all' || target === 'shippo') {
            try {
                if (!shippo.isConfigured()) {
                    results.shippo = { ok: false, message: 'Shippo API token missing' };
                } else {
                    const audit = await auditShippoCarriers();
                    const carrierLines = audit.requiredCarriers.map((carrier) => {
                        const active = audit.accounts?.carriers?.[carrier]?.active;
                        const rateCount = audit.rates?.byProvider?.[carrier] || 0;
                        const label = carrier.toUpperCase();
                        if (active && rateCount > 0) return `${label}: connected (${rateCount} sample rates)`;
                        if (active) return `${label}: connected (no sample rates yet)`;
                        return `${label}: not connected in Shippo`;
                    });
                    results.shippo = {
                        ok: audit.ready,
                        message: audit.ready
                            ? `Shippo ready — ${carrierLines.join('; ')}`
                            : audit.blockers[0] || 'Shippo carrier setup incomplete',
                        carriers: audit.accounts?.carriers || null,
                        ratesByProvider: audit.rates?.byProvider || null,
                        blockers: audit.blockers,
                        warnings: audit.warnings || [],
                        carrierSummary: carrierLines,
                    };
                }
            } catch (e) {
                results.shippo = { ok: false, message: e.response?.data?.detail || e.message || 'Shippo test failed' };
            }
        }

        if (target === 'all' || target === 'mxmerchant' || target === 'mx') {
            const website = await mxmerchant.testConnection('website');
            const pos = await mxmerchant.testConnection('pos');
            const { testTerminalConnection } = require('../services/mxmerchantTerminal');
            const terminal = await testTerminalConnection('pos');
            results.mxmerchantWebsite = website;
            results.mxmerchantPos = pos;
            results.mxmerchantTerminal = terminal;
        }

        res.json({ results });
    } catch (error) {
        logger.error('Integration credentials test error:', error);
        res.status(500).json({ error: error.message || 'Connection test failed' });
    }
});

module.exports = router;
