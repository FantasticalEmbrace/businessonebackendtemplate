'use strict';

const SETTING_ENABLED = 'loyalty_program_enabled';
const SETTING_CASH_ENABLED = 'loyalty_cash_enabled';
const SETTING_POINTS_ENABLED = 'loyalty_points_enabled';
const SETTING_CASHBACK_PERCENT = 'loyalty_cashback_percent';
const SETTING_POINTS_PER_DOLLAR = 'loyalty_points_per_dollar';
const SETTING_DOLLAR_PER_POINT = 'loyalty_dollar_per_point';

const VALID_ENROLLMENTS = new Set(['cash', 'points', 'both']);

function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
}

function parseBoolSetting(raw, defaultTrue = true) {
    const v = String(raw ?? (defaultTrue ? 'true' : 'false')).trim().toLowerCase();
    return v !== 'false' && v !== '0';
}

async function loadLoyaltyProgramSettings(pool) {
    try {
        const [rows] = await pool.execute(
            `SELECT key_name, value FROM settings
             WHERE key_name IN (?, ?, ?, ?, ?, ?)`,
            [
                SETTING_ENABLED,
                SETTING_CASH_ENABLED,
                SETTING_POINTS_ENABLED,
                SETTING_CASHBACK_PERCENT,
                SETTING_POINTS_PER_DOLLAR,
                SETTING_DOLLAR_PER_POINT
            ]
        );
        const map = new Map((rows || []).map((r) => [r.key_name, r.value]));
        const masterEnabled = parseBoolSetting(map.get(SETTING_ENABLED), true);
        const cashEnabled = masterEnabled && parseBoolSetting(map.get(SETTING_CASH_ENABLED), true);
        const pointsEnabled = masterEnabled && parseBoolSetting(map.get(SETTING_POINTS_ENABLED), true);
        let cashbackPercent = Number(map.get(SETTING_CASHBACK_PERCENT));
        if (!Number.isFinite(cashbackPercent) || cashbackPercent < 0) cashbackPercent = 5;
        if (cashbackPercent > 50) cashbackPercent = 50;
        let pointsPerDollar = Number(map.get(SETTING_POINTS_PER_DOLLAR));
        if (!Number.isFinite(pointsPerDollar) || pointsPerDollar <= 0) pointsPerDollar = 1;
        let dollarPerPoint = Number(map.get(SETTING_DOLLAR_PER_POINT));
        if (!Number.isFinite(dollarPerPoint) || dollarPerPoint <= 0) dollarPerPoint = 0.01;
        return {
            enabled: masterEnabled && (cashEnabled || pointsEnabled),
            cashEnabled,
            pointsEnabled,
            cashbackPercent,
            pointsPerDollar,
            dollarPerPoint
        };
    } catch {
        return {
            enabled: true,
            cashEnabled: true,
            pointsEnabled: true,
            cashbackPercent: 5,
            pointsPerDollar: 1,
            dollarPerPoint: 0.01
        };
    }
}

function pointsToDollars(points, settings) {
    const pts = Math.max(0, Math.floor(Number(points) || 0));
    const rate = settings?.dollarPerPoint ?? 0.01;
    return roundMoney(pts * rate);
}

function dollarsToPoints(dollars, settings) {
    const rate = settings?.dollarPerPoint ?? 0.01;
    if (rate <= 0) return 0;
    return Math.floor(roundMoney(Number(dollars) || 0) / rate);
}

function resolveEarnFlags(enrollment, settings) {
    const enroll = VALID_ENROLLMENTS.has(enrollment) ? enrollment : 'cash';
    const earnCash = Boolean(settings?.cashEnabled) && (enroll === 'cash' || enroll === 'both');
    const earnPoints = Boolean(settings?.pointsEnabled) && (enroll === 'points' || enroll === 'both');
    return { enrollment: enroll, earnCash, earnPoints };
}

async function ensureLoyaltyRow(connection, userId) {
    const [[loyalty]] = await connection.execute(
        'SELECT * FROM customer_loyalty WHERE user_id = ? FOR UPDATE',
        [userId]
    );
    if (!loyalty) {
        await connection.execute(
            `INSERT INTO customer_loyalty (user_id, points_balance, cash_balance, loyalty_enrollment, member_since)
             VALUES (?, 0, 0, 'cash', CURDATE())`,
            [userId]
        );
    }
    const [[fresh]] = await connection.execute(
        'SELECT * FROM customer_loyalty WHERE user_id = ?',
        [userId]
    );
    return fresh;
}

async function insertLoyaltyTransaction(connection, {
    userId,
    transactionType,
    rewardType,
    pointsChange,
    pointsBalanceAfter,
    cashChange,
    cashBalanceAfter,
    source,
    orderId,
    description,
    adminUserId,
    metadata
}) {
    await connection.execute(
        `INSERT INTO loyalty_transactions
            (user_id, transaction_type, reward_type, points_change, points_balance_after,
             cash_change, cash_balance_after, source, order_id, description, admin_user_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            transactionType,
            rewardType,
            Math.trunc(pointsChange || 0),
            pointsBalanceAfter,
            roundMoney(cashChange || 0),
            cashBalanceAfter != null ? roundMoney(cashBalanceAfter) : null,
            source,
            orderId,
            description || null,
            adminUserId || null,
            metadata ? JSON.stringify(metadata) : null
        ]
    );
}

async function adjustLoyaltyPoints(pool, userId, pointsChange, options = {}) {
    const {
        description,
        adminUserId,
        source = 'manual',
        orderId = null,
        metadata = null,
        transactionType = null
    } = options;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const fresh = await ensureLoyaltyRow(conn, userId);
        const change = Math.trunc(Number(pointsChange) || 0);
        const newBalance = Math.max(0, (fresh.points_balance || 0) + change);
        const earnedDelta = change > 0 ? change : 0;
        const redeemedDelta = change < 0 ? Math.abs(change) : 0;

        await conn.execute(
            `UPDATE customer_loyalty
                SET points_balance = ?,
                    lifetime_points_earned = lifetime_points_earned + ?,
                    lifetime_points_redeemed = lifetime_points_redeemed + ?,
                    last_earned_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_earned_at END,
                    last_redeemed_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_redeemed_at END,
                    last_synced_at = CURRENT_TIMESTAMP,
                    sync_status = 'synced'
              WHERE user_id = ?`,
            [newBalance, earnedDelta, redeemedDelta, earnedDelta, redeemedDelta, userId]
        );

        let txType = transactionType;
        if (!txType) {
            if (source === 'manual') txType = 'adjust';
            else txType = change >= 0 ? 'earn' : 'redeem';
        }

        await insertLoyaltyTransaction(conn, {
            userId,
            transactionType: txType,
            rewardType: 'points',
            pointsChange: change,
            pointsBalanceAfter: newBalance,
            cashChange: 0,
            cashBalanceAfter: roundMoney(fresh.cash_balance || 0),
            source,
            orderId,
            description,
            adminUserId,
            metadata
        });

        await conn.commit();
        return { success: true, newBalance, pointsChange: change };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function adjustLoyaltyCash(pool, userId, cashChange, options = {}) {
    const {
        description,
        adminUserId,
        source = 'manual',
        orderId = null,
        metadata = null,
        transactionType = null
    } = options;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const fresh = await ensureLoyaltyRow(conn, userId);
        const change = roundMoney(cashChange);
        const newBalance = roundMoney(Math.max(0, roundMoney(fresh.cash_balance || 0) + change));
        const earnedDelta = change > 0 ? change : 0;
        const redeemedDelta = change < 0 ? Math.abs(change) : 0;

        await conn.execute(
            `UPDATE customer_loyalty
                SET cash_balance = ?,
                    lifetime_cash_earned = lifetime_cash_earned + ?,
                    lifetime_cash_redeemed = lifetime_cash_redeemed + ?,
                    last_earned_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_earned_at END,
                    last_redeemed_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_redeemed_at END,
                    last_synced_at = CURRENT_TIMESTAMP,
                    sync_status = 'synced'
              WHERE user_id = ?`,
            [newBalance, earnedDelta, redeemedDelta, earnedDelta, redeemedDelta, userId]
        );

        let txType = transactionType;
        if (!txType) {
            if (source === 'manual') txType = 'adjust';
            else txType = change >= 0 ? 'earn' : 'redeem';
        }

        await insertLoyaltyTransaction(conn, {
            userId,
            transactionType: txType,
            rewardType: 'cash',
            pointsChange: 0,
            pointsBalanceAfter: fresh.points_balance || 0,
            cashChange: change,
            cashBalanceAfter: newBalance,
            source,
            orderId,
            description,
            adminUserId,
            metadata
        });

        await conn.commit();
        return { success: true, newBalance, cashChange: change };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function setLoyaltyEnrollment(pool, userId, enrollment) {
    const enroll = String(enrollment || '').trim().toLowerCase();
    if (!VALID_ENROLLMENTS.has(enroll)) {
        const err = new Error('INVALID_LOYALTY_ENROLLMENT');
        err.code = 'INVALID_LOYALTY_ENROLLMENT';
        throw err;
    }
    await ensureLoyaltyRow(pool, userId);
    await pool.execute(
        `UPDATE customer_loyalty SET loyalty_enrollment = ?, last_synced_at = CURRENT_TIMESTAMP, sync_status = 'synced'
          WHERE user_id = ?`,
        [enroll, userId]
    );
    return { enrollment: enroll };
}

async function redeemLoyaltyCash(connection, userId, amountToRedeem, orderId, settings, source = 'pos') {
    const settingsResolved = settings || (await loadLoyaltyProgramSettings(connection));
    if (!settingsResolved.cashEnabled) {
        const err = new Error('LOYALTY_CASH_DISABLED');
        err.code = 'LOYALTY_CASH_DISABLED';
        throw err;
    }

    const amount = roundMoney(amountToRedeem);
    if (amount <= 0) {
        return { cashRedeemed: 0, newBalance: null };
    }

    const fresh = await ensureLoyaltyRow(connection, userId);
    const balance = roundMoney(fresh.cash_balance || 0);
    if (amount > balance + 0.0001) {
        const err = new Error('INSUFFICIENT_LOYALTY_CASH');
        err.code = 'INSUFFICIENT_LOYALTY_CASH';
        err.balance = balance;
        throw err;
    }

    const newBalance = roundMoney(balance - amount);

    await connection.execute(
        `UPDATE customer_loyalty
            SET cash_balance = ?,
                lifetime_cash_redeemed = lifetime_cash_redeemed + ?,
                last_redeemed_at = CURRENT_TIMESTAMP,
                last_synced_at = CURRENT_TIMESTAMP,
                sync_status = 'synced'
          WHERE user_id = ?`,
        [newBalance, amount, userId]
    );

    await insertLoyaltyTransaction(connection, {
        userId,
        transactionType: 'redeem',
        rewardType: 'cash',
        pointsChange: 0,
        pointsBalanceAfter: fresh.points_balance || 0,
        cashChange: -amount,
        cashBalanceAfter: newBalance,
        source,
        orderId,
        description: `Redeemed $${amount.toFixed(2)} store credit on order #${orderId}`
    });

    return { cashRedeemed: amount, newBalance };
}

async function redeemLoyaltyPoints(connection, userId, pointsToRedeem, orderId, settings, source = 'pos') {
    const settingsResolved = settings || (await loadLoyaltyProgramSettings(connection));
    if (!settingsResolved.pointsEnabled) {
        const err = new Error('LOYALTY_POINTS_DISABLED');
        err.code = 'LOYALTY_POINTS_DISABLED';
        throw err;
    }

    const points = Math.max(0, Math.floor(Number(pointsToRedeem) || 0));
    if (points <= 0) {
        return { pointsRedeemed: 0, dollarValue: 0, newBalance: null };
    }

    const fresh = await ensureLoyaltyRow(connection, userId);
    const balance = Number(fresh.points_balance) || 0;
    if (points > balance) {
        const err = new Error('INSUFFICIENT_LOYALTY_POINTS');
        err.code = 'INSUFFICIENT_LOYALTY_POINTS';
        err.balance = balance;
        throw err;
    }

    const dollarValue = pointsToDollars(points, settingsResolved);
    const newBalance = balance - points;

    await connection.execute(
        `UPDATE customer_loyalty
            SET points_balance = ?,
                lifetime_points_redeemed = lifetime_points_redeemed + ?,
                last_redeemed_at = CURRENT_TIMESTAMP,
                last_synced_at = CURRENT_TIMESTAMP,
                sync_status = 'synced'
          WHERE user_id = ?`,
        [newBalance, points, userId]
    );

    await insertLoyaltyTransaction(connection, {
        userId,
        transactionType: 'redeem',
        rewardType: 'points',
        pointsChange: -points,
        pointsBalanceAfter: newBalance,
        cashChange: 0,
        cashBalanceAfter: roundMoney(fresh.cash_balance || 0),
        source,
        orderId,
        description: `Redeemed ${points} points ($${dollarValue.toFixed(2)}) on order #${orderId}`
    });

    return { pointsRedeemed: points, dollarValue, newBalance };
}

async function earnCashForOrder(connection, userId, orderId, eligibleSubtotal, settings, source = 'pos') {
    if (!settings?.cashEnabled) return { cashEarned: 0, newBalance: null };

    const subtotal = roundMoney(eligibleSubtotal);
    if (subtotal <= 0) return { cashEarned: 0, newBalance: null };

    const pct = Number(settings.cashbackPercent) || 0;
    if (pct <= 0) return { cashEarned: 0, newBalance: null };

    const cashEarned = roundMoney(subtotal * (pct / 100));
    if (cashEarned <= 0) return { cashEarned: 0, newBalance: null };

    const fresh = await ensureLoyaltyRow(connection, userId);
    const newBalance = roundMoney(roundMoney(fresh.cash_balance || 0) + cashEarned);

    await connection.execute(
        `UPDATE customer_loyalty
            SET cash_balance = ?,
                lifetime_cash_earned = lifetime_cash_earned + ?,
                last_earned_at = CURRENT_TIMESTAMP,
                last_synced_at = CURRENT_TIMESTAMP,
                sync_status = 'synced'
          WHERE user_id = ?`,
        [newBalance, cashEarned, userId]
    );

    await insertLoyaltyTransaction(connection, {
        userId,
        transactionType: 'earn',
        rewardType: 'cash',
        pointsChange: 0,
        pointsBalanceAfter: fresh.points_balance || 0,
        cashChange: cashEarned,
        cashBalanceAfter: newBalance,
        source,
        orderId,
        description: `Earned $${cashEarned.toFixed(2)} store credit (${pct}% on $${subtotal.toFixed(2)})`
    });

    return { cashEarned, newBalance };
}

async function earnPointsForOrder(connection, userId, orderId, eligibleSubtotal, settings, source = 'pos') {
    if (!settings?.pointsEnabled) return { pointsEarned: 0, newBalance: null };

    const subtotal = roundMoney(eligibleSubtotal);
    if (subtotal <= 0) return { pointsEarned: 0, newBalance: null };

    const pointsEarned = Math.floor(subtotal * settings.pointsPerDollar);
    if (pointsEarned <= 0) return { pointsEarned: 0, newBalance: null };

    const fresh = await ensureLoyaltyRow(connection, userId);
    const newBalance = (Number(fresh.points_balance) || 0) + pointsEarned;

    await connection.execute(
        `UPDATE customer_loyalty
            SET points_balance = ?,
                lifetime_points_earned = lifetime_points_earned + ?,
                last_earned_at = CURRENT_TIMESTAMP,
                last_synced_at = CURRENT_TIMESTAMP,
                sync_status = 'synced'
          WHERE user_id = ?`,
        [newBalance, pointsEarned, userId]
    );

    await insertLoyaltyTransaction(connection, {
        userId,
        transactionType: 'earn',
        rewardType: 'points',
        pointsChange: pointsEarned,
        pointsBalanceAfter: newBalance,
        cashChange: 0,
        cashBalanceAfter: roundMoney(fresh.cash_balance || 0),
        source,
        orderId,
        description: `Earned ${pointsEarned} points on $${subtotal.toFixed(2)} purchase`
    });

    return { pointsEarned, newBalance };
}

async function earnLoyaltyForOrder(connection, userId, orderId, eligibleSubtotal, settings, source = 'pos') {
    const settingsResolved = settings || (await loadLoyaltyProgramSettings(connection));
    if (!settingsResolved.enabled) {
        return { pointsEarned: 0, cashEarned: 0, newPointsBalance: null, newCashBalance: null };
    }

    const fresh = await ensureLoyaltyRow(connection, userId);
    const { earnCash, earnPoints } = resolveEarnFlags(fresh.loyalty_enrollment, settingsResolved);

    let pointsResult = { pointsEarned: 0, newBalance: null };
    let cashResult = { cashEarned: 0, newBalance: null };

    if (earnCash) {
        cashResult = await earnCashForOrder(connection, userId, orderId, eligibleSubtotal, settingsResolved, source);
    }
    if (earnPoints) {
        pointsResult = await earnPointsForOrder(connection, userId, orderId, eligibleSubtotal, settingsResolved, source);
    }

    return {
        pointsEarned: pointsResult.pointsEarned,
        cashEarned: cashResult.cashEarned,
        newPointsBalance: pointsResult.newBalance,
        newCashBalance: cashResult.newBalance
    };
}

module.exports = {
    SETTING_ENABLED,
    SETTING_CASH_ENABLED,
    SETTING_POINTS_ENABLED,
    SETTING_CASHBACK_PERCENT,
    SETTING_POINTS_PER_DOLLAR,
    SETTING_DOLLAR_PER_POINT,
    VALID_ENROLLMENTS,
    loadLoyaltyProgramSettings,
    pointsToDollars,
    dollarsToPoints,
    resolveEarnFlags,
    adjustLoyaltyPoints,
    adjustLoyaltyCash,
    setLoyaltyEnrollment,
    redeemLoyaltyCash,
    redeemLoyaltyPoints,
    earnCashForOrder,
    earnPointsForOrder,
    earnLoyaltyForOrder
};
