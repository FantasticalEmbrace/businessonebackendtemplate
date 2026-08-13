'use strict';

const BASE_MONTHLY = 100;
const MID_TIER_STATIONS = 4;
const MID_TIER_RATE = 50;
const VOLUME_RATE = 25;
const FAILOVER_INCLUDED_GB = 2;
const FAILOVER_OVERAGE_PER_GB = 10;

/**
 * Monthly Business One POS fee from active station count.
 * 1 station: $100 (includes failover internet up to 2 GB) | 2–4: +$50 each | 5+: +$25 each
 */
function calculateMonthlyAmount(stationCount) {
    const n = Math.max(1, Math.floor(Number(stationCount) || 1));
    if (n <= 1) return BASE_MONTHLY;
    if (n <= MID_TIER_STATIONS) return BASE_MONTHLY + (n - 1) * MID_TIER_RATE;
    const midTotal = BASE_MONTHLY + (MID_TIER_STATIONS - 1) * MID_TIER_RATE;
    return midTotal + (n - MID_TIER_STATIONS) * VOLUME_RATE;
}

/**
 * Failover data overage — $10 per GB (or portion) beyond included allowance.
 * Failover is bundled with the first station; only usage overage is billed separately.
 */
function calculateFailoverOverage(gbUsed) {
    const used = Math.max(0, Number(gbUsed) || 0);
    const overGb = used - FAILOVER_INCLUDED_GB;
    if (overGb <= 0) return 0;
    return Math.ceil(overGb) * FAILOVER_OVERAGE_PER_GB;
}

function describeMonthlyPricing(stationCount) {
    const n = Math.max(1, Math.floor(Number(stationCount) || 1));
    const amount = calculateMonthlyAmount(n);
    const parts = [`$${BASE_MONTHLY} base (1 station, includes ${FAILOVER_INCLUDED_GB} GB failover internet)`];
    if (n > 1) {
        const mid = Math.min(n, MID_TIER_STATIONS) - 1;
        if (mid > 0) parts.push(`${mid} × $${MID_TIER_RATE} (stations 2–4)`);
    }
    if (n > MID_TIER_STATIONS) {
        parts.push(`${n - MID_TIER_STATIONS} × $${VOLUME_RATE} (station 5+)`);
    }
    return {
        stationCount: n,
        monthlyAmount: amount,
        summary: parts.join(' + '),
        formatted: `$${amount.toFixed(2)}/mo`,
        failover: {
            included: true,
            includedWithFirstStation: true,
            includedGb: FAILOVER_INCLUDED_GB,
            overagePerGb: FAILOVER_OVERAGE_PER_GB,
            description: `The first station includes ${FAILOVER_INCLUDED_GB} GB of failover internet. Each additional GB used after that is $${FAILOVER_OVERAGE_PER_GB}.`
        }
    };
}

function describeBillingBreakdown(stationCount, failoverGbUsed = 0) {
    const pricing = describeMonthlyPricing(stationCount);
    const gb = Math.max(0, Number(failoverGbUsed) || 0);
    const failoverOverage = calculateFailoverOverage(gb);
    const total = pricing.monthlyAmount + failoverOverage;
    const lines = [pricing.summary];
    if (failoverOverage > 0) {
        lines.push(
            `failover over ${FAILOVER_INCLUDED_GB} GB (${gb.toFixed(1)} GB used): $${failoverOverage.toFixed(2)}`
        );
    }
    return {
        ...pricing,
        failoverGbUsed: gb,
        failoverOverageAmount: failoverOverage,
        monthlyAmount: total,
        subscriptionAmount: pricing.monthlyAmount,
        summary: lines.join(' + '),
        formatted: `$${total.toFixed(2)}/mo`
    };
}

module.exports = {
    BASE_MONTHLY,
    MID_TIER_STATIONS,
    MID_TIER_RATE,
    VOLUME_RATE,
    FAILOVER_INCLUDED_GB,
    FAILOVER_OVERAGE_PER_GB,
    calculateMonthlyAmount,
    calculateFailoverOverage,
    describeMonthlyPricing,
    describeBillingBreakdown
};
