'use strict';

const creds = require('../services/integrationCredentials');

function numEnv(key, fallback) {
    const v = parseFloat(process.env[key]);
    return Number.isFinite(v) ? v : fallback;
}

function getShippingConfig() {
    const firstClass = numEnv('FIRST_CLASS_SHIPPING', 9.99);
    return {
        FREE_SHIPPING_THRESHOLD: numEnv('FREE_SHIPPING_THRESHOLD', 50),
        FIRST_CLASS_SHIPPING: firstClass,
        /** Paid checkout options (flat or Shippo) must not undercut this amount. */
        MIN_PAID_SHIPPING_RATE: numEnv('MIN_PAID_SHIPPING_RATE', firstClass),
        SHIPPO_API_BASE: 'https://api.goshippo.com',
        SHIPPO_API_TOKEN: creds.getShippoApiToken(),
        SHIPPO_TEST_MODE: creds.isShippoTestMode(),
        STORE_ORIGIN: creds.getShippoStoreOrigin(),
        CARRIER_FILTER: creds.getShippoCarrierFilter(),
    };
}

const FREE_SHIPPING_THRESHOLD = numEnv('FREE_SHIPPING_THRESHOLD', 50);
const FIRST_CLASS_SHIPPING = numEnv('FIRST_CLASS_SHIPPING', 9.99);
const MIN_PAID_SHIPPING_RATE = numEnv('MIN_PAID_SHIPPING_RATE', FIRST_CLASS_SHIPPING);

module.exports = {
    FREE_SHIPPING_THRESHOLD,
    FIRST_CLASS_SHIPPING,
    MIN_PAID_SHIPPING_RATE,
    getShippingConfig,
};
