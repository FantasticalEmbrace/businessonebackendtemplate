'use strict';

const logger = require('../utils/logger');
const { loadPosOperationsSettings } = require('./posOperationsSettings');
const { sendDailySalesEmail } = require('./posDailySalesEmail');
const { localDateKey } = require('./posSalesReports');

function shouldRunDailyEmail(now, hour, minute) {
    if (now.getHours() !== hour) return false;
    return now.getMinutes() >= minute;
}

function startPosDailySalesScheduler(pool) {
    let running = false;

    const tick = async (source = 'interval') => {
        if (running) return;
        const now = new Date();
        let settings;
        try {
            settings = await loadPosOperationsSettings(pool);
        } catch (e) {
            logger.warn('[pos-daily-sales] Settings load failed', { message: e.message });
            return;
        }
        if (!settings.dailySalesEmailEnabled) return;
        if (!shouldRunDailyEmail(now, settings.dailySalesEmailHour, settings.dailySalesEmailMinute)) {
            return;
        }

        running = true;
        try {
            const date = localDateKey(now);
            const result = await sendDailySalesEmail(pool, { date });
            if (result.sent) {
                logger.info('[pos-daily-sales] Scheduled send completed', { source, date });
            }
        } catch (error) {
            logger.error('[pos-daily-sales] Scheduled send failed', { message: error.message, source });
        } finally {
            running = false;
        }
    };

    logger.info('[pos-daily-sales] Scheduler enabled (checks every minute)');
    const intervalId = setInterval(() => tick('interval'), 60 * 1000);
    setTimeout(() => tick('startup'), 20 * 1000);
    return () => clearInterval(intervalId);
}

module.exports = {
    startPosDailySalesScheduler,
    shouldRunDailyEmail
};
