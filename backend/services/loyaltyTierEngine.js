'use strict';

const logger = require('../utils/logger');
const { listTiers, getProgramSettings } = require('./loyaltyTierProgram');

function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
}

/** Spend used for tier thresholds (minLifetimeSpend in DB). */
function tierQualificationSpend(metrics) {
    return Number(metrics?.lifetimeSpend) || 0;
}

/** Paid order count used for tier thresholds (minOrderCount in DB). */
function tierQualificationOrders(metrics) {
    return Number(metrics?.orderCount) || 0;
}

/** Points balance used for tier thresholds in points mode (minPoints in DB). */
function tierQualificationPoints(metrics) {
    return Number(metrics?.pointsBalance) || 0;
}

function programMode(settingsOrMode) {
    const raw =
        typeof settingsOrMode === 'string'
            ? settingsOrMode
            : settingsOrMode?.programMode ?? settingsOrMode?.mode ?? 'cash';
    const v = String(raw).toLowerCase();
    if (v === 'points') return 'points';
    if (v === 'cashback') return 'cash';
    return 'cash';
}

function isPointsMode(settingsOrMode) {
    return programMode(settingsOrMode) === 'points';
}

function isCashMode(settingsOrMode) {
    return !isPointsMode(settingsOrMode);
}

function meetsThreshold(tier, metrics, mode) {
    const m = metrics || {};
    if (isPointsMode(mode)) {
        return tierQualificationPoints(m) >= (Number(tier.minPoints) || 0);
    }

    const spend = tierQualificationSpend(m);
    const orders = tierQualificationOrders(m);
    const minSpend = Number(tier.minLifetimeSpend) || 0;
    const minOrders = Number(tier.minOrderCount) || 0;

    // Minimum lifetime spend is always required when configured.
    if (minSpend > 0 && spend < minSpend) {
        return false;
    }

    // When "Spend + orders" is on, order count is an additional gate after spend.
    if (tier.requireBothSpendAndOrders && minOrders > 0 && orders < minOrders) {
        return false;
    }

    return true;
}

function evaluateTierFromMetrics(tiers, metrics, mode = 'cash') {
    const resolvedMode = programMode(mode);
    const active = (tiers || [])
        .filter((t) => t.isActive !== false)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    if (!active.length) return { tierKey: 'bronze', tier: null };

    let best = active[0];
    for (const tier of active) {
        if (meetsThreshold(tier, metrics, resolvedMode)) {
            best = tier;
        }
    }
    return { tierKey: best.tierKey, tier: best };
}

function nextTier(tiers, currentTierKey) {
    const sorted = [...(tiers || [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((t) => t.tierKey === currentTierKey);
    if (idx < 0 || idx >= sorted.length - 1) return null;
    return sorted[idx + 1];
}

function progressTowardTier(metrics, targetTier, mode) {
    if (!targetTier) return { percent: 100 };

    if (isPointsMode(mode)) {
        const target = Number(targetTier.minPoints) || 0;
        const current = tierQualificationPoints(metrics);
        if (target <= 0) return { percent: 100 };
        return { percent: Math.min(100, Math.round((current / target) * 100)) };
    }

    const spend = tierQualificationSpend(metrics);
    const orders = tierQualificationOrders(metrics);
    const minSpend = Number(targetTier.minLifetimeSpend) || 0;
    const minOrders = Number(targetTier.minOrderCount) || 0;
    if (minSpend > 0) {
        return { percent: Math.min(100, Math.round((spend / minSpend) * 100)) };
    }
    if (minOrders > 0) {
        return { percent: Math.min(100, Math.round((orders / minOrders) * 100)) };
    }
    return { percent: 100 };
}

/** Cash-back % earned on eligible subtotal after a paid order (stored in discount_percent). */
function resolveEffectiveCashbackPercent(tier, metrics, settings) {
    if (!tier || isPointsMode(settings)) return 0;
    let pct = Number(tier.discountPercent) || 0;
    const combinedBonus = settings?.combinedSpendFrequencyBonus !== false;
    const spendOk = tierQualificationSpend(metrics) >= (Number(tier.minLifetimeSpend) || 0);
    const ordersOk = tierQualificationOrders(metrics) >= (Number(tier.minOrderCount) || 0);
    if (combinedBonus && spendOk && ordersOk && Number(tier.frequencyBonusPercent) > 0) {
        pct += Number(tier.frequencyBonusPercent);
    }
    return Math.min(50, pct);
}

/** Tier programs do not apply automatic checkout discounts — use store credit or points redemption. */
function resolveEffectiveDiscountPercent(_tier, _metrics, _settings) {
    return 0;
}

function resolveEffectivePointsMultiplier(tier, settings) {
    if (!tier || !isPointsMode(settings)) return 1;
    const mult = Number(tier.discountPercent);
    return mult > 0 ? Math.min(10, mult) : 1;
}

async function loadCustomerMetrics(pool, userId) {
    const [[user]] = await pool.execute(
        `SELECT u.id, u.email, u.first_name, u.total_orders, u.lifetime_value, u.last_order_at,
                cl.points_balance, cl.cash_balance, cl.tier
           FROM users u
           LEFT JOIN customer_loyalty cl ON cl.user_id = u.id
          WHERE u.id = ?`,
        [userId]
    );
    if (!user) return null;

    return {
        userId: user.id,
        email: user.email,
        firstName: user.first_name,
        lifetimeSpend: roundMoney(user.lifetime_value),
        orderCount: Number(user.total_orders) || 0,
        pointsBalance: Number(user.points_balance) || 0,
        cashBalance: roundMoney(user.cash_balance),
        currentTierKey: user.tier || 'bronze',
        lastOrderAt: user.last_order_at,
    };
}

async function evaluateCustomerTier(pool, userId) {
    const settings = await getProgramSettings(pool);
    const tiers = await listTiers(pool, { activeOnly: true });
    const metrics = await loadCustomerMetrics(pool, userId);
    if (!metrics) return { tier: null, metrics: null, settings };
    const { tier } = evaluateTierFromMetrics(tiers, metrics, settings.programMode);
    return { tier, metrics, settings };
}

async function recalculateCustomerTier(pool, userId, { sendPromotionEmail = true } = {}) {
    const settings = await getProgramSettings(pool);
    if (!settings.enabled) return { changed: false, reason: 'disabled' };

    const { tier, metrics } = await evaluateCustomerTier(pool, userId);
    if (!tier || !metrics) return { changed: false };

    const [[loyalty]] = await pool.execute(
        'SELECT tier, tier_progress FROM customer_loyalty WHERE user_id = ?',
        [userId]
    );
    const previousTier = loyalty?.tier || 'bronze';
    const tiers = await listTiers(pool, { activeOnly: true });
    const nxt = nextTier(tiers, tier.tierKey);
    const progress = nxt
        ? progressTowardTier(metrics, nxt, settings.programMode)
        : { percent: 100 };

    await pool.execute(
        `INSERT INTO customer_loyalty (user_id, tier, tier_progress, member_since)
         VALUES (?, ?, ?, CURDATE())
         ON DUPLICATE KEY UPDATE tier = VALUES(tier), tier_progress = VALUES(tier_progress)`,
        [userId, tier.tierKey, progress.percent]
    );

    let changed = false;
    if (previousTier !== tier.tierKey) {
        changed = true;
        const sorted = [...tiers].sort((a, b) => a.sortOrder - b.sortOrder);
        const prevIdx = sorted.findIndex((t) => t.tierKey === previousTier);
        const newIdx = sorted.findIndex((t) => t.tierKey === tier.tierKey);
        const changeType = newIdx > prevIdx ? 'upgrade' : newIdx < prevIdx ? 'downgrade' : 'manual';

        await pool.execute(
            `INSERT INTO loyalty_tier_history
                (user_id, from_tier, to_tier, reason, lifetime_spend, order_count, points_balance)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                previousTier,
                tier.tierKey,
                changeType,
                metrics.lifetimeSpend,
                metrics.orderCount,
                metrics.pointsBalance,
            ]
        );

        if (sendPromotionEmail && changeType === 'upgrade' && settings.emailPromotionEnabled) {
            const [[user]] = await pool.execute(
                'SELECT id, email, first_name FROM users WHERE id = ?',
                [userId]
            );
            if (user?.email) {
                const { sendTierPromotionEmail } = require('./loyaltyTierEmails');
                void sendTierPromotionEmail(pool, userId, {
                    fromTier: previousTier,
                    toTier: tier,
                    user,
                }).catch(() => {});
            }
        }
    }

    return { changed, previousTier, tier, metrics, progress };
}

/**
 * Re-evaluate and persist tiers for all customers with spend or paid orders.
 */
async function recalculateAllCustomerTiers(pool, { sendPromotionEmail = false } = {}) {
    const settings = await getProgramSettings(pool);
    if (!settings.enabled) {
        return { skipped: true, reason: 'disabled', processed: 0, changed: 0, errors: [] };
    }

    const [rows] = await pool.execute(
        `SELECT u.id
           FROM users u
          WHERE u.customer_status != 'deleted'
            AND (
                COALESCE(u.lifetime_value, 0) > 0
                OR COALESCE(u.total_orders, 0) > 0
                OR EXISTS (
                    SELECT 1 FROM orders o
                     WHERE o.user_id = u.id AND o.payment_status = 'paid'
                )
            )
          ORDER BY u.id ASC`
    );

    const result = {
        processed: 0,
        changed: 0,
        errors: [],
        tierCounts: {},
    };

    for (const row of rows || []) {
        const userId = Number(row.id);
        if (!Number.isFinite(userId) || userId < 1) continue;
        result.processed++;
        try {
            const recalc = await recalculateCustomerTier(pool, userId, { sendPromotionEmail });
            if (recalc.changed) result.changed++;
            const tierKey = recalc.tier?.tierKey || recalc.previousTier || 'bronze';
            result.tierCounts[tierKey] = (result.tierCounts[tierKey] || 0) + 1;
        } catch (err) {
            result.errors.push({ userId, message: err?.message || String(err) });
            logger.error('[loyalty] bulk tier recalc error:', userId, err);
        }
    }

    return result;
}

async function orderAlreadyHasEarnTransaction(pool, orderId) {
    const [[row]] = await pool.execute(
        `SELECT id FROM loyalty_transactions
          WHERE order_id = ? AND transaction_type = 'earn'
          LIMIT 1`,
        [orderId]
    );
    return Boolean(row);
}

async function earnTierRewardsForOrder(pool, userId, orderId, eligibleSubtotal, source = 'web') {
    const settings = await getProgramSettings(pool);
    if (!settings.enabled) {
        return { earned: false, reason: 'disabled' };
    }

    if (await orderAlreadyHasEarnTransaction(pool, orderId)) {
        return { earned: false, reason: 'already_earned' };
    }

    const subtotal = roundMoney(eligibleSubtotal);
    if (subtotal <= 0) return { earned: false, reason: 'zero_subtotal' };

    const { tier, metrics } = await evaluateCustomerTier(pool, userId);

    if (isPointsMode(settings)) {
        const { adjustLoyaltyPoints } = require('./customerLoyalty');
        const baseRate = settings.pointsPerDollar || 1;
        const multiplier = resolveEffectivePointsMultiplier(tier, settings);
        const pointsEarned = Math.floor(subtotal * baseRate * multiplier);
        if (pointsEarned <= 0) return { earned: false, pointsEarned: 0 };

        await adjustLoyaltyPoints(pool, userId, pointsEarned, {
            source,
            orderId,
            transactionType: 'earn',
            description: `Earned ${pointsEarned} points (${baseRate} per $1${multiplier > 1 ? ` × ${multiplier} tier bonus` : ''}) on order #${orderId}`,
        });
        return { earned: true, pointsEarned, pointsMultiplier: multiplier };
    }

    const cashbackPercent = resolveEffectiveCashbackPercent(tier, metrics, settings);
    if (cashbackPercent <= 0) {
        return { earned: false, reason: 'zero_cashback_rate', cashbackPercent: 0 };
    }

    const cashEarned = roundMoney(subtotal * (cashbackPercent / 100));
    if (cashEarned <= 0) {
        return { earned: false, cashEarned: 0, cashbackPercent };
    }

    const { adjustLoyaltyCash } = require('./customerLoyalty');
    await adjustLoyaltyCash(pool, userId, cashEarned, {
        source,
        orderId,
        transactionType: 'earn',
        description: `Earned $${cashEarned.toFixed(2)} store credit (${cashbackPercent}% on $${subtotal.toFixed(2)})`,
    });
    return { earned: true, cashEarned, cashbackPercent };
}

const evaluateTierForAccount = (account, settings, tiers) =>
    evaluateTierFromMetrics(tiers, account, settings?.programMode ?? settings?.mode);
const computeTierProgress = (account, settings, tiers, currentTierKey) => {
    const nxt = nextTier(tiers, currentTierKey);
    const pct = progressTowardTier(account, nxt, settings?.programMode ?? settings?.mode);
    return { progressPercent: pct.percent, nextTier: nxt };
};
const findNextTier = nextTier;
const thresholdMet = (actual, minimum) => {
    const min = Number(minimum) || 0;
    if (min <= 0) return true;
    return Number(actual) >= min;
};

module.exports = {
    roundMoney,
    programMode,
    isPointsMode,
    isCashMode,
    isCashbackMode: isCashMode,
    tierQualificationSpend,
    tierQualificationOrders,
    tierQualificationPoints,
    meetsThreshold,
    thresholdMet,
    evaluateTierFromMetrics,
    evaluateTierForAccount,
    evaluateCustomerTier,
    nextTier,
    findNextTier,
    progressTowardTier,
    computeTierProgress,
    resolveEffectiveDiscountPercent,
    resolveEffectiveCashbackPercent,
    resolveEffectivePointsMultiplier,
    loadCustomerMetrics,
    recalculateCustomerTier,
    recalculateAllCustomerTiers,
    earnTierRewardsForOrder,
};
