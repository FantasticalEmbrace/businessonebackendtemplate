'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const promoEngine = require('../services/webPromotionEngine');
const { finalizePaidOrder } = require('../services/finalizePaidOrder');
const {
    getCardAmountDueForOrder,
    applyPendingStoreTendersAtCapture,
    loadLoyaltyProgramSettings,
    persistOrderTenders,
} = require('../services/webCheckoutPayments');
const { cartLookupBinds, hasCartIdentity } = require('../utils/cartSession');
const {
    loadStorePaymentProcessor,
    resolveProcessorCredentials,
    MX_PROCESSOR_ID,
} = require('../services/storePaymentProcessor');
const {
    getLimitedUseToken,
    getPayment,
    isMxmerchantConfigured,
} = require('../services/mxmerchantGateway');
const {
    getMxmerchantApiBase,
    getMxmerchantConfig,
    buildWebsitePosData,
} = require('../utils/mxmerchantEnv');

const router = express.Router();

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

/** Public: MX session token for browser 3-way payment (PCI stays with MX). */
router.get('/mx-client-config', async (req, res) => {
    try {
        const processor = await loadStorePaymentProcessor(req.pool);
        const creds = resolveProcessorCredentials(processor);
        if (processor !== MX_PROCESSOR_ID) {
            return res.json({
                enabled: false,
                processor,
                processorLabel: creds.label,
            });
        }
        if (!isMxmerchantConfigured('website')) {
            return res.json({
                enabled: false,
                processor,
                processorLabel: creds.label,
                merchantId: '',
            });
        }
        const cfg = getMxmerchantConfig('website');
        const sessionToken = await getLimitedUseToken('website');
        return res.json({
            enabled: true,
            processor,
            processorLabel: creds.label,
            merchantId: cfg.merchantId,
            apiBaseUrl: getMxmerchantApiBase('website'),
            sessionToken,
            sandbox: Boolean(cfg.sandbox),
            posDataDefaults: buildWebsitePosData(),
        });
    } catch (e) {
        logger.error('MX client config error:', e);
        return res.json({
            enabled: false,
            processor: MX_PROCESSOR_ID,
            processorLabel: 'MX',
            error: e.message || 'MX not configured',
        });
    }
});

/**
 * POST { orderId, mxPaymentId, customerEmail? }
 * Verifies payment with MX and finalizes the order.
 */
router.post('/process-mx-payment', async (req, res) => {
    try {
        const processor = await loadStorePaymentProcessor(req.pool);
        if (processor !== MX_PROCESSOR_ID) {
            return res.status(400).json({ error: 'This store does not use MX checkout.' });
        }
        if (!isMxmerchantConfigured('website')) {
            return res.status(503).json({ error: 'MX is not configured.' });
        }

        const { orderId, mxPaymentId, customerEmail } = req.body || {};
        const oid = Number(orderId);
        const paymentId = String(mxPaymentId || '').trim();
        if (!Number.isFinite(oid) || oid < 1 || !paymentId) {
            return res.status(400).json({ error: 'orderId and mxPaymentId are required' });
        }

        const connection = await req.pool.getConnection();
        const payLockName = `hmherbs_order_pay_${oid}`;
        let orderRow;
        let payLockHeld = false;
        try {
            const [[lockRow]] = await connection.execute('SELECT GET_LOCK(?, 0) AS got', [payLockName]);
            if (!Number(lockRow?.got)) {
                connection.release();
                return res.status(409).json({ error: 'Payment is already in progress for this order.' });
            }
            payLockHeld = true;
            await connection.beginTransaction();
            const [orders] = await connection.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [oid]);
            if (!orders.length) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found or already paid' });
            }
            orderRow = orders[0];
            if (orderRow.status !== 'pending') {
                await connection.commit();
                if (orderRow.payment_reference) {
                    return res.json({
                        success: true,
                        transactionId: String(orderRow.payment_reference),
                        orderId: oid,
                        orderNumber: orderRow.order_number,
                        idempotent: true,
                    });
                }
                return res.status(404).json({ error: 'Order not found or already paid' });
            }
            if (orderRow.payment_reference) {
                await connection.commit();
                return res.json({
                    success: true,
                    transactionId: String(orderRow.payment_reference),
                    orderId: oid,
                    orderNumber: orderRow.order_number,
                    idempotent: true,
                });
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
                    logger.warn('Failed to release order payment lock', { orderId: oid, err: releaseErr.message });
                }
            }
            connection.release();
        }

        try {
            await assertCanPayOrder(req, orderRow, { ...req.body, customerEmail });
        } catch (e) {
            if (e.status === 403) return res.status(403).json({ error: 'Not allowed to pay for this order' });
            throw e;
        }

        const cardAmountDue = await getCardAmountDueForOrder(req.pool, oid);
        if (cardAmountDue <= 0.005) {
            return res.status(400).json({ error: 'This order has no card balance remaining.' });
        }

        const sale = await getPayment(paymentId, 'website');
        if (!sale.ok) {
            return res.status(402).json({
                success: false,
                error: sale.responseText || 'Payment not approved',
            });
        }

        const paidAmount = promoEngine.roundMoney(Number(sale.raw?.amount || 0));
        const expected = promoEngine.roundMoney(cardAmountDue);
        if (Math.abs(paidAmount - expected) > 0.02) {
            return res.status(400).json({ error: 'Payment amount does not match order balance.' });
        }

        const payId = sale.paymentId || paymentId;
        const authUser = await getAuthenticatedUserFromRequest(req);

        const payConnection = await req.pool.getConnection();
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
                    loyaltySettings,
                });
            } catch (tenderErr) {
                if (tenderErr.code !== 'PENDING_TENDERS_UNSUPPORTED') throw tenderErr;
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
                            amount: expected,
                            terminalAuthCode: sale.authCode || payId,
                            terminalReference: payId,
                        },
                    ]);
                }
            } catch (tenderErr) {
                if (tenderErr.code !== 'ER_NO_SUCH_TABLE') {
                    logger.warn('Could not persist MX card tender row', { orderId: oid, err: tenderErr.message });
                }
            }
            await payConnection.commit();
        } catch (preFinalizeErr) {
            await payConnection.rollback();
            throw preFinalizeErr;
        } finally {
            payConnection.release();
        }

        let finalizeResult;
        try {
            finalizeResult = await finalizePaidOrder(req.pool, {
                orderId: oid,
                paymentId: String(payId),
                paymentStatus: 'paid',
                paymentProcessor: MX_PROCESSOR_ID,
                paymentToken: sale.paymentToken || null,
            });
        } catch (e) {
            if (e.code === 'ORDER_NOT_PENDING') {
                return res.status(409).json({ error: 'Order was already processed.' });
            }
            throw e;
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
                logger.warn('Cart clear after MX payment failed', { orderId: oid, err: cartErr.message });
            }
        }

        return res.json({
            success: true,
            transactionId: payId,
            orderId: oid,
            orderNumber: finalizeResult?.orderNumber || orderRow.order_number,
            trackingNumber: finalizeResult?.trackingNumber || null,
            authCode: sale.authCode || null,
            last4: sale.last4 || null,
        });
    } catch (e) {
        logger.error('MX process payment error:', e);
        res.status(500).json({ error: e.message || 'Payment processing failed' });
    }
});

module.exports = router;
