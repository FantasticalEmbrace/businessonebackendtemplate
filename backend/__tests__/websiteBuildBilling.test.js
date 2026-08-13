'use strict';

const {
    computeMilestoneAmounts,
    describeBuildMilestones,
    computeBuildSignupAmount,
    computeBuildRemainderFinance,
    normalizeBuildPayMode
} = require('../services/websiteBuildBilling');

describe('websiteBuildBilling', () => {
    test('milestone amounts sum to build total', () => {
        const amounts = computeMilestoneAmounts(10000);
        const sum = amounts.reduce((s, m) => s + m.amount, 0);
        expect(sum).toBe(10000);
    });

    test('deposit is 25% of basic tier', () => {
        const info = describeBuildMilestones('basic');
        expect(info.depositAmount).toBe(375);
        expect(info.buildAmount).toBe(1500);
    });

    test('full pay equals total build amount', () => {
        const info = describeBuildMilestones('growth');
        expect(info.buildAmount).toBe(6000);
        expect(info.depositAmount).toBe(1500);
        expect(info.buildAmount - info.depositAmount).toBe(4500);
    });

    test('normalizeBuildPayMode accepts 50 and 75', () => {
        expect(normalizeBuildPayMode('50')).toBe('50');
        expect(normalizeBuildPayMode('75%')).toBe('75');
        expect(normalizeBuildPayMode('full')).toBe('full');
        expect(normalizeBuildPayMode('deposit')).toBe('deposit');
    });

    test('50% and 75% signup amounts', () => {
        expect(computeBuildSignupAmount(10000, '50').amount).toBe(5000);
        expect(computeBuildSignupAmount(10000, '75').amount).toBe(7500);
        expect(computeBuildSignupAmount(1500, '50').amount).toBe(750);
    });

    test('describeBuildMilestones exposes pay plan amounts', () => {
        const info = describeBuildMilestones('standard');
        expect(info.payPlans['50'].amount).toBe(1500);
        expect(info.payPlans['75'].amount).toBe(2250);
        expect(info.payPlans.full.amount).toBe(3000);
    });

    test('unpaid build balance is financed over 12 months', () => {
        const finance = computeBuildRemainderFinance(10000, 'full');
        expect(finance.remaining).toBe(0);
        expect(finance.monthlyAmount).toBe(0);

        const deposit = computeBuildRemainderFinance(10000, 'deposit');
        expect(deposit.paidToday).toBe(2500);
        expect(deposit.remaining).toBe(7500);
        expect(deposit.months).toBe(12);
        expect(deposit.monthlyAmount).toBe(625);
    });
});
