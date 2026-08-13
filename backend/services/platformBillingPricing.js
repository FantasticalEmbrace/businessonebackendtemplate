'use strict';

const {
    calculateMonthlyAmount,
    calculateFailoverOverage,
    describeBillingBreakdown,
    describeMonthlyPricing,
    FAILOVER_INCLUDED_GB,
    FAILOVER_OVERAGE_PER_GB
} = require('./posBillingPricing');

/** Standard managed hosting tiers (monthly). +$150 per tier step. */
const HOSTING_TIERS_STANDARD = {
    essential: 150,
    standard: 300,
    growth: 450,
    enterprise: 600
};

/** Principal / designated accounts ($150 less per tier where applicable). */
const HOSTING_TIERS_LEGACY = {
    essential: 150,
    standard: 150,
    growth: 300,
    enterprise: 450
};

const HOSTING_TIER_ORDER = ['essential', 'standard', 'growth', 'enterprise'];

const HOSTING_TIER_ALIASES = {
    performance: 'enterprise'
};

const HOSTING_OVERAGE_PER_STEP = 150;

/** Full Business One internet plans (not WTI failover). */
const INTERNET_PLANS = {
    basic_50: { label: 'Internet 50 Mbps', monthly: 79 },
    standard_100: { label: 'Internet 100 Mbps', monthly: 99 },
    performance_200: { label: 'Internet 200 Mbps', monthly: 129 },
    business_500: { label: 'Internet 500 Mbps', monthly: 179 }
};

const HARDWARE_MIN_INSTALLMENT = Number(process.env.BILLING_HARDWARE_MIN_INSTALLMENT || 300);
const HARDWARE_MAX_INSTALLMENT_MONTHS = Math.min(
    12,
    Math.max(1, Number(process.env.BILLING_HARDWARE_MAX_INSTALLMENT_MONTHS || 12))
);

/** Sales tax on hardware/router at signup (decimal). Default 7.5% — override via env. */
function hardwareSalesTaxRate() {
    const rate = Number(process.env.BILLING_HARDWARE_SALES_TAX_RATE || 0.075);
    return Number.isFinite(rate) && rate >= 0 ? rate : 0.075;
}

function computeHardwareCheckout(subtotal, { taxRate } = {}) {
    const sub = Math.round(Number(subtotal) * 100) / 100;
    const rate = taxRate != null ? Number(taxRate) : hardwareSalesTaxRate();
    const taxAmount = Math.round(sub * rate * 100) / 100;
    const total = Math.round((sub + taxAmount) * 100) / 100;
    return {
        subtotal: sub,
        taxRate: rate,
        taxAmount,
        total,
        formattedSubtotal: `$${sub.toFixed(2)}`,
        formattedTax: `$${taxAmount.toFixed(2)}`,
        formattedTotal: `$${total.toFixed(2)}`
    };
}

function normalizeHostingTier(tier) {
    const key = String(tier || 'essential').toLowerCase();
    const mapped = HOSTING_TIER_ALIASES[key] || key;
    return HOSTING_TIERS_STANDARD[mapped] != null ? mapped : 'essential';
}

function hostingMonthlyAmount(tier, { legacyRate = false } = {}) {
    const table = legacyRate ? HOSTING_TIERS_LEGACY : HOSTING_TIERS_STANDARD;
    return table[normalizeHostingTier(tier)] ?? table.essential;
}

function hostingOverageAmount({ currentTier, recommendedTier, legacyRate = false } = {}) {
    const cur = HOSTING_TIER_ORDER.indexOf(normalizeHostingTier(currentTier));
    const rec = HOSTING_TIER_ORDER.indexOf(normalizeHostingTier(recommendedTier));
    if (cur < 0 || rec < 0 || rec <= cur) return 0;
    return (rec - cur) * HOSTING_OVERAGE_PER_STEP;
}

function internetMonthlyAmount(planId) {
    const plan = INTERNET_PLANS[String(planId || '').toLowerCase()];
    return plan ? plan.monthly : 0;
}

function internetPlanLabel(planId) {
    const plan = INTERNET_PLANS[String(planId || '').toLowerCase()];
    return plan ? plan.label : String(planId || 'Internet');
}

function computeInstallmentSchedule(totalAmount, months) {
    const total = Math.round(Number(totalAmount) * 100) / 100;
    const n = Math.min(HARDWARE_MAX_INSTALLMENT_MONTHS, Math.max(1, Math.floor(Number(months) || 1)));
    if (total <= 0) {
        return { months: n, monthlyAmount: 0, total };
    }
    const monthly = Math.ceil((total / n) * 100) / 100;
    return { months: n, monthlyAmount: monthly, total };
}

function isHardwareInstallmentEligible(totalAmount) {
    return Number(totalAmount) >= HARDWARE_MIN_INSTALLMENT;
}

/**
 * Build itemized monthly statement lines for an account.
 */
function buildMonthlyLineItems({
    subscriptions = [],
    usageLines = [],
    installmentPlans = []
}) {
    const lines = [];
    let subtotal = 0;

    for (const sub of subscriptions) {
        if (String(sub.status).toLowerCase() !== 'active') continue;
        const type = String(sub.product_type || sub.productType).toLowerCase();
        const config = sub.config || sub.config_json || {};
        const overrideRaw = sub.monthly_amount_override ?? sub.monthlyAmountOverride;
        const override =
            overrideRaw != null && Number.isFinite(Number(overrideRaw)) ? Number(overrideRaw) : null;
        let amount = 0;
        let label = type;

        if (type === 'pos') {
            const stations = Math.max(1, Number(config.stationCount || config.licensedStationCount) || 1);
            if (override != null) {
                amount = override;
                label = config.label || `POS — $${override.toFixed(2)}/mo`;
            } else {
                const pricing = describeMonthlyPricing(stations);
                amount = pricing.monthlyAmount;
                label = `POS — ${pricing.summary}`;
            }
        } else if (type === 'hosting') {
            if (override != null) {
                amount = override;
                const tierLabel = normalizeHostingTier(config.tier || 'standard');
                label = config.label || `Web hosting — ${tierLabel} ($${override.toFixed(2)}/mo)`;
            } else {
                amount = hostingMonthlyAmount(config.tier, { legacyRate: Boolean(config.legacyRate) });
                label = `Web hosting — ${normalizeHostingTier(config.tier)} ($${amount}/mo)`;
                const over = hostingOverageAmount({
                    currentTier: config.tier,
                    recommendedTier: config.recommendedTier,
                    legacyRate: Boolean(config.legacyRate)
                });
                if (over > 0) {
                    lines.push({
                        code: 'hosting_overage',
                        label: `Hosting tier upgrade notice (${config.recommendedTier})`,
                        amount: over
                    });
                    subtotal += over;
                }
            }
        } else if (type === 'internet') {
            if (override != null) {
                amount = override;
                label = config.label || `Internet — $${override.toFixed(2)}/mo`;
            } else {
                amount = internetMonthlyAmount(config.planId);
                label = `Internet — ${internetPlanLabel(config.planId)}`;
            }
        } else if (override != null) {
            amount = override;
            label = config.label || type;
        }

        if (amount > 0) {
            lines.push({ code: type, label, amount, subscriptionId: sub.id });
            subtotal += amount;
        }
    }

    for (const usage of usageLines) {
        const amt = Number(usage.amount) || 0;
        if (amt <= 0) continue;
        lines.push({
            code: usage.usage_type || usage.usageType || 'usage',
            label: usage.label || usage.usage_type || 'Usage',
            amount: amt,
            usageId: usage.id
        });
        subtotal += amt;
    }

    for (const plan of installmentPlans) {
        if (String(plan.status).toLowerCase() !== 'active') continue;
        const amt = Number(plan.monthly_amount) || 0;
        if (amt <= 0) continue;
        const sku = String(plan.sku || '');
        const isBuild = sku.startsWith('website-build');
        lines.push({
            code: isBuild ? 'build_installment' : 'hardware_installment',
            label: `${isBuild ? 'Website build plan' : 'Hardware plan'} — ${plan.description || plan.sku} (${plan.months_remaining} left)`,
            amount: amt,
            installmentPlanId: plan.id
        });
        subtotal += amt;
    }

    return {
        lines,
        subtotal: Math.round(subtotal * 100) / 100
    };
}

module.exports = {
    HOSTING_TIERS_STANDARD,
    HOSTING_TIERS_LEGACY,
    HOSTING_TIER_ORDER,
    HOSTING_OVERAGE_PER_STEP,
    INTERNET_PLANS,
    HARDWARE_MIN_INSTALLMENT,
    HARDWARE_MAX_INSTALLMENT_MONTHS,
    hardwareSalesTaxRate,
    computeHardwareCheckout,
    normalizeHostingTier,
    hostingMonthlyAmount,
    hostingOverageAmount,
    internetMonthlyAmount,
    internetPlanLabel,
    computeInstallmentSchedule,
    isHardwareInstallmentEligible,
    buildMonthlyLineItems,
    calculateMonthlyAmount,
    calculateFailoverOverage,
    describeBillingBreakdown,
    describeMonthlyPricing,
    FAILOVER_INCLUDED_GB,
    FAILOVER_OVERAGE_PER_GB
};
