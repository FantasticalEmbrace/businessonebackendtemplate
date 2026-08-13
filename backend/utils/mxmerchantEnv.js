'use strict';

const integrationCredentials = require('../services/integrationCredentials');

function isTruthyFlag(raw) {
    const s = String(raw || '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}

function isMxmerchantSandbox(scope = 'website') {
    if (scope === 'pos') {
        const raw = integrationCredentials.getPosMxmerchantSandbox();
        if (raw != null && String(raw).trim() !== '') return isTruthyFlag(raw);
    }
    return integrationCredentials.isMxmerchantSandbox();
}

function getMxmerchantApiBase(scope = 'website') {
    return isMxmerchantSandbox(scope)
        ? 'https://sandbox.api.mxmerchant.com/checkout'
        : 'https://api.mxmerchant.com/checkout';
}

function getMxmerchantConfig(scope = 'website') {
    return integrationCredentials.getMxmerchantCredentials(scope);
}

function isMxmerchantConfigured(scope = 'website') {
    const cfg = getMxmerchantConfig(scope);
    return Boolean(cfg.merchantId && cfg.hasAuth);
}

function buildWebsitePosData() {
    return {
        cardholderPresence: 'Ecom',
        deviceAttendance: 'HomePc',
        deviceInputCapability: 'KeyedOnly',
        deviceLocation: 'HomePc',
        panCaptureMethod: 'Manual',
    };
}

function buildPosVirtualPosData() {
    return {
        cardholderPresence: 'Present',
        deviceAttendance: 'Attended',
        deviceInputCapability: 'KeyedOnly',
        deviceLocation: 'OnPremise',
        panCaptureMethod: 'Manual',
    };
}

/** EMV/chip or swipe on certified MX terminal (Terminal API). */
function buildPosTerminalPosData() {
    return {
        cardholderPresence: 'Present',
        deviceAttendance: 'Attended',
        deviceInputCapability: 'ChipSwipeKeyed',
        deviceLocation: 'OnPremise',
        panCaptureMethod: 'Chip',
    };
}

function getMxmerchantSecurityApiBase(scope = 'website') {
    return isMxmerchantSandbox(scope)
        ? 'https://sandbox-api2.mxmerchant.com/security'
        : 'https://api2.mxmerchant.com/security';
}

function getMxmerchantTerminalApiBase(scope = 'website') {
    return isMxmerchantSandbox(scope)
        ? 'https://sandbox-api2.mxmerchant.com/terminal/v1'
        : 'https://api2.mxmerchant.com/terminal/v1';
}

module.exports = {
    isMxmerchantSandbox,
    getMxmerchantApiBase,
    getMxmerchantSecurityApiBase,
    getMxmerchantTerminalApiBase,
    getMxmerchantConfig,
    isMxmerchantConfigured,
    buildWebsitePosData,
    buildPosVirtualPosData,
    buildPosTerminalPosData,
};
