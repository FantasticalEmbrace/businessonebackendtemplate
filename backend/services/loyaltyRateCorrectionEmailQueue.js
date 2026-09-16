'use strict';

const logger = require('../utils/logger');
const {
    sendLoyaltyRateCorrectionEmail,
    LOYALTY_RATE_CORRECTION_EMAIL_TYPE,
} = require('./loyaltyTierEmails');

/** Same proven Gmail-safe throttling as program-intro (defaults shared via env aliases). */
const DEFAULTS = {
    delayMs: Number(process.env.LOYALTY_RATE_CORRECTION_DELAY_MS || process.env.LOYALTY_INTRO_EMAIL_DELAY_MS) || 1500,
    batchSize: Number(process.env.LOYALTY_RATE_CORRECTION_BATCH_SIZE || process.env.LOYALTY_INTRO_EMAIL_BATCH_SIZE) || 10,
    batchPauseMs:
        Number(process.env.LOYALTY_RATE_CORRECTION_BATCH_PAUSE_MS || process.env.LOYALTY_INTRO_EMAIL_BATCH_PAUSE_MS) ||
        10000,
    smtpBackoffMs:
        Number(process.env.LOYALTY_RATE_CORRECTION_SMTP_BACKOFF_MS || process.env.LOYALTY_INTRO_EMAIL_SMTP_BACKOFF_MS) ||
        120000,
    maxConsecutiveSmtpFailures:
        Number(
            process.env.LOYALTY_RATE_CORRECTION_MAX_SMTP_FAILURES || process.env.LOYALTY_INTRO_EMAIL_MAX_SMTP_FAILURES
        ) || 3,
    dailyCap: Number(process.env.LOYALTY_RATE_CORRECTION_DAILY_CAP || process.env.LOYALTY_INTRO_EMAIL_DAILY_CAP) || 25,
    schedulerHour: Number(process.env.LOYALTY_RATE_CORRECTION_SCHEDULER_HOUR ?? process.env.LOYALTY_INTRO_EMAIL_SCHEDULER_HOUR) ?? 10,
};

let correctionSendRunning = false;
let lastRunResult = null;
/** Calendar date (YYYY-MM-DD) when the scheduler last started a batch — one run per day. */
let lastSchedulerSendDate = null;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSmtpRateLimitError(err) {
    if (!err) return false;
    const code = Number(err.responseCode || err.code);
    if (code === 454 || code === 421) return true;
    const msg = String(err.message || err.response || '').toLowerCase();
    return (
        msg.includes('454') ||
        msg.includes('421') ||
        msg.includes('too many login') ||
        msg.includes('rate limit')
    );
}

/**
 * ONLY customers who already received program_intro and have not received
 * loyalty_rate_correction. Never targets never-emailed customers.
 */
async function loadEligibleCorrectionUserIds(pool, { userIds } = {}) {
    if (Array.isArray(userIds) && userIds.length > 0) {
        const unique = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
        if (!unique.length) return [];
        const placeholders = unique.map(() => '?').join(',');
        const [users] = await pool.execute(
            `SELECT u.id
               FROM users u
              WHERE u.id IN (${placeholders})
                AND u.email IS NOT NULL AND u.email != ''
                AND u.customer_status = 'active'
                AND EXISTS (
                    SELECT 1 FROM loyalty_email_sends s
                     WHERE s.user_id = u.id AND s.email_type = 'program_intro'
                )
                AND NOT EXISTS (
                    SELECT 1 FROM loyalty_email_sends s2
                     WHERE s2.user_id = u.id AND s2.email_type = ?
                )
              ORDER BY u.id ASC`,
            [...unique, LOYALTY_RATE_CORRECTION_EMAIL_TYPE]
        );
        return (users || []).map((row) => row.id);
    }

    const [users] = await pool.execute(
        `SELECT u.id
           FROM users u
          WHERE u.email IS NOT NULL AND u.email != ''
            AND u.customer_status = 'active'
            AND EXISTS (
                SELECT 1 FROM loyalty_email_sends s
                 WHERE s.user_id = u.id AND s.email_type = 'program_intro'
            )
            AND NOT EXISTS (
                SELECT 1 FROM loyalty_email_sends s2
                 WHERE s2.user_id = u.id AND s2.email_type = ?
            )
          ORDER BY u.id ASC`,
        [LOYALTY_RATE_CORRECTION_EMAIL_TYPE]
    );
    return (users || []).map((row) => row.id);
}

async function countPendingRateCorrectionEmails(pool) {
    const ids = await loadEligibleCorrectionUserIds(pool);
    return ids.length;
}

function getDailyCap() {
    const cap = Number(process.env.LOYALTY_RATE_CORRECTION_DAILY_CAP || process.env.LOYALTY_INTRO_EMAIL_DAILY_CAP);
    return Number.isFinite(cap) && cap > 0 ? cap : 25;
}

async function countRateCorrectionSentToday(pool) {
    const [[row]] = await pool.execute(
        `SELECT COUNT(*) AS sentToday
           FROM loyalty_email_sends
          WHERE email_type = ?
            AND DATE(sent_at) = CURDATE()`,
        [LOYALTY_RATE_CORRECTION_EMAIL_TYPE]
    );
    return Number(row?.sentToday) || 0;
}

async function getDailyCapStatus(pool) {
    const dailyCap = getDailyCap();
    const sentToday = await countRateCorrectionSentToday(pool);
    const remainingToday = Math.max(0, dailyCap - sentToday);
    return { dailyCap, sentToday, remainingToday };
}

async function getRateCorrectionSendStats(pool) {
    const [[sentRow]] = await pool.execute(
        `SELECT COUNT(*) AS sent FROM loyalty_email_sends WHERE email_type = ?`,
        [LOYALTY_RATE_CORRECTION_EMAIL_TYPE]
    );
    const pending = await countPendingRateCorrectionEmails(pool);
    const dailyCapStatus = await getDailyCapStatus(pool);
    return {
        sent: Number(sentRow?.sent) || 0,
        pending,
        running: correctionSendRunning,
        lastRun: lastRunResult,
        rateLimit: { ...DEFAULTS },
        emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE,
        ...dailyCapStatus,
    };
}

/**
 * Send loyalty_rate_correction emails with throttling.
 * Dedupes via loyalty_email_sends; requires prior program_intro.
 */
async function runThrottledRateCorrectionSend(pool, options = {}) {
    if (correctionSendRunning) {
        return {
            started: false,
            reason: 'already_running',
            running: true,
            emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE,
        };
    }

    const {
        dryRun = false,
        maxEmails,
        trigger = 'manual',
        delayMs = DEFAULTS.delayMs,
        batchSize = DEFAULTS.batchSize,
        batchPauseMs = DEFAULTS.batchPauseMs,
        smtpBackoffMs = DEFAULTS.smtpBackoffMs,
        maxConsecutiveSmtpFailures = DEFAULTS.maxConsecutiveSmtpFailures,
        log = logger,
    } = options;

    const dailyCapStatus = await getDailyCapStatus(pool);
    const { dailyCap, sentToday, remainingToday } = dailyCapStatus;

    if (!dryRun && remainingToday <= 0) {
        return {
            started: false,
            reason: 'daily_cap_reached',
            dailyCap,
            sentToday,
            remainingToday: 0,
            emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE,
            trigger,
        };
    }

    correctionSendRunning = true;
    const result = {
        started: true,
        sent: 0,
        skipped: 0,
        errors: 0,
        dryRun,
        emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE,
        trigger,
        stoppedEarly: false,
        stopReason: null,
        dailyCap,
        sentToday,
        remainingToday,
    };

    try {
        const userIds = await loadEligibleCorrectionUserIds(pool, { userIds: options.userIds });
        const dailyLimit = dryRun ? dailyCap : remainingToday;
        const requested = maxEmails != null ? maxEmails : dailyLimit;
        const effectiveMax = Math.max(0, Math.min(requested, dailyLimit));
        const toProcess = userIds.slice(0, effectiveMax);
        result.pending = userIds.length;
        result.processing = toProcess.length;

        let consecutiveSmtpFailures = 0;
        let sinceBatch = 0;
        let sentThisRun = 0;

        for (const userId of toProcess) {
            if (!dryRun) {
                const liveCap = await getDailyCapStatus(pool);
                if (liveCap.remainingToday <= 0) {
                    result.stoppedEarly = true;
                    result.stopReason = 'daily_cap_reached';
                    result.sentToday = liveCap.sentToday;
                    result.remainingToday = 0;
                    break;
                }
            }

            try {
                const r = await sendLoyaltyRateCorrectionEmail(pool, userId, { dryRun });
                if (r.sent || (dryRun && r.wouldSend)) {
                    result.sent += 1;
                    consecutiveSmtpFailures = 0;
                    if (!dryRun) {
                        sentThisRun += 1;
                        result.sentToday = sentToday + sentThisRun;
                        result.remainingToday = Math.max(0, dailyCap - result.sentToday);
                    }
                } else {
                    result.skipped += 1;
                }
            } catch (err) {
                result.errors += 1;
                if (isSmtpRateLimitError(err)) {
                    consecutiveSmtpFailures += 1;
                    log.warn('[loyalty-rate-correction] SMTP rate limit', {
                        userId,
                        responseCode: err.responseCode,
                        message: err.message,
                        consecutiveSmtpFailures,
                    });
                    if (consecutiveSmtpFailures >= maxConsecutiveSmtpFailures) {
                        result.stoppedEarly = true;
                        result.stopReason = 'smtp_rate_limit';
                        break;
                    }
                    if (!dryRun) await sleep(smtpBackoffMs);
                } else {
                    log.warn('[loyalty-rate-correction] send failed', { userId, message: err.message });
                }
            }

            sinceBatch += 1;
            if (!dryRun && delayMs > 0 && sinceBatch < toProcess.length) {
                await sleep(delayMs);
            }
            if (sinceBatch >= batchSize && batchPauseMs > 0 && sinceBatch < toProcess.length) {
                sinceBatch = 0;
                if (!dryRun) await sleep(batchPauseMs);
            }
        }

        result.remaining = Math.max(0, result.pending - result.sent);
        if (!dryRun && result.sentToday == null) {
            const finalCap = await getDailyCapStatus(pool);
            result.sentToday = finalCap.sentToday;
            result.remainingToday = finalCap.remainingToday;
        } else if (dryRun) {
            result.remainingToday = Math.max(0, dailyCap - sentToday - result.sent);
        }
        lastRunResult = { ...result, finishedAt: new Date().toISOString() };
        log.info('[loyalty-rate-correction] batch finished', result);
        return result;
    } finally {
        correctionSendRunning = false;
    }
}

/** Fire-and-forget throttled bulk send — returns immediately. */
async function scheduleRateCorrectionBulkSend(pool, options = {}) {
    const { log = logger, ...runOpts } = options;

    if (correctionSendRunning) {
        return { scheduled: false, reason: 'already_running', running: true };
    }

    const pending = await countPendingRateCorrectionEmails(pool);
    if (pending === 0 && !runOpts.dryRun) {
        return { scheduled: false, reason: 'none_pending', pending: 0 };
    }

    const dailyCapStatus = await getDailyCapStatus(pool);
    if (!runOpts.dryRun && dailyCapStatus.remainingToday <= 0) {
        return {
            scheduled: false,
            reason: 'daily_cap_reached',
            pending,
            ...dailyCapStatus,
        };
    }

    setImmediate(() => {
        runThrottledRateCorrectionSend(pool, runOpts).catch((err) => {
            log.error('[loyalty-rate-correction] background send failed', { message: err.message });
        });
    });

    return {
        scheduled: true,
        pending,
        dryRun: Boolean(runOpts.dryRun),
        trigger: runOpts.trigger || 'background',
        emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE,
        ...dailyCapStatus,
    };
}

function localCalendarDate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Once per calendar day during the configured hour — up to daily cap (default 25).
 * Independent of the program_intro scheduler (which stays paused for never-emailed).
 */
function startLoyaltyRateCorrectionEmailScheduler(pool) {
    const raw = String(process.env.LOYALTY_RATE_CORRECTION_SCHEDULER_ENABLED || 'true').trim().toLowerCase();
    if (raw === 'false' || raw === '0') {
        logger.info('[loyalty-rate-correction] Scheduler disabled (LOYALTY_RATE_CORRECTION_SCHEDULER_ENABLED=false)');
        return () => {};
    }

    const intervalMin = Math.max(
        15,
        Number(process.env.LOYALTY_RATE_CORRECTION_SCHEDULER_INTERVAL_MIN || process.env.LOYALTY_INTRO_EMAIL_SCHEDULER_INTERVAL_MIN) ||
            30
    );
    const schedulerHour = Number.isFinite(Number(process.env.LOYALTY_RATE_CORRECTION_SCHEDULER_HOUR))
        ? Number(process.env.LOYALTY_RATE_CORRECTION_SCHEDULER_HOUR)
        : Number.isFinite(Number(process.env.LOYALTY_INTRO_EMAIL_SCHEDULER_HOUR))
          ? Number(process.env.LOYALTY_INTRO_EMAIL_SCHEDULER_HOUR)
          : 10;
    const dailyCap = getDailyCap();

    const tick = async () => {
        if (correctionSendRunning) return;
        try {
            const now = new Date();
            if (now.getHours() !== schedulerHour) return;

            const today = localCalendarDate();
            if (lastSchedulerSendDate === today) return;

            const pending = await countPendingRateCorrectionEmails(pool);
            if (pending === 0) return;

            const capStatus = await getDailyCapStatus(pool);
            if (capStatus.remainingToday <= 0) {
                lastSchedulerSendDate = today;
                return;
            }

            lastSchedulerSendDate = today;
            logger.info('[loyalty-rate-correction] Scheduler daily batch', {
                pending,
                dailyCap,
                sentToday: capStatus.sentToday,
                sending: capStatus.remainingToday,
            });
            await runThrottledRateCorrectionSend(pool, {
                trigger: 'scheduler',
                maxEmails: capStatus.remainingToday,
            });
        } catch (err) {
            logger.error('[loyalty-rate-correction] scheduler tick failed', { message: err.message });
        }
    };

    logger.info(
        `[loyalty-rate-correction] Scheduler active — checks every ${intervalMin} min; ` +
            `one batch up to ${dailyCap}/day at hour ${schedulerHour} (server local time); ` +
            `targets only prior program_intro recipients`
    );
    const interval = setInterval(() => void tick(), intervalMin * 60 * 1000);
    // Run once shortly after boot so today's batch can start without waiting for the hour window
    // when LOYALTY_RATE_CORRECTION_RUN_ON_BOOT=true (used for first launch / catch-up).
    const runOnBoot = String(process.env.LOYALTY_RATE_CORRECTION_RUN_ON_BOOT || '').trim().toLowerCase();
    if (runOnBoot === 'true' || runOnBoot === '1') {
        setTimeout(() => {
            void (async () => {
                if (correctionSendRunning) return;
                try {
                    const today = localCalendarDate();
                    if (lastSchedulerSendDate === today) return;
                    const pending = await countPendingRateCorrectionEmails(pool);
                    if (pending === 0) return;
                    const capStatus = await getDailyCapStatus(pool);
                    if (capStatus.remainingToday <= 0) {
                        lastSchedulerSendDate = today;
                        return;
                    }
                    lastSchedulerSendDate = today;
                    logger.info('[loyalty-rate-correction] Boot catch-up batch', {
                        pending,
                        sending: capStatus.remainingToday,
                    });
                    await runThrottledRateCorrectionSend(pool, {
                        trigger: 'boot',
                        maxEmails: capStatus.remainingToday,
                    });
                } catch (err) {
                    logger.error('[loyalty-rate-correction] boot catch-up failed', { message: err.message });
                }
            })();
        }, 5000);
    }
    return () => clearInterval(interval);
}

function isRateCorrectionSendRunning() {
    return correctionSendRunning;
}

function _resetRateCorrectionSendStateForTests() {
    correctionSendRunning = false;
    lastRunResult = null;
    lastSchedulerSendDate = null;
}

module.exports = {
    DEFAULTS,
    getDailyCap,
    isSmtpRateLimitError,
    loadEligibleCorrectionUserIds,
    countPendingRateCorrectionEmails,
    countRateCorrectionSentToday,
    getDailyCapStatus,
    getRateCorrectionSendStats,
    runThrottledRateCorrectionSend,
    scheduleRateCorrectionBulkSend,
    startLoyaltyRateCorrectionEmailScheduler,
    isRateCorrectionSendRunning,
    _resetRateCorrectionSendStateForTests,
};
