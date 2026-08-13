'use strict';

const { getCapabilities, listAllCapabilities } = require('./capabilities');
const {
    reversePayment,
    reverseOrderPayment,
    chargeMxTerminal,
    resolveProcessorForOrder,
} = require('../paymentGatewayOps');

module.exports = {
    getCapabilities,
    listAllCapabilities,
    reversePayment,
    reverseOrderPayment,
    chargeMxTerminal,
    resolveProcessorForOrder,
};
