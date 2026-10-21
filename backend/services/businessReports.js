'use strict';

/**
 * Storefront / membership business reports for admin Reports → Business.
 * Date range is inclusive calendar days in America/Chicago-ish server local time
 * (MySQL DATE comparisons on DATETIME columns).
 */

function parseRange(query = {}) {
    const today = new Date();
    const defaultTo = today.toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 29 * 86400000);
    const defaultFrom = weekAgo.toISOString().slice(0, 10);

    let from = String(query.from || defaultFrom).slice(0, 10);
    let to = String(query.to || defaultTo).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = defaultFrom;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = defaultTo;
    if (from > to) {
        const tmp = from;
        from = to;
        to = tmp;
    }
    // Cap range length to keep queries light
    const fromMs = Date.parse(from + 'T00:00:00Z');
    const toMs = Date.parse(to + 'T00:00:00Z');
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs - fromMs > 366 * 86400000) {
        from = new Date(toMs - 365 * 86400000).toISOString().slice(0, 10);
    }
    return { from, to, fromStart: `${from} 00:00:00`, toEnd: `${to} 23:59:59` };
}

async function safeQuery(pool, sql, params, fallback) {
    try {
        const [rows] = await pool.execute(sql, params);
        return rows;
    } catch (err) {
        // Keep the report partial if an optional table/column is missing.
        if (process.env.NODE_ENV !== 'test') {
            // eslint-disable-next-line no-console
            console.warn('[businessReports] query failed:', err.code || err.message);
        }
        return fallback;
    }
}

async function getBusinessReport(pool, query = {}) {
    const { from, to, fromStart, toEnd } = parseRange(query);
    const rangeParams = [fromStart, toEnd];

    const membersRows = await safeQuery(
        pool,
        `SELECT
            COUNT(*) AS new_accounts,
            SUM(CASE WHEN marketing_email_opt_in = 1 THEN 1 ELSE 0 END) AS new_accounts_marketing_opt_in,
            SUM(CASE WHEN customer_status = 'vip' THEN 1 ELSE 0 END) AS new_vip
         FROM users
         WHERE created_at BETWEEN ? AND ?
           AND (is_active IS NULL OR is_active <> 0)`,
        rangeParams,
        [{ new_accounts: 0, new_accounts_marketing_opt_in: 0, new_vip: 0 }]
    );

    // Cash store-credit rewards activity (cash loyalty by default; points columns may also exist)
    const rewardsRows = await safeQuery(
        pool,
        `SELECT
            COALESCE(SUM(CASE WHEN cash_change > 0 THEN cash_change ELSE 0 END), 0) AS cash_earned,
            COALESCE(SUM(CASE WHEN cash_change < 0 THEN ABS(cash_change) ELSE 0 END), 0) AS cash_redeemed,
            COUNT(CASE WHEN cash_change > 0 THEN 1 END) AS earn_events,
            COUNT(CASE WHEN cash_change < 0 THEN 1 END) AS redeem_events
         FROM loyalty_transactions
         WHERE created_at BETWEEN ? AND ?`,
        rangeParams,
        [{ cash_earned: 0, cash_redeemed: 0, earn_events: 0, redeem_events: 0 }]
    );

    const rewardsBalanceRows = await safeQuery(
        pool,
        `SELECT COALESCE(SUM(cash_balance), 0) AS outstanding_cash_credit
         FROM customer_loyalty`,
        [],
        [{ outstanding_cash_credit: 0 }]
    );

    const subscriberRows = await safeQuery(
        pool,
        `SELECT
            COUNT(*) AS new_newsletter_subscribers,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_in_range
         FROM email_subscribers
         WHERE subscribed_at BETWEEN ? AND ?`,
        rangeParams,
        [{ new_newsletter_subscribers: 0, active_in_range: 0 }]
    );

    const orderRows = await safeQuery(
        pool,
        `SELECT
            COUNT(*) AS paid_orders,
            COALESCE(SUM(total_amount), 0) AS revenue,
            COALESCE(AVG(total_amount), 0) AS avg_order_value,
            SUM(CASE WHEN COALESCE(sales_channel, 'online') = 'online' THEN 1 ELSE 0 END) AS online_orders,
            SUM(CASE WHEN COALESCE(sales_channel, 'online') IN ('pos', 'in_store', 'instore') THEN 1 ELSE 0 END) AS in_store_orders,
            COALESCE(SUM(CASE WHEN COALESCE(sales_channel, 'online') = 'online' THEN total_amount ELSE 0 END), 0) AS online_revenue,
            COALESCE(SUM(CASE WHEN COALESCE(sales_channel, 'online') IN ('pos', 'in_store', 'instore') THEN total_amount ELSE 0 END), 0) AS in_store_revenue,
            COUNT(DISTINCT COALESCE(user_id, LOWER(email))) AS unique_buyers
         FROM orders
         WHERE payment_status = 'paid'
           AND created_at BETWEEN ? AND ?`,
        rangeParams,
        [{
            paid_orders: 0,
            revenue: 0,
            avg_order_value: 0,
            online_orders: 0,
            in_store_orders: 0,
            online_revenue: 0,
            in_store_revenue: 0,
            unique_buyers: 0,
        }]
    );

    const firstTimeRows = await safeQuery(
        pool,
        `SELECT COUNT(*) AS first_time_buyers
         FROM (
            SELECT COALESCE(o.user_id, LOWER(o.email)) AS buyer_key,
                   MIN(o.created_at) AS first_paid_at
            FROM orders o
            WHERE o.payment_status = 'paid'
              AND COALESCE(o.user_id, o.email) IS NOT NULL
            GROUP BY COALESCE(o.user_id, LOWER(o.email))
            HAVING first_paid_at BETWEEN ? AND ?
         ) t`,
        rangeParams,
        [{ first_time_buyers: 0 }]
    );

    const giftRows = await safeQuery(
        pool,
        `SELECT
            COUNT(*) AS gift_cards_issued,
            COALESCE(SUM(CASE WHEN status = 'active' THEN current_balance ELSE 0 END), 0) AS gift_card_balance_issued_active
         FROM gift_cards
         WHERE created_at BETWEEN ? AND ?`,
        rangeParams,
        [{ gift_cards_issued: 0, gift_card_balance_issued_active: 0 }]
    );

    const edsaRows = await safeQuery(
        pool,
        `SELECT
            COUNT(*) AS edsa_bookings,
            SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS edsa_confirmed,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS edsa_pending,
            SUM(CASE WHEN status IN ('cancelled', 'canceled') THEN 1 ELSE 0 END) AS edsa_cancelled
         FROM edsa_bookings
         WHERE created_at BETWEEN ? AND ?`,
        rangeParams,
        [{ edsa_bookings: 0, edsa_confirmed: 0, edsa_pending: 0, edsa_cancelled: 0 }]
    );

    const productRows = await safeQuery(
        pool,
        `SELECT
            COUNT(*) AS products_added,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS products_added_active
         FROM products
         WHERE deleted_at IS NULL
           AND created_at BETWEEN ? AND ?`,
        rangeParams,
        [{ products_added: 0, products_added_active: 0 }]
    );

    const lowStockRows = await safeQuery(
        pool,
        `SELECT COUNT(*) AS low_stock_now
         FROM products
         WHERE deleted_at IS NULL
           AND is_active = 1
           AND track_inventory = 1
           AND inventory_quantity <= low_stock_threshold`,
        [],
        [{ low_stock_now: 0 }]
    );

    const totalsRows = await safeQuery(
        pool,
        `SELECT
            (SELECT COUNT(*) FROM users WHERE is_active IS NULL OR is_active <> 0) AS total_customers,
            (SELECT COUNT(*) FROM email_subscribers WHERE status = 'active') AS total_newsletter_subscribers`,
        [],
        [{ total_customers: 0, total_newsletter_subscribers: 0 }]
    );

    const dailyMembers = await safeQuery(
        pool,
        `SELECT DATE(created_at) AS day_key, COUNT(*) AS new_accounts
         FROM users
         WHERE created_at BETWEEN ? AND ?
           AND (is_active IS NULL OR is_active <> 0)
         GROUP BY DATE(created_at)`,
        rangeParams,
        []
    );
    const dailyRewards = await safeQuery(
        pool,
        `SELECT DATE(created_at) AS day_key,
                COALESCE(SUM(CASE WHEN cash_change > 0 THEN cash_change ELSE 0 END), 0) AS cash_earned
         FROM loyalty_transactions
         WHERE created_at BETWEEN ? AND ?
         GROUP BY DATE(created_at)`,
        rangeParams,
        []
    );
    const dailyOrders = await safeQuery(
        pool,
        `SELECT DATE(created_at) AS day_key,
                COUNT(*) AS paid_orders,
                COALESCE(SUM(total_amount), 0) AS revenue
         FROM orders
         WHERE payment_status = 'paid'
           AND created_at BETWEEN ? AND ?
         GROUP BY DATE(created_at)`,
        rangeParams,
        []
    );

    const dayKey = (dayVal) => {
        if (dayVal instanceof Date) return dayVal.toISOString().slice(0, 10);
        return String(dayVal || '').slice(0, 10);
    };
    const dayMap = new Map();
    const ensureDay = (key) => {
        if (!dayMap.has(key)) {
            dayMap.set(key, {
                day: key,
                newAccounts: 0,
                rewardsCashEarned: 0,
                paidOrders: 0,
                revenue: 0,
            });
        }
        return dayMap.get(key);
    };
    for (const row of dailyMembers) {
        const key = dayKey(row.day_key);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
        ensureDay(key).newAccounts = Number(row.new_accounts) || 0;
    }
    for (const row of dailyRewards) {
        const key = dayKey(row.day_key);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
        ensureDay(key).rewardsCashEarned = Number(row.cash_earned) || 0;
    }
    for (const row of dailyOrders) {
        const key = dayKey(row.day_key);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
        const cur = ensureDay(key);
        cur.paidOrders = Number(row.paid_orders) || 0;
        cur.revenue = Number(row.revenue) || 0;
    }
    const daily = [];
    {
        const cursor = new Date(from + 'T12:00:00Z');
        const end = new Date(to + 'T12:00:00Z');
        while (cursor <= end) {
            const key = cursor.toISOString().slice(0, 10);
            daily.push(
                dayMap.get(key) || {
                    day: key,
                    newAccounts: 0,
                    rewardsCashEarned: 0,
                    paidOrders: 0,
                    revenue: 0,
                }
            );
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
    }

    const recentMembers = await safeQuery(
        pool,
        `SELECT u.id, u.first_name, u.last_name, u.email, u.created_at,
                cl.tier, cl.loyalty_enrollment, cl.member_since
         FROM users u
         LEFT JOIN customer_loyalty cl ON cl.user_id = u.id
         WHERE u.created_at BETWEEN ? AND ?
           AND (u.is_active IS NULL OR u.is_active <> 0)
         ORDER BY u.created_at DESC
         LIMIT 50`,
        rangeParams,
        []
    );

    const topProducts = await safeQuery(
        pool,
        `SELECT p.id, p.name, p.sku,
                SUM(oi.quantity) AS units_sold,
                COALESCE(SUM(oi.total), 0) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE o.payment_status = 'paid'
           AND o.created_at BETWEEN ? AND ?
         GROUP BY p.id, p.name, p.sku
         ORDER BY units_sold DESC
         LIMIT 15`,
        rangeParams,
        []
    );

    const members = membersRows[0] || {};
    const rewards = rewardsRows[0] || {};
    const rewardsBal = rewardsBalanceRows[0] || {};
    const subscribers = subscriberRows[0] || {};
    const orders = orderRows[0] || {};
    const firstTime = firstTimeRows[0] || {};
    const gifts = giftRows[0] || {};
    const edsa = edsaRows[0] || {};
    const products = productRows[0] || {};
    const lowStock = lowStockRows[0] || {};
    const totals = totalsRows[0] || {};

    const paidOrders = Number(orders.paid_orders) || 0;
    const firstTimeBuyers = Number(firstTime.first_time_buyers) || 0;
    const uniqueBuyers = Number(orders.unique_buyers) || 0;

    return {
        range: { from, to },
        totals: {
            customers: Number(totals.total_customers) || 0,
            newsletterSubscribers: Number(totals.total_newsletter_subscribers) || 0,
            lowStockNow: Number(lowStock.low_stock_now) || 0,
            outstandingCashCredit: Number(rewardsBal.outstanding_cash_credit) || 0,
        },
        members: {
            newAccounts: Number(members.new_accounts) || 0,
            marketingOptIn: Number(members.new_accounts_marketing_opt_in) || 0,
            newVip: Number(members.new_vip) || 0,
            newNewsletterSubscribers: Number(subscribers.new_newsletter_subscribers) || 0,
        },
        rewards: {
            cashEarned: Number(rewards.cash_earned) || 0,
            cashRedeemed: Number(rewards.cash_redeemed) || 0,
            earnEvents: Number(rewards.earn_events) || 0,
            redeemEvents: Number(rewards.redeem_events) || 0,
        },
        orders: {
            paidOrders,
            revenue: Number(orders.revenue) || 0,
            avgOrderValue: Number(orders.avg_order_value) || 0,
            onlineOrders: Number(orders.online_orders) || 0,
            inStoreOrders: Number(orders.in_store_orders) || 0,
            onlineRevenue: Number(orders.online_revenue) || 0,
            inStoreRevenue: Number(orders.in_store_revenue) || 0,
            uniqueBuyers,
            firstTimeBuyers,
            returningBuyers: Math.max(0, uniqueBuyers - firstTimeBuyers),
        },
        giftCards: {
            issued: Number(gifts.gift_cards_issued) || 0,
            activeBalanceIssued: Number(gifts.gift_card_balance_issued_active) || 0,
        },
        edsa: {
            bookings: Number(edsa.edsa_bookings) || 0,
            confirmed: Number(edsa.edsa_confirmed) || 0,
            pending: Number(edsa.edsa_pending) || 0,
            cancelled: Number(edsa.edsa_cancelled) || 0,
        },
        catalog: {
            productsAdded: Number(products.products_added) || 0,
            productsAddedActive: Number(products.products_added_active) || 0,
        },
        daily,
        recentMembers: (recentMembers || []).map((u) => ({
            id: u.id,
            name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || '—',
            email: u.email || '',
            createdAt: u.created_at,
            tier: u.tier || null,
            loyaltyEnrollment: u.loyalty_enrollment || null,
            memberSince: u.member_since || null,
        })),
        topProducts: (topProducts || []).map((p) => ({
            id: p.id,
            name: p.name || 'Unknown product',
            sku: p.sku || '',
            unitsSold: Number(p.units_sold) || 0,
            revenue: Number(p.revenue) || 0,
        })),
    };
}

module.exports = {
    parseRange,
    getBusinessReport,
};
