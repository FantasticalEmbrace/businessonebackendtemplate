'use strict';

const {
    NMI_PROCESSOR_ID,
    NMI_PROCESSOR_LABEL,
    MX_PROCESSOR_ID,
    MX_PROCESSOR_LABEL,
    loadStorePaymentProcessor,
    loadPosPaymentProcessor,
    posProcessorConfigured,
} = require('./storePaymentProcessor');
const { loadPosCardCheckoutSettings } = require('./posCardCheckoutSettings');

/** Semi-integrated NMI terminal — POS card payment mode. */
const SEMI_INTEGRATED_ADAPTER = Object.freeze({
    id: NMI_PROCESSOR_ID,
    label: `${NMI_PROCESSOR_LABEL} (semi-integrated terminal)`,
    description:
        'Total is sent to the card terminal; the register completes the sale when the terminal approves. Card data never enters the POS.',
    integrated: true,
    pciScope: 'SAQ B / P2PE — certified terminal handles card data',
    driverScript: 'js/payment-drivers/nmi.js',
    serverCharge: true,
});

const MX_VIRTUAL_ADAPTER = Object.freeze({
    id: MX_PROCESSOR_ID,
    label: `${MX_PROCESSOR_LABEL} (on screen)`,
    description:
        'Keyed card entry on the register via MX 3-way payment. Card data posts directly to MX — not through HM Herbs servers.',
    integrated: true,
    pciScope: 'SAQ A — card data sent directly to MX Checkout API',
    driverScript: 'js/payment-drivers/mxmerchant.js',
    helperScript: 'js/mxmerchant-checkout.js',
    serverCharge: false,
});

const SETTING_KEY = 'pos_card_payment_adapter';

function listPublicAdapters() {
    return [
        {
            id: SEMI_INTEGRATED_ADAPTER.id,
            label: SEMI_INTEGRATED_ADAPTER.label,
            description: SEMI_INTEGRATED_ADAPTER.description,
            integrated: true,
            pciScope: SEMI_INTEGRATED_ADAPTER.pciScope,
            driverScript: SEMI_INTEGRATED_ADAPTER.driverScript,
            serverCharge: true,
            requiresEnv: ['POS_NMI_PRIVATE_API_KEY', 'POS_NMI_PUBLIC_TOKENIZATION_KEY'],
        },
        {
            id: MX_VIRTUAL_ADAPTER.id,
            label: MX_VIRTUAL_ADAPTER.label,
            description: MX_VIRTUAL_ADAPTER.description,
            integrated: true,
            pciScope: MX_VIRTUAL_ADAPTER.pciScope,
            driverScript: MX_VIRTUAL_ADAPTER.driverScript,
            helperScript: MX_VIRTUAL_ADAPTER.helperScript,
            serverCharge: false,
            requiresEnv: ['POS_MXMERCHANT_MERCHANT_ID', 'POS_MXMERCHANT_CONSUMER_KEY', 'POS_MXMERCHANT_CONSUMER_SECRET'],
        },
    ];
}

/**
 * Resolve POS payment adapter for the active store processor.
 * @param {import('mysql2/promise').Pool|null} pool
 */
async function resolveEffectivePaymentAdapter(pool) {
    const storeProcessor = pool ? await loadStorePaymentProcessor(pool) : 'epi';
    const posProcessor = pool ? await loadPosPaymentProcessor(pool) : storeProcessor;
    const checkout = pool ? await loadPosCardCheckoutSettings(pool) : { virtualTerminal: true };
    let configured = posProcessorConfigured(posProcessor);
    if (posProcessor === MX_PROCESSOR_ID && checkout.displayMode === 'mx_quick_pay') {
        configured = true;
    }

    const adapter =
        posProcessor === MX_PROCESSOR_ID
            ? MX_VIRTUAL_ADAPTER
            : SEMI_INTEGRATED_ADAPTER;

    let configurationNote = null;
    if (posProcessor === MX_PROCESSOR_ID && checkout.displayMode === 'mx_quick_pay') {
        configurationNote =
            'MX Quick Pay mode — charge the cart total in MX Quick Pay, then confirm on the register to save the sale.';
    } else if (!configured) {
        configurationNote =
            posProcessor === MX_PROCESSOR_ID
                ? 'Add MX credentials in Admin → Developer tools → Integrations.'
                : 'Add NMI POS keys in Admin → Developer tools → Integrations (In-store POS section), or set POS_NMI_* in backend .env.';
    } else if (posProcessor === MX_PROCESSOR_ID) {
        configurationNote =
            checkout.displayMode === 'mx_terminal'
                ? 'MX physical terminal mode is selected — POS sends the amount to the configured MX terminal.'
                : 'MX on-screen mode — card entry on the register.';
    } else if (checkout.virtualTerminal) {
        configurationNote =
            'On screen — card entry on the register via Collect.js (no physical terminal required).';
    } else if (!checkout.poiDeviceId) {
        configurationNote = 'Physical terminal mode — set the POI device ID in Developer tools or POS Equipment.';
    }

    const virtualTerminal =
        posProcessor === MX_PROCESSOR_ID
            ? checkout.displayMode === 'mx_virtual'
            : Boolean(checkout.virtualTerminal);

    const mxQuickPay = checkout.displayMode === 'mx_quick_pay';

    return {
        posMode: 'integrated',
        posModeLabel:
            posProcessor === MX_PROCESSOR_ID
                ? mxQuickPay
                    ? 'MX Quick Pay'
                    : 'MX checkout'
                : 'Semi-integrated NMI terminal',
        cardAdapter: adapter.id,
        cardAdapterLabel: adapter.label,
        storeProcessor,
        posProcessor,
        driverScript: adapter.driverScript,
        helperScript: mxQuickPay ? '' : adapter.helperScript || '',
        customDriverUrl: '',
        integrated: true,
        serverCharge: Boolean(adapter.serverCharge),
        configured,
        configurationNote,
        compliance: {
            cardDataInApp: virtualTerminal && !mxQuickPay,
            useExternalTerminalForCards: !virtualTerminal || mxQuickPay,
            pciScope: mxQuickPay
                ? 'SAQ — card data entered only in MX Quick Pay (portal); POS records sale after staff confirmation'
                : virtualTerminal
                  ? adapter.pciScope
                  : SEMI_INTEGRATED_ADAPTER.pciScope,
        },
        envOverride: false,
    };
}

async function loadPosPaymentConfig(pool) {
    const resolved = await resolveEffectivePaymentAdapter(pool);
    return {
        cardAdapter: resolved.cardAdapter,
        cardAdapterLabel: resolved.cardAdapterLabel,
        posMode: resolved.posMode,
        posModeLabel: resolved.posModeLabel,
        storeProcessor: resolved.storeProcessor,
        posProcessor: resolved.posProcessor,
        adapters: listPublicAdapters(),
        driverScript: resolved.driverScript,
        helperScript: resolved.helperScript,
        customDriverUrl: '',
        integrated: true,
        serverCharge: resolved.serverCharge,
        configured: resolved.configured,
        configurationNote: resolved.configurationNote,
        compliance: resolved.compliance,
        envOverride: false,
    };
}

/** @deprecated Legacy ids map to active adapter. */
function normalizeAdapterId(raw) {
    const id = String(raw || '').trim().toLowerCase();
    if (id === MX_PROCESSOR_ID || id === 'mx') return MX_PROCESSOR_ID;
    return NMI_PROCESSOR_ID;
}

/** @deprecated Legacy modes map to integrated semi-integrated. */
function normalizePosMode() {
    return 'integrated';
}

function adapterConfigured(processorId) {
    return posProcessorConfigured(processorId || NMI_PROCESSOR_ID);
}

module.exports = {
    POS_CARD_ADAPTERS: {
        [NMI_PROCESSOR_ID]: SEMI_INTEGRATED_ADAPTER,
        [MX_PROCESSOR_ID]: MX_VIRTUAL_ADAPTER,
    },
    DEFAULT_ADAPTER_ID: SEMI_INTEGRATED_ADAPTER.id,
    SETTING_KEY,
    normalizeAdapterId,
    normalizePosMode,
    adapterConfigured,
    loadPosPaymentConfig,
    resolveEffectivePaymentAdapter,
    listPublicAdapters,
};
