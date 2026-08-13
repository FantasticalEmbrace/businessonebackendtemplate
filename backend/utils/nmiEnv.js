'use strict';

const creds = require('../services/integrationCredentials');

/**
 * NMI credential resolution. Prefer DB (Developer Tools), then env names from your sandbox checklist.
 * @see https://docs.nmi.com/docs/collectjs — tokenization key is public (Collect.js only).
 * Private key is the Direct Post `security_key` and must never be sent to the browser.
 */

const DEFAULT_COLLECT_JS = 'https://secure.nmi.com/token/Collect.js';
const SANDBOX_COLLECT_JS = 'https://sandbox.nmi.com/token/Collect.js';
/**
 * Direct Post transact endpoint. The public https://nmi.com site does not host /api/transact.php (404).
 * Always use secure.nmi.com for Payment API unless you override with a full working URL.
 */
const DEFAULT_TRANSACT_URL = 'https://secure.nmi.com/api/transact.php';
/** Production token session endpoint (Collect.js). 401 means the key is not valid on this host. */
const NMI_TOKEN_CREATE_URL_SECURE = 'https://secure.nmi.com/token/api/create';
/** Sandbox tokenization keys validate here; probing only production falsely rejects sandbox keys. */
const NMI_TOKEN_CREATE_URL_SANDBOX = 'https://sandbox.nmi.com/token/api/create';

function getEpiPublicTokenizationKey() {
    return creds.getEpiPublicTokenizationKey();
}

function getEpiPrivateApiKey() {
    return creds.getEpiPrivateApiKey();
}

function getNmiPublicTokenizationKey() {
    return creds.getNmiPublicTokenizationKey();
}

function getNmiPrivateApiKey() {
    return creds.getNmiPrivateApiKey();
}

/** In-store POS NMI — separate merchant account from website checkout. */
function getPosNmiPublicTokenizationKey() {
    return creds.getPosNmiPublicTokenizationKey();
}

function getPosNmiPrivateApiKey() {
    return creds.getPosNmiPrivateApiKey();
}

function isPosNmiSandboxHint() {
    return creds.isPosNmiSandboxHint();
}

function resolveNmiTransactUrl(apiUrlEnv, sandboxHint) {
    let u = String(apiUrlEnv || '').trim();
    if (!u) {
        return sandboxHint ? 'https://sandbox.nmi.com/api/transact.php' : DEFAULT_TRANSACT_URL;
    }
    u = u.replace(/\/+$/, '');
    const lower = u.toLowerCase();
    if (
        lower === 'https://nmi.com' ||
        lower === 'http://nmi.com' ||
        lower === 'https://www.nmi.com' ||
        lower === 'http://www.nmi.com' ||
        lower === 'https://nmi.com/api/transact.php' ||
        lower === 'https://www.nmi.com/api/transact.php'
    ) {
        return DEFAULT_TRANSACT_URL;
    }
    if (/^https?:\/\/[^/]+$/i.test(u)) {
        return `${u}/api/transact.php`;
    }
    if (!/transact\.php/i.test(u)) {
        return `${u.replace(/\/+$/, '')}/api/transact.php`;
    }
    return u;
}

function getPosNmiTransactUrl() {
    return resolveNmiTransactUrl(process.env.POS_NMI_API_URL, isPosNmiSandboxHint());
}

function getPosNmiCollectJsUrl() {
    const u = String(process.env.POS_NMI_COLLECT_JS_URL || '').trim();
    if (u) return u;
    return isPosNmiSandboxHint() ? SANDBOX_COLLECT_JS : DEFAULT_COLLECT_JS;
}

function isPosNmiWalletsDisabled() {
    const s = String(process.env.POS_NMI_DISABLE_WALLETS || '').trim().toLowerCase();
    if (s === '0' || s === 'false' || s === 'no') return false;
    if (s === '1' || s === 'true' || s === 'yes') return true;
    return isPosNmiSandboxHint();
}

function shouldSkipPosNmiTokenizationPreflight() {
    const s = String(process.env.POS_NMI_SKIP_TOKENIZATION_PREFLIGHT || '').trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes') return true;
    return shouldSkipNmiTokenizationPreflight();
}

/**
 * Resolves Direct Post URL. Accepts full transact URL or bare origin (e.g. https://nmi.com).
 * If the gateway returns errors, try https://secure.nmi.com/api/transact.php via NMI_API_URL.
 */
function getNmiTransactUrl() {
    return resolveNmiTransactUrl(process.env.NMI_API_URL, isNmiSandboxHint());
}

function getNmiCollectJsUrl() {
    const u = String(process.env.NMI_COLLECT_JS_URL || '').trim();
    if (u) return u;
    return isNmiSandboxHint() ? SANDBOX_COLLECT_JS : DEFAULT_COLLECT_JS;
}

function isNmiSandboxHint() {
    return creds.isNmiSandboxHint();
}

/** Skip Apple Pay / Google Pay in Collect.js unless explicitly enabled in merchant portal + env. */
function isNmiWalletsDisabled() {
    const enable = String(process.env.NMI_ENABLE_WALLETS || '').trim().toLowerCase();
    if (enable === '1' || enable === 'true' || enable === 'yes') return false;
    const s = String(process.env.NMI_DISABLE_WALLETS || '').trim().toLowerCase();
    if (s === '0' || s === 'false' || s === 'no') return false;
    return true;
}

function shouldSkipNmiTokenizationPreflight() {
    const s = String(process.env.NMI_SKIP_TOKENIZATION_PREFLIGHT || '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}

/**
 * POST /token/api/create — same check Collect.js performs server-side.
 * @param {string} createUrl full URL e.g. https://secure.nmi.com/token/api/create
 * @param {string} tokenizationKey
 * @returns {Promise<boolean>} true if this host accepts the key (or network error: fail-open like before).
 */
async function nmiTokenCreatePreflightOnce(createUrl, tokenizationKey) {
    const key = String(tokenizationKey || '').trim();
    if (!key) return false;

    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 10000);
    try {
        const r = await fetch(createUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ tokenizationKey: key }),
            signal: ac.signal
        });
        const text = await r.text();
        if (r.status === 401 || r.status === 403) return false;
        if (r.status >= 400 && /authenticationError|E_AUTHENTICATION/i.test(text)) return false;
        return true;
    } catch {
        return true;
    } finally {
        clearTimeout(tid);
    }
}

/**
 * Resolves which Collect.js base accepts the tokenization key (production vs sandbox).
 * When NMI_COLLECT_JS_URL is unset, returns the matching default script URL.
 * @param {string} tokenizationKey
 * @returns {Promise<{ ok: boolean, collectJsUrl: string }>}
 */
async function nmiResolveTokenizationCollectJs(tokenizationKey, opts = {}) {
    const key = String(tokenizationKey || '').trim();
    const userCollect = String(opts.collectJsUrl || process.env.NMI_COLLECT_JS_URL || '').trim();
    const sandboxHint = opts.sandbox != null ? Boolean(opts.sandbox) : isNmiSandboxHint();
    const fallbackCollect = userCollect || (sandboxHint ? SANDBOX_COLLECT_JS : DEFAULT_COLLECT_JS);

    if (!key) {
        return { ok: false, collectJsUrl: fallbackCollect };
    }
    if (shouldSkipNmiTokenizationPreflight()) {
        // Still honor explicit NMI_COLLECT_JS_URL; skip only avoids blocking on probe failures.
        return { ok: true, collectJsUrl: fallbackCollect, preflightSkipped: true };
    }

    if (userCollect) {
        const lowerCollect = userCollect.toLowerCase();
        if (lowerCollect.includes('sandbox.nmi.com')) {
            if (await nmiTokenCreatePreflightOnce(NMI_TOKEN_CREATE_URL_SANDBOX, key)) {
                return { ok: true, collectJsUrl: userCollect };
            }
            return { ok: false, collectJsUrl: userCollect };
        }
        if (lowerCollect.includes('secure.nmi.com')) {
            if (await nmiTokenCreatePreflightOnce(NMI_TOKEN_CREATE_URL_SECURE, key)) {
                return { ok: true, collectJsUrl: userCollect };
            }
            return { ok: false, collectJsUrl: userCollect };
        }
        const tryOrder = sandboxHint
            ? [NMI_TOKEN_CREATE_URL_SANDBOX, NMI_TOKEN_CREATE_URL_SECURE]
            : [NMI_TOKEN_CREATE_URL_SECURE, NMI_TOKEN_CREATE_URL_SANDBOX];
        for (const createUrl of tryOrder) {
            if (await nmiTokenCreatePreflightOnce(createUrl, key)) {
                return { ok: true, collectJsUrl: userCollect };
            }
        }
        return { ok: false, collectJsUrl: userCollect };
    }

    const defaultPairs = [
        [NMI_TOKEN_CREATE_URL_SECURE, DEFAULT_COLLECT_JS],
        [NMI_TOKEN_CREATE_URL_SANDBOX, SANDBOX_COLLECT_JS]
    ];
    const order = sandboxHint ? [defaultPairs[1], defaultPairs[0]] : defaultPairs;
    for (const [createUrl, collectOut] of order) {
        if (await nmiTokenCreatePreflightOnce(createUrl, key)) {
            return { ok: true, collectJsUrl: collectOut };
        }
    }
    return { ok: false, collectJsUrl: DEFAULT_COLLECT_JS };
}

/**
 * @deprecated Prefer {@link nmiResolveTokenizationCollectJs} for correct sandbox Collect.js URL.
 * @param {string} tokenizationKey
 * @returns {Promise<boolean>}
 */
async function nmiTokenizationKeyPassesServerPreflight(tokenizationKey) {
    const r = await nmiResolveTokenizationCollectJs(tokenizationKey);
    return r.ok;
}

module.exports = {
    getEpiPublicTokenizationKey,
    getEpiPrivateApiKey,
    getNmiPublicTokenizationKey,
    getNmiPrivateApiKey,
    getPosNmiPublicTokenizationKey,
    getPosNmiPrivateApiKey,
    getNmiTransactUrl,
    getPosNmiTransactUrl,
    getNmiCollectJsUrl,
    getPosNmiCollectJsUrl,
    isNmiSandboxHint,
    isPosNmiSandboxHint,
    isNmiWalletsDisabled,
    isPosNmiWalletsDisabled,
    nmiTokenCreatePreflightOnce,
    nmiResolveTokenizationCollectJs,
    nmiTokenizationKeyPassesServerPreflight,
    shouldSkipNmiTokenizationPreflight,
    shouldSkipPosNmiTokenizationPreflight,
    DEFAULT_COLLECT_JS,
    SANDBOX_COLLECT_JS,
    DEFAULT_TRANSACT_URL,
    NMI_TOKEN_CREATE_URL_SECURE,
    NMI_TOKEN_CREATE_URL_SANDBOX
};
