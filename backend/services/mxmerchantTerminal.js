'use strict';

const axios = require('axios');
const {
    getMxmerchantSecurityApiBase,
    getMxmerchantTerminalApiBase,
    getMxmerchantConfig,
    isMxmerchantConfigured,
} = require('../utils/mxmerchantEnv');
const { buildAuthHeaderFromConfig } = require('./mxmerchantGateway');

function terminalClient(scope = 'pos', jwtToken) {
    const token = String(jwtToken || '').trim();
    if (!token) {
        const err = new Error('MX_TERMINAL_JWT_REQUIRED');
        err.code = 'MX_TERMINAL_JWT_REQUIRED';
        throw err;
    }
    return axios.create({
        baseURL: getMxmerchantTerminalApiBase(scope),
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        timeout: 120000,
        validateStatus: () => true,
    });
}

function securityClient(scope = 'pos') {
    const cfg = getMxmerchantConfig(scope);
    const auth = buildAuthHeaderFromConfig(cfg);
    if (!auth) {
        const err = new Error('MXMERCHANT_NOT_CONFIGURED');
        err.code = 'MXMERCHANT_NOT_CONFIGURED';
        throw err;
    }
    return axios.create({
        baseURL: getMxmerchantSecurityApiBase(scope),
        headers: {
            Authorization: auth,
            Accept: 'application/json',
        },
        timeout: 45000,
        validateStatus: () => true,
    });
}

async function getTerminalJwt(scope = 'pos') {
    if (!isMxmerchantConfigured(scope)) {
        const err = new Error('MXMERCHANT_NOT_CONFIGURED');
        err.code = 'MXMERCHANT_NOT_CONFIGURED';
        throw err;
    }
    const cfg = getMxmerchantConfig(scope);
    const res = await securityClient(scope).get(
        `/v1/merchant/${encodeURIComponent(cfg.merchantId)}/token`
    );
    if (res.status >= 400) {
        const err = new Error(res.data?.message || `MX JWT HTTP ${res.status}`);
        err.code = 'MX_JWT_FAILED';
        throw err;
    }
    const jwtToken = String(res.data?.jwtToken || res.data?.token || '').trim();
    if (!jwtToken) {
        const err = new Error('MX JWT response empty');
        err.code = 'MX_JWT_FAILED';
        throw err;
    }
    return jwtToken;
}

async function listTerminals(scope = 'pos') {
    const jwt = await getTerminalJwt(scope);
    const cfg = getMxmerchantConfig(scope);
    const res = await terminalClient(scope, jwt).get(
        `/terminal/merchantid/${encodeURIComponent(cfg.merchantId)}`
    );
    if (res.status >= 400) {
        return { ok: false, terminals: [], message: res.data?.message || `HTTP ${res.status}` };
    }
    const terminals = Array.isArray(res.data) ? res.data : res.data?.terminals || res.data?.results || [];
    return { ok: true, terminals };
}

function buildReplayId(seed) {
    const raw = String(seed || Date.now()).replace(/\D/g, '');
    return raw.padStart(15, '0').slice(-15);
}

/**
 * Send a sale/refund/void to a physical MX terminal (chip/swipe/NFC).
 * @see https://developer.mxmerchant.com/reference/terminal-transaction-create
 */
async function createTerminalTransaction({
    scope = 'pos',
    terminalId,
    amount,
    type = 'Sale',
    replayId,
    vaultCard = false,
}) {
    const jwt = await getTerminalJwt(scope);
    const cfg = getMxmerchantConfig(scope);
    const tid = String(terminalId || cfg.terminalId || '').trim();
    if (!tid) {
        const err = new Error('MX terminal ID required — set cred_mxmerchant_terminal_id in Developer Tools');
        err.code = 'MX_TERMINAL_ID_REQUIRED';
        throw err;
    }
    const body = {
        amount: Number(amount),
        type,
        replayId: buildReplayId(replayId),
        vaultCard: Boolean(vaultCard),
    };
    const res = await terminalClient(scope, jwt).post(
        `/transaction/merchantid/${encodeURIComponent(cfg.merchantId)}/terminalid/${encodeURIComponent(tid)}`,
        body
    );
    if (res.status >= 400) {
        return {
            ok: false,
            responseText: res.data?.message || `HTTP ${res.status}`,
            raw: res.data,
        };
    }
    const providerTxn = res.data?.provider?.transaction || {};
    const auditId =
        res.data?.prioritypaymentsystems?.mxmerchant?.merchant?.devicePaymentAuditId ||
        providerTxn.id ||
        '';
    return {
        ok: true,
        status: res.data?.status || providerTxn.status || 'SENTTOTERMINAL',
        transactionId: auditId,
        callbackUrl: providerTxn.callbackUrl || null,
        raw: res.data,
    };
}

async function getTerminalTransaction(scope, terminalId, transactionId) {
    const jwt = await getTerminalJwt(scope);
    const cfg = getMxmerchantConfig(scope);
    const res = await terminalClient(scope, jwt).get(
        `/transaction/merchantid/${encodeURIComponent(cfg.merchantId)}/terminalid/${encodeURIComponent(terminalId)}/transactionid/${encodeURIComponent(transactionId)}`
    );
    if (res.status >= 400) {
        return { ok: false, raw: res.data };
    }
    return { ok: true, raw: res.data };
}

async function testTerminalConnection(scope = 'pos') {
    if (!isMxmerchantConfigured(scope)) {
        return { ok: false, message: 'MX credentials missing' };
    }
    try {
        const jwt = await getTerminalJwt(scope);
        if (!jwt) return { ok: false, message: 'JWT request failed' };
        const listed = await listTerminals(scope);
        const cfg = getMxmerchantConfig(scope);
        const terminalId = String(cfg.terminalId || '').trim();
        return {
            ok: true,
            message: `Terminal API ready (${listed.terminals?.length || 0} terminal(s) on account)`,
            terminalCount: listed.terminals?.length || 0,
            configuredTerminalId: terminalId || null,
        };
    } catch (e) {
        return { ok: false, message: e.message || 'Terminal API connection failed' };
    }
}

module.exports = {
    getTerminalJwt,
    listTerminals,
    createTerminalTransaction,
    getTerminalTransaction,
    testTerminalConnection,
    buildReplayId,
};
