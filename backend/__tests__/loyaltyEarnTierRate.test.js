'use strict';

jest.mock('../services/loyaltyTierProgram', () => ({
    getProgramSettings: jest.fn()
}));

jest.mock('../services/loyaltyTierEngine', () => ({
    evaluateCustomerTier: jest.fn(),
    resolveEffectiveCashbackPercent: jest.fn(),
    resolveEffectivePointsMultiplier: jest.fn(),
    isPointsMode: jest.fn((s) => (s?.programMode ?? s?.mode) === 'points')
}));

const { getProgramSettings } = require('../services/loyaltyTierProgram');
const {
    evaluateCustomerTier,
    resolveEffectiveCashbackPercent,
    resolveEffectivePointsMultiplier,
    isPointsMode
} = require('../services/loyaltyTierEngine');
const { resolveOrderEarnSettings } = require('../services/customerLoyalty');

describe('resolveOrderEarnSettings — tier earn vs flat', () => {
    const flatSettings = {
        enabled: true,
        cashEnabled: true,
        pointsEnabled: true,
        cashbackPercent: 5,
        pointsPerDollar: 1,
        dollarPerPoint: 0.01
    };

    beforeEach(() => {
        jest.clearAllMocks();
        isPointsMode.mockImplementation((s) => (s?.programMode ?? s?.mode) === 'points');
    });

    test('uses tier cashback % (not flat 5%) when tiers are enabled', async () => {
        getProgramSettings.mockResolvedValue({
            enabled: true,
            programMode: 'cash',
            combinedSpendFrequencyBonus: true
        });
        evaluateCustomerTier.mockResolvedValue({
            tier: { tierKey: 'gold', discountPercent: 2, frequencyBonusPercent: 2 },
            metrics: { lifetimeSpend: 800, orderCount: 10 }
        });
        resolveEffectiveCashbackPercent.mockReturnValue(4);

        const result = await resolveOrderEarnSettings({}, 42, flatSettings);

        expect(resolveEffectiveCashbackPercent).toHaveBeenCalled();
        expect(result.cashbackPercent).toBe(4);
        expect(result.earnRateSource).toBe('tier');
        expect(result.earnTierKey).toBe('gold');
        expect(result.cashbackPercent).not.toBe(5);
    });

    test('Bronze at 0% earns 0 — does not fall back to flat 5%', async () => {
        getProgramSettings.mockResolvedValue({
            enabled: true,
            programMode: 'cash',
            combinedSpendFrequencyBonus: true
        });
        evaluateCustomerTier.mockResolvedValue({
            tier: { tierKey: 'bronze', discountPercent: 0, frequencyBonusPercent: 0 },
            metrics: { lifetimeSpend: 0, orderCount: 0 }
        });
        resolveEffectiveCashbackPercent.mockReturnValue(0);

        const result = await resolveOrderEarnSettings({}, 7, flatSettings);

        expect(result.cashbackPercent).toBe(0);
        expect(result.earnRateSource).toBe('tier');
        expect(result.earnTierKey).toBe('bronze');
    });

    test('keeps flat rate when tier program is disabled', async () => {
        getProgramSettings.mockResolvedValue({ enabled: false, programMode: 'cash' });

        const result = await resolveOrderEarnSettings({}, 1, flatSettings);

        expect(evaluateCustomerTier).not.toHaveBeenCalled();
        expect(result.cashbackPercent).toBe(5);
        expect(result.earnRateSource).toBe('flat');
    });

    test('falls back to flat only when tier row is missing', async () => {
        getProgramSettings.mockResolvedValue({ enabled: true, programMode: 'cash' });
        evaluateCustomerTier.mockResolvedValue({ tier: null, metrics: null });

        const result = await resolveOrderEarnSettings({}, 9, flatSettings);

        expect(result.cashbackPercent).toBe(5);
        expect(result.earnRateSource).toBe('fallback');
    });

    test('points mode applies tier multiplier to points-per-dollar', async () => {
        getProgramSettings.mockResolvedValue({
            enabled: true,
            programMode: 'points',
            pointsPerDollar: 2
        });
        evaluateCustomerTier.mockResolvedValue({
            tier: { tierKey: 'silver', discountPercent: 2 },
            metrics: { pointsBalance: 600 }
        });
        resolveEffectivePointsMultiplier.mockReturnValue(2);

        const result = await resolveOrderEarnSettings({}, 3, flatSettings);

        expect(result.pointsPerDollar).toBe(4);
        expect(result.earnRateSource).toBe('tier');
        expect(result.earnTierKey).toBe('silver');
    });
});
