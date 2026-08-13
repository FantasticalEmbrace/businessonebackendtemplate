'use strict';

const axios = require('axios');
const {
    getMxmerchantApiBase,
    getMxmerchantConfig,
    isMxmerchantConfigured,
} = require('../utils/mxmerchantEnv');

const APPROVED_STATUSES = new Set(['Approved', 'Settled', 'AuthOnly', 'InProgress']);

function buildAuthHeader(cfg) {
    return buildAuthHeaderFromConfig(cfg);
}

function buildAuthHeaderFromConfig(cfg) {
    if (cfg.authMethod === 'username') {
        const user = String(cfg.username || '');
        const pass = String(cfg.password || '');
        if (!user || !pass) return null;
        return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    }
    const key = String(cfg.consumerKey || '');
    const secret = String(cfg.consumerSecret || '');
    if (!key || !secret) return null;
    return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

function client(scope = 'website') {
    const cfg = getMxmerchantConfig(scope);
    const auth = buildAuthHeader(cfg);
    if (!auth) {
        const err = new Error('MXMERCHANT_NOT_CONFIGURED');
        err.code = 'MXMERCHANT_NOT_CONFIGURED';
        throw err;
    }
    return axios.create({
        baseURL: getMxmerchantApiBase(scope),
        headers: {
            Authorization: auth,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        timeout: 45000,
        validateStatus: () => true,
    });
}

function unwrapTokenResponse(data) {
    if (typeof data === 'string') return data.trim();
    if (data && typeof data.token === 'string') return data.token.trim();
    return '';
}

function normalizePaymentResult(data) {
    const status = String(data?.status || '').trim();
    const approved = APPROVED_STATUSES.has(status);
    const declined = status === 'Declined' || status === 'Voided' || status === 'Chargedback';
    const authCode = String(data?.authCode || '').trim();
    const last4 = String(data?.cardAccount?.last4 || '').trim();
    const cardType = String(data?.cardAccount?.cardType || '').trim();
    const paymentId = data?.id != null ? String(data.id) : '';
    const reference = String(data?.reference || data?.clientReference || '').trim();
    const message = String(data?.authMessage || data?.message || status || '').trim();

    return {
        ok: approved && !declined,
        status,
        paymentId,
        paymentToken: String(data?.paymentToken || data?.cardAccount?.token || '').trim(),
        reference,
        authCode,
        last4,
        cardType,
        amount: Number(data?.amount),
        responseText: message || (approved ? 'Approved' : 'Declined'),
        raw: data,
    };
}

async function getLimitedUseToken(scope = 'website') {
    if (!isMxmerchantConfigured(scope)) {
        const err = new Error('MXMERCHANT_NOT_CONFIGURED');
        err.code = 'MXMERCHANT_NOT_CONFIGURED';
        throw err;
    }
    const cfg = getMxmerchantConfig(scope);
    const res = await client(scope).post(`/v3/auth/token/${encodeURIComponent(cfg.merchantId)}`);
    if (res.status >= 400) {
        const err = new Error(res.data?.message || `MX token HTTP ${res.status}`);
        err.code = 'MX_TOKEN_FAILED';
        err.httpStatus = res.status;
        err.raw = res.data;
        throw err;
    }
    const token = unwrapTokenResponse(res.data);
    if (!token) {
        const err = new Error('MX token response empty');
        err.code = 'MX_TOKEN_FAILED';
        throw err;
    }
    return token;
}

async function getPayment(paymentId, scope = 'website') {
    const id = String(paymentId || '').trim();
    if (!id) {
        const err = new Error('paymentId required');
        err.code = 'PAYMENT_ID_REQUIRED';
        throw err;
    }
    const res = await client(scope).get(`/v3/payment/${encodeURIComponent(id)}`);
    if (res.status >= 400) {
        return {
            ok: false,
            responseText: res.data?.message || `HTTP ${res.status}`,
            raw: res.data,
        };
    }
    return normalizePaymentResult(res.data);
}

async function createPayment({
    scope = 'website',
    amount,
    cardAccount,
    clientReference,
    replayId,
    posData,
    paymentType = 'Sale',
    tenderType = 'Card',
    customer,
}) {
    const cfg = getMxmerchantConfig(scope);
    const body = {
        merchantId: Number(cfg.merchantId) || cfg.merchantId,
        tenderType,
        paymentType,
        amount: Number(amount),
        cardAccount,
        source: 'API',
    };
    if (clientReference) body.clientReference = String(clientReference).slice(0, 17);
    if (replayId != null) body.replayId = replayId;
    if (posData) body.posData = posData;
    if (customer) body.customer = customer;

    const res = await client(scope).post('/v3/payment', body);
    if (res.status >= 400) {
        return {
            ok: false,
            responseText: res.data?.message || res.data?.errorCode || `HTTP ${res.status}`,
            raw: res.data,
        };
    }
    return normalizePaymentResult(res.data);
}

async function voidPayment(paymentId, scope = 'website', { force = false } = {}) {
    const id = String(paymentId || '').trim();
    if (!id) {
        const err = new Error('paymentId required');
        err.code = 'PAYMENT_ID_REQUIRED';
        throw err;
    }
    const qs = force ? '?force=true' : '';
    const res = await client(scope).delete(`/v3/payment/${encodeURIComponent(id)}${qs}`);
    if (res.status === 204 || (res.status >= 200 && res.status < 300)) {
        return { ok: true };
    }
    return {
        ok: false,
        responseText: res.data?.message || `HTTP ${res.status}`,
        raw: res.data,
    };
}

async function testConnection(scope = 'website') {
    if (!isMxmerchantConfigured(scope)) {
        return { ok: false, message: 'Merchant ID and API credentials missing' };
    }
    try {
        const token = await getLimitedUseToken(scope);
        return token
            ? { ok: true, message: 'MX API credentials accepted' }
            : { ok: false, message: 'Token request returned empty' };
    } catch (e) {
        return { ok: false, message: e.message || 'MX connection failed' };
    }
}

async function refundPayment(paymentId, scope = 'website', { amount, force = true, paymentToken } = {}) {
    const id = String(paymentId || '').trim();
    if (!id) {
        const err = new Error('paymentId required');
        err.code = 'PAYMENT_ID_REQUIRED';
        throw err;
    }

    const refundAmount = amount != null ? Math.abs(Number(amount)) : null;
    let original = null;
    if (refundAmount != null) {
        original = await getPayment(id, scope);
        if (!original.ok && !original.raw) {
            return {
                ok: false,
                responseText: original.responseText || 'Could not load original MX payment',
            };
        }
    }

    const originalAmount = Math.abs(Number(original?.raw?.amount ?? original?.amount ?? 0));
    const token =
        String(paymentToken || '').trim() ||
        String(original?.paymentToken || original?.raw?.paymentToken || original?.raw?.cardAccount?.token || '').trim();
    const isPartial =
        refundAmount != null &&
        originalAmount > 0 &&
        refundAmount + 0.009 < originalAmount;

    // MX docs: partial refund = POST /v3/payment with negative amount + paymentToken
    if (isPartial) {
        if (!token) {
            return {
                ok: false,
                responseText:
                    'MX partial refund requires paymentToken from the original sale — ensure payment_token is stored on the order',
            };
        }
        const cfg = getMxmerchantConfig(scope);
        const body = {
            merchantId: Number(cfg.merchantId) || cfg.merchantId,
            tenderType: 'Card',
            amount: -refundAmount,
            paymentToken: token,
        };
        const res = await client(scope).post('/v3/payment', body);
        if (res.status >= 400) {
            return {
                ok: false,
                responseText: res.data?.message || res.data?.errorCode || `HTTP ${res.status}`,
                raw: res.data,
            };
        }
        const normalized = normalizePaymentResult(res.data);
        return { ...normalized, operation: 'refund', partial: true };
    }

    // MX docs: full refund or void = DELETE /v3/payment/{id}?force=true
    return voidPayment(paymentId, scope, { force });
}

async function capturePayment(paymentId, scope = 'website', { amount } = {}) {
    const id = String(paymentId || '').trim();
    if (!id) {
        const err = new Error('paymentId required');
        err.code = 'PAYMENT_ID_REQUIRED';
        throw err;
    }
    const body = amount != null ? { amount: Number(amount) } : {};
    const res = await client(scope).post(`/v3/payment/${encodeURIComponent(id)}/capture`, body);
    if (res.status >= 400) {
        return {
            ok: false,
            responseText: res.data?.message || `HTTP ${res.status}`,
            raw: res.data,
        };
    }
    return normalizePaymentResult(res.data);
}

async function createCustomer({ scope = 'website', name, firstName, lastName, email, phone, address1, city, state, zip }) {
    const cfg = getMxmerchantConfig(scope);
    const body = {
        merchantId: Number(cfg.merchantId) || cfg.merchantId,
        name: name || [firstName, lastName].filter(Boolean).join(' ').trim(),
        firstName,
        lastName,
        email,
        phone,
        address1,
        city,
        state,
        zip,
    };
    Object.keys(body).forEach((k) => body[k] == null && delete body[k]);
    const res = await client(scope).post('/v3/customer', body);
    if (res.status >= 400) {
        return { ok: false, responseText: res.data?.message || `HTTP ${res.status}`, raw: res.data };
    }
    return { ok: true, customerId: res.data?.id, raw: res.data };
}

async function createVaultedCardWithToken({ scope = 'website', sessionToken, cardAccount, customerId }) {
    const token = String(sessionToken || '').trim();
    if (!token) {
        const err = new Error('sessionToken required');
        err.code = 'MX_TOKEN_REQUIRED';
        throw err;
    }
    const cfg = getMxmerchantConfig(scope);
    const qs = `?token=${encodeURIComponent(token)}`;
    const body = {
        merchantId: Number(cfg.merchantId) || cfg.merchantId,
        cardAccount,
    };
    if (customerId) body.customerId = customerId;
    const base = getMxmerchantApiBase(scope);
    const auth = buildAuthHeaderFromConfig(cfg);
    const res = await axios.post(`${base}/v3/customercardaccount${qs}`, body, {
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        timeout: 45000,
        validateStatus: () => true,
    });
    if (res.status >= 400) {
        return { ok: false, responseText: res.data?.message || `HTTP ${res.status}`, raw: res.data };
    }
    const vaultToken = res.data?.cardAccount?.token || res.data?.token || '';
    return {
        ok: true,
        vaultToken: String(vaultToken).trim(),
        customerId: res.data?.customerId || customerId || null,
        last4: res.data?.cardAccount?.last4 || '',
        cardType: res.data?.cardAccount?.cardType || '',
        raw: res.data,
    };
}

module.exports = {
    getLimitedUseToken,
    getPayment,
    createPayment,
    voidPayment,
    refundPayment,
    capturePayment,
    createCustomer,
    createVaultedCardWithToken,
    testConnection,
    normalizePaymentResult,
    isMxmerchantConfigured,
    buildAuthHeaderFromConfig,
};
