'use strict';

const { Environment } = require('procharge');

function getProchargeApiHost() {
    const explicit = String(process.env.PROCHARGE_API_HOST || '').trim();
    if (explicit) return explicit.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const sandbox = String(process.env.PROCHARGE_SANDBOX ?? '1').trim().toLowerCase();
    const isProd = sandbox === '0' || sandbox === 'false' || sandbox === 'no';
    return isProd ? Environment.Production : Environment.Development;
}

function getProchargeApplicationKey() {
    return String(process.env.PROCHARGE_APPLICATION_KEY || '').trim();
}

function getProchargeMerchantNumber() {
    return String(process.env.PROCHARGE_MERCHANT_NUMBER || '').trim();
}

/**
 * Credentials for POST /api/authentication/login (see api.procharge.com/api/help).
 * Portal fields: Login, 6-digit Reg Key, Password.
 * API JSON fields: userName, passWord, pin (Reg Key), application.
 */
function getProchargeLoginCreds() {
    const userName = String(
        process.env.PROCHARGE_USERNAME || process.env.PROCHARGE_EMAIL || ''
    ).trim();
    const passWord = String(process.env.PROCHARGE_PASSWORD || '').trim();
    const regKey = String(
        process.env.PROCHARGE_REG_KEY || process.env.PROCHARGE_PIN || ''
    ).trim();
    const application = String(process.env.PROCHARGE_APPLICATION || 'procharge').trim();
    return {
        userName,
        passWord,
        pin: regKey,
        application,
        // procharge SDK getAccessToken() validates creds.email; alias Login ID for callers/tests.
        email: userName
    };
}

function isProchargeConfigured() {
    const creds = getProchargeLoginCreds();
    return Boolean(
        creds.userName &&
            creds.passWord &&
            creds.pin &&
            getProchargeApplicationKey() &&
            getProchargeMerchantNumber()
    );
}

function isProchargeSandbox() {
    const sandbox = String(process.env.PROCHARGE_SANDBOX ?? '1').trim().toLowerCase();
    return sandbox !== '0' && sandbox !== 'false' && sandbox !== 'no';
}

module.exports = {
    getProchargeApiHost,
    getProchargeApplicationKey,
    getProchargeMerchantNumber,
    getProchargeLoginCreds,
    isProchargeConfigured,
    isProchargeSandbox
};
