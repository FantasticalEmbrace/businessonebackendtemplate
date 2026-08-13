'use strict';

const axios = require('axios');
const { getShippingConfig } = require('../config/shippingConfig');

function isConfigured() {
    return Boolean(getShippingConfig().SHIPPO_API_TOKEN);
}

function client() {
    const { SHIPPO_API_BASE, SHIPPO_API_TOKEN } = getShippingConfig();
    if (!SHIPPO_API_TOKEN) {
        const err = new Error('SHIPPO_NOT_CONFIGURED');
        err.code = 'SHIPPO_NOT_CONFIGURED';
        throw err;
    }
    return axios.create({
        baseURL: SHIPPO_API_BASE,
        headers: {
            Authorization: `ShippoToken ${SHIPPO_API_TOKEN}`,
            'Content-Type': 'application/json',
        },
        timeout: 45000,
    });
}

async function createShipment(payload) {
    const res = await client().post('/shipments/', { ...payload, async: false });
    return res.data;
}

async function createTransaction(payload) {
    const res = await client().post('/transactions/', { ...payload, async: false });
    return res.data;
}

async function getTransaction(transactionId) {
    const res = await client().get(`/transactions/${transactionId}`);
    return res.data;
}

module.exports = {
    isConfigured,
    client,
    createShipment,
    createTransaction,
    getTransaction,
};
