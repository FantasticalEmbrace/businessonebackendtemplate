'use strict';

const logger = require('../utils/logger');
const { sendProgramIntroEmail, PROGRAM_INTRO_EMAIL_TYPE } = require('./loyaltyTierEmails');

/** Default throttling — ~40 emails/min with batch pauses; tune via env. */
const DEFAULTS = {
    delayMs: Number(process.env.LOYALTY_INTRO_EMAIL_DELAY_MS) || 1500,
    batchSize: Number(process.env.LOYALTY_INTRO_EMAIL_BATCH_SIZE) || 10,
    batchPauseMs: Number(process.env.LOYALTY_INTRO_EMAIL_BATCH_PAUSE_MS) || 10000,
    smtpBackoffMs: Number(process.env.LOYALTY_INTRO_EMAIL_SMTP_BACKOFF_MS) || 120000,
    maxConsecutiveSmtpFailures: Number(process.env.LOYALTY_INTRO_EMAIL_MAX_SMTP_FAILURES) || 3,
    dailyCap: Number(process.env.LOYALTY_INTRO_EMAIL_DAILY_CAP) || 25,
    schedulerHour: Number(process.env.LOYALTY_INTRO_EMAIL_SCHEDULER_HOUR) ?? 10,
};

let introSendRunning = false;
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

async function loadEligibleUserIds(pool) {
    const [users] = await pool.execute(
        `SELECT u.id
           FROM users u
          WHERE u.email IS NOT NULL AND u.email != ''
            AND u.customer_status = 'active'
            AND NOT EXISTS (
                SELECT 1 FROM loyalty_email_sends s
                 WHERE s.user_id = u.id AND s.email_type = ?
            )`,
        [PROGRAM_INTRO_EMAIL_TYPE]
    );
    return (users || []).map((row) => row.id);
}

async function countPendingProgramIntroEmails(pool) {
    const ids = await loadEligibleUserIds(pool);
    return ids.length;
}

function getDailyCap() {
    const cap = Number(process.env.LOYALTY_INTRO_EMAIL_DAILY_CAP);
    return Number.isFinite(cap) && cap > 0 ? cap : 25;
}

async function countProgramIntroSentToday(pool) {
    const [[row]] = await pool.execute(
        `SELECT COUNT(*) AS sentToday
           FROM loyalty_email_sends
          WHERE email_type = ?
            AND DATE(sent_at) = CURDATE()`,
        [PROGRAM_INTRO_EMAIL_TYPE]
    );
    return Number(row?.sentToday) || 0;
}

async function getDailyCapStatus(pool) {
    const dailyCap = getDailyCap();
    const sentToday = await countProgramIntroSentToday(pool);
    const remainingToday = Math.max(0, dailyCap - sentToday);
    return { dailyCap, sentToday, remainingToday };
}

async function getProgramIntroSendStats(pool) {
    const [[sentRow]] = await pool.execute(
        `SELECT COUNT(*) AS sent FROM loyalty_email_sends WHERE email_type = ?`,
        [PROGRAM_INTRO_EMAIL_TYPE]
    );
    const pending = await countPendingProgramIntroEmails(pool);
    const dailyCapStatus = await getDailyCapStatus(pool);
    return {
        sent: Number(sentRow?.sent) || 0,
        pending,
        running: introSendRunning,
        lastRun: lastRunResult,
        rateLimit: { ...DEFAULTS },
        ...dailyCapStatus,
    };
}

/**
 * Send program-intro emails with throttling. Dedupes via loyalty_email_sends in sendProgramIntroEmail.
 */
async function runThrottledProgramIntroSend(pool, options = {}) {
    if (introSendRunning) {
        return { started: false, reason: 'already_running', running: true, emailType: PROGRAM_INTRO_EMAIL_TYPE };
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
            emailType: PROGRAM_INTRO_EMAIL_TYPE,
            trigger,
        };
    }

    introSendRunning = true;
    const result = {
        started: true,
        sent: 0,
        skipped: 0,
        errors: 0,
        dryRun,
        emailType: PROGRAM_INTRO_EMAIL_TYPE,
        trigger,
        stoppedEarly: false,
        stopReason: null,
        dailyCap,
        sentToday,
        remainingToday,
    };

    try {
        const userIds = await loadEligibleUserIds(pool);
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
                const r = await sendProgramIntroEmail(pool, userId, { dryRun });
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
                    log.warn('[loyalty-intro-queue] SMTP rate limit', {
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
                    log.warn('[loyalty-intro-queue] send failed', { userId, message: err.message });
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
        log.info('[loyalty-intro-queue] batch finished', result);
        return result;
    } finally {
        introSendRunning = false;
    }
}

/** Fire-and-forget throttled bulk send — returns immediately. */
async function scheduleProgramIntroBulkSend(pool, options = {}) {
    const { log = logger, ...runOpts } = options;

    if (introSendRunning) {
        return { scheduled: false, reason: 'already_running', running: true };
    }

    const pending = await countPendingProgramIntroEmails(pool);
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
        runThrottledProgramIntroSend(pool, runOpts).catch((err) => {
            log.error('[loyalty-intro-queue] background send failed', { message: err.message });
        });
    });

    return {
        scheduled: true,
        pending,
        dryRun: Boolean(runOpts.dryRun),
        trigger: runOpts.trigger || 'background',
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

/** Once per calendar day during the configured hour — up to daily cap (default 25). */
function startLoyaltyIntroEmailScheduler(pool) {
    const raw = String(process.env.LOYALTY_INTRO_EMAIL_SCHEDULER_ENABLED || 'true').trim().toLowerCase();
    if (raw === 'false' || raw === '0') {
        logger.info('[loyalty-intro-queue] Scheduler disabled (LOYALTY_INTRO_EMAIL_SCHEDULER_ENABLED=false)');
        return () => {};
    }

    const intervalMin = Math.max(15, Number(process.env.LOYALTY_INTRO_EMAIL_SCHEDULER_INTERVAL_MIN) || 30);
    const schedulerHour = Number.isFinite(Number(process.env.LOYALTY_INTRO_EMAIL_SCHEDULER_HOUR))
        ? Number(process.env.LOYALTY_INTRO_EMAIL_SCHEDULER_HOUR)
        : 10;
    const dailyCap = getDailyCap();

    const tick = async () => {
        if (introSendRunning) return;
        try {
            const now = new Date();
            if (now.getHours() !== schedulerHour) return;

            const today = localCalendarDate();
            if (lastSchedulerSendDate === today) return;

            const pending = await countPendingProgramIntroEmails(pool);
            if (pending === 0) return;

            const capStatus = await getDailyCapStatus(pool);
            if (capStatus.remainingToday <= 0) {
                lastSchedulerSendDate = today;
                return;
            }

            lastSchedulerSendDate = today;
            logger.info('[loyalty-intro-queue] Scheduler daily batch', {
                pending,
                dailyCap,
                sentToday: capStatus.sentToday,
                sending: capStatus.remainingToday,
            });
            await runThrottledProgramIntroSend(pool, {
                trigger: 'scheduler',
                maxEmails: capStatus.remainingToday,
            });
        } catch (err) {
            logger.error('[loyalty-intro-queue] scheduler tick failed', { message: err.message });
        }
    };

    logger.info(
        `[loyalty-intro-queue] Scheduler active — checks every ${intervalMin} min; ` +
            `one batch up to ${dailyCap}/day at hour ${schedulerHour} (server local time)`
    );
    const interval = setInterval(() => void tick(), intervalMin * 60 * 1000);
    return () => clearInterval(interval);
}

function isIntroSendRunning() {
    return introSendRunning;
}

function _resetIntroSendStateForTests() {
    introSendRunning = false;
    lastRunResult = null;
    lastSchedulerSendDate = null;
}

module.exports = {
    DEFAULTS,
    getDailyCap,
    isSmtpRateLimitError,
    countPendingProgramIntroEmails,
    countProgramIntroSentToday,
    getDailyCapStatus,
    getProgramIntroSendStats,
    runThrottledProgramIntroSend,
    scheduleProgramIntroBulkSend,
    startLoyaltyIntroEmailScheduler,
    isIntroSendRunning,
    _resetIntroSendStateForTests,
};
