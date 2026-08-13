'use strict';

const axios = require('axios');
const { Client, Transaction, Environment } = require('procharge');
const logger = require('../utils/logger');
const {
    getProchargeApiHost,
    getProchargeApplicationKey,
    getProchargeMerchantNumber,
    getProchargeLoginCreds,
    isProchargeConfigured,
    isProchargeSandbox
} = require('../utils/prochargeEnv');

let cachedAuth = null;

const PROCHARGE_ORDER_NUMBER_MAX = 8;

function apiBaseUrl() {
    return `https://${getProchargeApiHost()}`;
}

function extractPaymentToken(data) {
    if (data == null) return null;
    if (typeof data === 'object' && !Array.isArray(data)) {
        return data.token || data.Token || data.paymentToken || null;
    }
    if (typeof data === 'string' && data.trim()) return data.trim();
    if (typeof data === 'number' && Number.isFinite(data)) return String(data);
    return null;
}

function formatOrderNumber(orderNumber) {
    if (!orderNumber) return undefined;
    return String(orderNumber).slice(-PROCHARGE_ORDER_NUMBER_MAX);
}

/** CardPointe / CardConnect hosted iframe tokens (long numeric strings). */
function isHostedPaymentToken(token) {
    const t = String(token || '').trim();
    return /^\d{12,22}$/.test(t);
}

function authExpired() {
    if (!cachedAuth?.access_token) return true;
    const expiresAt = cachedAuth.expiresAt || 0;
    return Date.now() >= expiresAt - 60_000;
}

async function getAuthToken() {
    if (!isProchargeConfigured()) {
        const err = new Error('ProCharge is not configured on the server.');
        err.code = 'PROCHARGE_NOT_CONFIGURED';
        throw err;
    }
    if (!authExpired()) {
        return cachedAuth.access_token;
    }

    const creds = getProchargeLoginCreds();
    const loginBody = {
        userName: creds.userName,
        passWord: creds.passWord,
        pin: creds.pin,
        application: creds.application
    };
    const res = await axios.post(`${apiBaseUrl()}/api/authentication/login`, loginBody, {
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        },
        timeout: 60_000,
        validateStatus: () => true
    });
    const response = res.data || {};
    const token = response.access_token || response.accessToken;
    if (res.status >= 400 || !token) {
        const err = new Error(
            response.responseText ||
                response.errorMessage ||
                response.message ||
                `ProCharge authentication failed (HTTP ${res.status})`
        );
        err.code = 'PROCHARGE_AUTH_FAILED';
        throw err;
    }
    const ttlSec = Number(response.expires_in || response.expiresIn || 3600);
    cachedAuth = {
        access_token: token,
        refresh_token: response.refresh_token || response.refreshToken || null,
        expiresAt: Date.now() + ttlSec * 1000,
        acquirerID: response.acquirerID || response.acquirerId || null,
        profileID: response.profileID || response.profileId || null,
        paymentGatewayID: response.paymentGatewayID || response.paymentGatewayId || null,
        terminalID: response.terminalID || response.terminalId || null
    };
    return cachedAuth.access_token;
}

async function getAuthSession() {
    await getAuthToken();
    return cachedAuth;
}

function bearerHeader(token) {
    const raw = String(token || '').trim();
    return raw.toLowerCase().startsWith('bearer ') ? raw : `Bearer ${raw}`;
}

async function prochargeRequest(method, path, body) {
    const token = await getAuthToken();
    const headers = {
        Authorization: bearerHeader(token),
        'x-api-key': getProchargeApplicationKey(),
        Accept: 'application/json',
        'Content-Type': 'application/json'
    };
    const res = await axios({
        method,
        url: `${apiBaseUrl()}${path}`,
        headers,
        data: body,
        timeout: 60_000,
        validateStatus: () => true
    });
    return res;
}

/**
 * Card sales/refunds use the application key as Bearer (apiKeyOnly keys).
 * Tokenization and ACH continue to use login bearer + x-api-key.
 */
async function prochargeTransactionRequest(body) {
    const appKey = getProchargeApplicationKey();
    const res = await axios({
        method: 'POST',
        url: `${apiBaseUrl()}/api/transaction`,
        headers: {
            Authorization: bearerHeader(appKey),
            'x-api-key': appKey,
            Accept: 'application/json',
            'Content-Type': 'application/json'
        },
        data: body,
        timeout: 60_000,
        validateStatus: () => true
    });
    return res;
}

function buildSaleTransactionBody({
    amount,
    token,
    cardNumber,
    ccExpMonth,
    ccExpYear,
    cvv,
    orderNumber,
    email,
    name,
    description,
    postalCode,
    street1,
    city,
    state,
    country = 'US',
    isRecurring = false,
    isInstallment = false,
    profileId,
    skipProfile = false
}) {
    const session = cachedAuth || {};
    const body = {
        merchantNumber: getProchargeMerchantNumber(),
        transactionCode: '1',
        isProcharge: true,
        isEcommerce: true,
        isMoto: false,
        isRetail: false,
        source: 'wg',
        cardNotPresent: true,
        receipts: false,
        items: [],
        amount: Number(amount).toFixed(2),
        universalTimeStamp: Date.now(),
        isRecurring: Boolean(isRecurring),
        isInstallment: Boolean(isInstallment)
    };
    if (!skipProfile && (profileId != null || session.profileID)) {
        body.profileID = profileId != null ? profileId : session.profileID;
    }
    if (session.acquirerID) {
        body.acquirerID = String(session.acquirerID);
    }
    if (session.paymentGatewayID) {
        body.paymentGatewayID = String(session.paymentGatewayID);
    }
    if (isProchargeSandbox()) {
        body.sandbox = 'y';
    }
    if (token) body.token = String(token);
    if (cardNumber) {
        body.cardNumber = String(cardNumber).replace(/\s+/g, '');
        if (ccExpMonth) body.ccExpMonth = String(ccExpMonth).padStart(2, '0');
        if (ccExpYear) body.ccExpYear = String(ccExpYear).slice(-2);
        if (cvv) body.cvv = String(cvv);
    }
    const order = formatOrderNumber(orderNumber);
    if (order) body.orderNumber = order;
    if (email) body.email = String(email).slice(0, 255);
    if (name) body.name = String(name).slice(0, 120);
    if (description) body.description = String(description).slice(0, 255);
    if (street1) body.street1 = String(street1);
    if (city) body.city = String(city);
    if (state) body.state = String(state);
    if (country) body.country = String(country);
    if (postalCode) body.postalCode = String(postalCode);
    body.aci = body.street1 && body.postalCode ? 'Y' : 'N';
    return body;
}

function normalizeTransactionResponse(response) {
    const fields = response || {};
    const responseCode = String(
        fields.responseCode ?? fields.ResponseCode ?? fields.response_code ?? ''
    );
    const ok =
        responseCode === '0' ||
        responseCode === '00' ||
        Number(responseCode) === 0 ||
        String(fields.responseText || fields.ResponseText || '')
            .toLowerCase()
            .includes('approved');
    return {
        ok,
        responseCode,
        responseText: String(fields.responseText || fields.ResponseText || fields.message || ''),
        transactionId: String(
            fields.transactionID ||
                fields.transactionId ||
                fields.TransactionID ||
                fields.id ||
                ''
        ),
        approvalCode: String(fields.authorizationNumber || fields.AuthorizationNumber || ''),
        profileId: fields.profileID || fields.profileId || fields.ProfileID || null,
        token: fields.token || fields.Token || null,
        raw: fields
    };
}

/**
 * Tokenize card for vault storage (POST /api/token).
 */
async function tokenizeCard({
    cardNumber,
    ccExpMonth,
    ccExpYear,
    cvv,
    name,
    postalCode,
    street1,
    email
}) {
    const merchantNumber = getProchargeMerchantNumber();
    const month = String(ccExpMonth || '').padStart(2, '0');
    const year = String(ccExpYear || '').slice(-2);
    const body = {
        merchantNumber,
        accountNumber: String(cardNumber || '').replace(/\s+/g, ''),
        expDate: `${month}${year}`,
        format: 'json'
    };
    const res = await prochargeRequest('POST', '/api/token', body);
    if (res.status >= 400) {
        return {
            ok: false,
            responseText: res.data?.message || res.data?.responseText || `Tokenize HTTP ${res.status}`
        };
    }
    const token = extractPaymentToken(res.data);
    if (!token) {
        return {
            ok: false,
            responseText: res.data?.responseText || 'Tokenization did not return a token'
        };
    }
    return { ok: true, token: String(token), raw: res.data };
}

/**
 * Charge a CardPointe / CardConnect hosted-field token (browser iframe).
 * Hosted tokens are submitted as cardNumber without expiration or CVV.
 */
async function chargeHostedToken({
    amount,
    token,
    orderNumber,
    email,
    name,
    isRecurring = false,
    isInstallment = false,
    description,
    postalCode,
    street1
}) {
    const hostedToken = String(token || '').trim();
    if (!hostedToken) {
        return { ok: false, responseText: 'Payment token required' };
    }
    try {
        await getAuthSession();
        const body = buildSaleTransactionBody({
            amount,
            token: hostedToken,
            orderNumber,
            email,
            name,
            description,
            postalCode,
            street1,
            isRecurring,
            isInstallment,
            skipProfile: true
        });
        const res = await prochargeTransactionRequest(body);
        if (res.status >= 400 && !res.data?.responseText) {
            return {
                ok: false,
                responseText: res.data?.message || `Charge HTTP ${res.status}`
            };
        }
        return normalizeTransactionResponse(res.data);
    } catch (e) {
        logger.warn('[procharge] chargeHostedToken failed', { message: e.message });
        return {
            ok: false,
            responseText: e.responseText || e.message || 'Charge failed'
        };
    }
}

/**
 * Charge a stored ProCharge token.
 */
async function chargeToken({
    amount,
    token,
    orderNumber,
    email,
    name,
    isRecurring = false,
    isInstallment = false,
    description,
    postalCode,
    street1
}) {
    const paymentToken = String(token || '').trim();
    if (!paymentToken) {
        return { ok: false, responseText: 'Payment token required' };
    }
    if (isHostedPaymentToken(paymentToken)) {
        return chargeHostedToken({
            amount,
            token: paymentToken,
            orderNumber,
            email,
            name,
            isRecurring,
            isInstallment,
            description,
            postalCode,
            street1
        });
    }
    try {
        await getAuthSession();
        const body = buildSaleTransactionBody({
            amount,
            token: paymentToken,
            orderNumber,
            email,
            name,
            description,
            postalCode,
            street1,
            isRecurring,
            isInstallment
        });
        const res = await prochargeTransactionRequest(body);
        if (res.status >= 400 && !res.data?.responseText) {
            return {
                ok: false,
                responseText: res.data?.message || `Charge HTTP ${res.status}`
            };
        }
        return normalizeTransactionResponse(res.data);
    } catch (e) {
        logger.warn('[procharge] chargeToken failed', { message: e.message });
        return {
            ok: false,
            responseText: e.responseText || e.message || 'Charge failed'
        };
    }
}

/**
 * One-time card sale (hardware pay-in-full).
 */
async function chargeCard({
    amount,
    cardNumber,
    ccExpMonth,
    ccExpYear,
    cvv,
    name,
    postalCode,
    street1,
    email,
    orderNumber,
    description
}) {
    try {
        await getAuthSession();
        const body = buildSaleTransactionBody({
            amount,
            cardNumber,
            ccExpMonth,
            ccExpYear,
            cvv,
            name,
            postalCode,
            street1,
            email,
            orderNumber,
            description
        });
        const res = await prochargeTransactionRequest(body);
        if (res.status >= 400 && !res.data?.responseText) {
            return {
                ok: false,
                responseText: res.data?.message || `Charge HTTP ${res.status}`
            };
        }
        return normalizeTransactionResponse(res.data);
    } catch (e) {
        logger.warn('[procharge] chargeCard failed', { message: e.message });
        return {
            ok: false,
            responseText: e.responseText || e.message || 'Charge failed'
        };
    }
}

async function achAuthenticate() {
    const res = await prochargeRequest('GET', '/api/ach/authenticate');
    if (res.status >= 400) {
        throw new Error(res.data?.message || `ACH auth HTTP ${res.status}`);
    }
    return res.data;
}

async function achAddCustomer({ name, email, bankAccount }) {
    const res = await prochargeRequest('POST', '/api/ach/customer', {
        name,
        email,
        bank_account: bankAccount
    });
    if (res.status >= 400) {
        return { ok: false, responseText: res.data?.message || `ACH customer HTTP ${res.status}` };
    }
    const uuid = res.data?.customer_uuid || res.data?.uuid || res.data?.id;
    return { ok: Boolean(uuid), customerUuid: uuid ? String(uuid) : null, raw: res.data };
}

async function achChargeToken({ customerUuid, amount, description }) {
    const res = await prochargeRequest('POST', '/api/ach/payment/token', {
        customer_uuid: customerUuid,
        amount: Number(amount).toFixed(2),
        description: description || 'Business One billing'
    });
    if (res.status >= 400) {
        return { ok: false, responseText: res.data?.message || `ACH payment HTTP ${res.status}` };
    }
    const paymentUuid = res.data?.payment_uuid || res.data?.uuid;
    return {
        ok: true,
        transactionId: paymentUuid ? String(paymentUuid) : null,
        approvalCode: String(res.data?.approval_code || res.data?.approvalCode || ''),
        raw: res.data
    };
}

function buildProchargeClient(authToken) {
    return new Client({
        env: getProchargeApiHost(),
        applicationKey: getProchargeApplicationKey(),
        authToken: bearerHeader(authToken)
    });
}

function baseTransactionFields({ profileId } = {}) {
    const transaction = new Transaction();
    transaction.merchantNumber = getProchargeMerchantNumber();
    transaction.isEcommerce = true;
    transaction.sandbox = isProchargeSandbox() ? 'y' : 'n';
    if (profileId) transaction.profileID = profileId;
    return transaction;
}

/**
 * Void a sale in the same open batch (before settlement).
 * Requires transactionID + approvalCode from the original sale.
 */
async function voidSale({ transactionId, approvalCode, profileId }) {
    if (!transactionId || !approvalCode) {
        return { ok: false, responseText: 'transactionId and approvalCode required for void' };
    }
    const transaction = baseTransactionFields({ profileId });
    transaction.transactionID = String(transactionId);
    transaction.approvalCode = String(approvalCode);
    transaction.cardNotPresent = true;
    transaction.cardTypeIndicator = 'C';

    try {
        const client = buildProchargeClient(await getAuthToken());
        const response = await client.voidSale(transaction);
        return normalizeTransactionResponse(response);
    } catch (e) {
        logger.warn('[procharge] voidSale failed', { message: e.message, transactionId });
        return {
            ok: false,
            responseText: e.responseText || e.message || 'Void failed'
        };
    }
}

/**
 * Refund to card via stored vault token (closed batch / after settlement).
 */
async function refundToken({
    amount,
    token,
    orderNumber,
    email,
    name,
    description,
    profileId,
    transactionId,
    approvalCode
}) {
    if (!token) {
        return { ok: false, responseText: 'Payment token required for refund' };
    }
    const transaction = baseTransactionFields({ profileId });
    transaction.amount = Number(amount).toFixed(2);
    transaction.token = String(token);
    transaction.cardTypeIndicator = 'C';
    transaction.aci = 'N';
    if (orderNumber) transaction.orderNumber = String(orderNumber).slice(0, 64);
    if (email) transaction.email = String(email).slice(0, 255);
    if (name) transaction.name = String(name).slice(0, 120);
    if (description) transaction.description = String(description).slice(0, 255);
    if (transactionId) transaction.transactionID = String(transactionId);
    if (approvalCode) transaction.approvalCode = String(approvalCode);

    try {
        const client = buildProchargeClient(await getAuthToken());
        const response = await client.processRefund(transaction);
        return normalizeTransactionResponse(response);
    } catch (e) {
        logger.warn('[procharge] refundToken failed', { message: e.message });
        return {
            ok: false,
            responseText: e.responseText || e.message || 'Refund failed'
        };
    }
}

function resetAuthCache() {
    cachedAuth = null;
}

module.exports = {
    getAuthToken,
    tokenizeCard,
    chargeToken,
    chargeHostedToken,
    chargeCard,
    isHostedPaymentToken,
    achAuthenticate,
    achAddCustomer,
    achChargeToken,
    voidSale,
    refundToken,
    normalizeTransactionResponse,
    resetAuthCache,
    Environment
};
