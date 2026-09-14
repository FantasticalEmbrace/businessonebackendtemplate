'use strict';

/**
 * Replace flat store tax on promo totals with ZipTax destination tax.
 * Must stay identical for: promotions preview, POST /api/orders, NMI process-payment.
 */

const promoEngine = require('./webPromotionEngine');
const taxSettings = require('./taxSettings');
const { quoteSalesTax } = require('./salesTaxService');
const { normalizeUsStateCode } = require('../utils/usStateCode');

function roundMoney(n) {
    return promoEngine.roundMoney(n);
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {object} totals - from previewOrApplyTotals().totals
 * @param {{ street1?: string, city?: string, state?: string, postalCode?: string, name?: string }} shipTo
 * @param {{ applyTaxExemption?: boolean, tenant?: string }} [opts]
 * @returns {Promise<{ totals: object, taxSource: 'exempt'|'destination'|'flat' }>}
 */
async function applyWebDestinationTax(pool, totals, shipTo, opts = {}) {
    const out = { ...totals };
    if (opts.applyTaxExemption) {
        return { totals: out, taxSource: 'exempt' };
    }

    if (pool) {
        await taxSettings.hydrateFromDatabase(pool);
    }

    const tenant = opts.tenant || 'business_one';
    const stateCode = normalizeUsStateCode(shipTo?.state);
    // Tax-exempt destination list: sales/shipping allowed; force $0 tax (not a blocklist).
    // State alone is enough — do not wait on ZIP (checkout UI often has state before postal).
    if (stateCode && taxSettings.isStateTaxExempt(stateCode, tenant)) {
        const flatTax = Number(out.taxAmount) || 0;
        out.taxAmount = 0;
        out.totalAmount = roundMoney(Math.max(0, (Number(out.totalAmount) || 0) - flatTax));
        return { totals: out, taxSource: 'exempt' };
    }

    const postal = String(shipTo?.postalCode || shipTo?.zip || '').trim();
    if (!postal) {
        return { totals: out, taxSource: 'flat' };
    }

    const shippingAfter = roundMoney(Number(out.shippingAfter) || 0);
    const flatTax = Number(out.taxAmount) || 0;
    const taxBase = roundMoney(Math.max(0, (Number(out.totalAmount) || 0) - shippingAfter - flatTax));
    const quote = await quoteSalesTax({
        amount: taxBase,
        shipTo: {
            street1: String(shipTo.street1 || shipTo.line1 || '').trim(),
            city: String(shipTo.city || '').trim(),
            state: String(shipTo.state || '').trim(),
            postalCode: postal,
            name: String(shipTo.name || '').trim()
        },
        pool,
        tenant
    });
    out.taxAmount = quote.taxAmount;
    out.totalAmount = roundMoney(taxBase + shippingAfter + quote.taxAmount);
    return { totals: out, taxSource: 'destination' };
}

module.exports = {
    applyWebDestinationTax
};
