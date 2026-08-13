'use strict';

const logger = require('../utils/logger');
const { loadPosPayrollSettings, shouldSendPayrollNow } = require('./posPayrollSettings');
const { sendPayrollTimesheetEmail } = require('./posPayrollEmail');

function startPosPayrollScheduler(pool) {
    let running = false;

    const tick = async (source = 'interval') => {
        if (running) return;
        running = true;
        try {
            const settings = await loadPosPayrollSettings(pool);
            const gate = shouldSendPayrollNow(new Date(), settings);
            if (!gate.ok) return;

            const result = await sendPayrollTimesheetEmail(pool, {
                period: gate.period,
                force: false,
                markSent: true
            });
            if (result.sent) {
                logger.info('[pos-payroll] Scheduled send completed', {
                    source,
                    periodKey: gate.period.periodKey,
                    to: result.to
                });
            } else {
                logger.info('[pos-payroll] Scheduled send skipped', {
                    source,
                    reason: result.reason
                });
            }
        } catch (error) {
            logger.error('[pos-payroll] Scheduled send failed', {
                message: error.message,
                source
            });
        } finally {
            running = false;
        }
    };

    logger.info('[pos-payroll] Scheduler enabled (checks every minute)');
    const intervalId = setInterval(() => tick('interval'), 60 * 1000);
    setTimeout(() => tick('startup'), 35 * 1000);
    return () => clearInterval(intervalId);
}

module.exports = { startPosPayrollScheduler };
