'use strict';

/**
 * Storefront / membership business reports for admin Reports → Business.
 * Date range is inclusive calendar days in America/Chicago-ish server local time
 * (MySQL DATE comparisons on DATETIME columns).
 */

const LIST_LIMIT = 2000;
const TOP_PRODUCTS_LIMIT = 100;

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

function personName(first, last, fallback) {
    const name = [first, last].filter(Boolean).join(' ').trim();
    return name || fallback || '—';
}

function dayKey(dayVal) {
    if (dayVal instanceof Date) return dayVal.toISOString().slice(0, 10);
    return String(dayVal || '').slice(0, 10);
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

    // Cash store-credit rewards activity (HM uses cash loyalty by default; points columns may also exist)
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

    const [
        recentMembers,
        newsletterList,
        rewardsList,
        paidOrdersList,
        buyersList,
        giftCardsList,
        edsaList,
        catalogList,
        topProducts,
    ] = await Promise.all([
        safeQuery(
            pool,
            `SELECT u.id, u.first_name, u.last_name, u.email, u.created_at,
                    cl.tier, cl.loyalty_enrollment, cl.member_since
             FROM users u
             LEFT JOIN customer_loyalty cl ON cl.user_id = u.id
             WHERE u.created_at BETWEEN ? AND ?
               AND (u.is_active IS NULL OR u.is_active <> 0)
             ORDER BY u.created_at DESC
             LIMIT ${LIST_LIMIT}`,
            rangeParams,
            []
        ),
        safeQuery(
            pool,
            `SELECT id, email, first_name, last_name, status, subscription_source, subscribed_at
             FROM email_subscribers
             WHERE subscribed_at BETWEEN ? AND ?
             ORDER BY subscribed_at DESC
             LIMIT ${LIST_LIMIT}`,
            rangeParams,
            []
        ),
        safeQuery(
            pool,
            `SELECT lt.id, lt.user_id, lt.cash_change, lt.transaction_type, lt.source,
                    lt.order_id, lt.description, lt.created_at,
                    u.first_name, u.last_name, u.email,
                    o.order_number
             FROM loyalty_transactions lt
             LEFT JOIN users u ON u.id = lt.user_id
             LEFT JOIN orders o ON o.id = lt.order_id
             WHERE lt.created_at BETWEEN ? AND ?
               AND lt.cash_change IS NOT NULL
               AND lt.cash_change <> 0
             ORDER BY lt.created_at DESC
             LIMIT ${LIST_LIMIT}`,
            rangeParams,
            []
        ),
        safeQuery(
            pool,
            `SELECT o.id, o.order_number, o.email, o.total_amount, o.created_at,
                    o.status, o.payment_status, o.fulfillment_status,
                    COALESCE(o.sales_channel, 'online') AS sales_channel,
                    o.shipping_first_name, o.shipping_last_name,
                    u.first_name AS user_first_name, u.last_name AS user_last_name,
                    COALESCE((
                        SELECT SUM(oi.quantity)
                        FROM order_items oi
                        WHERE oi.order_id = o.id
                    ), 0) AS item_count
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             WHERE o.payment_status = 'paid'
               AND o.created_at BETWEEN ? AND ?
             ORDER BY o.created_at DESC
             LIMIT ${LIST_LIMIT}`,
            rangeParams,
            []
        ),
        safeQuery(
            pool,
            `SELECT
                r.buyer_key,
                r.email,
                r.customer_name,
                r.order_count,
                r.spend_in_range,
                r.first_order_in_range,
                f.first_paid_at,
                CASE
                    WHEN f.first_paid_at BETWEEN ? AND ? THEN 'first-time'
                    ELSE 'returning'
                END AS buyer_type
             FROM (
                SELECT
                    COALESCE(o.user_id, LOWER(o.email)) AS buyer_key,
                    MAX(o.email) AS email,
                    MAX(TRIM(CONCAT(
                        COALESCE(NULLIF(u.first_name, ''), NULLIF(o.shipping_first_name, ''), ''),
                        ' ',
                        COALESCE(NULLIF(u.last_name, ''), NULLIF(o.shipping_last_name, ''), '')
                    ))) AS customer_name,
                    COUNT(*) AS order_count,
                    COALESCE(SUM(o.total_amount), 0) AS spend_in_range,
                    MIN(o.created_at) AS first_order_in_range
                FROM orders o
                LEFT JOIN users u ON u.id = o.user_id
                WHERE o.payment_status = 'paid'
                  AND o.created_at BETWEEN ? AND ?
                  AND COALESCE(o.user_id, o.email) IS NOT NULL
                GROUP BY COALESCE(o.user_id, LOWER(o.email))
             ) r
             LEFT JOIN (
                SELECT COALESCE(o2.user_id, LOWER(o2.email)) AS buyer_key,
                       MIN(o2.created_at) AS first_paid_at
                FROM orders o2
                WHERE o2.payment_status = 'paid'
                  AND COALESCE(o2.user_id, o2.email) IS NOT NULL
                GROUP BY COALESCE(o2.user_id, LOWER(o2.email))
             ) f ON f.buyer_key = r.buyer_key
             ORDER BY r.spend_in_range DESC
             LIMIT ${LIST_LIMIT}`,
            [fromStart, toEnd, fromStart, toEnd],
            []
        ),
        safeQuery(
            pool,
            `SELECT id, code, card_type, status, initial_balance, current_balance,
                    recipient_name, recipient_email, sender_name, created_at, issued_at
             FROM gift_cards
             WHERE created_at BETWEEN ? AND ?
             ORDER BY created_at DESC
             LIMIT ${LIST_LIMIT}`,
            rangeParams,
            []
        ),
        safeQuery(
            pool,
            `SELECT id, first_name, last_name, email, phone, status,
                    preferred_date, preferred_time, created_at
             FROM edsa_bookings
             WHERE created_at BETWEEN ? AND ?
             ORDER BY created_at DESC
             LIMIT ${LIST_LIMIT}`,
            rangeParams,
            []
        ),
        safeQuery(
            pool,
            `SELECT id, name, sku, is_active, inventory_quantity, created_at
             FROM products
             WHERE deleted_at IS NULL
               AND created_at BETWEEN ? AND ?
             ORDER BY created_at DESC
             LIMIT ${LIST_LIMIT}`,
            rangeParams,
            []
        ),
        safeQuery(
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
             LIMIT ${TOP_PRODUCTS_LIMIT}`,
            rangeParams,
            []
        ),
    ]);

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

    const mappedMembers = (recentMembers || []).map((u) => ({
        id: u.id,
        name: personName(u.first_name, u.last_name),
        email: u.email || '',
        createdAt: u.created_at,
        tier: u.tier || null,
        loyaltyEnrollment: u.loyalty_enrollment || null,
        memberSince: u.member_since || null,
    }));

    const mappedOrders = (paidOrdersList || []).map((o) => {
        const channel = String(o.sales_channel || 'online');
        const normalized =
            channel === 'pos' || channel === 'instore' || channel === 'in_store' ? 'in_store' : channel;
        return {
            id: o.id,
            orderNumber: o.order_number || String(o.id),
            customer: personName(
                o.user_first_name || o.shipping_first_name,
                o.user_last_name || o.shipping_last_name,
                o.email || '—'
            ),
            email: o.email || '',
            channel: normalized,
            status: o.status || o.payment_status || 'paid',
            paymentStatus: o.payment_status || 'paid',
            fulfillmentStatus: o.fulfillment_status || '',
            itemCount: Number(o.item_count) || 0,
            total: Number(o.total_amount) || 0,
            createdAt: o.created_at,
        };
    });

    return {
        range: { from, to },
        listLimit: LIST_LIMIT,
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
        // Backward-compatible aliases
        recentMembers: mappedMembers,
        topProducts: (topProducts || []).map((p) => ({
            id: p.id,
            name: p.name || 'Unknown product',
            sku: p.sku || '',
            unitsSold: Number(p.units_sold) || 0,
            revenue: Number(p.revenue) || 0,
        })),
        lists: {
            members: mappedMembers,
            newsletter: (newsletterList || []).map((s) => ({
                id: s.id,
                email: s.email || '',
                name: personName(s.first_name, s.last_name, ''),
                status: s.status || '—',
                source: s.subscription_source || '',
                subscribedAt: s.subscribed_at,
            })),
            rewards: (rewardsList || []).map((t) => {
                const amount = Number(t.cash_change) || 0;
                return {
                    id: t.id,
                    customer: personName(t.first_name, t.last_name, t.email || '—'),
                    email: t.email || '',
                    amount,
                    type: amount >= 0 ? 'earned' : 'redeemed',
                    date: t.created_at,
                    orderNumber: t.order_number || (t.order_id ? String(t.order_id) : ''),
                    source: t.source || t.transaction_type || '',
                    description: t.description || '',
                };
            }),
            orders: mappedOrders,
            buyers: (buyersList || []).map((b) => ({
                buyerKey: b.buyer_key,
                customer: String(b.customer_name || '').trim() || b.email || '—',
                email: b.email || '',
                buyerType: b.buyer_type === 'first-time' ? 'first-time' : 'returning',
                orderCount: Number(b.order_count) || 0,
                spendInRange: Number(b.spend_in_range) || 0,
                firstPaidAt: b.first_paid_at,
                firstOrderInRange: b.first_order_in_range,
            })),
            giftCards: (giftCardsList || []).map((g) => ({
                id: g.id,
                code: g.code || '',
                cardType: g.card_type || '',
                status: g.status || '',
                initialBalance: Number(g.initial_balance) || 0,
                currentBalance: Number(g.current_balance) || 0,
                recipient: g.recipient_name || g.recipient_email || g.sender_name || '—',
                email: g.recipient_email || '',
                createdAt: g.created_at || g.issued_at,
            })),
            edsa: (edsaList || []).map((b) => ({
                id: b.id,
                name: personName(b.first_name, b.last_name),
                email: b.email || '',
                phone: b.phone || '',
                status: b.status || '',
                preferredDate: b.preferred_date,
                preferredTime: b.preferred_time,
                createdAt: b.created_at,
            })),
            catalog: (catalogList || []).map((p) => ({
                id: p.id,
                name: p.name || '—',
                sku: p.sku || '',
                active: Number(p.is_active) === 1,
                inventory: p.inventory_quantity != null ? Number(p.inventory_quantity) : null,
                createdAt: p.created_at,
            })),
            daily,
            topProducts: (topProducts || []).map((p) => ({
                id: p.id,
                name: p.name || 'Unknown product',
                sku: p.sku || '',
                unitsSold: Number(p.units_sold) || 0,
                revenue: Number(p.revenue) || 0,
            })),
        },
    };
}

module.exports = {
    parseRange,
    getBusinessReport,
    LIST_LIMIT,
};
