'use strict';

const logger = require('../utils/logger');
const { processAllAccountsMaintenance } = require('./platformBillingRunner');
const { processMerchantBillingMaintenance } = require('./posMerchantLicense');

function isEnabled() {
    return (
        String(process.env.BILLING_SCHEDULER_ENABLED || process.env.POS_BILLING_SCHEDULER_ENABLED || '')
            .trim()
            .toLowerCase() === 'true'
    );
}

function shouldRunNow(date) {
    const hour = Number(process.env.BILLING_HOUR ?? process.env.POS_BILLING_HOUR ?? 6);
    const minute = Number(process.env.BILLING_MINUTE ?? process.env.POS_BILLING_MINUTE ?? 0);
    return date.getHours() === hour && date.getMinutes() === minute;
}

function startPlatformBillingScheduler(pool) {
    if (!isEnabled()) {
        logger.info('[platform-billing] Scheduler disabled (set BILLING_SCHEDULER_ENABLED=true)');
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
            const platform = await processAllAccountsMaintenance(pool);
            const pos = await processMerchantBillingMaintenance(pool);
            lastRunKey = key;
            logger.info('[platform-billing] Daily maintenance complete', { platform, pos });
        } catch (error) {
            logger.error('[platform-billing] Daily maintenance failed', { message: error.message });
        } finally {
            running = false;
        }
    };

    logger.info('[platform-billing] Scheduler enabled');
    const intervalId = setInterval(tick, 60 * 1000);
    return () => clearInterval(intervalId);
}

module.exports = { startPlatformBillingScheduler };
