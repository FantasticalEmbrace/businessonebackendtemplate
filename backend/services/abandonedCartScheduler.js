'use strict';

const logger = require('../utils/logger');
const { resolveEcommerceStoreAccess } = require('./storeEcommerceTier');
const { processAbandonedCartEmails } = require('./abandonedCartEngine');

function isExplicitlyDisabled() {
    const raw = String(process.env.ABANDONED_CART_SCHEDULER_ENABLED || '').trim().toLowerCase();
    return raw === 'false' || raw === '0';
}

function startAbandonedCartScheduler(pool) {
    if (isExplicitlyDisabled()) {
        logger.info('[abandoned-cart] Scheduler disabled (ABANDONED_CART_SCHEDULER_ENABLED=false)');
        return () => {};
    }

    const intervalMinutes = Math.max(5, Number(process.env.ABANDONED_CART_INTERVAL_MINUTES) || 15);
    let running = false;

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const access = await resolveEcommerceStoreAccess(pool);
            if (!access.enabled) return;

            const result = await processAbandonedCartEmails(pool);
            if (result.sent > 0) {
                logger.info('[abandoned-cart] Sent reminders', result);
            }
        } catch (err) {
            logger.error('[abandoned-cart] Scheduler tick failed', { message: err.message });
        } finally {
            running = false;
        }
    };

    logger.info(
        `[abandoned-cart] Scheduler active — checks every ${intervalMinutes} min on ecommerce stores`
    );
    const interval = setInterval(() => void tick(), intervalMinutes * 60 * 1000);
    void tick();
    return () => clearInterval(interval);
}

module.exports = { startAbandonedCartScheduler };
