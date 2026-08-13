// Order Management Routes with Inventory Integration
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const InventoryService = require('../services/inventory');
const promoEngine = require('../services/webPromotionEngine');
const { finalizePaidOrder, recalcUserOrderAggregates } = require('../services/finalizePaidOrder');
const { cartLookupBinds, hasCartIdentity } = require('../utils/cartSession');
const { validateGiftCardCartItems } = require('../services/giftCardFulfillment');
const { isUsPhoneDisplay } = require('../utils/usPhoneDisplay');
const {
    normalizeWebStoreTenders,
    splitWebCheckoutPayment,
    validateWebStoreTenders,
    applyWebStoreTenders,
    persistOrderTenders,
    formatTenderNotes,
    loadLoyaltyProgramSettings,
    savePendingStoreTenders
} = require('../services/webCheckoutPayments');
const {
    getAuthenticatedUserFromRequest,
    assertCanAccessOrder,
    assertInternalOrderSecret
} = require('../utils/orderAccess');
const { reverseOrderFinancials } = require('../services/orderTenderReversal');
const { reverseOrderCardPayment } = require('../services/orderPaymentReversal');

function mapCheckoutPromoHttpError(err) {
    const code = err && err.code ? String(err.code) : '';
    const table = {
        INVALID_PROMO_CODE: { status: 400, message: 'Promotion code is not valid.' },
        MALFORMED_PROMO_RULES: { status: 400, message: 'This promotion is misconfigured.' },
        PROMO_NO_EFFECTS: { status: 400, message: 'This promotion has no active discount rules.' },
        TOTAL_USAGE: { status: 400, message: 'This promotion has reached its usage limit.' },
        EMAIL_USAGE: { status: 400, message: 'This promotion is not available for this email address.' },
        PROMO_USAGE_EXCEEDED: { status: 400, message: 'This promotion code is no longer available for use.' },
        EMPTY_CART: { status: 400, message: 'Cart is empty.' },
        INVALID_CART_PRODUCT: { status: 400, message: 'One or more cart items are no longer available.' },
        INVALID_CART_VARIANT: { status: 400, message: 'One or more cart items have an invalid variant.' },
        GIFT_CARD_CODE_REQUIRED: { status: 400, message: 'Gift card code is required.' },
        GIFT_CARD_NOT_FOUND: { status: 400, message: 'Gift card not found or invalid PIN.' },
        GIFT_CARD_NOT_OWNED: { status: 403, message: 'That gift card is not on your account.' },
        GIFT_CARD_INVALID_PIN: { status: 400, message: 'Invalid gift card PIN.' },
        GIFT_CARD_INACTIVE: { status: 400, message: 'This gift card is not active.' },
        GIFT_CARD_EXPIRED: { status: 400, message: 'This gift card has expired.' },
        INSUFFICIENT_GIFT_CARD_BALANCE: {
            status: 400,
            message: 'Gift card balance is not enough for the amount requested.'
        },
        TENDER_TOTAL_MISMATCH: {
            status: 400,
            message: 'Payment amounts do not match the order total.'
        },
        CUSTOMER_REQUIRED_FOR_LOYALTY: {
            status: 401,
            message: 'Sign in to use store credit, points, or gift cards on your account.'
        },
        INSUFFICIENT_LOYALTY_POINTS: { status: 400, message: 'Not enough loyalty points.' },
        INSUFFICIENT_LOYALTY_CASH: { status: 400, message: 'Not enough store credit.' },
        LOYALTY_NOT_ENROLLED: { status: 400, message: 'Loyalty program enrollment required.' },
        LOYALTY_DISABLED: { status: 400, message: 'Loyalty rewards are not available.' },
        DIGITAL_GIFT_CARD_EMAIL_REQUIRED: {
            status: 400,
            message: 'Recipient email is required for digital gift cards.'
        },
        INVALID_GIFT_CARD_EMAIL: {
            status: 400,
            message: 'Please enter a valid recipient email address for the gift card.'
        },
        DIGITAL_GIFT_CARD_RECIPIENT_NAME_REQUIRED: {
            status: 400,
            message: 'Recipient name is required for digital gift cards.'
        },
        DIGITAL_GIFT_CARD_RECIPIENT_PHONE_REQUIRED: {
            status: 400,
            message: 'Recipient phone is required for digital gift cards so we can set up their account.'
        },
        INVALID_GIFT_CARD_RECIPIENT_PHONE: {
            status: 400,
            message: 'Recipient phone must be formatted as (555) 123-4567.'
        },
        DIGITAL_GIFT_CARD_RECIPIENT_ADDRESS_REQUIRED: {
            status: 400,
            message:
                'Recipient mailing address is required for digital gift cards so they can track their gift card balance in their account.'
        }
    };
    return table[code] || null;
}

/** mysql2 rejects `undefined` bind values; use SQL NULL instead. */
function sqlBind(value) {
    return value === undefined ? null : value;
}

function sqlBinds(values) {
    return values.map(sqlBind);
}

function mapAddress(address) {
    const src = address || {};
    return {
        line1: src.line1 ?? src.address_line_1 ?? '',
        line2: src.line2 ?? src.address_line_2 ?? null,
        city: src.city ?? '',
        state: src.state ?? '',
        postalCode: src.postalCode ?? src.postal_code ?? '',
        country: src.country ?? 'United States'
    };
}

function generateOrderNumber() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `HM${y}${m}${day}-${seq}`;
}

function buildOrderNotes(orderNotes) {
    const note = String(orderNotes || '').trim();
    return note || null;
}

function normalizeCustomerInfo(customerInfo = {}) {
    return {
        firstName: customerInfo.firstName ?? customerInfo.first_name ?? '',
        lastName: customerInfo.lastName ?? customerInfo.last_name ?? '',
        email: customerInfo.email ?? '',
        phone: customerInfo.phone ?? ''
    };
}

function normalizeCartItems(cartItems = []) {
    if (!Array.isArray(cartItems)) return [];
    return cartItems
        .map((item) => {
            const quantity = Number(item.quantity);
            const price = Number(item.price);
            const giftCard = item.giftCard || item.gift_card || null;
            return {
                product_id: Number(item.product_id ?? item.productId ?? item.id ?? 0),
                variant_id: item.variant_id ?? item.variantId ?? null,
                quantity: Number.isFinite(quantity) ? quantity : 0,
                price: Number.isFinite(price) ? price : 0,
                giftCard: giftCard && typeof giftCard === 'object' ? giftCard : null
            };
        })
        .filter((item) => item.product_id > 0 && item.quantity > 0 && item.price >= 0);
}


// Create order (checkout process)
router.post('/', async (req, res) => {
    try {
        const {
            customerInfo,
            shippingAddress,
            billingAddress,
            paymentMethod,
            cartItems,
            promoCode: rawPromoCode,
            awaitingNmiPayment,
            giftCard: rawGiftCard,
            orderNotes: rawOrderNotes,
            shippingMethod: rawShippingMethod,
            shippingAmount: rawShippingAmount,
        } = req.body || {};

        const deferCartClearRequested = Boolean(awaitingNmiPayment || req.body?.awaitingMxPayment);
        const isGiftCardPayment = String(paymentMethod || '').toLowerCase() === 'gift_card';

        const authUser = await getAuthenticatedUserFromRequest(req);
        const userId = authUser?.id || null;
        const sessionId = req.headers['x-session-id'] || req.sessionID || null;
        const normalizedCustomer = normalizeCustomerInfo(customerInfo);
        const normalizedItems = normalizeCartItems(cartItems);

        // Validate required fields
        if (!normalizedCustomer.email || normalizedItems.length === 0) {
            return res.status(400).json({ error: 'Missing required order information' });
        }

        try {
            await validateGiftCardCartItems(req.pool, normalizedItems);
        } catch (giftErr) {
            const mapped = mapCheckoutPromoHttpError(giftErr);
            if (mapped) {
                return res.status(mapped.status).json({ error: mapped.message, code: giftErr.code });
            }
            throw giftErr;
        }

        const phoneTrim = String(normalizedCustomer.phone || '').trim();
        if (!phoneTrim || !isUsPhoneDisplay(phoneTrim)) {
            return res.status(400).json({
                error: 'Phone is required and must be formatted as (555) 123-4567'
            });
        }

        if (isGiftCardPayment) {
            const giftCardId = rawGiftCard && rawGiftCard.id != null ? Number(rawGiftCard.id) : null;
            const code = rawGiftCard && rawGiftCard.code ? String(rawGiftCard.code).trim() : '';
            if (giftCardId) {
                if (!userId) {
                    return res.status(401).json({ error: 'Sign in to use a gift card from your account.' });
                }
            } else if (!code) {
                return res.status(400).json({ error: 'Select a gift card or enter a gift card code.' });
            }
        }

        // Require signed-in account to receive tax-exempt treatment.
        // "Proof" is represented by a saved tax_exempt_id on that verified user.
        const hasTaxExemptProof = Boolean(
            authUser?.tax_exempt_id && String(authUser.tax_exempt_id).trim().length >= 3
        );
        const applyTaxExemption = Boolean(authUser?.tax_exempt) && hasTaxExemptProof;

        const ship = mapAddress(shippingAddress);
        const bill = mapAddress(billingAddress || shippingAddress);
        const orderEmail = authUser?.email || normalizedCustomer.email;

        let checkout;
        try {
            checkout = await promoEngine.previewOrApplyTotals(req.pool, {
                cartItems: normalizedItems,
                promoCode: String(rawPromoCode || '').trim(),
                email: orderEmail,
                applyTaxExemption,
                customerType: authUser?.customer_type,
                userId: userId || undefined,
                shippingMethod: String(rawShippingMethod || '').trim() || undefined,
                shippingAmount: rawShippingAmount != null ? Number(rawShippingAmount) : undefined,
            });
        } catch (promoErr) {
            const mapped = mapCheckoutPromoHttpError(promoErr);
            if (mapped) {
                return res.status(mapped.status).json({
                    error: mapped.message,
                    code: promoErr.code
                });
            }
            logger.error('Order promo / pricing error:', promoErr);
            return res.status(500).json({ error: 'Unable to price this order' });
        }

        const t = checkout.totals;
        const merchandiseSubtotal = Number(t.merchandiseSubtotal) || 0;
        const discountAmount = Number(t.totalDiscountAmount) || 0;
        const computedTax = Number(t.taxAmount) || 0;
        const computedShipping = Number(t.shippingAfter) || 0;
        const computedTotal = Number(t.totalAmount) || 0;
        const orderNumber = generateOrderNumber();
        const baseOrderNotes = buildOrderNotes(rawOrderNotes);

        const loyaltySettings = await loadLoyaltyProgramSettings(req.pool);
        let storeTenders = normalizeWebStoreTenders(req.body, loyaltySettings);
        if (!storeTenders.length && isGiftCardPayment && rawGiftCard) {
            storeTenders = [
                {
                    type: 'gift_card',
                    amount: promoEngine.roundMoney(computedTotal),
                    giftCardId: rawGiftCard.id != null ? Number(rawGiftCard.id) : null,
                    code: rawGiftCard.code ? String(rawGiftCard.code).trim() : null,
                    pin: rawGiftCard.pin != null ? String(rawGiftCard.pin).trim() : null
                }
            ];
        }

        let webPaymentSplit;
        try {
            validateWebStoreTenders(storeTenders, userId);
            webPaymentSplit = splitWebCheckoutPayment(storeTenders, computedTotal);
        } catch (tenderErr) {
            const mapped = mapCheckoutPromoHttpError(tenderErr);
            if (mapped) {
                return res.status(mapped.status).json({ error: mapped.message, code: tenderErr.code });
            }
            throw tenderErr;
        }

        const appliedStoreTenders = webPaymentSplit.storeTenders;
        const cardAmountDue = webPaymentSplit.cardDue;
        const payFullyWithStoreValue = cardAmountDue <= 0.005 && appliedStoreTenders.length > 0;

        if (cardAmountDue > 0.005) {
            const pm = String(paymentMethod || '').toLowerCase();
            if (pm !== 'credit_card' && pm !== 'debit_card') {
                return res.status(400).json({
                    error: 'A credit or debit card is required to pay the remaining balance.',
                    code: 'CARD_REQUIRED_FOR_REMAINDER',
                    cardAmountDue
                });
            }
        }

        let storedPaymentMethod = String(paymentMethod || '').trim().toLowerCase() || null;
        if (appliedStoreTenders.length > 0) {
            if (cardAmountDue > 0.005) {
                storedPaymentMethod = 'split';
            } else if (appliedStoreTenders.length > 1) {
                storedPaymentMethod = 'split';
            } else if (appliedStoreTenders[0].type === 'gift_card') {
                storedPaymentMethod = 'gift_card';
            } else {
                storedPaymentMethod = 'loyalty';
            }
        }

        const deferCartClear = cardAmountDue > 0.005 || deferCartClearRequested;
        const tenderNoteText = appliedStoreTenders.length ? formatTenderNotes(appliedStoreTenders) : '';
        const orderNotes = [baseOrderNotes, tenderNoteText].filter(Boolean).join('\n') || null;

        // Start transaction
        const connection = await req.pool.getConnection();
        await connection.beginTransaction();

        try {
            const [orderResult] = await connection.execute(
                `
                INSERT INTO orders (
                    order_number,
                    user_id,
                    email,
                    status,
                    payment_status,
                    subtotal,
                    tax_amount,
                    shipping_amount,
                    discount_amount,
                    total_amount,
                    shipping_first_name,
                    shipping_last_name,
                    shipping_address_line_1,
                    shipping_address_line_2,
                    shipping_city,
                    shipping_state,
                    shipping_postal_code,
                    shipping_country,
                    billing_first_name,
                    billing_last_name,
                    billing_address_line_1,
                    billing_address_line_2,
                    billing_city,
                    billing_state,
                    billing_postal_code,
                    billing_country,
                    web_promotion_id,
                    promo_code,
                    notes,
                    shipping_method,
                    payment_method,
                    sales_channel
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
                sqlBinds([
                    orderNumber,
                    userId,
                    orderEmail,
                    'pending',
                    'pending',
                    merchandiseSubtotal,
                    computedTax,
                    computedShipping,
                    discountAmount,
                    computedTotal,
                    normalizedCustomer.firstName,
                    normalizedCustomer.lastName,
                    ship.line1,
                    ship.line2,
                    ship.city,
                    ship.state,
                    ship.postalCode,
                    ship.country,
                    normalizedCustomer.firstName,
                    normalizedCustomer.lastName,
                    bill.line1,
                    bill.line2,
                    bill.city,
                    bill.state,
                    bill.postalCode,
                    bill.country,
                    checkout.promotion ? checkout.promotion.id : null,
                    checkout.promotion ? String(checkout.promotion.code) : null,
                    orderNotes,
                    String(rawShippingMethod || '').trim() || null,
                    storedPaymentMethod,
                    'online'
                ])
            );

            const orderId = orderResult.insertId;

            // Add order items (server catalog price)
            for (const line of checkout.enrichment) {
                const lineTotal = promoEngine.roundMoney(line.unitPrice * line.quantity);
                const lineMeta = line.giftCard ? JSON.stringify({ giftCard: line.giftCard }) : null;
                await connection.execute(
                    `
                    INSERT INTO order_items (
                        order_id, product_id, variant_id, product_name, product_sku,
                        variant_name, quantity, price, total, metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                    sqlBinds([
                        orderId,
                        line.product_id,
                        line.variant_id,
                        line.name,
                        line.sku,
                        null,
                        line.quantity,
                        line.unitPrice,
                        lineTotal,
                        lineMeta
                    ])
                );
            }

            if (checkout.promotion && payFullyWithStoreValue) {
                await promoEngine.insertRedemptionRow(connection, {
                    promotionId: checkout.promotion.id,
                    orderId,
                    email: orderEmail,
                    userId,
                    merchandiseDisc: t.merchandiseDiscount,
                    shippingDisc: t.shippingDiscount
                });
            }

            let giftCardRedemption = null;
            let loyaltyRedemption = null;
            const deferStoreRedemption = cardAmountDue > 0.005 && appliedStoreTenders.length > 0;

            if (appliedStoreTenders.length && deferStoreRedemption) {
                await savePendingStoreTenders(connection, orderId, appliedStoreTenders);
            } else if (appliedStoreTenders.length) {
                const redeemResult = await applyWebStoreTenders(connection, {
                    storeTenders: appliedStoreTenders,
                    orderId,
                    user: authUser,
                    loyaltySettings
                });
                loyaltyRedemption = redeemResult;
                giftCardRedemption = redeemResult?.giftCards?.[0] || null;
                try {
                    await persistOrderTenders(connection, orderId, appliedStoreTenders);
                } catch (tenderPersistErr) {
                    if (tenderPersistErr.code !== 'ER_NO_SUCH_TABLE') throw tenderPersistErr;
                }
            }

            await connection.commit();

            let finalizeResult = null;
            if (payFullyWithStoreValue) {
                const payRef = appliedStoreTenders.length > 1
                    ? 'web:split'
                    : appliedStoreTenders[0].type === 'gift_card'
                      ? `gift_card:${giftCardRedemption?.giftCardId || 'account'}`
                      : `web:${appliedStoreTenders[0].type}`;
                finalizeResult = await finalizePaidOrder(req.pool, {
                    orderId,
                    paymentId: payRef,
                    paymentStatus: 'paid'
                });
            }

            // Clear cart after successful order (NMI path clears cart only after charge succeeds)
            if ((!deferCartClear || payFullyWithStoreValue) && hasCartIdentity(userId, sessionId)) {
                const [cartUserId, cartSessionId] = cartLookupBinds(userId, sessionId);
                const [carts] = await req.pool.execute(
                    'SELECT id FROM shopping_carts WHERE user_id = ? OR session_id = ?',
                    [cartUserId, cartSessionId]
                );

                if (carts.length > 0) {
                    await req.pool.execute('DELETE FROM cart_items WHERE cart_id = ?', [carts[0].id]);
                }
            }

            res.json({
                success: true,
                orderId: orderId,
                orderNumber,
                message: 'Order created successfully',
                paymentStatus: payFullyWithStoreValue ? 'paid' : 'pending',
                cardAmountDue: cardAmountDue > 0.005 ? cardAmountDue : undefined,
                trackingNumber: finalizeResult?.trackingNumber || null,
                totals: {
                    subtotal: merchandiseSubtotal,
                    discount: discountAmount,
                    tax: computedTax,
                    shipping: computedShipping,
                    total: computedTotal
                },
                promoApplied: Boolean(checkout.promotion),
                taxExemptApplied: applyTaxExemption
            });
        } catch (error) {
            await connection.rollback();
            const mappedGift = mapCheckoutPromoHttpError(error);
            if (mappedGift) {
                return res.status(mappedGift.status).json({ error: mappedGift.message, code: error.code });
            }
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        const mappedGift = mapCheckoutPromoHttpError(error);
        if (mappedGift) {
            return res.status(mappedGift.status).json({ error: mappedGift.message, code: error.code });
        }
        logger.error('Order creation error:', error);
        const message =
            process.env.NODE_ENV === 'development'
                ? error.message || 'Failed to create order'
                : 'Failed to create order';
        res.status(500).json({ error: message });
    }
});

// Complete order (payment successful) - internal or customer-authenticated only
router.post('/:orderId/complete', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { paymentId, paymentStatus, customerEmail } = req.body;

        const [orders] = await req.pool.execute(
            'SELECT * FROM orders WHERE id = ? AND status = ?',
            [orderId, 'pending']
        );

        if (orders.length === 0) {
            return res.status(404).json({ error: 'Order not found or already processed' });
        }

        const order = orders[0];
        if (!assertInternalOrderSecret(req)) {
            return res.status(403).json({ error: 'Order completion is restricted to internal payment callbacks.' });
        }

        const result = await finalizePaidOrder(req.pool, {
            orderId: Number(orderId),
            paymentId: String(paymentId || ''),
            paymentStatus: String(paymentStatus || 'paid')
        });

        res.json({
            success: true,
            message: 'Order completed successfully',
            orderId: Number(orderId),
            orderNumber: result?.orderNumber,
            trackingNumber: result?.trackingNumber
        });
    } catch (error) {
        if (error.code === 'ORDER_NOT_PENDING') {
            return res.status(404).json({ error: 'Order not found or already processed' });
        }
        logger.error('Order completion error:', error);
        res.status(500).json({ error: 'Failed to complete order: ' + error.message });
    }
});

// Cancel order - RESTORE INVENTORY and reverse wallet tenders
router.post('/:orderId/cancel', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { reason, customerEmail } = req.body;

        const [orders] = await req.pool.execute(
            'SELECT * FROM orders WHERE id = ? AND status IN (?, ?)',
            [orderId, 'pending', 'processing']
        );

        if (orders.length === 0) {
            return res.status(404).json({ error: 'Order not found or cannot be cancelled' });
        }

        const order = orders[0];

        if (!assertInternalOrderSecret(req)) {
            try {
                await assertCanAccessOrder(req, order, { email: customerEmail });
            } catch (e) {
                if (e.status === 403) {
                    return res.status(403).json({ error: 'Not allowed to cancel this order' });
                }
                throw e;
            }
        }

        const [orderItems] = await req.pool.execute(`
            SELECT oi.*, p.name as product_name, p.sku
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        `, [orderId]);

        const wasPaid = order.payment_status === 'paid' || order.status === 'processing';
        let gatewayReverse = null;

        if (wasPaid) {
            gatewayReverse = await reverseOrderCardPayment(req.pool, order, { operation: 'auto' });
            if (!gatewayReverse.skipped && !gatewayReverse.ok) {
                return res.status(402).json({
                    error: gatewayReverse.responseText || 'Card refund failed at payment processor',
                    code: 'GATEWAY_REFUND_FAILED',
                    processor: gatewayReverse.processor,
                });
            }
        }

        const connection = await req.pool.getConnection();
        await connection.beginTransaction();

        try {
            const cancelNote = reason ? `Cancelled: ${reason}` : 'Cancelled';
            const gatewayNote =
                gatewayReverse?.ok && !gatewayReverse.skipped
                    ? `\nGateway ${gatewayReverse.operation || 'reverse'}: ${
                          gatewayReverse.transactionId || gatewayReverse.paymentId || 'ok'
                      }`
                    : '';
            await connection.execute(
                `UPDATE orders
                    SET status = 'cancelled',
                        payment_status = CASE WHEN payment_status = 'paid' THEN 'refunded' ELSE payment_status END,
                        pending_store_tenders = NULL,
                        notes = CONCAT(COALESCE(notes, ''), IF(COALESCE(notes, '') = '', '', '\n'), ?)
                  WHERE id = ?`,
                [cancelNote + gatewayNote, orderId]
            );

            await reverseOrderFinancials(connection, orderId, order, {
                clawbackEarn: wasPaid,
                reversePromo: true
            });

            if (wasPaid) {
                const inventoryService = new InventoryService(req.pool);
                const inventoryItems = orderItems.map(item => ({
                    productId: item.product_id,
                    variantId: item.variant_id,
                    quantity: item.quantity
                }));

                await inventoryService.restoreInventoryForOrder(
                    inventoryItems,
                    orderId,
                    `Order #${orderId} cancelled - Reason: ${reason || 'Customer request'}`
                );
            }

            if (wasPaid && order.user_id) {
                await recalcUserOrderAggregates(connection, order.user_id);
            }

            await connection.commit();

            res.json({
                success: true,
                message: 'Order cancelled successfully',
                orderId: orderId
            });

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (error) {
        logger.error('Order cancellation error:', error);
        res.status(500).json({ error: 'Failed to cancel order: ' + error.message });
    }
});

// Public order summary for thank-you page (email must match order)
router.get('/:orderId/confirmation-summary', async (req, res) => {
    try {
        const orderId = Number(req.params.orderId);
        const email = String(req.query.email || '')
            .trim()
            .toLowerCase();
        if (!Number.isFinite(orderId) || orderId < 1 || !email) {
            return res.status(400).json({ error: 'order id and email are required' });
        }

        const [orders] = await req.pool.execute(
            `SELECT id, order_number, email, status, payment_status, total_amount,
                    tracking_number, tracking_url, created_at,
                    shipping_first_name, shipping_last_name
               FROM orders WHERE id = ? LIMIT 1`,
            [orderId]
        );
        if (!orders.length) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const order = orders[0];
        if (String(order.email || '').trim().toLowerCase() !== email) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const [items] = await req.pool.execute(
            `SELECT product_name, quantity, price, total
               FROM order_items WHERE order_id = ? ORDER BY id`,
            [orderId]
        );

        const { resolveTrackingInfo } = require('../utils/trackingUrl');
        const tracking = resolveTrackingInfo(order);
        res.json({
            orderId: order.id,
            orderNumber: order.order_number,
            email: order.email,
            status: order.status,
            paymentStatus: order.payment_status,
            totalAmount: Number(order.total_amount),
            trackingNumber: tracking.tracking_number,
            trackingUrl: tracking.tracking_url,
            createdAt: order.created_at,
            customerName: [order.shipping_first_name, order.shipping_last_name].filter(Boolean).join(' '),
            items: items.map((row) => ({
                name: row.product_name,
                quantity: row.quantity,
                price: Number(row.price),
                total: Number(row.total)
            }))
        });
    } catch (error) {
        logger.error('Order confirmation summary error:', error);
        res.status(500).json({ error: 'Failed to load order summary' });
    }
});

// Get order details (authenticated owner or matching guest email only)
router.get('/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const email = String(req.query.email || '').trim().toLowerCase();

        const [orders] = await req.pool.execute(`
            SELECT o.*, 
                   GROUP_CONCAT(
                       JSON_OBJECT(
                           'id', oi.id,
                           'product_id', oi.product_id,
                           'variant_id', oi.variant_id,
                           'quantity', oi.quantity,
                           'price', oi.price,
                           'total', oi.total,
                           'product_name', p.name,
                           'product_sku', p.sku,
                           'variant_name', pv.name
                       )
                   ) as items
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN products p ON oi.product_id = p.id
            LEFT JOIN product_variants pv ON oi.variant_id = pv.id
            WHERE o.id = ?
            GROUP BY o.id
        `, [orderId]);

        if (orders.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const order = orders[0];
        try {
            await assertCanAccessOrder(req, order, { email });
        } catch (e) {
            if (e.status === 403) {
                return res.status(403).json({ error: 'Not allowed to view this order' });
            }
            throw e;
        }

        order.items = order.items ? JSON.parse(`[${order.items}]`) : [];

        res.json(order);

    } catch (error) {
        logger.error('Get order error:', error);
        res.status(500).json({ error: 'Failed to get order' });
    }
});

// Deprecated — use GET /api/user/orders (authenticated)
router.get('/', async (req, res) => {
    res.status(410).json({
        error: 'This endpoint is deprecated. Use GET /api/user/orders with a customer Bearer token.'
    });
});

module.exports = router;
