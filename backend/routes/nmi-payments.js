'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const promoEngine = require('../services/webPromotionEngine');
const { applyWebDestinationTax } = require('../services/webDestinationTax');
const { nmiSale, nmiVoid } = require('../services/nmiGateway');
const nmiVaultCards = require('../services/nmiVaultCards');
const { finalizePaidOrder } = require('../services/finalizePaidOrder');
const { createSubscriptionsFromPaidOrder } = require('../services/storeSubscriptionService');
const { getCardAmountDueForOrder, persistOrderTenders, applyPendingStoreTendersAtCapture, loadLoyaltyProgramSettings } = require('../services/webCheckoutPayments');
const { cartLookupBinds, hasCartIdentity } = require('../utils/cartSession');
const InventoryService = require('../services/inventory');
const {
    getNmiCollectJsUrl,
    isNmiSandboxHint,
    isNmiWalletsDisabled,
    nmiResolveTokenizationCollectJs,
    nmiTokenCreatePreflightOnce,
    NMI_TOKEN_CREATE_URL_SANDBOX,
    NMI_TOKEN_CREATE_URL_SECURE,
    shouldSkipNmiTokenizationPreflight
} = require('../utils/nmiEnv');
const {
    loadStorePaymentProcessor,
    resolveProcessorCredentials
} = require('../services/storePaymentProcessor');
const {
    markUnpaidPaymentOutcome,
    nmiUnpaidOutcomeFromSale
} = require('../services/unpaidPaymentStatus');
const {
    beginPaymentAttempt,
    completePaymentAttempt,
    failPaymentAttempt
} = require('../services/paymentIdempotency');
const { formatNmiDeclineMessage } = require('../services/nmiDeclineMessages');

const router = express.Router();

function getOrderPaymentMethod(orderRow) {
    const fromColumn = String(orderRow?.payment_method || '').trim().toLowerCase();
    if (fromColumn) return fromColumn;
    const notes = String(orderRow?.notes || '');
    const match = notes.match(/Payment method:\s*([a-z_]+)/i);
    return match ? match[1].toLowerCase() : '';
}

function mapInventoryHttpError(err) {
    if (!err || err.code !== 'INSUFFICIENT_INVENTORY') return null;
    return {
        status: 409,
        message:
            err.message ||
            'An item in your order is no longer in stock. Update your cart and try again.',
        code: 'INSUFFICIENT_INVENTORY',
        productId: err.productId,
        productName: err.productName,
        available: err.available,
        requested: err.requested
    };
}

async function assertOrderInventoryBeforeCharge(pool, orderItems) {
    const inventoryService = new InventoryService(pool);
    const inventoryItems = orderItems.map((oi) => ({
        productId: Number(oi.product_id),
        variantId: oi.variant_id ?? null,
        quantity: Number(oi.quantity)
    }));
    await inventoryService.validateOrderInventoryAvailability(inventoryItems, { forUpdate: true });
}

async function getAuthenticatedUserFromRequest(req) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return null;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = Number(decoded?.userId);
        if (!Number.isInteger(userId) || userId <= 0) return null;

        const [rows] = await req.pool.execute(
            'SELECT id, email, tax_exempt, tax_exempt_id FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        return rows[0] || null;
    } catch {
        return null;
    }
}

async function assertCanPayOrder(req, orderRow, body) {
    const sessionId = String(req.headers['x-session-id'] || req.sessionID || '');
    const email = String(body?.customerEmail || body?.email || '').trim().toLowerCase();

    if (orderRow.user_id) {
        const authUser = await getAuthenticatedUserFromRequest(req);
        if (!authUser || Number(authUser.id) !== Number(orderRow.user_id)) {
            const err = new Error('FORBIDDEN');
            err.status = 403;
            throw err;
        }
        return;
    }
    if (email && String(orderRow.email || '').trim().toLowerCase() === email) return;

    const err = new Error('FORBIDDEN');
    err.status = 403;
    throw err;
}

/** Public: Collect.js URL + tokenization key (never the private security key). */
router.get('/nmi-client-config', async (req, res) => {
    const processor = await loadStorePaymentProcessor(req.pool);
    const creds = resolveProcessorCredentials(processor);
    const tokenizationKey = creds.publicKey;
    const processorLabel = creds.label;
    if (!tokenizationKey) {
        return res.json({
            enabled: false,
            processor,
            processorLabel,
            tokenizationKey: '',
            collectJsUrl: creds.collectJsUrl || getNmiCollectJsUrl(),
            disableWallets: isNmiWalletsDisabled()
        });
    }

    try {
        const resolved = await nmiResolveTokenizationCollectJs(tokenizationKey);
        if (!resolved.ok) {
            logger.warn(
                `${processorLabel} tokenization key rejected by token preflight (401/403). Use the Collect.js public tokenization key from your merchant portal (not the Direct Post security key), set NMI_COLLECT_JS_URL for sandbox, or fix NMI_PUBLIC_TOKENIZATION_KEY.`
            );
            return res.json({
                enabled: false,
                processor,
                processorLabel,
                tokenizationKey: '',
                collectJsUrl: resolved.collectJsUrl || creds.collectJsUrl || getNmiCollectJsUrl(),
                variant: 'inline',
                sandbox: Boolean(creds.sandbox),
                disableWallets: isNmiWalletsDisabled(),
                preflightRejected: true
            });
        }
        const collectJsUrl = resolved.collectJsUrl || creds.collectJsUrl || getNmiCollectJsUrl();
        const probeUrl = String(collectJsUrl).toLowerCase().includes('sandbox')
            ? NMI_TOKEN_CREATE_URL_SANDBOX
            : NMI_TOKEN_CREATE_URL_SECURE;
        if (
            !shouldSkipNmiTokenizationPreflight() &&
            !(await nmiTokenCreatePreflightOnce(probeUrl, tokenizationKey))
        ) {
            logger.warn(
                `${processorLabel} tokenization key rejected at ${probeUrl}. Update NMI_PUBLIC_TOKENIZATION_KEY (Collect.js public key, not the private security key).`
            );
            return res.json({
                enabled: false,
                processor,
                processorLabel,
                tokenizationKey: '',
                collectJsUrl,
                variant: 'inline',
                sandbox: Boolean(creds.sandbox),
                disableWallets: isNmiWalletsDisabled(),
                preflightRejected: true
            });
        }
        return res.json({
            enabled: true,
            processor,
            processorLabel,
            tokenizationKey,
            collectJsUrl,
            variant: 'inline',
            sandbox: Boolean(creds.sandbox),
            disableWallets: isNmiWalletsDisabled()
        });
    } catch (e) {
        logger.warn('Payment tokenization preflight error; still offering Collect.js', { err: e && e.message });
        return res.json({
            enabled: true,
            processor,
            processorLabel,
            tokenizationKey,
            collectJsUrl: creds.collectJsUrl || getNmiCollectJsUrl(),
            variant: 'inline',
            sandbox: Boolean(creds.sandbox),
            disableWallets: isNmiWalletsDisabled()
        });
    }
});

/** List saved NMI vault cards for logged-in customer */
router.get('/saved-cards', async (req, res) => {
    const authUser = await getAuthenticatedUserFromRequest(req);
    if (!authUser) return res.status(401).json({ error: 'Sign in to view saved cards' });
    try {
        const cards = await nmiVaultCards.listUserVaultCards(req.pool, authUser.id);
        res.json({ cards });
    } catch (e) {
        logger.error('List saved cards error:', e);
        res.status(500).json({ error: 'Failed to load saved cards' });
    }
});

/** Save card to NMI Customer Vault (Collect.js payment_token only — never PAN) */
router.post('/saved-cards', async (req, res) => {
    const authUser = await getAuthenticatedUserFromRequest(req);
    if (!authUser) return res.status(401).json({ error: 'Sign in to save a card' });
    const payment_token = String(req.body?.payment_token || '').trim();
    if (!payment_token) return res.status(400).json({ error: 'payment_token required' });
    try {
        const card = await nmiVaultCards.saveVaultCard(req.pool, authUser.id, {
            paymentToken: payment_token,
            setAsDefault: Boolean(req.body?.setAsDefault),
            cardholderName: req.body?.cardholderName
        });
        res.status(201).json({ success: true, card });
    } catch (e) {
        res.status(e.code ? 400 : 500).json({ error: e.message, code: e.code });
    }
});

router.delete('/saved-cards/:id', async (req, res) => {
    const authUser = await getAuthenticatedUserFromRequest(req);
    if (!authUser) return res.status(401).json({ error: 'Sign in required' });
    try {
        await nmiVaultCards.deleteVaultCard(req.pool, authUser.id, Number(req.params.id));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to remove card' });
    }
});

/**
 * POST { orderId, payment_token, customerEmail? }
 * OR { orderId, savedCardId } for vault charge
 * Re-prices from order lines, charges NMI, finalizes order, clears server cart when session matches.
 */
router.post('/process-payment', async (req, res) => {
    let attemptToken = null;
    let attemptOrderId = null;
    let attemptIdempotencyKey = '';
    try {
        const processor = await loadStorePaymentProcessor(req.pool);
        if (processor === 'mxmerchant') {
            return res.status(400).json({ error: 'This store uses MX checkout. Use process-mx-payment instead.' });
        }
        const creds = resolveProcessorCredentials(processor);
        const securityKey = creds.privateKey;
        if (!securityKey) {
            return res.status(503).json({ error: 'Payment processing is not configured.' });
        }

        const { orderId, payment_token: paymentTokenRaw, savedCardId, saveCard, customerEmail, idempotencyKey } = req.body || {};
        const oid = Number(orderId);
        const payment_token = String(paymentTokenRaw || '').trim();
        const vaultCardId = savedCardId != null ? Number(savedCardId) : null;
        if (!Number.isFinite(oid) || oid < 1 || (!payment_token && !vaultCardId)) {
            return res.status(400).json({ error: 'orderId and payment_token or savedCardId are required' });
        }

        const idem = beginPaymentAttempt(oid, idempotencyKey);
        if (idem.duplicate) {
            if (idem.cached) {
                return res.json(idem.cached);
            }
            return res.status(409).json({
                error: 'Payment is already in progress for this order. Please wait…',
                code: 'PAYMENT_IN_PROGRESS'
            });
        }
        attemptToken = idem.token;
        attemptOrderId = oid;
        attemptIdempotencyKey = idempotencyKey;

        const connection = await req.pool.getConnection();
        const payLockName = `bo_order_pay_${oid}`;
        let orderRow;
        let payLockHeld = false;
        try {
            const [[lockRow]] = await connection.execute('SELECT GET_LOCK(?, 0) AS got', [payLockName]);
            if (!Number(lockRow?.got)) {
                connection.release();
                failPaymentAttempt(oid, idempotencyKey, attemptToken);
                return res.status(409).json({ error: 'Payment is already in progress for this order.' });
            }
            payLockHeld = true;

            await connection.beginTransaction();
            const [orders] = await connection.execute(
                'SELECT * FROM orders WHERE id = ? FOR UPDATE',
                [oid]
            );
            if (!orders.length) {
                await connection.rollback();
                failPaymentAttempt(oid, idempotencyKey, attemptToken);
                return res.status(404).json({ error: 'Order not found or already paid' });
            }
            orderRow = orders[0];

            if (orderRow.status !== 'pending') {
                await connection.commit();
                if (orderRow.payment_reference) {
                    const paidPayload = {
                        success: true,
                        transactionId: String(orderRow.payment_reference),
                        orderId: oid,
                        orderNumber: orderRow.order_number,
                        idempotent: true
                    };
                    completePaymentAttempt(oid, idempotencyKey, attemptToken, paidPayload);
                    return res.json(paidPayload);
                }
                failPaymentAttempt(oid, idempotencyKey, attemptToken);
                return res.status(404).json({ error: 'Order not found or already paid' });
            }

            if (orderRow.payment_reference) {
                // The NMI charge already succeeded and stamped payment_reference, but
                // status is still 'pending' — finalizePaidOrder() never completed (e.g.
                // a process crash/restart between the gateway response and finalize).
                // Self-heal by finishing finalization now instead of returning a bare
                // "success" for an order that would otherwise sit as an ambiguous
                // pending/"Awaiting payment" row forever despite being paid.
                await connection.commit();
                const stampedRef = String(orderRow.payment_reference);
                try {
                    const healResult = await finalizePaidOrder(req.pool, {
                        orderId: oid,
                        paymentId: stampedRef,
                        paymentStatus: 'paid',
                        paymentProcessor: orderRow.payment_processor || processor || undefined,
                        // Charge already captured — never fail-closed on stock for recovery.
                        allowOversell: true
                    });
                    logger.warn('Self-healed order stuck pending after payment_reference was stamped', {
                        orderId: oid,
                        paymentReference: stampedRef
                    });
                    const healPayload = {
                        success: true,
                        transactionId: stampedRef,
                        orderId: oid,
                        orderNumber: healResult?.orderNumber || orderRow.order_number,
                        trackingNumber: healResult?.trackingNumber || null,
                        idempotent: true
                    };
                    completePaymentAttempt(oid, idempotencyKey, attemptToken, healPayload);
                    return res.json(healPayload);
                } catch (healErr) {
                    if (healErr.code !== 'ORDER_NOT_PENDING') {
                        logger.error('Self-heal finalize failed for order stuck pending with payment_reference set', {
                            orderId: oid,
                            paymentReference: stampedRef,
                            err: healErr.message
                        });
                    }
                    // Either another request just finished finalizing it (ORDER_NOT_PENDING,
                    // fine) or the heal attempt itself failed — either way the charge already
                    // happened, so still report success rather than a false decline/error.
                    const healPayload = {
                        success: true,
                        transactionId: stampedRef,
                        orderId: oid,
                        orderNumber: orderRow.order_number,
                        idempotent: true
                    };
                    completePaymentAttempt(oid, idempotencyKey, attemptToken, healPayload);
                    return res.json(healPayload);
                }
            }

            await connection.commit();
        } catch (lockErr) {
            await connection.rollback();
            throw lockErr;
        } finally {
            if (payLockHeld) {
                try {
                    await connection.execute('SELECT RELEASE_LOCK(?)', [payLockName]);
                } catch (releaseErr) {
                    logger.warn('Failed to release order payment lock', {
                        orderId: oid,
                        err: releaseErr.message
                    });
                }
            }
            connection.release();
        }

        try {
            await assertCanPayOrder(req, orderRow, { ...req.body, customerEmail });
        } catch (e) {
            if (e.status === 403) {
                return res.status(403).json({ error: 'Not allowed to pay for this order' });
            }
            throw e;
        }

        const method = getOrderPaymentMethod(orderRow);
        if (method !== 'credit_card' && method !== 'debit_card' && method !== 'split') {
            return res.status(400).json({ error: 'This order does not use card payment.' });
        }

        const cardAmountDue = await getCardAmountDueForOrder(req.pool, oid);
        if (cardAmountDue <= 0.005) {
            return res.status(400).json({ error: 'This order has no card balance remaining.' });
        }

        const [items] = await req.pool.execute(
            'SELECT product_id, variant_id, quantity, price FROM order_items WHERE order_id = ?',
            [oid]
        );
        const normalized = items.map((oi) => ({
            product_id: Number(oi.product_id),
            variant_id: oi.variant_id,
            quantity: Number(oi.quantity),
            price: 0
        }));

        let applyTaxExemption = false;
        let customerType = null;
        if (orderRow.user_id) {
            const [[user]] = await req.pool.execute(
                'SELECT tax_exempt, tax_exempt_id, customer_type FROM users WHERE id = ? LIMIT 1',
                [orderRow.user_id]
            );
            customerType = user?.customer_type;
            const hasTaxExemptProof = Boolean(user?.tax_exempt_id && String(user.tax_exempt_id).trim().length >= 3);
            applyTaxExemption = Boolean(user?.tax_exempt) && hasTaxExemptProof;
        }

        let recheck;
        try {
            recheck = await promoEngine.previewOrApplyTotals(req.pool, {
                cartItems: normalized,
                promoCode: String(orderRow.promo_code || '').trim(),
                email: orderRow.email,
                applyTaxExemption,
                customerType,
                userId: orderRow.user_id || undefined,
                shippingMethod: String(orderRow.shipping_method || '').trim() || undefined,
                shippingAmount:
                    orderRow.shipping_amount != null ? Number(orderRow.shipping_amount) : undefined
            });
        } catch (e) {
            logger.error('NMI price recheck failed:', e);
            return res.status(400).json({ error: 'Unable to verify order pricing.' });
        }

        const stored = promoEngine.roundMoney(Number(orderRow.total_amount));
        const storedSubtotal = promoEngine.roundMoney(Number(orderRow.subtotal));
        const storedShipping = promoEngine.roundMoney(Number(orderRow.shipping_amount) || 0);
        const storedDiscount = promoEngine.roundMoney(Number(orderRow.discount_amount) || 0);
        const recheckSubtotal = promoEngine.roundMoney(Number(recheck.totals.merchandiseSubtotal) || 0);
        const recheckShipping = promoEngine.roundMoney(Number(recheck.totals.shippingAfter) || 0);
        const recheckDiscount = promoEngine.roundMoney(Number(recheck.totals.totalDiscountAmount) || 0);
        const orderAgeMs = Math.max(0, Date.now() - new Date(orderRow.created_at).getTime());
        const merchandiseStillMatches =
            Math.abs(recheckSubtotal - storedSubtotal) <= 0.02 &&
            Math.abs(recheckShipping - storedShipping) <= 0.02 &&
            Math.abs(recheckDiscount - storedDiscount) <= 0.02;

        // Fresh unpaid drafts already ran ZipTax at order create — skip a second round-trip
        // so a flaky tax API cannot block / falsely fail a valid card charge.
        let expected = promoEngine.roundMoney(recheck.totals.totalAmount);
        if (merchandiseStillMatches && orderAgeMs <= 20 * 60 * 1000) {
            expected = stored;
        } else {
            try {
                const taxed = await applyWebDestinationTax(
                    req.pool,
                    recheck.totals,
                    {
                        street1: orderRow.shipping_address_line_1 || '',
                        city: orderRow.shipping_city || '',
                        state: orderRow.shipping_state || '',
                        postalCode: orderRow.shipping_postal_code || '',
                        name: [orderRow.shipping_first_name, orderRow.shipping_last_name]
                            .filter(Boolean)
                            .join(' ')
                    },
                    { applyTaxExemption, tenant: 'business_one' }
                );
                expected = promoEngine.roundMoney(taxed.totals.totalAmount);
            } catch (taxErr) {
                logger.warn('NMI price recheck destination tax failed', {
                    orderId: oid,
                    code: taxErr.code,
                    message: taxErr.message
                });
                // Merchandise still matches the draft: keep the create-time total instead of
                // turning a ZipTax outage into a failed checkout.
                if (merchandiseStillMatches) {
                    expected = stored;
                } else {
                    return res.status(400).json({
                        error: 'Unable to verify sales tax for this order. Please start checkout again.'
                    });
                }
            }
        }

        if (Math.abs(expected - stored) > 0.02) {
            logger.warn('NMI price recheck mismatch', {
                orderId: oid,
                expected,
                stored,
                delta: promoEngine.roundMoney(expected - stored)
            });
            return res.status(400).json({
                error: 'Order total no longer matches current prices or promotions. Please start checkout again.'
            });
        }

        const chargeTotal = promoEngine.roundMoney(cardAmountDue);
        if (chargeTotal > stored + 0.02) {
            failPaymentAttempt(oid, idempotencyKey, attemptToken);
            return res.status(400).json({ error: 'Card charge exceeds order total.' });
        }

        try {
            await assertOrderInventoryBeforeCharge(req.pool, items);
        } catch (invErr) {
            failPaymentAttempt(oid, idempotencyKey, attemptToken);
            const mapped = mapInventoryHttpError(invErr);
            if (mapped) {
                return res.status(mapped.status).json({
                    error: mapped.message,
                    code: mapped.code,
                    productId: mapped.productId,
                    productName: mapped.productName,
                    available: mapped.available,
                    requested: mapped.requested
                });
            }
            throw invErr;
        }

        const amountStr = chargeTotal.toFixed(2);
        const authUser = await getAuthenticatedUserFromRequest(req);

        let sale;
        let savedCardIdForSubscription = vaultCardId || null;
        if (vaultCardId) {
            if (!authUser) return res.status(401).json({ error: 'Sign in to use a saved card' });
            sale = await nmiVaultCards.chargeVaultCard(req.pool, authUser.id, vaultCardId, amountStr);
            sale = {
                ok: sale.ok,
                responseText: sale.responseText,
                transactionId: sale.transactionId,
                fields: sale.fields,
                responseCode: sale.responseCode
            };
        } else {
            sale = await nmiSale({
                securityKey,
                amount: amountStr,
                paymentToken: payment_token
            });
            if (sale.ok && saveCard && authUser) {
                try {
                    const saved = await nmiVaultCards.saveVaultCard(req.pool, authUser.id, {
                        paymentToken: payment_token,
                        setAsDefault: Boolean(req.body?.setAsDefault)
                    });
                    savedCardIdForSubscription = saved.id;
                } catch (vaultErr) {
                    logger.warn('Save card after checkout failed', { err: vaultErr.message });
                }
            }
        }

        if (!sale.ok) {
            failPaymentAttempt(oid, idempotencyKey, attemptToken);
            const unpaidOutcome = nmiUnpaidOutcomeFromSale(sale);
            try {
                await markUnpaidPaymentOutcome(req.pool, oid, unpaidOutcome);
            } catch (markErr) {
                logger.warn('Could not mark unpaid payment outcome after NMI response', {
                    orderId: oid,
                    unpaidOutcome,
                    err: markErr.message
                });
            }
            return res.status(402).json({
                success: false,
                error: unpaidOutcome === 'declined'
                    ? formatNmiDeclineMessage(sale)
                    : 'We could not complete this payment. Your card was not charged — please try again.',
                declineCode: unpaidOutcome === 'declined' ? 'CARD_DECLINED' : 'PAYMENT_FAILED',
                nmiResponse: sale.responseCode,
                nmi: sale.fields
            });
        }

        const payId = sale.transactionId || sale.fields?.authcode || `nmi-${oid}`;

        const payConnection = await req.pool.getConnection();
        let finalizeResult;
        try {
            await payConnection.beginTransaction();

            let loyaltyUser = authUser;
            if (!loyaltyUser && orderRow.user_id) {
                const [[u]] = await payConnection.execute(
                    'SELECT id, email, tax_exempt, tax_exempt_id, customer_type FROM users WHERE id = ? LIMIT 1',
                    [orderRow.user_id]
                );
                loyaltyUser = u || null;
            }

            const loyaltySettings = await loadLoyaltyProgramSettings(req.pool);
            try {
                await applyPendingStoreTendersAtCapture(payConnection, req.pool, {
                    orderId: oid,
                    user: loyaltyUser,
                    loyaltySettings
                });
            } catch (tenderErr) {
                if (tenderErr.code !== 'PENDING_TENDERS_UNSUPPORTED') throw tenderErr;
            }

            if (orderRow.web_promotion_id) {
                const [[existingPromo]] = await payConnection.execute(
                    'SELECT id FROM web_promotion_redemptions WHERE order_id = ? LIMIT 1',
                    [oid]
                );
                if (!existingPromo) {
                    await promoEngine.insertRedemptionRow(payConnection, {
                        promotionId: orderRow.web_promotion_id,
                        orderId: oid,
                        email: orderRow.email,
                        userId: orderRow.user_id,
                        merchandiseDisc: recheck?.totals?.merchandiseDiscount ?? 0,
                        shippingDisc: recheck?.totals?.shippingDiscount ?? 0
                    });
                }
            }

            try {
                const [existing] = await payConnection.execute(
                    `SELECT id FROM order_payment_tenders
                      WHERE order_id = ? AND tender_type = 'card_terminal' LIMIT 1`,
                    [oid]
                );
                if (!existing.length) {
                    await persistOrderTenders(payConnection, oid, [
                        {
                            type: 'card_terminal',
                            amount: chargeTotal,
                            terminalAuthCode: String(payId),
                            terminalReference: sale.transactionId || null
                        }
                    ]);
                }
            } catch (tenderErr) {
                if (tenderErr.code !== 'ER_NO_SUCH_TABLE') {
                    logger.warn('Could not persist card tender row after NMI payment', {
                        orderId: oid,
                        err: tenderErr.message
                    });
                }
            }

            await payConnection.commit();
        } catch (preFinalizeErr) {
            await payConnection.rollback();
            if (sale.transactionId) {
                try {
                    await nmiVoid({ securityKey, transactionId: sale.transactionId });
                } catch (voidErr) {
                    logger.error('NMI void after tender apply failure', {
                        orderId: oid,
                        err: voidErr.message
                    });
                }
            }
            failPaymentAttempt(oid, idempotencyKey, attemptToken);
            throw preFinalizeErr;
        } finally {
            payConnection.release();
        }

        try {
            finalizeResult = await finalizePaidOrder(req.pool, {
                orderId: oid,
                paymentId: String(payId),
                paymentStatus: 'paid',
                paymentProcessor: processor,
            });
        } catch (e) {
            if (e.code === 'ORDER_NOT_PENDING') {
                if (sale.transactionId) {
                    try {
                        await nmiVoid({ securityKey, transactionId: sale.transactionId });
                    } catch (voidErr) {
                        logger.error('NMI void after duplicate finalize', {
                            orderId: oid,
                            err: voidErr.message
                        });
                    }
                }
                failPaymentAttempt(oid, idempotencyKey, attemptToken);
                return res.status(409).json({ error: 'Order was already processed.' });
            }
            if (sale.transactionId) {
                try {
                    await nmiVoid({ securityKey, transactionId: sale.transactionId });
                } catch (voidErr) {
                    logger.error('NMI void after finalize failure', { orderId: oid, err: voidErr.message });
                }
            }
            const mappedInv = mapInventoryHttpError(e);
            if (mappedInv) {
                failPaymentAttempt(oid, idempotencyKey, attemptToken);
                try {
                    await markUnpaidPaymentOutcome(req.pool, oid, 'failed');
                } catch (markErr) {
                    logger.warn('Could not mark payment failed after inventory error', {
                        orderId: oid,
                        err: markErr.message
                    });
                }
                return res.status(mappedInv.status).json({
                    error: mappedInv.message,
                    code: mappedInv.code,
                    productId: mappedInv.productId,
                    productName: mappedInv.productName,
                    available: mappedInv.available,
                    requested: mappedInv.requested
                });
            }
            failPaymentAttempt(oid, idempotencyKey, attemptToken);
            throw e;
        }

        const subscriptionUserId = authUser?.id || orderRow.user_id;
        if (subscriptionUserId && savedCardIdForSubscription) {
            try {
                await createSubscriptionsFromPaidOrder(req.pool, {
                    orderId: oid,
                    userId: subscriptionUserId,
                    paymentCardId: savedCardIdForSubscription,
                });
            } catch (subErr) {
                logger.error('Subscription signup after payment failed', {
                    orderId: oid,
                    message: subErr.message,
                });
            }
        }

        const cartUserId = authUser?.id ?? null;
        const cartSessionId = req.headers['x-session-id'] || req.sessionID || null;
        if (hasCartIdentity(cartUserId, cartSessionId)) {
            try {
                const [userId, sessionId] = cartLookupBinds(cartUserId, cartSessionId);
                const [carts] = await req.pool.execute(
                    'SELECT id FROM shopping_carts WHERE user_id = ? OR session_id = ?',
                    [userId, sessionId]
                );
                if (carts.length > 0) {
                    await req.pool.execute('DELETE FROM cart_items WHERE cart_id = ?', [carts[0].id]);
                }
            } catch (cartErr) {
                logger.warn('Cart clear after NMI payment failed (payment already captured)', {
                    orderId: oid,
                    err: cartErr && cartErr.message
                });
            }
        }

        const successPayload = {
            success: true,
            transactionId: String(payId),
            orderId: oid,
            orderNumber: finalizeResult?.orderNumber || orderRow.order_number,
            trackingNumber: finalizeResult?.trackingNumber || null,
            nmi: sale.fields
        };
        completePaymentAttempt(oid, idempotencyKey, attemptToken, successPayload);
        res.json(successPayload);
    } catch (err) {
        logger.error('NMI process-payment error:', err);
        if (attemptToken && attemptOrderId) {
            failPaymentAttempt(attemptOrderId, attemptIdempotencyKey, attemptToken);
        }
        res.status(500).json({ error: err.message || 'Payment failed' });
    }
});

module.exports = router;
