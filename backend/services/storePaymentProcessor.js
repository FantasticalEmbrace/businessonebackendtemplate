'use strict';

const {
    getEpiPublicTokenizationKey,
    getEpiPrivateApiKey,
    getNmiPublicTokenizationKey,
    getNmiPrivateApiKey,
    getPosNmiPublicTokenizationKey,
    getPosNmiPrivateApiKey,
    getNmiCollectJsUrl,
    getPosNmiCollectJsUrl,
    getNmiTransactUrl,
    getPosNmiTransactUrl,
    isNmiSandboxHint,
    isPosNmiSandboxHint
} = require('../utils/nmiEnv');
const { getMxmerchantCredentials } = require('./integrationCredentials');
const { isMxmerchantConfigured } = require('./mxmerchantGateway');

const DEFAULT_PROCESSOR = 'epi';
const SETTING_KEY = 'store_card_payment_processor';
const POS_SETTING_KEY = 'pos_card_payment_processor';

const NMI_PROCESSOR_ID = 'nmi';
const NMI_PROCESSOR_LABEL = 'NMI';
const MX_PROCESSOR_ID = 'mxmerchant';
const MX_PROCESSOR_LABEL = 'MX';

const STORE_PROCESSORS = Object.freeze({
    epi: {
        id: 'epi',
        label: 'EPI',
        description: 'Standard card processing for most products (default).',
        highRisk: false
    },
    [NMI_PROCESSOR_ID]: {
        id: NMI_PROCESSOR_ID,
        label: NMI_PROCESSOR_LABEL,
        description: 'NMI gateway — high-risk or restricted products, or when selected for all store cards.',
        highRisk: true
    },
    [MX_PROCESSOR_ID]: {
        id: MX_PROCESSOR_ID,
        label: MX_PROCESSOR_LABEL,
        description: 'MX Merchant gateway — keyed virtual terminal and in-store POS.',
        highRisk: false
    }
});

function normalizeStoreProcessor(raw) {
    const id = String(raw || '').trim().toLowerCase();
    if (id === 'mxmerchant' || id === 'mx_merchant' || id === 'mx') return MX_PROCESSOR_ID;
    // Accept legacy processor id from older installs
    if (id === 'nmi' || id === 'nmi_durango') return NMI_PROCESSOR_ID;
    return STORE_PROCESSORS[id] ? id : DEFAULT_PROCESSOR;
}

async function readSetting(pool, key) {
    const [rows] = await pool.execute('SELECT value FROM settings WHERE key_name = ? LIMIT 1', [key]);
    return rows[0]?.value != null ? String(rows[0].value).trim() : '';
}

async function loadStorePaymentProcessor(pool) {
    if (pool) {
        try {
            const db = await readSetting(pool, SETTING_KEY);
            if (db) return normalizeStoreProcessor(db);
        } catch {
            /* use default */
        }
    }
    return DEFAULT_PROCESSOR;
}

/** Processor for in-store POS card charges (may differ from website). */
async function loadPosPaymentProcessor(pool) {
    if (pool) {
        try {
            const posRaw = await readSetting(pool, POS_SETTING_KEY);
            const posId = String(posRaw || 'inherit').trim().toLowerCase();
            if (posId && posId !== 'inherit') {
                return normalizeStoreProcessor(posId);
            }
        } catch {
            /* fall through */
        }
    }
    return loadStorePaymentProcessor(pool);
}

function processorConfigured(processorId) {
    const processor = normalizeStoreProcessor(processorId);
    if (processor === MX_PROCESSOR_ID) {
        return isMxmerchantConfigured('website');
    }
    const creds = resolveProcessorCredentials(processorId);
    return Boolean(creds.publicKey && creds.privateKey);
}

function posProcessorConfigured(processorId) {
    const id = normalizeStoreProcessor(processorId);
    if (id === MX_PROCESSOR_ID) {
        return isMxmerchantConfigured('pos');
    }
    if (id === 'nmi') {
        const creds = resolvePosProcessorCredentials('nmi');
        return Boolean(creds.publicKey && creds.privateKey);
    }
    return processorConfigured(id);
}

/**
 * Resolve Collect.js + Direct Post keys for the active store processor.
 * EPI falls back to NMI env names when EPI_* keys are not set (legacy deployments).
 */
function resolveProcessorCredentials(processorId) {
    const processor = normalizeStoreProcessor(processorId);
    const meta = STORE_PROCESSORS[processor];

    if (processor === MX_PROCESSOR_ID) {
        const mx = getMxmerchantCredentials('website');
        return {
            processor,
            label: meta.label,
            merchantId: mx.merchantId,
            authMethod: mx.authMethod,
            sandbox: Boolean(mx.sandbox),
            accountScope: 'website',
            driver: 'mxmerchant',
        };
    }

    if (processor === 'nmi') {
        return {
            processor,
            label: meta.label,
            publicKey: getNmiPublicTokenizationKey(),
            privateKey: getNmiPrivateApiKey(),
            collectJsUrl: getNmiCollectJsUrl(),
            transactUrl: getNmiTransactUrl(),
            sandbox: isNmiSandboxHint(),
            accountScope: 'website'
        };
    }

    const epiPublic = getEpiPublicTokenizationKey();
    const epiPrivate = getEpiPrivateApiKey();
    const publicKey = epiPublic || getNmiPublicTokenizationKey();
    const privateKey = epiPrivate || getNmiPrivateApiKey();

    return {
        processor,
        label: meta.label,
        publicKey,
        privateKey,
        collectJsUrl: getNmiCollectJsUrl(),
        transactUrl: getNmiTransactUrl(),
        sandbox: isNmiSandboxHint(),
        accountScope: 'website'
    };
}

/**
 * NMI credentials for in-store POS (terminal + customer display).
 * Uses POS_NMI_* env vars — separate merchant account from website NMI_* keys.
 */
function resolvePosProcessorCredentials(processorId) {
    const processor = normalizeStoreProcessor(processorId);

    if (processor === MX_PROCESSOR_ID) {
        const mx = getMxmerchantCredentials('pos');
        const meta = STORE_PROCESSORS[processor];
        return {
            processor,
            label: `${meta.label} (in-store)`,
            merchantId: mx.merchantId,
            authMethod: mx.authMethod,
            sandbox: Boolean(mx.sandbox),
            accountScope: 'pos',
            driver: 'mxmerchant',
        };
    }

    if (processor === 'nmi') {
        return {
            processor,
            label: `${NMI_PROCESSOR_LABEL} (in-store)`,
            publicKey: getPosNmiPublicTokenizationKey(),
            privateKey: getPosNmiPrivateApiKey(),
            collectJsUrl: getPosNmiCollectJsUrl(),
            transactUrl: getPosNmiTransactUrl(),
            sandbox: isPosNmiSandboxHint(),
            accountScope: 'pos'
        };
    }

    const epiPublic = getEpiPublicTokenizationKey();
    const epiPrivate = getEpiPrivateApiKey();
    const meta = STORE_PROCESSORS[processor];

    return {
        processor,
        label: meta?.label || processor,
        publicKey: epiPublic || getNmiPublicTokenizationKey(),
        privateKey: epiPrivate || getNmiPrivateApiKey(),
        collectJsUrl: getNmiCollectJsUrl(),
        transactUrl: getNmiTransactUrl(),
        sandbox: isNmiSandboxHint(),
        accountScope: 'pos'
    };
}

function listStoreProcessors() {
    return Object.values(STORE_PROCESSORS).map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        highRisk: p.highRisk
    }));
}

module.exports = {
    NMI_PROCESSOR_ID,
    NMI_PROCESSOR_LABEL,
    MX_PROCESSOR_ID,
    MX_PROCESSOR_LABEL,
    DEFAULT_PROCESSOR,
    SETTING_KEY,
    POS_SETTING_KEY,
    STORE_PROCESSORS,
    normalizeStoreProcessor,
    loadStorePaymentProcessor,
    loadPosPaymentProcessor,
    resolveProcessorCredentials,
    resolvePosProcessorCredentials,
    processorConfigured,
    posProcessorConfigured,
    listStoreProcessors
};
