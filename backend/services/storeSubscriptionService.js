'use strict';

const logger = require('../utils/logger');
const promoEngine = require('./webPromotionEngine');
const nmiVaultCards = require('./nmiVaultCards');
const { finalizePaidOrder } = require('./finalizePaidOrder');
const { applyWebDestinationTax } = require('./webDestinationTax');
const { assertStoreProductSubscriptionsEnabled } = require('./storeEcommerceTier');

function sqlBind(value) {
    return value === undefined ? null : value;
}

function sqlBinds(values) {
    return values.map(sqlBind);
}

const ALLOWED_INTERVALS = [30, 60, 90];

function generateOrderNumber() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const seq = String(Math.floor(Math.random() * 9000) + 1000);
    return `BO${y}${m}${day}-${seq}`;
}

function normalizeIntervalDays(days, fallback = 30) {
    const n = Number(days);
    if (ALLOWED_INTERVALS.includes(n)) return n;
    return ALLOWED_INTERVALS.includes(Number(fallback)) ? Number(fallback) : 30;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + Number(days));
    return d.toISOString().slice(0, 10);
}

function parseLineSubscriptionMeta(metadata) {
    if (!metadata) return null;
    let parsed = metadata;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return null;
        }
    }
    const sub = parsed?.subscription;
    if (!sub) return null;
    return { intervalDays: normalizeIntervalDays(sub.intervalDays, 30) };
}

function shippingSnapshotFromOrder(order) {
    return {
        first_name: order.shipping_first_name,
        last_name: order.shipping_last_name,
        address_line_1: order.shipping_address_line_1,
        address_line_2: order.shipping_address_line_2,
        city: order.shipping_city,
        state: order.shipping_state,
        postal_code: order.shipping_postal_code,
        country: order.shipping_country || 'United States',
        email: order.email,
        phone: order.phone || null,
    };
}

async function loadProductSubscriptionFlags(pool, productIds) {
    if (!productIds.length) return new Map();
    const [rows] = await pool.query(
        `SELECT id, subscription_eligible, subscription_interval_days, name, sku, price,
                is_active, show_on_web, gift_card_type
           FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
        productIds
    );
    return new Map(rows.map((r) => [Number(r.id), r]));
}

/**
 * Validate cart lines marked subscribe — ecommerce tier + eligible products + signed-in customer.
 */
async function validateSubscriptionCart(pool, cartItems, { userId } = {}) {
    await assertStoreProductSubscriptionsEnabled(pool);

    const subLines = (cartItems || []).filter((item) => item.subscribe);
    if (!subLines.length) return { hasSubscriptions: false, lines: [] };

    if (!userId) {
        const err = new Error('Sign in to subscribe — a saved card is required for auto-ship.');
        err.code = 'SUBSCRIPTION_LOGIN_REQUIRED';
        err.status = 401;
        throw err;
    }

    const productIds = [...new Set(subLines.map((i) => Number(i.product_id)).filter(Boolean))];
    const byProduct = await loadProductSubscriptionFlags(pool, productIds);

    for (const line of subLines) {
        const product = byProduct.get(Number(line.product_id));
        if (!product || !product.subscription_eligible) {
            const err = new Error('One or more items are not available for subscription.');
            err.code = 'SUBSCRIPTION_NOT_ELIGIBLE';
            err.status = 400;
            throw err;
        }
        if (product.gift_card_type) {
            const err = new Error('Gift cards cannot be subscribed.');
            err.code = 'SUBSCRIPTION_GIFT_CARD';
            err.status = 400;
            throw err;
        }
        line.subscriptionIntervalDays = normalizeIntervalDays(
            line.subscriptionIntervalDays,
            product.subscription_interval_days
        );
    }

    return { hasSubscriptions: true, lines: subLines };
}

async function createSubscriptionsFromPaidOrder(pool, { orderId, userId, paymentCardId }) {
    const oid = Number(orderId);
    const uid = Number(userId);
    const cardId = Number(paymentCardId);
    if (!Number.isFinite(oid) || !Number.isFinite(uid) || !Number.isFinite(cardId)) {
        return { created: 0, skipped: true, reason: 'missing_ids' };
    }

    await assertStoreProductSubscriptionsEnabled(pool);

    const [orders] = await pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [oid]);
    if (!orders.length) return { created: 0, skipped: true, reason: 'order_not_found' };
    const order = orders[0];

    const [items] = await pool.execute(
        'SELECT * FROM order_items WHERE order_id = ?',
        [oid]
    );

    const [cardRows] = await pool.execute(
        `SELECT id FROM payment_cards
          WHERE id = ? AND user_id = ? AND is_active = 1 AND deleted_at IS NULL
            AND nmi_customer_vault_id IS NOT NULL AND nmi_billing_id IS NOT NULL
          LIMIT 1`,
        [cardId, uid]
    );
    if (!cardRows.length) {
        logger.warn('[subscriptions] No vault card for subscription signup', { orderId: oid, userId: uid, cardId });
        return { created: 0, skipped: true, reason: 'no_vault_card' };
    }

    const shipSnap = shippingSnapshotFromOrder(order);
    let created = 0;

    for (const item of items) {
        const subMeta = parseLineSubscriptionMeta(item.metadata);
        if (!subMeta) continue;

        const [existing] = await pool.execute(
            `SELECT id FROM customer_subscriptions
              WHERE user_id = ? AND product_id = ? AND (variant_id <=> ?)
                AND status IN ('active', 'paused', 'past_due')
              LIMIT 1`,
            [uid, item.product_id, item.variant_id || null]
        );
        if (existing.length) continue;

        const intervalDays = subMeta.intervalDays;
        const nextCharge = addDays(new Date(), intervalDays);

        await pool.execute(
            `INSERT INTO customer_subscriptions (
                user_id, product_id, variant_id, quantity, interval_days, unit_price,
                payment_card_id, status, next_charge_at, initial_order_id, last_order_id, shipping_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
            sqlBinds([
                uid,
                item.product_id,
                item.variant_id || null,
                item.quantity,
                intervalDays,
                item.price,
                cardId,
                nextCharge,
                oid,
                oid,
                JSON.stringify(shipSnap),
            ])
        );
        created += 1;
    }

    return { created };
}

async function listUserSubscriptions(pool, userId) {
    const [rows] = await pool.execute(
        `SELECT cs.*, p.name AS product_name, p.slug AS product_slug,
                pv.name AS variant_name
           FROM customer_subscriptions cs
           JOIN products p ON p.id = cs.product_id
           LEFT JOIN product_variants pv ON pv.id = cs.variant_id
          WHERE cs.user_id = ?
          ORDER BY cs.created_at DESC`,
        [userId]
    );
    return rows.map((r) => ({
        ...r,
        shipping: (() => {
            try {
                return typeof r.shipping_json === 'string' ? JSON.parse(r.shipping_json) : r.shipping_json;
            } catch {
                return null;
            }
        })(),
    }));
}

async function cancelUserSubscription(pool, userId, subscriptionId) {
    const [result] = await pool.execute(
        `UPDATE customer_subscriptions
            SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
          WHERE id = ? AND user_id = ? AND status IN ('active', 'paused', 'past_due')`,
        [subscriptionId, userId]
    );
    return result.affectedRows > 0;
}

async function createRenewalOrder(pool, sub) {
    const ship = (() => {
        try {
            return typeof sub.shipping_json === 'string' ? JSON.parse(sub.shipping_json) : sub.shipping_json;
        } catch {
            return null;
        }
    })();
    if (!ship?.address_line_1 || !ship?.postal_code) {
        const err = new Error('Subscription missing shipping address');
        err.code = 'SUBSCRIPTION_NO_SHIPPING';
        throw err;
    }

    const [products] = await pool.execute(
        `SELECT p.*, pv.id AS v_id, pv.price AS v_price, pv.name AS v_name, pv.sku AS v_sku, pv.is_active AS v_active
           FROM products p
           LEFT JOIN product_variants pv ON pv.id = ? AND pv.product_id = p.id
          WHERE p.id = ? LIMIT 1`,
        [sub.variant_id || null, sub.product_id]
    );
    if (!products.length || !products[0].is_active) {
        const err = new Error('Product no longer available');
        err.code = 'SUBSCRIPTION_PRODUCT_INACTIVE';
        throw err;
    }
    const product = products[0];
    const unitPrice = sub.variant_id && product.v_active
        ? Number(product.v_price)
        : Number(product.price);
    const qty = Number(sub.quantity) || 1;
    const lineTotal = promoEngine.roundMoney(unitPrice * qty);

    const cartItems = [{
        product_id: sub.product_id,
        variant_id: sub.variant_id || null,
        quantity: qty,
        price: unitPrice,
    }];

    const checkout = await promoEngine.previewOrApplyTotals(pool, {
        cartItems,
        applyTaxExemption: false,
        shippingMethod: 'tier:standard',
        shippingAmount: null,
    });

    let totals = checkout.totals;
    try {
        const taxed = await applyWebDestinationTax(
            pool,
            totals,
            {
                street1: ship.address_line_1,
                city: ship.city,
                state: ship.state,
                postalCode: ship.postal_code,
                name: [ship.first_name, ship.last_name].filter(Boolean).join(' '),
            },
            { applyTaxExemption: false, tenant: 'business_one' }
        );
        totals = taxed.totals;
    } catch (taxErr) {
        logger.warn('[subscriptions] Renewal tax calc failed', { subId: sub.id, message: taxErr.message });
    }

    const orderNumber = generateOrderNumber();
    let shippingCarrier = 'Store';
    try {
        const { resolveStoreBranding } = require('./storeBranding');
        const branding = await resolveStoreBranding(pool);
        if (branding?.storeName) shippingCarrier = String(branding.storeName).slice(0, 100);
    } catch (_) {
        /* keep generic fallback */
    }
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [orderResult] = await conn.execute(
            `INSERT INTO orders (
                order_number, user_id, email, status, payment_status,
                subtotal, tax_amount, shipping_amount, discount_amount, total_amount,
                shipping_first_name, shipping_last_name,
                shipping_address_line_1, shipping_address_line_2,
                shipping_city, shipping_state, shipping_postal_code, shipping_country,
                billing_first_name, billing_last_name,
                billing_address_line_1, billing_address_line_2,
                billing_city, billing_state, billing_postal_code, billing_country,
                shipping_method, shipping_carrier, shipping_service,
                payment_method, sales_channel, notes
             ) VALUES (?, ?, ?, 'pending', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            sqlBinds([
                orderNumber,
                sub.user_id,
                ship.email || '',
                totals.merchandiseSubtotal,
                totals.taxAmount,
                totals.shippingAfter,
                totals.totalDiscountAmount,
                totals.totalAmount,
                ship.first_name,
                ship.last_name,
                ship.address_line_1,
                ship.address_line_2 || null,
                ship.city,
                ship.state,
                ship.postal_code,
                ship.country || 'United States',
                ship.first_name,
                ship.last_name,
                ship.address_line_1,
                ship.address_line_2 || null,
                ship.city,
                ship.state,
                ship.postal_code,
                ship.country || 'United States',
                'tier:standard',
                shippingCarrier,
                'Standard Shipping',
                'credit_card',
                'online',
                `[subscription] Auto-renewal #${sub.id}`,
            ])
        );
        const orderId = orderResult.insertId;
        await conn.execute(
            `INSERT INTO order_items (
                order_id, product_id, variant_id, product_name, product_sku,
                variant_name, quantity, price, total, metadata
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            sqlBinds([
                orderId,
                sub.product_id,
                sub.variant_id || null,
                product.name,
                product.sku,
                sub.variant_id ? product.v_name : null,
                qty,
                unitPrice,
                lineTotal,
                JSON.stringify({ subscriptionRenewal: { subscriptionId: sub.id } }),
            ])
        );
        await conn.commit();
        return { orderId, orderNumber, totalAmount: totals.totalAmount, ship, unitPrice };
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

async function processSubscriptionRenewal(pool, sub) {
    const renewal = await createRenewalOrder(pool, sub);
    const amountStr = promoEngine.roundMoney(renewal.totalAmount).toFixed(2);

    const sale = await nmiVaultCards.chargeVaultCard(pool, sub.user_id, sub.payment_card_id, amountStr, {
        orderId: renewal.orderId,
        email: renewal.ship.email || '',
        billingAddress: {
            street1: renewal.ship.address_line_1,
            city: renewal.ship.city,
            state: renewal.ship.state,
            postalCode: renewal.ship.postal_code,
            country: renewal.ship.country || 'US',
        },
        shippingAddress: {
            street1: renewal.ship.address_line_1,
            city: renewal.ship.city,
            state: renewal.ship.state,
            postalCode: renewal.ship.postal_code,
            country: renewal.ship.country || 'US',
        },
    });

    if (!sale.ok) {
        await pool.execute(
            `UPDATE customer_subscriptions
                SET status = 'past_due',
                    failure_count = failure_count + 1,
                    last_failure_at = NOW(),
                    last_failure_reason = ?,
                    updated_at = NOW()
              WHERE id = ?`,
            [String(sale.responseText || 'charge_failed').slice(0, 255), sub.id]
        );
        return { ok: false, subscriptionId: sub.id, reason: sale.responseText };
    }

    await finalizePaidOrder(pool, {
        orderId: renewal.orderId,
        paymentId: String(sale.transactionId || `nmi-renew-${renewal.orderId}`),
        paymentStatus: 'paid',
        paymentProcessor: 'nmi',
    });

    const nextCharge = addDays(new Date(), sub.interval_days);
    await pool.execute(
        `UPDATE customer_subscriptions
            SET status = 'active',
                next_charge_at = ?,
                last_order_id = ?,
                unit_price = ?,
                failure_count = 0,
                last_failure_at = NULL,
                last_failure_reason = NULL,
                updated_at = NOW()
          WHERE id = ?`,
        [nextCharge, renewal.orderId, renewal.unitPrice, sub.id]
    );

    return { ok: true, subscriptionId: sub.id, orderId: renewal.orderId, orderNumber: renewal.orderNumber };
}

async function hasRenewableCustomerSubscriptions(pool) {
    const [rows] = await pool.query(
        `SELECT 1 FROM customer_subscriptions
          WHERE status IN ('active', 'past_due')
          LIMIT 1`
    );
    return rows.length > 0;
}

async function processDueSubscriptionRenewals(pool, { limit = 50 } = {}) {
    await assertStoreProductSubscriptionsEnabled(pool);

    const today = new Date().toISOString().slice(0, 10);
    const [due] = await pool.query(
        `SELECT cs.* FROM customer_subscriptions cs
          WHERE cs.status = 'active' AND cs.next_charge_at <= ?
          ORDER BY cs.next_charge_at ASC
          LIMIT ?`,
        [today, Math.max(1, Number(limit) || 50)]
    );

    const results = { processed: 0, succeeded: 0, failed: 0, details: [] };
    for (const sub of due) {
        results.processed += 1;
        try {
            const r = await processSubscriptionRenewal(pool, sub);
            if (r.ok) results.succeeded += 1;
            else results.failed += 1;
            results.details.push(r);
        } catch (err) {
            results.failed += 1;
            results.details.push({ ok: false, subscriptionId: sub.id, reason: err.message });
            logger.error('[subscriptions] Renewal error', { subId: sub.id, message: err.message });
        }
    }
    return results;
}

module.exports = {
    ALLOWED_INTERVALS,
    normalizeIntervalDays,
    validateSubscriptionCart,
    createSubscriptionsFromPaidOrder,
    listUserSubscriptions,
    cancelUserSubscription,
    hasRenewableCustomerSubscriptions,
    processDueSubscriptionRenewals,
};
