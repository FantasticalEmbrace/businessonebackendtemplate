'use strict';

const { getProgramSettings } = require('./loyaltyTierProgram');
const {
    evaluateCustomerTier,
    resolveEffectiveCashbackPercent,
    resolveEffectivePointsMultiplier,
    isPointsMode,
} = require('./loyaltyTierEngine');

function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
}

async function getLoyaltyBenefitsForUser(pool, userId, subtotal) {
    const settings = await getProgramSettings(pool);
    if (!settings?.enabled || !userId) {
        return {
            enabled: false,
            programMode: 'cash',
            discountPercent: 0,
            discountAmount: 0,
            freeShipping: false,
        };
    }

    const { tier, metrics } = await evaluateCustomerTier(pool, userId);
    const isPoints = isPointsMode(settings);
    const programMode = isPoints ? 'points' : 'cashback';
    const sub = roundMoney(subtotal);
    const cashBalance = roundMoney(metrics?.cashBalance ?? 0);
    const pointsBalance = Number(metrics?.pointsBalance) || 0;

    let cashbackPercent = 0;
    let pointsMultiplier = 1;
    if (isPoints) {
        pointsMultiplier = resolveEffectivePointsMultiplier(tier, settings);
    } else {
        cashbackPercent = resolveEffectiveCashbackPercent(tier, metrics, settings);
    }

    let freeShipping = false;
    if (tier?.freeShipping) {
        const min = tier.freeShippingMinOrder;
        if (min == null || min <= 0 || sub >= min) {
            freeShipping = true;
        }
    }

    const minCashbackRedeem = Number(settings.minCashbackRedeem) || 0;
    const maxCashRedeemable =
        cashBalance >= minCashbackRedeem ? roundMoney(Math.min(cashBalance, sub)) : 0;

    return {
        enabled: true,
        programMode,
        tierKey: tier?.tierKey || 'bronze',
        tierName: tier?.displayName || 'Bronze',
        discountPercent: 0,
        discountAmount: 0,
        cashbackPercent: isPoints ? undefined : cashbackPercent,
        estimatedCashback: isPoints ? undefined : roundMoney(sub * (cashbackPercent / 100)),
        freeShipping,
        freeShippingMinOrder: tier?.freeShippingMinOrder ?? null,
        pointsBalance,
        cashBalance,
        maxCashRedeemable,
        minCashbackRedeem,
        pointsPerDollar: isPoints ? settings.pointsPerDollar ?? 1 : undefined,
        dollarPerPoint: isPoints ? settings.dollarPerPoint ?? 0.01 : undefined,
        pointsMultiplier: isPoints ? pointsMultiplier : undefined,
        rewardType: isPoints ? 'points' : 'cashback',
    };
}

async function applyLoyaltyToCartSummary(pool, userId, summary) {
    const subtotal = Number(summary?.subtotal) || 0;
    const benefits = await getLoyaltyBenefitsForUser(pool, userId, subtotal);
    if (!benefits.enabled) return { ...summary, loyalty: benefits };

    const tax = Number(summary.tax) || 0;
    let shipping = Number(summary.shipping) || 0;
    if (benefits.freeShipping) shipping = 0;

    const total = roundMoney(subtotal + tax + shipping);

    return {
        ...summary,
        subtotal: subtotal.toFixed(2),
        tax: tax.toFixed(2),
        shipping: shipping.toFixed(2),
        total: total.toFixed(2),
        loyalty: benefits,
    };
}

module.exports = {
    getLoyaltyBenefitsForUser,
    applyLoyaltyToCartSummary,
    roundMoney,
};
