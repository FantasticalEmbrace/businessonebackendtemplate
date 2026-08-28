'use strict';

const crypto = require('crypto');
const { nmiSale } = require('./nmiGateway');
const { loadPosPaymentProcessor, resolveMerchantPosProcessorCredentials, merchantPosProcessorConfigured } = require('./storePaymentProcessor');
const { hydrateFromDatabase: hydrateIntegrationCredentials } = require('./integrationCredentials');
const { refreshStoreBaseUrlFromDb, getStoreBaseUrl } = require('../utils/platformSupportEnv');
const { getJobByPortalToken, markJobPaid } = require('./shopJobs');
const { loadCustomerWorkflowConfig } = require('./shopCustomerWorkflow');
const { loadPosStoreConfig } = require('./posStoreConfig');
const { loadPosReceiptSettings } = require('./posReceiptSettings');

const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function linkSecret() {
    return String(
        process.env.SHOP_PAYMENT_LINK_SECRET ||
            process.env.CUSTOM_PAYMENT_LINK_SECRET ||
            process.env.JWT_SECRET ||
            ''
    ).trim();
}

function roundMoney(amount) {
    return Math.round(Number(amount) * 100) / 100;
}

async function storeOrigin(pool) {
    if (pool) await refreshStoreBaseUrlFromDb(pool);
    return getStoreBaseUrl().replace(/\/+$/, '');
}

async function buildCustomerPortalUrl(pool, portalToken) {
    const base = await storeOrigin(pool);
    const prefix = base || '';
    return `${prefix}/shop-track.html?token=${encodeURIComponent(String(portalToken || ''))}`;
}

async function buildShopPayPageUrl(pool, portalToken, amount) {
    const exp = Date.now() + LINK_TTL_MS;
    const token = String(portalToken || '');
    const total = roundMoney(amount);
    const sig = buildPaymentSignature(token, total, exp);
    const base = await storeOrigin(pool);
    const q = new URLSearchParams({ token, exp: String(exp) });
    if (sig) q.set('sig', sig);
    return `${base || ''}/shop-pay.html?${q.toString()}`;
}

function buildPaymentSignature(portalToken, amount, expiresAt) {
    const secret = linkSecret();
    if (!secret) return null;
    const payload = `${String(portalToken)}|${Math.round(roundMoney(amount) * 100)}|${Number(expiresAt) || 0}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyPaymentSignature({ portalToken, amount, expiresAt, signature }) {
    const secret = linkSecret();
    if (!secret) return { ok: true, locked: false };
    const sig = String(signature || '').trim();
    if (!sig) return { ok: false, locked: true, reason: 'Signed payment link required.' };
    const exp = Number(expiresAt) || 0;
    if (exp && Date.now() > exp) {
        return { ok: false, locked: true, reason: 'This payment link has expired.' };
    }
    const expected = buildPaymentSignature(portalToken, amount, exp);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected || '');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { ok: false, locked: true, reason: 'Invalid payment link signature.' };
    }
    return { ok: true, locked: true };
}

async function paymentLinkAllowed(pool, job) {
    const config = await loadCustomerWorkflowConfig(pool);
    const vertical = job?.jobType || job?.mode || 'auto';
    const template = config.verticals?.[vertical];
    if (config.paymentLinkEnabled === false) return false;
    if (template?.paymentLinkEnabled === false) return false;
    return true;
}

async function createShopJobPaymentLink(pool, { portalToken, amount, job: jobIn }) {
    const token = String(portalToken || '').trim();
    let job = jobIn;
    if (!job && token) {
        const loaded = await getJobByPortalToken(pool, token);
        job = loaded.job;
    }
    if (!job) {
        return { paymentLinkEnabled: false, url: null, error: 'Job not found' };
    }
    if (job.paid) {
        return { paymentLinkEnabled: false, url: null, error: 'This repair order is already paid.' };
    }
    const allowed = await paymentLinkAllowed(pool, job);
    if (!allowed) {
        return { paymentLinkEnabled: false, url: null, message: 'Online payment is disabled for this shop.' };
    }
    const total = roundMoney(amount != null ? amount : job.total);
    if (total < 0.01) {
        return { paymentLinkEnabled: false, url: null, error: 'Nothing due on this repair order yet.' };
    }
    const processor = await loadPosPaymentProcessor(pool);
    if (!merchantPosProcessorConfigured(processor)) {
        return {
            paymentLinkEnabled: false,
            url: null,
            error: 'This store has not configured its own card processor keys yet. Pay at the front desk or add keys in Admin → Developer tools.'
        };
    }
    const url = await buildShopPayPageUrl(pool, token || job.portalToken, total);
    return { paymentLinkEnabled: true, url, amount: total, expiresAt: Date.now() + LINK_TTL_MS };
}

async function loadShopPayInfo(pool, portalToken, { signature, expiresAt } = {}) {
    if (pool) await hydrateIntegrationCredentials(pool);
    const token = String(portalToken || '').trim();
    const { job } = await getJobByPortalToken(pool, token);
    if (!job) {
        return { ok: false, error: 'Repair order not found.' };
    }
    if (job.paid) {
        return { ok: false, paid: true, error: 'This repair order is already paid.' };
    }
    const allowed = await paymentLinkAllowed(pool, job);
    if (!allowed) {
        return { ok: false, error: 'Online payment is not enabled for this shop.' };
    }
    const amount = roundMoney(job.total);
    const verify = verifyPaymentSignature({
        portalToken: token,
        amount,
        expiresAt,
        signature
    });
    if (!verify.ok) {
        return { ok: false, locked: true, error: verify.reason || 'Invalid payment link.' };
    }
    const processor = await loadPosPaymentProcessor(pool);
    const creds = resolveMerchantPosProcessorCredentials(processor);
    const [store, receipt] = await Promise.all([
        loadPosStoreConfig(pool),
        loadPosReceiptSettings(pool, null)
    ]);
    const nmiReady =
        (processor === 'nmi' || processor === 'epi') && merchantPosProcessorConfigured(processor);
    return {
        ok: true,
        job: {
            roNumber: job.roNumber,
            customerName: job.customerName,
            vehicle: job.vehicle,
            total: amount,
            concern: job.concern
        },
        store: {
            name: store.storeName || 'Your shop',
            phone: receipt.storePhone || ''
        },
        payment: {
            amount,
            locked: verify.locked,
            processor: nmiReady ? processor : null,
            collectJs: nmiReady
                ? {
                      enabled: Boolean(creds.publicKey),
                      tokenizationKey: creds.publicKey || '',
                      collectJsUrl: creds.collectJsUrl || '',
                      sandbox: Boolean(creds.sandbox)
                  }
                : { enabled: false },
            description: `Repair order ${job.roNumber}`
        }
    };
}

async function chargeShopJobPayment(pool, portalToken, body = {}) {
    if (pool) await hydrateIntegrationCredentials(pool);
    const token = String(portalToken || '').trim();
    const { job } = await getJobByPortalToken(pool, token);
    if (!job) {
        const err = new Error('Repair order not found.');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (job.paid) {
        const err = new Error('This repair order is already paid.');
        err.code = 'ALREADY_PAID';
        throw err;
    }
    const amount = roundMoney(job.total);
    const verify = verifyPaymentSignature({
        portalToken: token,
        amount,
        expiresAt: body.exp || body.expiresAt,
        signature: body.sig || body.signature
    });
    if (!verify.ok) {
        const err = new Error(verify.reason || 'Invalid payment link.');
        err.code = 'INVALID_LINK';
        throw err;
    }
    const paymentToken = String(body.payment_token || body.paymentToken || '').trim();
    if (!paymentToken) {
        const err = new Error('Complete the secure card fields before submitting.');
        err.code = 'PAYMENT_TOKEN_REQUIRED';
        throw err;
    }
    const processor = await loadPosPaymentProcessor(pool);
    const creds = resolveMerchantPosProcessorCredentials(processor);
    if (processor === 'mxmerchant') {
        const err = new Error('Shop pay-by-link requires NMI or EPI keys saved for this store in Admin → Developer tools.');
        err.code = 'PROCESSOR_UNSUPPORTED';
        throw err;
    }
    if (!merchantPosProcessorConfigured(processor) || !creds.privateKey) {
        const err = new Error('This store has not configured its own card processor keys yet.');
        err.code = 'PROCESSOR_NOT_CONFIGURED';
        throw err;
    }
    const amountStr = amount.toFixed(2);
    const sale = await nmiSale({
        securityKey: creds.privateKey,
        amount: amountStr,
        paymentToken,
        transactUrl: creds.transactUrl
    });
    if (!sale?.ok) {
        const err = new Error(sale?.responseText || 'Payment was declined.');
        err.code = 'CHARGE_FAILED';
        throw err;
    }
    await markJobPaid(pool, token, sale.transactionId);
    return {
        ok: true,
        amount,
        transactionId: sale.transactionId,
        roNumber: job.roNumber,
        message: `Payment of $${amountStr} for ${job.roNumber} was approved.`
    };
}

module.exports = {
    buildCustomerPortalUrl,
    buildShopPayPageUrl,
    buildPaymentSignature,
    verifyPaymentSignature,
    createShopJobPaymentLink,
    loadShopPayInfo,
    chargeShopJobPayment
};
