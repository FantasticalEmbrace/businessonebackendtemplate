'use strict';

const shippo = require('./shippoClient');
const { getShippingConfig } = require('../config/shippingConfig');

const CARRIER_ALIASES = Object.freeze({
    usps: 'usps',
    ups: 'ups',
    fedex: 'fedex',
    fedexexpress: 'fedex',
    fedexground: 'fedex',
});

function normalizeCarrierId(raw) {
    const key = String(raw || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    return CARRIER_ALIASES[key] || key;
}

function requiredCarriers() {
    return [...getShippingConfig().CARRIER_FILTER];
}

function validateOriginForExpressCarriers(origin) {
    const issues = [];
    const o = origin || {};
    if (!String(o.street1 || '').trim()) issues.push('Ship-from street address is required');
    if (!String(o.city || '').trim()) issues.push('Ship-from city is required');
    if (!String(o.state || '').trim()) issues.push('Ship-from state is required');
    if (!String(o.zip || '').trim()) issues.push('Ship-from ZIP is required');
    const phoneDigits = String(o.phone || '').replace(/\D/g, '');
    if (phoneDigits.length < 10) {
        issues.push('Ship-from phone is required for UPS and FedEx labels (10+ digits)');
    }
    if (!String(o.email || '').trim()) {
        issues.push('Ship-from email is recommended for UPS and FedEx');
    }
    return { ok: issues.length === 0, issues };
}

async function listCarrierAccounts() {
    if (!shippo.isConfigured()) return [];
    const res = await shippo.client().get('/carrier_accounts/');
    return Array.isArray(res.data?.results) ? res.data.results : [];
}

function summarizeCarrierAccounts(accounts = []) {
    const wanted = new Set(requiredCarriers());
    const summary = {};
    for (const carrier of wanted) {
        summary[carrier] = { active: false, accountId: null, isTest: null };
    }

    for (const account of accounts) {
        const carrier = normalizeCarrierId(account.carrier);
        if (!wanted.has(carrier)) continue;
        if (!summary[carrier]) {
            summary[carrier] = { active: false, accountId: null, isTest: null };
        }
        if (account.active) {
            summary[carrier] = {
                active: true,
                accountId: account.account_id || account.object_id || null,
                isTest: Boolean(account.is_test),
            };
        }
    }

    const missing = [...wanted].filter((c) => !summary[c]?.active);
    return { carriers: summary, missing, required: [...wanted] };
}

function countRatesByProvider(rates = []) {
    const counts = {};
    for (const rate of rates) {
        const provider = normalizeCarrierId(rate.provider);
        counts[provider] = (counts[provider] || 0) + 1;
    }
    return counts;
}

async function quoteSampleRates() {
    const cfg = getShippingConfig();
    const origin = cfg.STORE_ORIGIN;
    const shipment = await shippo.createShipment({
        address_from: {
            name: origin.name,
            company: origin.company,
            street1: origin.street1,
            street2: origin.street2 || undefined,
            city: origin.city,
            state: origin.state,
            zip: origin.zip,
            country: origin.country || 'US',
            phone: origin.phone,
            email: origin.email,
        },
        address_to: {
            name: 'Rate Test Customer',
            street1: '123 Main St',
            city: 'Salt Lake City',
            state: 'UT',
            zip: '84101',
            country: 'US',
            phone: origin.phone || '8005551212',
            email: origin.email || undefined,
        },
        parcels: [
            {
                length: '8',
                width: '6',
                height: '4',
                distance_unit: 'in',
                weight: '16',
                mass_unit: 'oz',
            },
        ],
    });
    const filtered = (shipment.rates || []).filter((r) =>
        cfg.CARRIER_FILTER.has(normalizeCarrierId(r.provider))
    );
    return {
        shipmentId: shipment.object_id,
        rateCount: filtered.length,
        byProvider: countRatesByProvider(filtered),
        sample: filtered.slice(0, 3).map((r) => ({
            provider: normalizeCarrierId(r.provider),
            service: r.servicelevel?.name || r.servicelevel_name || '',
            amount: r.amount,
        })),
    };
}

async function auditShippoCarriers() {
    const cfg = getShippingConfig();
    const originCheck = validateOriginForExpressCarriers(cfg.STORE_ORIGIN);
    const report = {
        tokenConfigured: shippo.isConfigured(),
        testMode: cfg.SHIPPO_TEST_MODE,
        requiredCarriers: requiredCarriers(),
        origin: originCheck,
        accounts: null,
        rates: null,
        warnings: [],
        ready: false,
        blockers: [],
    };

    if (!report.tokenConfigured) {
        report.blockers.push('Shippo API token missing');
        return report;
    }
    if (!originCheck.ok) {
        report.blockers.push(...originCheck.issues);
    }

    try {
        report.rates = await quoteSampleRates();
    } catch (e) {
        report.rates = { error: e.response?.data?.detail || e.message };
        report.blockers.push(`Could not quote sample carrier rates: ${report.rates.error}`);
    }

    try {
        const accounts = await listCarrierAccounts();
        report.accounts = summarizeCarrierAccounts(accounts);
        for (const carrier of report.accounts.missing) {
            const rateCount = report.rates?.byProvider?.[carrier] || 0;
            if (rateCount > 0) continue;
            if (carrier === 'ups') {
                report.warnings.push(
                    'UPS BYOA account not marked active in Shippo — connect at goshippo.com → Settings → Carriers if you ship on your own UPS account'
                );
            } else if (carrier === 'fedex') {
                report.warnings.push(
                    'FedEx BYOA account not marked active in Shippo — connect your FedEx account in the Shippo dashboard'
                );
            }
        }
    } catch (e) {
        report.accounts = { error: e.response?.data?.detail || e.message };
        report.blockers.push(`Could not list Shippo carrier accounts: ${report.accounts.error}`);
    }

    if (report.rates && !report.rates.error) {
        for (const carrier of report.requiredCarriers) {
            const rateCount = report.rates.byProvider[carrier] || 0;
            const isActive = report.accounts?.carriers?.[carrier]?.active;
            if (rateCount > 0) continue;
            if (cfg.SHIPPO_TEST_MODE && carrier !== 'usps') {
                report.warnings.push(
                    `No ${carrier.toUpperCase()} sample rates in Shippo test mode — connect the live carrier account before go-live`
                );
                continue;
            }
            if (carrier === 'ups') {
                report.blockers.push(
                    'No UPS rates returned — connect your UPS account in the Shippo dashboard (OAuth + account number)'
                );
            } else if (carrier === 'fedex') {
                report.blockers.push(
                    'No FedEx rates returned — connect your FedEx account in the Shippo dashboard (account # + address verification)'
                );
            } else if (carrier === 'usps') {
                report.blockers.push('No USPS rates returned — confirm USPS is active in Shippo');
            }
            if (!isActive && (carrier === 'ups' || carrier === 'fedex')) {
                report.warnings.push(`${carrier.toUpperCase()} carrier account is not active in Shippo`);
            }
        }
    }

    report.ready = report.blockers.length === 0;
    return report;
}

module.exports = {
    normalizeCarrierId,
    requiredCarriers,
    validateOriginForExpressCarriers,
    listCarrierAccounts,
    summarizeCarrierAccounts,
    countRatesByProvider,
    quoteSampleRates,
    auditShippoCarriers,
};
