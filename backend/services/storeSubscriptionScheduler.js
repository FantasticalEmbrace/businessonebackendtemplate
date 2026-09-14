'use strict';

const logger = require('../utils/logger');
const {
    hasRenewableCustomerSubscriptions,
    processDueSubscriptionRenewals,
} = require('./storeSubscriptionService');
const { resolveStoreProductSubscriptionsAccess } = require('./storeEcommerceTier');

/** Only used to opt out (e.g. local dev). Renewals run automatically once customers subscribe. */
function isExplicitlyDisabled() {
    const raw = String(process.env.STORE_SUBSCRIPTION_SCHEDULER_ENABLED || '').trim().toLowerCase();
    return raw === 'false' || raw === '0';
}

function shouldRunNow(date) {
    const hour = Number(process.env.STORE_SUBSCRIPTION_HOUR ?? process.env.BILLING_HOUR ?? 7);
    const minute = Number(process.env.STORE_SUBSCRIPTION_MINUTE ?? 30);
    return date.getHours() === hour && date.getMinutes() === minute;
}

function startStoreSubscriptionScheduler(pool) {
    if (isExplicitlyDisabled()) {
        logger.info(
            '[store-subscriptions] Scheduler disabled (STORE_SUBSCRIPTION_SCHEDULER_ENABLED=false)'
        );
        return () => {};
    }

    let running = false;
    let lastRunKey = '';

    const tick = async () => {
        const now = new Date();
        const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        if (!shouldRunNow(now)) return;
        if (lastRunKey === key) return;
        if (running) return;

        running = true;
        try {
            const access = await resolveStoreProductSubscriptionsAccess(pool);
            if (!access.enabled) {
                lastRunKey = key;
                return;
            }
            const hasSubs = await hasRenewableCustomerSubscriptions(pool);
            if (!hasSubs) {
                lastRunKey = key;
                return;
            }
            const result = await processDueSubscriptionRenewals(pool);
            lastRunKey = key;
            logger.info('[store-subscriptions] Daily renewals complete', result);
        } catch (error) {
            logger.error('[store-subscriptions] Daily renewals failed', { message: error.message });
        } finally {
            running = false;
        }
    };

    logger.info(
        '[store-subscriptions] Scheduler active — renewals run when customers have active auto-ship subscriptions'
    );
    const interval = setInterval(() => void tick(), 60 * 1000);
    void tick();
    return () => clearInterval(interval);
}

module.exports = { startStoreSubscriptionScheduler };
