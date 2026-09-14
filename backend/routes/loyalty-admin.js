'use strict';



const express = require('express');

const router = express.Router();

const logger = require('../utils/logger');

const { requireEcommerceStoreAccess } = require('../middleware/requireEcommerceStore');

const { resolveStoreBranding, brandingForPublicApi } = require('../services/storeBranding');

const {

    getProgramSettings,

    saveProgramSettings,

    recordProgramEnabledAt,

    listTiers,

    updateTier,

    seedDefaultTiersIfEmpty,

    repairKnownTierDefaultDrift,

    listLoyaltyCustomers,

    getLoyaltyCustomerSummary,

    formatTierForAdmin,

} = require('../services/loyaltyTierProgram');

const { recalculateCustomerTier, evaluateCustomerTier, recalculateAllCustomerTiers } = require('../services/loyaltyTierEngine');

const {
    processLoyaltyEmails,
    sendManualEmail,
    previewProgramIntroEmail,
    previewTierPromotionEmail,
    sendPendingTierPromotionEmails,
    sendProgramIntroToEligibleCustomers,
} = require('../services/loyaltyTierEmails');
const {
    runThrottledProgramIntroSend,
    scheduleProgramIntroBulkSend,
    getProgramIntroSendStats,
    isIntroSendRunning,
} = require('../services/loyaltyIntroEmailQueue');

const { backfillPreEnableLoyaltyRewards } = require('../services/loyaltyPreEnableBackfill');
const { runFullLoyaltyEarnBackfill } = require('../services/loyaltyEarnBackfill');



router.use(requireEcommerceStoreAccess);



router.get('/settings', async (req, res) => {

    try {

        await seedDefaultTiersIfEmpty(req.pool);
        await repairKnownTierDefaultDrift(req.pool);

        const settings = await getProgramSettings(req.pool);

        const rawTiers = await listTiers(req.pool);
        const tiers = rawTiers.map((t) => formatTierForAdmin(t, settings.programMode));

        const branding = brandingForPublicApi(await resolveStoreBranding(req.pool));

        res.json({

            settings,

            tiers,

            branding,

            starterNote: '',

        });

    } catch (err) {

        logger.error('[loyalty-admin] get settings error:', err);

        res.status(500).json({ error: 'Failed to load loyalty settings' });

    }

});



router.put('/settings', async (req, res) => {

    try {

        const previous = await getProgramSettings(req.pool);

        const settings = await saveProgramSettings(req.pool, req.body || {});

        let programIntro = null;
        let backfill = null;
        let tierRecalc = null;

        if (!previous.enabled && settings.enabled) {
            const enableAt = new Date();
            await recordProgramEnabledAt(req.pool, enableAt);
            backfill = await backfillPreEnableLoyaltyRewards(req.pool, enableAt);
            tierRecalc = await recalculateAllCustomerTiers(req.pool, { sendPromotionEmail: false });
            programIntro = await sendProgramIntroToEligibleCustomers(req.pool, { background: true });
            logger.info('[loyalty-admin] program enabled — pre-enable backfill:', backfill);
            logger.info('[loyalty-admin] program enabled — tier recalc:', tierRecalc);
            logger.info('[loyalty-admin] program enabled — program intro emails scheduled:', programIntro);
        }

        res.json({
            ok: true,
            settings,
            ...(programIntro ? { programIntro } : {}),
            ...(backfill ? { backfill } : {}),
            ...(tierRecalc ? { tierRecalc } : {}),
        });

    } catch (err) {

        logger.error('[loyalty-admin] put settings error:', err);

        res.status(500).json({ error: 'Failed to save loyalty settings' });

    }

});



router.put('/tiers/:tierKey', async (req, res) => {

    try {

        const tier = await updateTier(req.pool, req.params.tierKey, req.body || {});

        res.json({ tier });

    } catch (err) {

        if (err.code === 'INVALID_TIER') {

            return res.status(400).json({ error: err.message });

        }

        logger.error('[loyalty-admin] update tier error:', err);

        res.status(500).json({ error: 'Failed to update tier' });

    }

});



router.get('/customers', async (req, res) => {

    try {

        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));

        const offset = Math.max(0, Number(req.query.offset) || 0);

        const filters = {

            search: req.query.search,

            tier: req.query.tier,

            limit,

            offset,

        };

        const [customers, summary] = await Promise.all([

            listLoyaltyCustomers(req.pool, filters),

            getLoyaltyCustomerSummary(req.pool, filters),

        ]);

        res.json({ customers, ...summary, limit, offset });

    } catch (err) {

        logger.error('[loyalty-admin] list customers error:', err);

        res.status(500).json({ error: 'Failed to load loyalty customers' });

    }

});



router.post('/customers/:userId/recalculate', async (req, res) => {

    try {

        const userId = Number(req.params.userId);

        const result = await recalculateCustomerTier(req.pool, userId);

        res.json({ ok: true, result });

    } catch (err) {

        logger.error('[loyalty-admin] recalculate error:', err);

        res.status(500).json({ error: 'Failed to recalculate tier' });

    }

});

router.post('/recalculate-all-tiers', async (req, res) => {
    try {
        const sendPromotionEmail = Boolean(req.body?.sendPromotionEmail);
        const result = await recalculateAllCustomerTiers(req.pool, { sendPromotionEmail });
        res.json({ ok: true, result });
    } catch (err) {
        logger.error('[loyalty-admin] recalculate-all error:', err);
        res.status(500).json({ error: 'Failed to recalculate customer tiers' });
    }
});

router.post('/backfill-earns', async (req, res) => {
    try {
        const dryRun = Boolean(req.body?.dryRun);
        const limit = Number(req.body?.limit) || 5000;
        const result = await runFullLoyaltyEarnBackfill(req.pool, { dryRun, limit });
        res.json({ ok: true, result });
    } catch (err) {
        logger.error('[loyalty-admin] backfill-earns error:', err);
        res.status(500).json({ error: 'Failed to backfill loyalty earns' });
    }
});

router.post('/send-pending-promotion-emails', async (req, res) => {
    try {
        const dryRun = Boolean(req.body?.dryRun);
        const result = await sendPendingTierPromotionEmails(req.pool, { dryRun });
        res.json({ ok: true, result });
    } catch (err) {
        logger.error('[loyalty-admin] pending promotion emails error:', err);
        res.status(500).json({ error: 'Failed to send pending promotion emails' });
    }
});

router.get('/email-preview/promotion', async (req, res) => {
    try {
        const tierKey = String(req.query.tier || 'silver').toLowerCase();
        const fromTier = String(req.query.fromTier || 'bronze').toLowerCase();
        const userId = Number(req.query.userId) || null;
        const preview = await previewTierPromotionEmail(req.pool, {
            tierKey,
            fromTier,
            userId: userId || undefined,
            customerName: req.query.name,
        });
        if (String(req.query.format || '').toLowerCase() === 'html') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(preview.html);
        }
        res.json({ ok: true, ...preview });
    } catch (err) {
        logger.error('[loyalty-admin] promotion email preview error:', err);
        res.status(500).json({ error: 'Failed to build promotion email preview' });
    }
});

router.get('/intro-email-status', async (req, res) => {
    try {
        const stats = await getProgramIntroSendStats(req.pool);
        res.json({ ok: true, stats });
    } catch (err) {
        logger.error('[loyalty-admin] intro email status error:', err);
        res.status(500).json({ error: 'Failed to load intro email status' });
    }
});

router.post('/resume-intro-emails', async (req, res) => {
    try {
        const dryRun = Boolean(req.body?.dryRun);
        const stats = await getProgramIntroSendStats(req.pool);

        if (dryRun) {
            const result = await runThrottledProgramIntroSend(req.pool, {
                dryRun: true,
                delayMs: 0,
                trigger: 'admin_dry_run',
            });
            return res.json({ ok: true, dryRun: true, stats, result });
        }

        if (isIntroSendRunning()) {
            return res.json({ ok: true, alreadyRunning: true, stats });
        }

        const scheduled = await scheduleProgramIntroBulkSend(req.pool, {
            trigger: 'admin_resume',
            maxEmails: stats.remainingToday,
        });
        logger.info('[loyalty-admin] resume intro emails:', scheduled);
        res.json({ ok: true, ...scheduled, stats });
    } catch (err) {
        logger.error('[loyalty-admin] resume intro emails error:', err);
        res.status(500).json({ error: 'Failed to resume intro emails' });
    }
});

router.post('/run-now', async (req, res) => {

    try {

        const dryRun = Boolean(req.body?.dryRun);

        const result = await processLoyaltyEmails(req.pool, { dryRun });

        res.json({ ok: true, result });

    } catch (err) {

        logger.error('[loyalty-admin] run-now error:', err);

        res.status(500).json({ error: 'Failed to process loyalty emails' });

    }

});



router.post('/email/:userId', async (req, res) => {

    try {

        const userId = Number(req.params.userId);

        const message = req.body?.message ? String(req.body.message).trim() : '';

        if (message) {

            const result = await sendManualEmail(req.pool, userId, {

                subject: req.body?.subject,

                message,

            });

            return res.json({ ok: true, result });

        }



        const [[user]] = await req.pool.execute(

            'SELECT id, email, first_name FROM users WHERE id = ?',

            [userId]

        );

        if (!user?.email) return res.status(404).json({ error: 'Customer not found' });



        const { tier, metrics } = await evaluateCustomerTier(req.pool, userId);

        const { sendTierPromotionEmail } = require('../services/loyaltyTierEmails');

        const result = await sendTierPromotionEmail(req.pool, userId, {

            fromTier: metrics?.currentTierKey,

            toTier: tier,

            user,

        });

        res.json({ ok: true, result });

    } catch (err) {

        logger.error('[loyalty-admin] manual email error:', err);

        res.status(500).json({ error: 'Failed to send email' });

    }

});



router.get('/email-preview/program-intro', async (req, res) => {

    try {

        const modeRaw = String(req.query.mode || '').toLowerCase();

        const programMode = modeRaw === 'points' ? 'points' : 'cashback';

        const customerName = String(req.query.customerName || req.query.name || 'there').trim() || 'there';

        const tierKey = String(req.query.tier || 'bronze').toLowerCase();

        const preview = await previewProgramIntroEmail(req.pool, {

            programMode,

            customerName,

            tierKey,

        });

        if (String(req.query.format || '').toLowerCase() === 'html') {

            res.setHeader('Content-Type', 'text/html; charset=utf-8');

            res.setHeader('X-Loyalty-Email-Preview', 'program_intro_draft_not_sent');

            return res.send(preview.html);

        }

        res.json({

            ok: true,

            draft: true,

            sent: false,

            note: 'Preview only. Nothing was sent.',

            emailType: preview.emailType,

            programMode: preview.programMode,

            subject: preview.subject,

            previewText: preview.previewText,

            html: preview.html,

            text: preview.text,

            placeholders: preview.placeholders,

        });

    } catch (err) {

        logger.error('[loyalty-admin] intro email preview error:', err);

        res.status(500).json({ error: 'Failed to build intro email preview' });

    }

});



module.exports = router;


