'use strict';

const TIER_KEYS = ['bronze', 'silver', 'gold', 'platinum'];

/** discount_percent = tier marketing/estimate rate (emails + checkout estimates). Live credit posts use loyalty_cashback_percent. */
const DEFAULT_TIERS = [
    {
        tier_key: 'bronze',
        display_name: 'Bronze',
        sort_order: 1,
        min_lifetime_spend: 0,
        min_order_count: 0,
        min_points: 0,
        require_both_spend_and_orders: 0,
        discount_percent: 0,
        free_shipping: 0,
        free_shipping_min_order: null,
        frequency_bonus_percent: 0,
        perks_json: { birthday_bonus: false, referral_hook: true },
    },
    {
        tier_key: 'silver',
        display_name: 'Silver',
        sort_order: 2,
        min_lifetime_spend: 250,
        min_order_count: 3,
        min_points: 500,
        require_both_spend_and_orders: 0,
        discount_percent: 2,
        free_shipping: 0,
        free_shipping_min_order: null,
        frequency_bonus_percent: 0.5,
        perks_json: { birthday_bonus: true },
    },
    {
        tier_key: 'gold',
        display_name: 'Gold',
        sort_order: 3,
        min_lifetime_spend: 750,
        min_order_count: 8,
        min_points: 2000,
        require_both_spend_and_orders: 0,
        discount_percent: 5,
        free_shipping: 1,
        free_shipping_min_order: 50,
        frequency_bonus_percent: 1,
        perks_json: { birthday_bonus: true, tier_anniversary: true },
    },
    {
        tier_key: 'platinum',
        display_name: 'Platinum',
        sort_order: 4,
        min_lifetime_spend: 2000,
        min_order_count: 15,
        min_points: 7500,
        require_both_spend_and_orders: 1,
        discount_percent: 10,
        free_shipping: 1,
        free_shipping_min_order: 0,
        frequency_bonus_percent: 3,
        perks_json: { birthday_bonus: true, tier_anniversary: true, priority_support: true },
    },
];

const SETTING_KEYS = {
    enabled: 'loyalty_tiers_enabled',
    enabledAt: 'loyalty_tiers_enabled_at',
    programMode: 'loyalty_tiers_program_mode',
    mode: 'loyalty_tiers_mode',
    emailNear: 'loyalty_tiers_email_near_enabled',
    emailPromotion: 'loyalty_tiers_email_promotion_enabled',
    emailWinback: 'loyalty_tiers_email_winback_enabled',
    nearThreshold: 'loyalty_tiers_near_threshold_percent',
    winbackDays: 'loyalty_tiers_winback_days',
    pointsPerDollar: 'loyalty_tiers_points_per_dollar',
    dollarPerPoint: 'loyalty_tiers_dollar_per_point',
    combinedBonus: 'loyalty_tiers_combined_spend_frequency_bonus',
    minCashbackRedeem: 'loyalty_tiers_min_cashback_redeem',
    birthdayEnabled: 'loyalty_tiers_birthday_enabled',
    referralEnabled: 'loyalty_tiers_referral_enabled',
    /** Flat store-credit earn rate posted on paid orders (customerLoyalty). */
    flatCashbackPercent: 'loyalty_cashback_percent',
};

function normalizeProgramMode(raw, legacyRaw) {
    const v = String(raw ?? legacyRaw ?? 'cash').trim().toLowerCase();
    if (v === 'points') return 'points';
    if (v === 'cashback') return 'cash';
    if (v === 'cash' || v === 'spend') return 'cash';
    return 'cash';
}

function programModeToLegacy(mode) {
    return mode === 'points' ? 'points' : 'spend';
}

function parseBool(raw, defaultTrue = false) {
    if (raw == null || raw === '') return defaultTrue;
    const v = String(raw).trim().toLowerCase();
    return v !== 'false' && v !== '0';
}

function roundMoney(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

function rowToTier(row) {
    if (!row) return null;
    let perks = {};
    try {
        perks = row.perks_json
            ? typeof row.perks_json === 'object'
                ? row.perks_json
                : JSON.parse(row.perks_json)
            : {};
    } catch {
        perks = {};
    }
    const rate = roundMoney(row.discount_percent);
    return {
        id: row.id,
        tierKey: row.tier_key,
        displayName: row.display_name,
        sortOrder: row.sort_order,
        minLifetimeSpend: roundMoney(row.min_lifetime_spend),
        minOrderCount: Number(row.min_order_count) || 0,
        minPoints: Number(row.min_points) || 0,
        requireBothSpendAndOrders: Boolean(row.require_both_spend_and_orders),
        discountPercent: rate,
        cashbackPercent: rate,
        freeShipping: Boolean(row.free_shipping),
        freeShippingMinOrder:
            row.free_shipping_min_order != null ? roundMoney(row.free_shipping_min_order) : null,
        frequencyBonusPercent: roundMoney(row.frequency_bonus_percent),
        perks,
        isActive: Boolean(row.is_active),
    };
}

async function loadSettingsMap(pool) {
    const keys = Object.values(SETTING_KEYS);
    const [rows] = await pool.execute(
        `SELECT key_name, value FROM settings WHERE key_name IN (${keys.map(() => '?').join(',')})`,
        keys
    );
    return new Map((rows || []).map((r) => [r.key_name, r.value]));
}

async function getProgramSettings(pool) {
    const map = await loadSettingsMap(pool);
    const programMode = normalizeProgramMode(
        map.get(SETTING_KEYS.programMode),
        map.get(SETTING_KEYS.mode)
    );

    let nearPct = Number(map.get(SETTING_KEYS.nearThreshold));
    if (!Number.isFinite(nearPct) || nearPct < 50) nearPct = 85;
    if (nearPct > 99) nearPct = 99;

    let winbackDays = Number(map.get(SETTING_KEYS.winbackDays));
    if (!Number.isFinite(winbackDays) || winbackDays < 14) winbackDays = 60;

    let pointsPerDollar = Number(map.get(SETTING_KEYS.pointsPerDollar));
    if (!Number.isFinite(pointsPerDollar) || pointsPerDollar <= 0) pointsPerDollar = 1;

    let dollarPerPoint = Number(map.get(SETTING_KEYS.dollarPerPoint));
    if (!Number.isFinite(dollarPerPoint) || dollarPerPoint <= 0) dollarPerPoint = 0.01;

    let minCashbackRedeem = Number(map.get(SETTING_KEYS.minCashbackRedeem));
    if (!Number.isFinite(minCashbackRedeem) || minCashbackRedeem < 0) minCashbackRedeem = 0;

    let cashbackPercent = Number(map.get(SETTING_KEYS.flatCashbackPercent));
    if (!Number.isFinite(cashbackPercent) || cashbackPercent < 0) cashbackPercent = 5;
    if (cashbackPercent > 50) cashbackPercent = 50;

    return {
        enabled: parseBool(map.get(SETTING_KEYS.enabled), false),
        programMode,
        mode: programModeToLegacy(programMode),
        emailNearEnabled: parseBool(map.get(SETTING_KEYS.emailNear), true),
        emailPromotionEnabled: parseBool(map.get(SETTING_KEYS.emailPromotion), true),
        emailWinbackEnabled: parseBool(map.get(SETTING_KEYS.emailWinback), true),
        nearThresholdPercent: nearPct,
        nearTierThresholdPercent: nearPct,
        winbackDays,
        winbackDaysInactive: winbackDays,
        pointsPerDollar,
        dollarPerPoint,
        minCashbackRedeem,
        cashbackPercent,
        combinedSpendFrequencyBonus: parseBool(map.get(SETTING_KEYS.combinedBonus), true),
        birthdayEnabled: parseBool(map.get(SETTING_KEYS.birthdayEnabled), false),
        referralEnabled: parseBool(map.get(SETTING_KEYS.referralEnabled), false),
    };
}

async function recordProgramEnabledAt(pool, at = new Date()) {
    const d = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(d.getTime())) {
        const err = new Error('INVALID_ENABLED_AT');
        err.code = 'INVALID_ENABLED_AT';
        throw err;
    }
    const iso = d.toISOString();
    await pool.execute(
        `INSERT INTO settings (key_name, value, type) VALUES (?, ?, 'string')
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [SETTING_KEYS.enabledAt, iso]
    );
    return iso;
}

async function getProgramEnabledAt(pool) {
    const map = await loadSettingsMap(pool);
    const raw = map.get(SETTING_KEYS.enabledAt);
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

async function saveProgramSettings(pool, body) {
    const updates = [];

    if ('enabled' in body) updates.push([SETTING_KEYS.enabled, body.enabled ? 'true' : 'false']);

    if ('programMode' in body || 'mode' in body) {
        const programMode = normalizeProgramMode(body.programMode, body.mode);
        updates.push([SETTING_KEYS.programMode, programMode]);
        updates.push([SETTING_KEYS.mode, programModeToLegacy(programMode)]);
    }

    if ('emailNearEnabled' in body) {
        updates.push([SETTING_KEYS.emailNear, body.emailNearEnabled ? 'true' : 'false']);
    }
    if ('emailPromotionEnabled' in body) {
        updates.push([SETTING_KEYS.emailPromotion, body.emailPromotionEnabled ? 'true' : 'false']);
    }
    if ('emailWinbackEnabled' in body) {
        updates.push([SETTING_KEYS.emailWinback, body.emailWinbackEnabled ? 'true' : 'false']);
    }
    if ('nearThresholdPercent' in body) {
        updates.push([
            SETTING_KEYS.nearThreshold,
            String(Math.min(99, Math.max(50, Number(body.nearThresholdPercent) || 85))),
        ]);
    }
    if ('winbackDays' in body) {
        updates.push([SETTING_KEYS.winbackDays, String(Math.max(14, Number(body.winbackDays) || 60))]);
    }
    if ('pointsPerDollar' in body) {
        updates.push([SETTING_KEYS.pointsPerDollar, String(Math.max(0.1, Number(body.pointsPerDollar) || 1))]);
    }
    if ('dollarPerPoint' in body) {
        updates.push([SETTING_KEYS.dollarPerPoint, String(Math.max(0.001, Number(body.dollarPerPoint) || 0.01))]);
    }
    if ('minCashbackRedeem' in body) {
        updates.push([
            SETTING_KEYS.minCashbackRedeem,
            String(Math.max(0, Number(body.minCashbackRedeem) || 0)),
        ]);
    }
        if ('cashbackPercent' in body || 'flatCashbackPercent' in body) {
        let pct = Number(body.cashbackPercent ?? body.flatCashbackPercent);
        if (!Number.isFinite(pct) || pct < 0) pct = 5;
        if (pct > 50) pct = 50;
        updates.push([SETTING_KEYS.flatCashbackPercent, String(pct)]);
    }
if ('combinedSpendFrequencyBonus' in body) {
        updates.push([SETTING_KEYS.combinedBonus, body.combinedSpendFrequencyBonus ? 'true' : 'false']);
    }
    if ('nearTierThresholdPercent' in body) {
        updates.push([
            SETTING_KEYS.nearThreshold,
            String(Math.min(99, Math.max(50, Number(body.nearTierThresholdPercent) || 85))),
        ]);
    }
    if ('winbackDaysInactive' in body) {
        updates.push([SETTING_KEYS.winbackDays, String(Math.max(14, Number(body.winbackDaysInactive) || 60))]);
    }
    if ('birthdayEnabled' in body) {
        updates.push([SETTING_KEYS.birthdayEnabled, body.birthdayEnabled ? 'true' : 'false']);
    }
    if ('referralEnabled' in body) {
        updates.push([SETTING_KEYS.referralEnabled, body.referralEnabled ? 'true' : 'false']);
    }

    for (const [key, value] of updates) {
        await pool.execute(
            `INSERT INTO settings (key_name, value, type) VALUES (?, ?, 'string')
             ON DUPLICATE KEY UPDATE value = VALUES(value)`,
            [key, value]
        );
    }

    const current = await getProgramSettings(pool);
    if (
        current.programMode === 'points' &&
        ('pointsPerDollar' in body || 'dollarPerPoint' in body)
    ) {
        await syncPointsEarnSettings(pool, {
            pointsPerDollar: body.pointsPerDollar ?? current.pointsPerDollar,
            dollarPerPoint: body.dollarPerPoint ?? current.dollarPerPoint,
        });
    }

    return getProgramSettings(pool);
}

function formatTierForAdmin(tier, programMode) {
    if (!tier) return null;
    return {
        ...tier,
        minSpend: tier.minLifetimeSpend,
        minOrders: tier.minOrderCount,
        requiresBothGoals: Boolean(tier.requireBothSpendAndOrders),
    };
}

async function syncPointsEarnSettings(pool, { pointsPerDollar, dollarPerPoint } = {}) {
    const sync = [];
    if (pointsPerDollar != null) {
        sync.push(['loyalty_points_per_dollar', String(Math.max(0.1, Number(pointsPerDollar) || 1))]);
    }
    if (dollarPerPoint != null) {
        sync.push(['loyalty_dollar_per_point', String(Math.max(0.001, Number(dollarPerPoint) || 0.01))]);
    }
    for (const [key, value] of sync) {
        await pool.execute(
            `INSERT INTO settings (key_name, value, type) VALUES (?, ?, 'string')
             ON DUPLICATE KEY UPDATE value = VALUES(value)`,
            [key, value]
        );
    }
}

async function listTiers(pool, { activeOnly = false } = {}) {
    const where = activeOnly ? 'WHERE is_active = 1' : '';
    const [rows] = await pool.execute(
        `SELECT * FROM loyalty_tiers ${where} ORDER BY sort_order ASC, id ASC`
    );
    return (rows || []).map(rowToTier);
}

async function getTierByKey(pool, tierKey) {
    const [rows] = await pool.execute('SELECT * FROM loyalty_tiers WHERE tier_key = ? LIMIT 1', [
        String(tierKey).toLowerCase(),
    ]);
    return rowToTier(rows[0]);
}

async function updateTier(pool, tierKey, body) {
    const key = String(tierKey).toLowerCase();
    if (!TIER_KEYS.includes(key)) {
        const err = new Error('Invalid tier key');
        err.code = 'INVALID_TIER';
        throw err;
    }

    if ('cashbackPercent' in body && !('discountPercent' in body)) {
        body.discountPercent = body.cashbackPercent;
    }
    if ('pointsMultiplier' in body && !('discountPercent' in body)) {
        body.discountPercent = body.pointsMultiplier;
    }
    if ('minSpend' in body && !('minLifetimeSpend' in body)) {
        body.minLifetimeSpend = body.minSpend;
    }
    if ('minOrders' in body && !('minOrderCount' in body)) {
        body.minOrderCount = body.minOrders;
    }
    if ('requiresBothGoals' in body && !('requireBothSpendAndOrders' in body)) {
        body.requireBothSpendAndOrders = body.requiresBothGoals;
    }

    const fields = [];
    const values = [];
    const map = {
        displayName: 'display_name',
        sortOrder: 'sort_order',
        minLifetimeSpend: 'min_lifetime_spend',
        minOrderCount: 'min_order_count',
        minPoints: 'min_points',
        requireBothSpendAndOrders: 'require_both_spend_and_orders',
        discountPercent: 'discount_percent',
        freeShipping: 'free_shipping',
        freeShippingMinOrder: 'free_shipping_min_order',
        frequencyBonusPercent: 'frequency_bonus_percent',
        isActive: 'is_active',
    };

    for (const [jsKey, col] of Object.entries(map)) {
        if (jsKey in body) {
            let val = body[jsKey];
            if (['requireBothSpendAndOrders', 'freeShipping', 'isActive'].includes(jsKey)) {
                val = val ? 1 : 0;
            }
            if (
                ['minLifetimeSpend', 'discountPercent', 'freeShippingMinOrder', 'frequencyBonusPercent'].includes(
                    jsKey
                )
            ) {
                val = val == null || val === '' ? null : roundMoney(val);
            }
            fields.push(`${col} = ?`);
            values.push(val);
        }
    }

    if ('perks' in body) {
        fields.push('perks_json = ?');
        values.push(JSON.stringify(body.perks || {}));
    }

    if (!fields.length) return getTierByKey(pool, key);

    values.push(key);
    await pool.execute(`UPDATE loyalty_tiers SET ${fields.join(', ')} WHERE tier_key = ?`, values);
    return getTierByKey(pool, key);
}

async function seedDefaultTiersIfEmpty(pool) {
    const [rows] = await pool.execute('SELECT COUNT(*) AS c FROM loyalty_tiers');
    if (Number(rows[0]?.c) > 0) return false;

    for (const tier of DEFAULT_TIERS) {
        await pool.execute(
            `INSERT INTO loyalty_tiers (
                tier_key, display_name, sort_order, min_lifetime_spend, min_order_count, min_points,
                require_both_spend_and_orders, discount_percent, free_shipping, free_shipping_min_order,
                frequency_bonus_percent, perks_json, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                tier.tier_key,
                tier.display_name,
                tier.sort_order,
                tier.min_lifetime_spend,
                tier.min_order_count,
                tier.min_points,
                tier.require_both_spend_and_orders,
                tier.discount_percent,
                tier.free_shipping,
                tier.free_shipping_min_order,
                tier.frequency_bonus_percent,
                JSON.stringify(tier.perks_json || {}),
            ]
        );
    }
    return true;
}

/** Fix known bad tier counts from a partial UI restore (Gold 5 / Platinum 7 → 8 / 15). */
async function repairKnownTierDefaultDrift(pool) {
    await pool.execute(
        `UPDATE loyalty_tiers SET min_order_count = 8 WHERE tier_key = 'gold' AND min_order_count = 5`
    );
    await pool.execute(
        `UPDATE loyalty_tiers
            SET min_order_count = 15, require_both_spend_and_orders = 1
          WHERE tier_key = 'platinum' AND min_order_count = 7`
    );
}

async function getLoyaltyCustomerSummary(pool, { search = '', tier = '' } = {}) {
    const where = ['u.customer_status != ?'];
    const params = ['deleted'];

    if (search) {
        where.push('(u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)');
        const q = `%${search}%`;
        params.push(q, q, q);
    }
    if (tier) {
        where.push('COALESCE(cl.tier, ?) = ?');
        params.push('bronze', tier);
    }

    const whereSql = where.join(' AND ');
    const [[totalRow]] = await pool.execute(
        `SELECT COUNT(*) AS total
           FROM users u
           LEFT JOIN customer_loyalty cl ON cl.user_id = u.id
          WHERE ${whereSql}`,
        params
    );
    const [tierRows] = await pool.execute(
        `SELECT COALESCE(cl.tier, 'bronze') AS tier, COUNT(*) AS count
           FROM users u
           LEFT JOIN customer_loyalty cl ON cl.user_id = u.id
          WHERE ${whereSql}
          GROUP BY COALESCE(cl.tier, 'bronze')`,
        params
    );

    const tierOrder = ['bronze', 'silver', 'gold', 'platinum'];
    const sortedTierRows = (tierRows || []).sort((a, b) => {
        const ai = tierOrder.indexOf(a.tier);
        const bi = tierOrder.indexOf(b.tier);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const tierCounts = {};
    for (const row of sortedTierRows) {
        tierCounts[row.tier] = Number(row.count) || 0;
    }

    return {
        total: Number(totalRow?.total) || 0,
        tierCounts,
    };
}

async function listLoyaltyCustomers(pool, { search = '', tier = '', limit = 50, offset = 0 } = {}) {
    const where = ['u.customer_status != ?'];
    const params = ['deleted'];

    if (search) {
        where.push('(u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)');
        const q = `%${search}%`;
        params.push(q, q, q);
    }
    if (tier) {
        where.push('COALESCE(cl.tier, ?) = ?');
        params.push('bronze', tier);
    }

    const lim = Math.min(50, Math.max(1, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);

    const [rows] = await pool.execute(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.total_orders, u.lifetime_value, u.last_order_at,
                cl.tier, cl.points_balance, cl.cash_balance, cl.member_since, cl.tier_progress
           FROM users u
           LEFT JOIN customer_loyalty cl ON cl.user_id = u.id
          WHERE ${where.join(' AND ')}
          ORDER BY u.lifetime_value DESC, u.id DESC
          LIMIT ${lim} OFFSET ${off}`,
        params
    );

    return (rows || []).map((r) => ({
        userId: r.id,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || `Customer #${r.id}`,
        totalOrders: Number(r.total_orders) || 0,
        lifetimeSpend: roundMoney(r.lifetime_value),
        orderCount: Number(r.total_orders) || 0,
        lastOrderAt: r.last_order_at,
        tier: r.tier || 'bronze',
        currentTierKey: r.tier || 'bronze',
        pointsBalance: Number(r.points_balance) || 0,
        cashBalance: roundMoney(r.cash_balance),
        tierProgress: Number(r.tier_progress) || 0,
        memberSince: r.member_since,
    }));
}

module.exports = {
    TIER_KEYS,
    DEFAULT_TIERS,
    SETTING_KEYS,
    normalizeProgramMode,
    programModeToLegacy,
    formatTierForAdmin,
    syncPointsEarnSettings,
    getProgramSettings,
    getProgramEnabledAt,
    recordProgramEnabledAt,
    saveProgramSettings,
    listTiers,
    getTierByKey,
    updateTier,
    seedDefaultTiersIfEmpty,
    repairKnownTierDefaultDrift,
    listLoyaltyCustomers,
    getLoyaltyCustomerSummary,
    rowToTier,
};
