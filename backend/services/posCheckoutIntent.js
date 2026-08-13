'use strict';

const crypto = require('crypto');
const { resolvePosProcessorCredentials, loadPosPaymentProcessor, MX_PROCESSOR_ID } = require('./storePaymentProcessor');
const { nmiPoiSale, nmiSale, nmiPoiPollStatus } = require('./nmiGateway');
const { getPayment: getMxPayment } = require('./mxmerchantGateway');
const { chargeMxTerminal } = require('./paymentGatewayOps');
const integrationCredentials = require('./integrationCredentials');
const { loadPosCardCheckoutSettings } = require('./posCardCheckoutSettings');
const { buildRegisterHardwareProfile } = require('./posRegisterHardware');

async function resolveCheckoutPoiDeviceId(pool, deviceRecordId) {
    if (deviceRecordId) {
        const globalCheckout = await loadPosCardCheckoutSettings(pool);
        const profile = await buildRegisterHardwareProfile(pool, deviceRecordId, {
            globalCheckout
        });
        const poi = String(profile?.runtime?.poiDeviceId || '').trim();
        if (poi) return poi;
    }
    const checkoutSettings = await loadPosCardCheckoutSettings(pool);
    return String(checkoutSettings.poiDeviceId || '').trim();
}

async function assertTerminalCheckoutReady(pool, deviceRecordId) {
    const checkoutSettings = await loadPosCardCheckoutSettings(pool);
    const poiDeviceId = await resolveCheckoutPoiDeviceId(pool, deviceRecordId);
    if (checkoutSettings.displayMode !== 'nmi_terminal' || !poiDeviceId) {
        const err = new Error('NMI terminal checkout is not configured for this register');
        err.code = 'TERMINAL_NOT_CONFIGURED';
        throw err;
    }
    return poiDeviceId;
}

const INTENT_TTL_MS = 15 * 60 * 1000;

function mapIntentRow(row) {
    if (!row) return null;
    let cart = row.cart_json;
    if (typeof cart === 'string') {
        try {
            cart = JSON.parse(cart);
        } catch {
            cart = null;
        }
    }
    return {
        id: row.id,
        deviceId: row.device_id,
        status: row.status,
        amount: Number(row.amount),
        cart,
        checkoutMode: row.checkout_mode || '',
        authCode: row.auth_code || '',
        lastFour: row.last_four || '',
        cardBrand: row.card_brand || '',
        transactionId: row.nmi_transaction_id || '',
        errorMessage: row.error_message || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at
    };
}

function checkoutPhaseForIntent(intent) {
    if (!intent) return 'idle';
    if (intent.status === 'awaiting') return 'awaiting_payment';
    if (intent.status === 'processing') return 'processing';
    return intent.status;
}

async function upsertDisplayCheckout(pool, deviceId, intent, checkoutMode) {
    const [rows] = await pool.execute(
        'SELECT payload FROM pos_display_snapshots WHERE device_id = ? LIMIT 1',
        [deviceId]
    );
    let existing = {};
    if (rows[0]?.payload) {
        try {
            existing = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
        } catch {
            existing = {};
        }
    }
    const mode = checkoutMode || intent?.checkoutMode || '';
    const payload = {
        ...existing,
        checkout: intent
            ? {
                  phase: checkoutPhaseForIntent(intent),
                  intentId: intent.id,
                  amount: intent.amount,
                  mode,
                  updatedAt: new Date().toISOString()
              }
            : { phase: 'idle' }
    };
    await pool.execute(
        `INSERT INTO pos_display_snapshots (device_id, payload) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
        [deviceId, JSON.stringify(payload)]
    );
}

async function cancelStaleIntentsForDevice(pool, deviceId) {
    await pool.execute(
        `UPDATE pos_checkout_intents
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE device_id = ? AND status IN ('awaiting', 'processing')`,
        [String(deviceId || '').slice(0, 64)]
    );
    await upsertDisplayCheckout(pool, deviceId, null);
}

async function claimIntentForProcessing(pool, intentId) {
    const [result] = await pool.execute(
        `UPDATE pos_checkout_intents
         SET status = 'processing', error_message = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'awaiting'`,
        [intentId]
    );
    if (!result.affectedRows) {
        const existing = await getCheckoutIntent(pool, intentId);
        if (existing?.status === 'approved') return existing;
        const err = new Error(
            existing?.status === 'processing'
                ? 'Checkout is already processing'
                : 'Checkout is no longer active'
        );
        err.code = existing ? 'INVALID_STATE' : 'NOT_FOUND';
        throw err;
    }
    return getCheckoutIntent(pool, intentId);
}

async function revertIntentToAwaiting(pool, intentId, message) {
    await pool.execute(
        `UPDATE pos_checkout_intents
         SET status = 'awaiting', error_message = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'processing'`,
        [String(message || 'Payment could not be completed').slice(0, 500), intentId]
    );
}

async function resolveCredentialsForMode(pool) {
    const processor = pool ? await loadPosPaymentProcessor(pool) : 'nmi';
    return resolvePosProcessorCredentials(processor);
}

async function applySaleResult(pool, intentId, deviceId, sale) {
    if (sale.asyncStatusGuid && !sale.ok) {
        const creds = await resolveCredentialsForMode(pool);
        for (let i = 0; i < 8; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const polled = await nmiPoiPollStatus({
                securityKey: creds.privateKey,
                asyncStatusGuid: sale.asyncStatusGuid,
                transactUrl: creds.transactUrl,
            });
            if (polled.pending) continue;
            if (polled.ok) {
                sale = { ...sale, ok: true, transactionId: polled.transactionId, fields: polled.fields, responseText: polled.responseText };
                break;
            }
            sale = { ...sale, ok: false, responseText: polled.responseText, fields: polled.fields };
            break;
        }
    }

    if (sale.asyncStatusGuid && !sale.ok) {
        return getCheckoutIntent(pool, intentId);
    }

    if (!sale.ok) {
        const message = sale.responseText || 'Card declined';
        const isDuplicate = /duplicate transaction/i.test(message);
        if (isDuplicate && sale.transactionId) {
            sale.ok = true;
        } else {
            await pool.execute(
                `UPDATE pos_checkout_intents SET status = 'declined', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [message.slice(0, 500), intentId]
            );
            const declined = await getCheckoutIntent(pool, intentId);
            await upsertDisplayCheckout(pool, deviceId, declined, declined?.checkoutMode);
            const err = new Error(message);
            err.code = 'CARD_DECLINED';
            err.data = { intent: declined };
            throw err;
        }
    }

    const authCode = String(sale.fields.authcode || sale.fields.authorizationcode || '').trim();
    const lastFour = String(sale.fields.cc_number || sale.fields.ccnumber || '')
        .replace(/\D/g, '')
        .slice(-4);
    const cardBrand = String(sale.fields.cc_type || sale.fields.cctype || 'card').trim();

    await pool.execute(
        `UPDATE pos_checkout_intents SET
            status = 'approved',
            auth_code = ?,
            last_four = ?,
            card_brand = ?,
            nmi_transaction_id = ?,
            error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [authCode || null, lastFour || null, cardBrand || null, sale.transactionId || null, intentId]
    );
    const approved = await getCheckoutIntent(pool, intentId);
    await upsertDisplayCheckout(pool, deviceId, approved, approved?.checkoutMode);
    setTimeout(() => {
        upsertDisplayCheckout(pool, deviceId, null).catch(() => {});
    }, 4000);
    return approved;
}

async function createCheckoutIntent(pool, { deviceId, deviceRecordId, amount, cart, employeeId }) {
    const checkoutSettings = await loadPosCardCheckoutSettings(pool);
    const id = crypto.randomUUID();
    const amt = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(amt) || amt <= 0) {
        const err = new Error('Invalid checkout amount');
        err.code = 'INVALID_AMOUNT';
        throw err;
    }
    if (!checkoutSettings.displayCardCheckout) {
        const err = new Error('Customer display card checkout is disabled');
        err.code = 'CHECKOUT_DISABLED';
        throw err;
    }

    await cancelStaleIntentsForDevice(pool, deviceId);

    const checkoutMode = checkoutSettings.displayMode;
    const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
    await pool.execute(
        `INSERT INTO pos_checkout_intents
         (id, device_id, employee_id, status, amount, cart_json, checkout_mode, expires_at)
         VALUES (?, ?, ?, 'awaiting', ?, ?, ?, ?)`,
        [
            id,
            String(deviceId || '').slice(0, 64),
            employeeId || null,
            amt,
            JSON.stringify(cart || {}),
            checkoutMode,
            expiresAt
        ]
    );
    let intent = await getCheckoutIntent(pool, id);
    await upsertDisplayCheckout(pool, deviceId, intent, checkoutMode);

    if (checkoutMode === 'nmi_terminal') {
        intent = await chargeTerminalCheckoutIntent(pool, id, { deviceId, deviceRecordId });
    } else if (checkoutMode === 'mx_terminal') {
        intent = await chargeMxTerminalCheckoutIntent(pool, id, { deviceId, deviceRecordId });
    }
    return intent;
}

async function getCheckoutIntent(pool, intentId) {
    const [rows] = await pool.execute(`SELECT * FROM pos_checkout_intents WHERE id = ? LIMIT 1`, [
        String(intentId)
    ]);
    return rows[0] ? mapIntentRow(rows[0]) : null;
}

async function cancelCheckoutIntent(pool, intentId, deviceId) {
    const existing = await getCheckoutIntent(pool, intentId);
    if (!existing) return null;
    if (deviceId && existing.deviceId !== deviceId) {
        const err = new Error('Checkout not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (existing.status === 'approved') return existing;
    await pool.execute(
        `UPDATE pos_checkout_intents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [intentId]
    );
    const intent = await getCheckoutIntent(pool, intentId);
    await upsertDisplayCheckout(pool, existing.deviceId, null);
    return intent;
}

async function chargeMxTerminalCheckoutIntent(pool, intentId, deviceRef) {
    const deviceId =
        deviceRef && typeof deviceRef === 'object' ? deviceRef.deviceId : deviceRef;

    const existing = await getCheckoutIntent(pool, intentId);
    if (!existing) {
        const err = new Error('Checkout not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (deviceId && existing.deviceId !== deviceId) {
        const err = new Error('Checkout not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (existing.status === 'approved') return existing;
    if (existing.status !== 'awaiting') {
        const err = new Error('Checkout is no longer active');
        err.code = 'INVALID_STATE';
        throw err;
    }

    const terminalId = String(integrationCredentials.getMxmerchantCredentials('pos').terminalId || '').trim();
    if (!terminalId) {
        const err = new Error('MX terminal ID is not configured — set it in Developer Tools');
        err.code = 'TERMINAL_NOT_CONFIGURED';
        throw err;
    }

    const claimed = await claimIntentForProcessing(pool, intentId);
    await upsertDisplayCheckout(pool, existing.deviceId, claimed, 'mx_terminal');

    try {
        const sent = await chargeMxTerminal({
            amount: existing.amount,
            scope: 'pos',
            terminalId,
            replayId: intentId.replace(/\D/g, '').slice(-15) || undefined,
            type: 'Sale',
        });
        if (!sent.ok) {
            await revertIntentToAwaiting(pool, intentId, sent.responseText || 'Terminal payment failed');
            const err = new Error(sent.responseText || 'Terminal payment failed');
            err.code = 'CARD_DECLINED';
            throw err;
        }

        const txnId = String(sent.transactionId || '').trim();
        if (sent.status === 'SENTTOTERMINAL' && txnId) {
            const { getTerminalTransaction } = require('./mxmerchantTerminal');
            for (let i = 0; i < 12; i++) {
                await new Promise((r) => setTimeout(r, 2500));
                const polled = await getTerminalTransaction('pos', terminalId, txnId);
                const approved =
                    polled.ok &&
                    /approved|complete|success/i.test(
                        String(polled.raw?.status || polled.raw?.provider?.transaction?.status || '')
                    );
                if (approved) {
                    await pool.execute(
                        `UPDATE pos_checkout_intents SET
                            status = 'approved',
                            nmi_transaction_id = ?,
                            error_message = NULL,
                            updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        [txnId, intentId]
                    );
                    const approvedIntent = await getCheckoutIntent(pool, intentId);
                    await upsertDisplayCheckout(pool, existing.deviceId, approvedIntent, 'mx_terminal');
                    return approvedIntent;
                }
            }
            await pool.execute(
                `UPDATE pos_checkout_intents SET nmi_transaction_id = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [txnId, 'Awaiting terminal — complete payment on device', intentId]
            );
            return getCheckoutIntent(pool, intentId);
        }

        await pool.execute(
            `UPDATE pos_checkout_intents SET status = 'approved', nmi_transaction_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [txnId || null, intentId]
        );
        const approved = await getCheckoutIntent(pool, intentId);
        await upsertDisplayCheckout(pool, existing.deviceId, approved, 'mx_terminal');
        return approved;
    } catch (e) {
        if (e.code === 'CARD_DECLINED' || e.code === 'TERMINAL_NOT_CONFIGURED') throw e;
        await revertIntentToAwaiting(pool, intentId, e.message || 'Terminal payment failed');
        throw e;
    }
}

async function chargeTerminalCheckoutIntent(pool, intentId, deviceRef) {
    const deviceId =
        deviceRef && typeof deviceRef === 'object' ? deviceRef.deviceId : deviceRef;
    const deviceRecordId =
        deviceRef && typeof deviceRef === 'object' ? deviceRef.deviceRecordId : null;

    const existing = await getCheckoutIntent(pool, intentId);
    if (!existing) {
        const err = new Error('Checkout not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (deviceId && existing.deviceId !== deviceId) {
        const err = new Error('Checkout not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (existing.status === 'approved') return existing;
    if (existing.status === 'processing') return existing;
    if (existing.status !== 'awaiting') {
        const err = new Error('Checkout is no longer active');
        err.code = 'INVALID_STATE';
        throw err;
    }
    if (existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
        await pool.execute(
            `UPDATE pos_checkout_intents SET status = 'expired', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            ['Checkout expired', intentId]
        );
        const err = new Error('Checkout expired');
        err.code = 'EXPIRED';
        throw err;
    }

    const poiDeviceId = await assertTerminalCheckoutReady(pool, deviceRecordId);

    const claimed = await claimIntentForProcessing(pool, intentId);
    await upsertDisplayCheckout(pool, existing.deviceId, claimed, 'nmi_terminal');

    const creds = await resolveCredentialsForMode(pool);
    if (!creds.privateKey) {
        await revertIntentToAwaiting(pool, intentId, 'NMI is not configured on the server');
        const err = new Error('Card processor is not configured on the server');
        err.code = 'PROCESSOR_NOT_CONFIGURED';
        throw err;
    }

    try {
        const sale = await nmiPoiSale({
            securityKey: creds.privateKey,
            amount: existing.amount.toFixed(2),
            poiDeviceId,
            orderId: intentId,
            transactUrl: creds.transactUrl
        });
        return await applySaleResult(pool, intentId, existing.deviceId, sale);
    } catch (e) {
        if (e.code === 'CARD_DECLINED') throw e;
        await revertIntentToAwaiting(pool, intentId, e.message || 'Terminal payment failed');
        throw e;
    }
}

async function applyMxPaymentResult(pool, intentId, deviceId, sale, amountExpected) {
    if (!sale.ok) {
        const message = sale.responseText || 'Card declined';
        await pool.execute(
            `UPDATE pos_checkout_intents SET status = 'declined', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [message.slice(0, 500), intentId]
        );
        const declined = await getCheckoutIntent(pool, intentId);
        await upsertDisplayCheckout(pool, deviceId, declined, declined?.checkoutMode);
        const err = new Error(message);
        err.code = 'CARD_DECLINED';
        err.data = { intent: declined };
        throw err;
    }

    const paid = Math.round(Number(sale.raw?.amount || 0) * 100) / 100;
    const expected = Math.round(Number(amountExpected) * 100) / 100;
    if (Math.abs(paid - expected) > 0.02) {
        const err = new Error('Payment amount does not match checkout total');
        err.code = 'AMOUNT_MISMATCH';
        throw err;
    }

    await pool.execute(
        `UPDATE pos_checkout_intents SET
            status = 'approved',
            auth_code = ?,
            last_four = ?,
            card_brand = ?,
            nmi_transaction_id = ?,
            error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            sale.authCode || null,
            sale.last4 || null,
            sale.cardType || null,
            sale.paymentId || null,
            intentId,
        ]
    );
    const approved = await getCheckoutIntent(pool, intentId);
    await upsertDisplayCheckout(pool, deviceId, approved, approved?.checkoutMode);
    setTimeout(() => {
        upsertDisplayCheckout(pool, deviceId, null).catch(() => {});
    }, 4000);
    return approved;
}

async function completeCheckoutIntent(pool, intentId, { paymentToken, mxPaymentId, deviceId }) {
    const token = String(paymentToken || '').trim();
    const mxId = String(mxPaymentId || '').trim();

    const existing = await getCheckoutIntent(pool, intentId);
    if (!existing) {
        const err = new Error('Checkout not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (deviceId && existing.deviceId !== deviceId) {
        const err = new Error('Checkout not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (existing.status === 'approved') return existing;
    if (existing.checkoutMode === 'mx_virtual') {
        if (!mxId) {
            const err = new Error('MX payment id is required');
            err.code = 'TOKEN_REQUIRED';
            throw err;
        }
        if (existing.status !== 'awaiting' && existing.status !== 'processing') {
            const err = new Error('Checkout is no longer active');
            err.code = 'INVALID_STATE';
            throw err;
        }
        if (existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
            await pool.execute(
                `UPDATE pos_checkout_intents SET status = 'expired', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                ['Checkout expired', intentId]
            );
            const err = new Error('Checkout expired');
            err.code = 'EXPIRED';
            throw err;
        }
        const processor = pool ? await loadPosPaymentProcessor(pool) : MX_PROCESSOR_ID;
        if (processor !== MX_PROCESSOR_ID) {
            const err = new Error('MX is not the active POS processor');
            err.code = 'PROCESSOR_NOT_CONFIGURED';
            throw err;
        }
        await claimIntentForProcessing(pool, intentId);
        await upsertDisplayCheckout(pool, existing.deviceId, await getCheckoutIntent(pool, intentId), 'mx_virtual');
        const sale = await getMxPayment(mxId, 'pos');
        return await applyMxPaymentResult(pool, intentId, existing.deviceId, sale, existing.amount);
    }

    if (!token) {
        const err = new Error('Payment token is required');
        err.code = 'TOKEN_REQUIRED';
        throw err;
    }

    if (existing.checkoutMode !== 'collect_js') {
        const err = new Error(
            'Virtual terminal checkout is not active. Set NMI deployment to Virtual in Developer Tools, or use a physical terminal.'
        );
        err.code = 'TERMINAL_ONLY';
        throw err;
    }
    if (existing.status !== 'awaiting' && existing.status !== 'processing') {
        const err = new Error('Checkout is no longer active');
        err.code = 'INVALID_STATE';
        throw err;
    }
    if (existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
        await pool.execute(
            `UPDATE pos_checkout_intents SET status = 'expired', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            ['Checkout expired', intentId]
        );
        const err = new Error('Checkout expired');
        err.code = 'EXPIRED';
        throw err;
    }

    const creds = await resolveCredentialsForMode(pool);
    if (!creds.privateKey || !creds.publicKey) {
        const err = new Error('POS NMI keys are not configured');
        err.code = 'PROCESSOR_NOT_CONFIGURED';
        throw err;
    }

    await claimIntentForProcessing(pool, intentId);
    await upsertDisplayCheckout(pool, existing.deviceId, await getCheckoutIntent(pool, intentId), 'collect_js');

    try {
        const sale = await nmiSale({
            securityKey: creds.privateKey,
            amount: existing.amount.toFixed(2),
            paymentToken: token,
            transactUrl: creds.transactUrl
        });
        return await applySaleResult(pool, intentId, existing.deviceId, sale);
    } catch (e) {
        if (e.code === 'CARD_DECLINED') throw e;
        await revertIntentToAwaiting(pool, intentId, e.message || 'Card payment failed');
        throw e;
    }
}

module.exports = {
    createCheckoutIntent,
    getCheckoutIntent,
    cancelCheckoutIntent,
    completeCheckoutIntent,
    chargeTerminalCheckoutIntent,
    upsertDisplayCheckout
};
