'use strict';

const logger = require('../utils/logger');
const { processMerchantBillingMaintenance } = require('./posMerchantLicense');

function isEnabled() {
    if (
        String(process.env.BILLING_SCHEDULER_ENABLED || '').trim().toLowerCase() === 'true'
    ) {
        return false;
    }
    return String(process.env.POS_BILLING_SCHEDULER_ENABLED || '').trim().toLowerCase() === 'true';
}

function shouldRunNow(date) {
    const hour = Number(process.env.POS_BILLING_HOUR ?? 6);
    const minute = Number(process.env.POS_BILLING_MINUTE ?? 0);
    return date.getHours() === hour && date.getMinutes() === minute;
}

function startPosBillingScheduler(pool) {
    if (!isEnabled()) {
        logger.info(
            '[pos-billing] Legacy scheduler disabled (use BILLING_SCHEDULER_ENABLED=true for platform billing)'
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
            const result = await processMerchantBillingMaintenance(pool);
            lastRunKey = key;
            logger.info('[pos-billing] Retry/grace maintenance complete', result);
        } catch (error) {
            logger.error('[pos-billing] Maintenance failed', { message: error.message });
        } finally {
            running = false;
        }
    };

    logger.info('[pos-billing] Legacy retry/grace scheduler enabled');
    const intervalId = setInterval(tick, 60 * 1000);
    return () => clearInterval(intervalId);
}

module.exports = { startPosBillingScheduler };
