'use strict';

const {
    DEFAULTS,
    getDailyCap,
    runThrottledRateCorrectionSend,
    countPendingRateCorrectionEmails,
    getDailyCapStatus,
    _resetRateCorrectionSendStateForTests,
} = require('../services/loyaltyRateCorrectionEmailQueue');
const {
    LOYALTY_RATE_CORRECTION_EMAIL_TYPE,
    LOYALTY_RATE_CORRECTION_SUBJECT,
    PROGRAM_INTRO_EMAIL_TYPE,
    buildLoyaltyRateCorrectionEmail,
} = require('../services/loyaltyTierEmails');

jest.mock('../utils/mailTransporter', () => ({
    sendMail: jest.fn(async () => ({ messageId: 'test' })),
}));

jest.mock('../services/storeBranding', () => ({
    resolveStoreBranding: jest.fn(async () => ({
        storeName: 'Business One',
        storePhone: '(706) 861-9454',
        colors: { primary: '#2563eb' },
    })),
}));

const { sendMail } = require('../utils/mailTransporter');

function makePool({
    users = [
        { id: 1, email: 'a@example.com', first_name: 'A', customer_status: 'active' },
        { id: 2, email: 'b@example.com', first_name: 'B', customer_status: 'active' },
        { id: 3, email: 'c@example.com', first_name: 'C', customer_status: 'active' },
        { id: 4, email: 'd@example.com', first_name: 'D', customer_status: 'active' },
    ],
    introSentUserIds = [1, 2, 3],
    correctionSentUserIds = [],
    supersededCorrectionUserIds = [],
    sentTodayCount = 0,
} = {}) {
    const introSent = new Set(introSentUserIds);
    const correctionSent = new Set(correctionSentUserIds);
    const superseded = new Set(supersededCorrectionUserIds);
    const todayCounter = { count: sentTodayCount };

    const pool = {
        execute: jest.fn(async (sql, params = []) => {
            const q = String(sql);
            if (q.includes('sentToday') && q.includes('DATE(sent_at) = CURDATE()')) {
                return [[{ sentToday: todayCounter.count }]];
            }
            if (q.includes('COUNT(*) AS sent FROM loyalty_email_sends')) {
                return [[{ sent: correctionSent.size }]];
            }
            if (q.includes('FROM users u') && q.includes('EXISTS') && q.includes('program_intro')) {
                const eligible = users.filter(
                    (u) =>
                        u.email &&
                        u.customer_status === 'active' &&
                        introSent.has(u.id) &&
                        !(correctionSent.has(u.id) && !superseded.has(u.id))
                );
                // Priority: superseded first
                eligible.sort((a, b) => {
                    const ap = superseded.has(a.id) ? 0 : 1;
                    const bp = superseded.has(b.id) ? 0 : 1;
                    return ap - bp || a.id - b.id;
                });
                if (q.includes('u.id IN')) {
                    const ids = params.slice(0, -2).map(Number);
                    return [eligible.filter((u) => ids.includes(u.id)).map((u) => ({ id: u.id }))];
                }
                return [eligible.map((u) => ({ id: u.id }))];
            }
            if (q.includes('FROM users') && q.includes('WHERE id = ?')) {
                const user = users.find((u) => u.id === params[0]);
                return [[user || null]];
            }
            if (q.includes('FROM loyalty_email_sends') && q.includes('email_type = ?')) {
                const userId = params[0];
                const emailType = params[1];
                if (emailType === PROGRAM_INTRO_EMAIL_TYPE && introSent.has(userId)) {
                    return [[{ id: 1 }]];
                }
                if (emailType === LOYALTY_RATE_CORRECTION_EMAIL_TYPE) {
                    if (correctionSent.has(userId) && !superseded.has(userId)) {
                        return [[{ id: 2, metadata: { trigger: 'loyalty_rate_correction' } }]];
                    }
                    if (superseded.has(userId)) {
                        return [[{ id: 2, metadata: { superseded: true } }]];
                    }
                }
                return [[]];
            }
            if (q.includes('INSERT INTO loyalty_email_sends')) {
                correctionSent.add(params[0]);
                superseded.delete(params[0]);
                todayCounter.count += 1;
                return [{ insertId: correctionSent.size }];
            }
            return [[]];
        }),
        correctionSent,
        introSent,
        superseded,
    };
    return pool;
}

describe('loyaltyRateCorrectionEmailQueue', () => {
    beforeEach(() => {
        sendMail.mockClear();
        sendMail.mockImplementation(async () => ({ messageId: 'test' }));
        _resetRateCorrectionSendStateForTests();
    });

    test('copy uses tiers-only subject and rates (no flat-rate language)', () => {
        const payload = buildLoyaltyRateCorrectionEmail({
            branding: { storeName: 'Business One' },
            customerName: 'Pat',
        });
        expect(payload.subject).toBe(LOYALTY_RATE_CORRECTION_SUBJECT);
        expect(payload.subject).not.toMatch(/flat/i);
        expect(payload.text).not.toMatch(/flat\s*5%/i);
        expect(payload.text).not.toMatch(/not stacked/i);
        expect(payload.html).not.toMatch(/flat\s*5%/i);
        expect(payload.text).toMatch(/Bronze: 0%/);
        expect(payload.text).toMatch(/Silver: 1% base/);
        expect(payload.text).toMatch(/Gold: 2% base/);
        expect(payload.text).toMatch(/Platinum: 3% base/);
        expect(payload.text).toMatch(/frequency bonus/i);
        expect(payload.html).toMatch(/Business One/);
        expect(payload.html).toMatch(/With frequency bonus/);
        expect(payload.html).toMatch(/border-collapse:collapse/);
        expect(payload.html).toMatch(/up to 2%/);
        expect(payload.html).toMatch(/up to 4%/);
        expect(payload.html).toMatch(/up to 5%/);
        expect(payload.html).not.toMatch(/#658d0b/i);
        expect(payload.html).not.toMatch(/HM Herbs/i);
    });

    test('default daily cap is 25', () => {
        const prev = process.env.LOYALTY_RATE_CORRECTION_DAILY_CAP;
        const prevIntro = process.env.LOYALTY_INTRO_EMAIL_DAILY_CAP;
        delete process.env.LOYALTY_RATE_CORRECTION_DAILY_CAP;
        delete process.env.LOYALTY_INTRO_EMAIL_DAILY_CAP;
        expect(getDailyCap()).toBe(25);
        expect(DEFAULTS.dailyCap).toBe(25);
        process.env.LOYALTY_RATE_CORRECTION_DAILY_CAP = prev;
        process.env.LOYALTY_INTRO_EMAIL_DAILY_CAP = prevIntro;
    });

    test('only targets program_intro recipients; never-emailed stay pending=0 for them', async () => {
        const pool = makePool({ introSentUserIds: [1, 2], correctionSentUserIds: [] });
        const pending = await countPendingRateCorrectionEmails(pool);
        expect(pending).toBe(2);
        expect(pool.introSent.has(4)).toBe(false);
    });

    test('sends up to daily cap and records loyalty_rate_correction', async () => {
        const prev = process.env.LOYALTY_RATE_CORRECTION_DAILY_CAP;
        process.env.LOYALTY_RATE_CORRECTION_DAILY_CAP = '2';
        const pool = makePool({ introSentUserIds: [1, 2, 3], sentTodayCount: 0 });
        const result = await runThrottledRateCorrectionSend(pool, {
            trigger: 'test',
            delayMs: 0,
            batchPauseMs: 0,
        });
        expect(result.started).toBe(true);
        expect(result.sent).toBe(2);
        expect(result.emailType).toBe(LOYALTY_RATE_CORRECTION_EMAIL_TYPE);
        expect(sendMail).toHaveBeenCalledTimes(2);
        expect(pool.correctionSent.size).toBe(2);
        process.env.LOYALTY_RATE_CORRECTION_DAILY_CAP = prev;
    });

    test('skips when daily cap already reached', async () => {
        const prev = process.env.LOYALTY_RATE_CORRECTION_DAILY_CAP;
        process.env.LOYALTY_RATE_CORRECTION_DAILY_CAP = '2';
        const pool = makePool({ introSentUserIds: [1, 2, 3], sentTodayCount: 2 });
        const status = await getDailyCapStatus(pool);
        expect(status.remainingToday).toBe(0);
        const result = await runThrottledRateCorrectionSend(pool, { trigger: 'test', delayMs: 0 });
        expect(result.started).toBe(false);
        expect(result.reason).toBe('daily_cap_reached');
        expect(sendMail).not.toHaveBeenCalled();
        process.env.LOYALTY_RATE_CORRECTION_DAILY_CAP = prev;
    });

    test('does not send to users missing program_intro even if requested', async () => {
        const pool = makePool({ introSentUserIds: [1], correctionSentUserIds: [] });
        const result = await runThrottledRateCorrectionSend(pool, {
            userIds: [1, 4],
            trigger: 'test',
            delayMs: 0,
            batchPauseMs: 0,
        });
        expect(result.sent).toBe(1);
        expect(pool.correctionSent.has(4)).toBe(false);
        expect(sendMail).toHaveBeenCalledTimes(1);
    });

    test('superseded flat-rate recipients are eligible again and prioritized', async () => {
        const pool = makePool({
            introSentUserIds: [1, 2, 3],
            correctionSentUserIds: [2],
            supersededCorrectionUserIds: [2],
        });
        const pending = await countPendingRateCorrectionEmails(pool);
        expect(pending).toBe(3);
        const ids = await require('../services/loyaltyRateCorrectionEmailQueue').loadEligibleCorrectionUserIds(
            pool
        );
        expect(ids[0]).toBe(2);
        const result = await runThrottledRateCorrectionSend(pool, {
            trigger: 'test',
            delayMs: 0,
            batchPauseMs: 0,
            maxEmails: 1,
        });
        expect(result.sent).toBe(1);
        expect(pool.correctionSent.has(2)).toBe(true);
        expect(pool.superseded.has(2)).toBe(false);
    });
});
