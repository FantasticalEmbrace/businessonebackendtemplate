'use strict';

/**
 * Template capability matrix — what each store processor supports.
 * Used by admin UI, POS config, and gateway dispatch.
 */
const CAPABILITIES = Object.freeze({
    epi: {
        id: 'epi',
        label: 'EPI',
        protocol: 'nmi_direct_post',
        website: {
            keyedSale: true,
            savedCards: true,
            authCapture: true,
            refund: true,
            void: true,
            ach: false,
            wallets: false,
            threeDS: false,
        },
        pos: {
            virtualTerminal: true,
            physicalTerminal: true,
            terminalProtocol: 'nmi_poi',
            chipReaderReady: true,
            refund: true,
            void: true,
        },
        pciScope: 'SAQ A (Collect.js) / SAQ B (POI terminal)',
    },
    nmi: {
        id: 'nmi',
        label: 'NMI',
        protocol: 'nmi_direct_post',
        website: {
            keyedSale: true,
            savedCards: true,
            authCapture: true,
            refund: true,
            void: true,
            ach: false,
            wallets: false,
            threeDS: false,
        },
        pos: {
            virtualTerminal: true,
            physicalTerminal: true,
            terminalProtocol: 'nmi_poi',
            chipReaderReady: true,
            refund: true,
            void: true,
        },
        pciScope: 'SAQ A (Collect.js) / SAQ B (POI terminal)',
    },
    mxmerchant: {
        id: 'mxmerchant',
        label: 'MX',
        protocol: 'mx_checkout_api',
        website: {
            keyedSale: true,
            savedCards: true,
            authCapture: true,
            refund: true,
            void: true,
            ach: true,
            wallets: false,
            threeDS: false,
            threeWayPci: true,
        },
        pos: {
            virtualTerminal: true,
            physicalTerminal: true,
            terminalProtocol: 'mx_terminal_api',
            chipReaderReady: true,
            refund: true,
            void: true,
        },
        pciScope: 'SAQ A (3-way browser) / P2PE (certified terminal)',
    },
});

function getCapabilities(processorId) {
    const id = String(processorId || 'epi').toLowerCase();
    if (id === 'mx' || id === 'mx_merchant') return CAPABILITIES.mxmerchant;
    if (id === 'nmi' || id === 'nmi_durango') return CAPABILITIES.nmi;
    return CAPABILITIES[id] || CAPABILITIES.epi;
}

function listAllCapabilities() {
    return Object.values(CAPABILITIES);
}

module.exports = {
    CAPABILITIES,
    getCapabilities,
    listAllCapabilities,
};
