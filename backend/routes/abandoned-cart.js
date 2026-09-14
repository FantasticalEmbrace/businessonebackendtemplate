'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { upsertSnapshot, suppressActiveSnapshots, normalizeCartItems } = require('../services/abandonedCartEngine');
const programs = require('../services/abandonedCartPrograms');
const { getAuthenticatedUserFromRequest } = require('../utils/orderAccess');
const { requireEcommerceStoreAccess } = require('../middleware/requireEcommerceStore');

router.use(requireEcommerceStoreAccess);

router.post('/track', async (req, res) => {
    try {
        const { email, firstName, cartItems } = req.body || {};
        const authUser = await getAuthenticatedUserFromRequest(req);
        const sessionId = req.headers['x-session-id'] || req.sessionID || null;
        const resolvedEmail =
            programs.normalizeEmail(authUser?.email) || programs.normalizeEmail(email);
        const items = normalizeCartItems(cartItems);

        if (!items.length) {
            if (!resolvedEmail && !sessionId && !authUser?.id) {
                return res.status(400).json({ error: 'Valid email is required', code: 'INVALID_EMAIL' });
            }
            const suppressed = await suppressActiveSnapshots(req.pool, {
                userId: authUser?.id,
                sessionId,
                email: resolvedEmail,
            });
            return res.json({ ok: true, suppressed: suppressed > 0 });
        }

        if (!resolvedEmail) {
            return res.status(400).json({ error: 'Valid email is required', code: 'INVALID_EMAIL' });
        }

        const snapshotId = await upsertSnapshot(req.pool, {
            userId: authUser?.id,
            sessionId,
            email: resolvedEmail,
            firstName: firstName || authUser?.first_name,
            cartItems: items,
        });

        if (!snapshotId) {
            return res.status(400).json({ error: 'Cart items are required', code: 'EMPTY_CART' });
        }

        res.json({ ok: true, snapshotId });
    } catch (err) {
        logger.error('[abandoned-cart] track error:', err);
        res.status(500).json({ error: 'Failed to track cart' });
    }
});

module.exports = router;
