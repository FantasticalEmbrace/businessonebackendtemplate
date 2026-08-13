'use strict';

const logger = require('../utils/logger');
const { TaxLedgerService, toDateKey } = require('./taxLedger');

function isEnabled() {
    return process.env.TAX_LEDGER_SYNC_ENABLED === 'true';
}

function shouldRunNow(date) {
    return date.getHours() === 23 && date.getMinutes() === 50;
}

function startTaxReserveScheduler(pool) {
    if (!isEnabled()) return () => {};

    const service = new TaxLedgerService(pool);
    let running = false;
    let lastRunDate = '';

    const tick = async () => {
        const now = new Date();
        const today = toDateKey(now);
        if (!shouldRunNow(now)) return;
        if (lastRunDate === today) return;
        if (running) return;

        running = true;
        try {
            const result = await service.runDailySync(today);
            lastRunDate = today;
            logger.info('[tax-ledger] Daily sync complete', result);
        } catch (error) {
            logger.error('[tax-ledger] Daily sync failed', { message: error.message });
        } finally {
            running = false;
        }
    };

    logger.info('[tax-ledger] Scheduler enabled (daily at 23:50 local time)');
    const intervalId = setInterval(tick, 60 * 1000);

    return () => clearInterval(intervalId);
}

module.exports = { startTaxReserveScheduler };
