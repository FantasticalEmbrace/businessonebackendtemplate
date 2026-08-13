'use strict';

const logger = require('../utils/logger');
const {
    TaxAccountantReportService,
    getPreviousMonthRange
} = require('./taxAccountantReport');

const SCHEDULED_HOUR = Number(process.env.TAX_ACCOUNTANT_REPORT_HOUR || 8);
const SCHEDULED_MINUTE = Number(process.env.TAX_ACCOUNTANT_REPORT_MINUTE || 0);

function isEnabled() {
    return process.env.TAX_ACCOUNTANT_REPORT_ENABLED !== 'false';
}

/** True on the 1st at/after the configured send time (default 8:00 AM local). */
function shouldRunMonthlyReport(date, hour = SCHEDULED_HOUR, minute = SCHEDULED_MINUTE) {
    if (date.getDate() !== 1) return false;
    if (date.getHours() > hour) return true;
    if (date.getHours() < hour) return false;
    return date.getMinutes() >= minute;
}

function periodRunKey(range) {
    return `${range.startDate}_${range.endDate}`;
}

function startTaxAccountantScheduler(pool) {
    if (!isEnabled()) {
        logger.info('[tax-report] Monthly accountant email scheduler disabled (TAX_ACCOUNTANT_REPORT_ENABLED=false)');
        return () => {};
    }

    const service = new TaxAccountantReportService(pool);
    let running = false;
    /** Period keys that completed successfully or were already sent this process lifetime. */
    let completedPeriodKey = '';

    const tick = async (source = 'interval') => {
        const now = new Date();
        if (!shouldRunMonthlyReport(now)) return;
        if (running) return;

        const range = getPreviousMonthRange(now);
        const runKey = periodRunKey(range);
        if (completedPeriodKey === runKey) return;

        running = true;
        try {
            logger.info('[tax-report] Running scheduled accountant report', {
                source,
                period: `${range.startDate} to ${range.endDate}`,
                recipient: process.env.TAX_ACCOUNTANT_EMAIL || 'wandaforto@aol.com'
            });

            const result = await service.deliverPreviousMonthReport({
                triggerType: 'scheduled',
                skipIfScheduledAlreadySent: true,
                referenceDate: now
            });

            if (result.skipped) {
                logger.info('[tax-report] Monthly send skipped', result);
                if (String(result.reason || '').includes('already sent')) {
                    completedPeriodKey = runKey;
                }
            } else if (result.email?.sent) {
                completedPeriodKey = runKey;
                logger.info('[tax-report] Monthly accountant email sent', {
                    period: `${result.startDate} to ${result.endDate}`,
                    rowCount: result.rowCount,
                    to: result.recipientEmail
                });
            } else {
                logger.warn('[tax-report] Monthly report built but email not sent — will retry', result);
            }
        } catch (error) {
            logger.error('[tax-report] Monthly accountant email failed — will retry', {
                message: error.message,
                period: `${range.startDate} to ${range.endDate}`
            });
        } finally {
            running = false;
        }
    };

    logger.info(
        `[tax-report] Monthly accountant email scheduler enabled (1st of month at ${String(SCHEDULED_HOUR).padStart(2, '0')}:${String(SCHEDULED_MINUTE).padStart(2, '0')} local; full previous calendar month)`
    );

    const intervalId = setInterval(() => tick('interval'), 60 * 1000);
    // Catch server restarts on the 1st after the scheduled time.
    setTimeout(() => tick('startup'), 15 * 1000);

    return () => clearInterval(intervalId);
}

module.exports = {
    startTaxAccountantScheduler,
    shouldRunMonthlyReport,
    SCHEDULED_HOUR,
    SCHEDULED_MINUTE
};
