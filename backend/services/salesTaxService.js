'use strict';

/**
 * Destination sales tax for Business One seller charges (hardware, taxable invoices).
 * Default provider: Ziptax address-level rates (state / county / city / special districts).
 * Rates are fetched live at checkout — never cached for days, never a fixed statewide %.
 *
 * Prefer Admin → Sales Tax Reporting (or Business One Admin → Tax) for ZIPTAX_API_KEY.
 * That field writes the same value the billing hub reads as process.env.ZIPTAX_API_KEY.
 * Docs: https://docs.zip.tax/guides/rest-api/overview
 */

const axios = require('axios');
const logger = require('../utils/logger');
const taxSettings = require('./taxSettings');

function roundMoney(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function taxProvider() {
    return String(process.env.BILLING_TAX_PROVIDER || 'ziptax')
        .trim()
        .toLowerCase();
}

function normalizeTenant(tenant) {
    const t = String(tenant || 'business_one')
        .trim()
        .toLowerCase();
    if (t === 'hmherbs' || t === 'hm' || t === 'hm-herbs') return 'hmherbs';
    return 'business_one';
}

async function ensureTaxSettingsHydrated(pool) {
    if (!pool) return;
    try {
        await taxSettings.hydrateFromDatabase(pool);
    } catch (e) {
        logger.warn('[sales-tax] Could not hydrate tax settings from DB', { message: e.message });
    }
}

/** Tenant-scoped Ziptax key (Business One ≠ HM Herbs). */
function ziptaxApiKey(tenant = 'business_one') {
    return taxSettings.getZiptaxApiKey(normalizeTenant(tenant));
}

function ziptaxBaseUrl() {
    const raw = String(process.env.ZIPTAX_API_URL || 'https://api.zip-tax.com').trim().replace(/\/+$/, '');
    return raw || 'https://api.zip-tax.com';
}

function sellerOrigin() {
    return {
        country: 'US',
        street: String(process.env.BILLING_SELLER_STREET || '').trim(),
        city: String(process.env.BILLING_SELLER_CITY || '').trim(),
        state: String(process.env.BILLING_SELLER_STATE || '').trim().toUpperCase().slice(0, 2),
        postalCode: String(process.env.BILLING_SELLER_ZIP || process.env.BILLING_SELLER_POSTAL_CODE || '')
            .trim()
            .slice(0, 16)
    };
}

function sellerIdentity() {
    const origin = sellerOrigin();
    return {
        legalName: String(process.env.BILLING_SELLER_LEGAL_NAME || 'Business One Comprehensive').trim(),
        ein: String(process.env.BILLING_SELLER_EIN || process.env.BILLING_SELLER_TIN || '').trim(),
        phone: String(process.env.BILLING_SELLER_PHONE || '').trim(),
        email: String(process.env.BILLING_SELLER_EMAIL || '').trim(),
        ...origin
    };
}

function normalizeShipTo(shipTo = {}) {
    const street1 = String(shipTo.street1 || shipTo.street || shipTo.line1 || '').trim();
    const city = String(shipTo.city || '').trim();
    const state = String(shipTo.state || '')
        .trim()
        .toUpperCase()
        .slice(0, 2);
    const postalCode = String(shipTo.postalCode || shipTo.zip || shipTo.postal || '')
        .trim()
        .replace(/\s+/g, '')
        .slice(0, 16);
    const country = String(shipTo.country || 'US')
        .trim()
        .toUpperCase()
        .slice(0, 2) || 'US';
    const name = String(shipTo.name || shipTo.shipName || '').trim();
    if (!street1 || !city || !state || !postalCode) {
        return null;
    }
    if (!/^[A-Z]{2}$/.test(state)) {
        return null;
    }
    return { name, street1, city, state, postalCode, country };
}

function assertShipTo(shipTo) {
    const normalized = normalizeShipTo(shipTo);
    if (!normalized) {
        const err = new Error(
            'A complete shipping address (street, city, state, ZIP) is required to calculate sales tax.'
        );
        err.code = 'SHIPPING_REQUIRED_FOR_TAX';
        throw err;
    }
    return normalized;
}

function isProduction() {
    return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function allowDevZeroTax() {
    if (isProduction()) return false;
    const provider = taxProvider();
    if (provider === 'dev_zero' || provider === 'none') return true;
    if (process.env.BILLING_TAX_ALLOW_DEV_ZERO === 'true' && !ziptaxApiKey()) return true;
    return false;
}

function emptyBreakdown(subtotal, to, reason) {
    return {
        subtotal: roundMoney(subtotal),
        taxAmount: 0,
        taxRate: 0,
        total: roundMoney(subtotal),
        freightTaxable: false,
        provider: 'none',
        reason: reason || null,
        to,
        from: sellerOrigin(),
        jurisdictions: [],
        formattedSubtotal: `$${roundMoney(subtotal).toFixed(2)}`,
        formattedTax: '$0.00',
        formattedTotal: `$${roundMoney(subtotal).toFixed(2)}`
    };
}

function formatAddressLine(shipTo) {
    return [shipTo.street1, shipTo.city, shipTo.state, shipTo.postalCode].filter(Boolean).join(', ');
}

function mapZiptaxJurisdictions(baseRates = [], subtotal, taxAmount, taxRate) {
    const jurisdictions = [];
    for (const row of baseRates) {
        const jurType = String(row.jurType || '').toUpperCase();
        // Prefer sales-tax lines; skip use-tax duplicates.
        if (jurType.includes('USE_TAX')) continue;
        const rate = Number(row.rate) || 0;
        if (rate <= 0) continue;
        let type = 'special';
        if (jurType.includes('STATE')) type = 'state';
        else if (jurType.includes('COUNTY')) type = 'county';
        else if (jurType.includes('CITY') || jurType.includes('MUNICIPAL')) type = 'city';
        const name = String(row.jurName || row.jurDescription || type).trim();
        jurisdictions.push({
            type,
            name,
            rate,
            amount: roundMoney(subtotal * rate),
            label: `${name} (${(rate * 100).toFixed(2)}%)`
        });
    }

    if (!jurisdictions.length && taxAmount > 0) {
        jurisdictions.push({
            type: 'combined',
            name: 'Sales tax',
            rate: taxRate,
            amount: taxAmount,
            label: `Sales tax (${(taxRate * 100).toFixed(2)}%)`
        });
        return jurisdictions;
    }

    // Reconcile to provider total so jurisdiction lines never invent extra tax.
    const sum = roundMoney(jurisdictions.reduce((s, j) => s + j.amount, 0));
    if (jurisdictions.length && Math.abs(sum - taxAmount) > 0.02) {
        return [
            {
                type: 'combined',
                name: 'Sales tax',
                rate: taxRate,
                amount: taxAmount,
                label: `Sales tax (${(taxRate * 100).toFixed(2)}%)`
            }
        ];
    }
    // Fix penny drift on last line
    if (jurisdictions.length > 1) {
        const head = jurisdictions.slice(0, -1);
        const headSum = roundMoney(head.reduce((s, j) => s + j.amount, 0));
        jurisdictions[jurisdictions.length - 1].amount = roundMoney(taxAmount - headSum);
    }
    return jurisdictions;
}

async function quoteZiptax({ amount, shipTo, tenant = 'business_one' }) {
    const key = ziptaxApiKey(tenant);
    if (!key) {
        const label = normalizeTenant(tenant) === 'hmherbs' ? 'HM Herbs' : 'Business One';
        const err = new Error(
            `Sales tax cannot be calculated: ${label} Ziptax API key is not configured. Add it under ${label === 'Business One' ? 'Business One Admin → Tax' : 'Admin → Sales Tax Reporting'}.`
        );
        err.code = 'TAX_PROVIDER_NOT_CONFIGURED';
        throw err;
    }

    const to = assertShipTo(shipTo);
    const subtotal = roundMoney(amount);
    const address = formatAddressLine(to);

    let response;
    try {
        response = await axios.get(`${ziptaxBaseUrl()}/request/v60`, {
            headers: { 'X-API-KEY': key },
            params: { address, format: 'json', countryCode: 'USA' },
            timeout: 15000,
            validateStatus: () => true
        });
    } catch (e) {
        logger.error('[sales-tax] Ziptax request failed', { message: e.message });
        const err = new Error('Sales tax service is unreachable. Try again — we will not guess a tax rate.');
        err.code = 'TAX_PROVIDER_UNAVAILABLE';
        throw err;
    }

    if (response.status === 401 || response.status === 403) {
        const err = new Error(
            'Ziptax API key was rejected. Update the key under Admin → Sales Tax Reporting (or ZIPTAX_API_KEY).'
        );
        err.code = 'TAX_PROVIDER_AUTH_FAILED';
        throw err;
    }
    if (response.status >= 400) {
        const detail = response.data?.detail || response.data?.title || `HTTP ${response.status}`;
        logger.warn('[sales-tax] Ziptax HTTP error', { status: response.status, detail });
        const err = new Error(`Sales tax could not be calculated for this address: ${detail}`);
        err.code = 'TAX_CALCULATION_FAILED';
        throw err;
    }

    const data = response.data || {};
    const code = Number(data.metadata?.response?.code ?? data.rCode);
    if (code && code !== 100) {
        const msg = data.metadata?.response?.message || `Ziptax response code ${code}`;
        const err = new Error(`Sales tax could not be calculated for this address: ${msg}`);
        err.code = 'TAX_CALCULATION_FAILED';
        throw err;
    }

    const salesSummary = (data.taxSummaries || []).find((s) => s.taxType === 'SALES_TAX') || data.taxSummaries?.[0];
    let taxRate = Number(salesSummary?.rate);
    if (!Number.isFinite(taxRate) || taxRate < 0) {
        // Legacy postal-style fallback if present
        const legacy = data.results?.[0];
        taxRate = Number(legacy?.taxSales ?? legacy?.TaxSales);
    }
    if (!Number.isFinite(taxRate) || taxRate < 0) {
        const err = new Error('Ziptax returned no usable sales tax rate for this address.');
        err.code = 'TAX_CALCULATION_FAILED';
        throw err;
    }

    // Ziptax returns decimal fractions (0.0775 = 7.75%). Guard against percent-style values.
    if (taxRate > 1) taxRate = taxRate / 100;

    const taxAmount = roundMoney(subtotal * taxRate);
    const total = roundMoney(subtotal + taxAmount);
    const addr = data.addressDetail?.address || {};
    const resolvedTo = {
        ...to,
        city: addr.city || to.city,
        state: addr.stateCode || to.state,
        postalCode: String(addr.postalCode || to.postalCode).slice(0, 16),
        county: addr.county || null
    };

    const freightTaxable = String(data.shipping?.taxable || '').toUpperCase() === 'Y';
    const jurisdictions = mapZiptaxJurisdictions(data.baseRates || [], subtotal, taxAmount, taxRate);

    return {
        subtotal,
        taxAmount,
        taxRate,
        total,
        freightTaxable,
        provider: 'ziptax',
        reason: null,
        to: resolvedTo,
        from: sellerOrigin(),
        jurisdictions,
        providerRaw: {
            normalizedAddress: data.addressDetail?.normalizedAddress || null,
            responseCode: code || 100,
            sourcing: data.sourcingRules?.value || null
        },
        formattedSubtotal: `$${subtotal.toFixed(2)}`,
        formattedTax: `$${taxAmount.toFixed(2)}`,
        formattedTotal: `$${total.toFixed(2)}`
    };
}

/**
 * Quote sales tax for a taxable amount shipped to `shipTo`.
 * Always live from the provider at call time (checkout) — no long-lived rate cache.
 *
 * opts.tenant: 'hmherbs' | 'business_one' (controls ignore-state list)
 * opts.pool: optional — refreshes admin-stored Ziptax key / ignore states from DB
 */
async function quoteSalesTax(opts = {}) {
    await ensureTaxSettingsHydrated(opts.pool);

    const subtotal = roundMoney(opts.amount);
    if (!(subtotal > 0)) {
        return emptyBreakdown(0, normalizeShipTo(opts.shipTo), 'zero_amount');
    }

    const tenant = normalizeTenant(opts.tenant);
    const to = opts.shipTo ? assertShipTo(opts.shipTo) : null;

    if (to && taxSettings.isStateIgnored(to.state, tenant)) {
        logger.info('[sales-tax] State ignored for tenant — $0 tax', { tenant, state: to.state });
        return emptyBreakdown(subtotal, to, 'ignored_state');
    }

    const provider = taxProvider();
    if (provider === 'dev_zero' || provider === 'none') {
        if (isProduction() && provider !== 'none') {
            const err = new Error('dev_zero tax provider is not allowed in production.');
            err.code = 'TAX_PROVIDER_INVALID';
            throw err;
        }
        return emptyBreakdown(subtotal, to, 'dev_zero');
    }

    if (provider === 'ziptax') {
        if (!ziptaxApiKey(tenant) && allowDevZeroTax()) {
            logger.warn('[sales-tax] Ziptax API key missing — using $0 tax in non-production only', { tenant });
            return emptyBreakdown(subtotal, to, 'dev_zero_missing_key');
        }
        return quoteZiptax({ ...opts, shipTo: to || opts.shipTo, tenant });
    }

    const err = new Error(`Unknown BILLING_TAX_PROVIDER “${provider}”. Use ziptax.`);
    err.code = 'TAX_PROVIDER_INVALID';
    throw err;
}

async function computeHardwareCheckoutForAddress(subtotal, shipTo, opts = {}) {
    return quoteSalesTax({
        amount: subtotal,
        shipTo,
        shipping: opts.shipping || 0,
        pool: opts.pool,
        tenant: opts.tenant || 'business_one'
    });
}

function buildTaxLineItems(quote, { hardwareLabel, hardwareAmount } = {}) {
    const lines = [];
    if (hardwareLabel != null) {
        lines.push({
            code: 'hardware',
            label: hardwareLabel,
            amount: roundMoney(hardwareAmount != null ? hardwareAmount : quote.subtotal),
            taxable: true
        });
    }
    for (const j of quote.jurisdictions || []) {
        lines.push({
            code: `tax_${j.type}`,
            label: j.label,
            amount: j.amount,
            taxable: false,
            taxJurisdiction: {
                type: j.type,
                name: j.name,
                rate: j.rate
            }
        });
    }
    if (!(quote.jurisdictions || []).length && quote.taxAmount > 0) {
        lines.push({
            code: 'sales_tax',
            label: `Sales tax (${((quote.taxRate || 0) * 100).toFixed(2)}%)`,
            amount: quote.taxAmount,
            taxable: false
        });
    }
    lines.push({
        code: '_tax_meta',
        label: 'Tax calculation metadata',
        amount: 0,
        meta: true,
        tax: {
            provider: quote.provider,
            combinedRate: quote.taxRate,
            taxAmount: quote.taxAmount,
            subtotal: quote.subtotal,
            to: quote.to,
            from: quote.from,
            jurisdictions: quote.jurisdictions,
            reason: quote.reason || null
        }
    });
    return lines;
}

function lineItemsForCharge(quote, hardwareLabel) {
    return buildTaxLineItems(quote, {
        hardwareLabel,
        hardwareAmount: quote.subtotal
    });
}

module.exports = {
    roundMoney,
    taxProvider,
    normalizeTenant,
    sellerOrigin,
    sellerIdentity,
    normalizeShipTo,
    assertShipTo,
    quoteSalesTax,
    computeHardwareCheckoutForAddress,
    buildTaxLineItems,
    lineItemsForCharge,
    emptyBreakdown,
    formatAddressLine
};
