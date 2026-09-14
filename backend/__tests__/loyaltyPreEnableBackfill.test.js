'use strict';

jest.mock('../services/loyaltyTierEngine', () => ({
    earnTierRewardsForOrder: jest.fn(),
    recalculateCustomerTier: jest.fn(),
}));

jest.mock('../services/webCheckoutPayments', () => ({
    getNonEarnTenderTotal: jest.fn(),
}));

const { earnTierRewardsForOrder, recalculateCustomerTier } = require('../services/loyaltyTierEngine');
const { getNonEarnTenderTotal } = require('../services/webCheckoutPayments');
const {
    BACKFILL_SOURCE,
    DEFAULT_LOOKBACK_DAYS,
    computeBackfillWindow,
    orderAlreadyEarned,
    backfillPreEnableLoyaltyRewards,
} = require('../services/loyaltyPreEnableBackfill');

function makePool({ orders = [], earnedOrderIds = new Set() } = {}) {
    return {
        execute: jest.fn(async (sql, params) => {
            const q = String(sql).replace(/\s+/g, ' ').trim();

            if (q.includes('FROM loyalty_transactions') && q.includes('transaction_type')) {
                const orderId = params[0];
                if (earnedOrderIds.has(orderId)) {
                    return [[{ id: 1 }], []];
                }
                return [[undefined], []];
            }

            if (q.includes('FROM orders o') && q.includes('payment_status')) {
                const [windowStart, windowEnd] = params;
                const startMs = new Date(windowStart).getTime();
                const endMs = new Date(windowEnd).getTime();
                const matched = orders.filter((o) => {
                    const t = new Date(o.updated_at).getTime();
                    return t >= startMs && t < endMs;
                });
                return [matched, []];
            }

            throw new Error(`Unexpected SQL: ${q}`);
        }),
    };
}

describe('loyaltyPreEnableBackfill', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getNonEarnTenderTotal.mockResolvedValue(0);
        earnTierRewardsForOrder.mockResolvedValue({ earned: true, cashEarned: 2 });
        recalculateCustomerTier.mockResolvedValue({ changed: false });
    });

    test('computeBackfillWindow uses half-open [start, end) interval', () => {
        const enableAt = new Date('2026-03-01T12:00:00.000Z');
        const window = computeBackfillWindow(enableAt, 30);
        expect(window.end.toISOString()).toBe(enableAt.toISOString());
        expect(window.start.toISOString()).toBe('2026-01-30T12:00:00.000Z');
    });

    test('backfill credits in-window orders and recalculates affected customers', async () => {
        const enableAt = new Date('2026-03-01T12:00:00.000Z');
        const pool = makePool({
            orders: [
                { id: 101, user_id: 7, subtotal: 100, sales_channel: 'web', updated_at: '2026-02-15T10:00:00.000Z' },
                { id: 102, user_id: 7, subtotal: 50, sales_channel: 'in_store', updated_at: '2026-02-20T10:00:00.000Z' },
            ],
        });

        const result = await backfillPreEnableLoyaltyRewards(pool, enableAt);

        expect(result.ordersScanned).toBe(2);
        expect(result.ordersCredited).toBe(2);
        expect(result.ordersSkipped).toBe(0);
        expect(result.customersAffected).toBe(1);
        expect(earnTierRewardsForOrder).toHaveBeenCalledTimes(2);
        expect(earnTierRewardsForOrder).toHaveBeenCalledWith(pool, 7, 101, 100, BACKFILL_SOURCE);
        expect(earnTierRewardsForOrder).toHaveBeenCalledWith(pool, 7, 102, 50, BACKFILL_SOURCE);
        expect(recalculateCustomerTier).toHaveBeenCalledWith(pool, 7, { sendPromotionEmail: false });
    });

    test('backfill skips orders outside the 30-day window', async () => {
        const enableAt = new Date('2026-03-01T12:00:00.000Z');
        const pool = makePool({
            orders: [
                { id: 201, user_id: 9, subtotal: 80, sales_channel: 'web', updated_at: '2026-01-01T10:00:00.000Z' },
                { id: 202, user_id: 9, subtotal: 40, sales_channel: 'web', updated_at: '2026-02-28T23:59:59.000Z' },
            ],
        });

        const result = await backfillPreEnableLoyaltyRewards(pool, enableAt);

        expect(result.ordersScanned).toBe(1);
        expect(result.ordersCredited).toBe(1);
        expect(earnTierRewardsForOrder).toHaveBeenCalledTimes(1);
        expect(earnTierRewardsForOrder).toHaveBeenCalledWith(pool, 9, 202, 40, BACKFILL_SOURCE);
    });

    test('backfill dedupes orders that already have earn transactions', async () => {
        const enableAt = new Date('2026-03-01T12:00:00.000Z');
        const pool = makePool({
            orders: [
                { id: 301, user_id: 3, subtotal: 60, sales_channel: 'web', updated_at: '2026-02-10T10:00:00.000Z' },
                { id: 302, user_id: 3, subtotal: 70, sales_channel: 'web', updated_at: '2026-02-11T10:00:00.000Z' },
            ],
            earnedOrderIds: new Set([301]),
        });

        const result = await backfillPreEnableLoyaltyRewards(pool, enableAt);

        expect(result.ordersScanned).toBe(2);
        expect(result.ordersCredited).toBe(1);
        expect(result.ordersSkipped).toBe(1);
        expect(earnTierRewardsForOrder).toHaveBeenCalledTimes(1);
        expect(earnTierRewardsForOrder).toHaveBeenCalledWith(pool, 3, 302, 70, BACKFILL_SOURCE);
    });

    test('backfill skips when earnTierRewardsForOrder reports disabled or zero', async () => {
        const enableAt = new Date('2026-03-01T12:00:00.000Z');
        earnTierRewardsForOrder.mockResolvedValue({ earned: false, reason: 'disabled' });
        const pool = makePool({
            orders: [{ id: 401, user_id: 5, subtotal: 25, sales_channel: 'web', updated_at: '2026-02-05T10:00:00.000Z' }],
        });

        const result = await backfillPreEnableLoyaltyRewards(pool, enableAt);

        expect(result.ordersCredited).toBe(0);
        expect(result.ordersSkipped).toBe(1);
        expect(recalculateCustomerTier).not.toHaveBeenCalled();
    });

    test('orderAlreadyEarned checks loyalty_transactions earn rows', async () => {
        const pool = makePool({ earnedOrderIds: new Set([999]) });
        expect(await orderAlreadyEarned(pool, 999)).toBe(true);
        expect(await orderAlreadyEarned(pool, 1000)).toBe(false);
    });

    test('DEFAULT_LOOKBACK_DAYS is 30', () => {
        expect(DEFAULT_LOOKBACK_DAYS).toBe(30);
    });
});
