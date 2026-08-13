'use strict';

const { normalizeHostingTier, computeInstallmentSchedule } = require('./platformBillingPricing');

/** Months to spread unpaid website-build balances into the monthly bill. */
const ONE_TIME_FINANCE_MONTHS = 12;

/** Keep aligned with business-one-webpage/js/web-build-pricing-tiers.js */
const BUILD_TIER_AMOUNTS = {
    basic: 1500,
    standard: 3000,
    growth: 6000,
    ecommerce: 10000
};

const HOSTING_TO_BUILD_TIER = {
    essential: 'basic',
    standard: 'standard',
    growth: 'growth',
    enterprise: 'ecommerce'
};

/** Milestone schedule — percentages of total build; deposit charged at signup. */
const BUILD_MILESTONE_DEFS = [
    {
        key: 'deposit',
        label: 'Discovery deposit (before kickoff)',
        pct: 25,
        order: 1,
        chargedAtSignup: true
    },
    {
        key: 'design',
        label: 'Design approval',
        pct: 35,
        order: 2,
        chargedAtSignup: false
    },
    {
        key: 'development',
        label: 'Development complete',
        pct: 25,
        order: 3,
        chargedAtSignup: false
    },
    {
        key: 'launch',
        label: 'Launch & delivery',
        pct: 15,
        order: 4,
        chargedAtSignup: false
    }
];

/** Upfront payment options at signup (percent of total build). */
const BUILD_PAY_PLANS = {
    deposit: {
        pct: 25,
        label: 'Discovery deposit (25%)',
        shortLabel: '25% deposit today',
        chargeType: 'build_deposit'
    },
    '50': {
        pct: 50,
        label: 'Website build — 50% upfront',
        shortLabel: '50% upfront today',
        chargeType: 'build_prepay'
    },
    '75': {
        pct: 75,
        label: 'Website build — 75% upfront',
        shortLabel: '75% upfront today',
        chargeType: 'build_prepay'
    },
    full: {
        pct: 100,
        label: 'Paid in full at signup',
        shortLabel: 'Pay build in full today',
        chargeType: 'build_full'
    }
};

function normalizeBuildPayMode(mode) {
    const raw = String(mode || 'deposit')
        .toLowerCase()
        .replace(/%/g, '')
        .trim();
    if (raw === 'full' || raw === '100') return 'full';
    if (raw === '50' || raw === 'pct50') return '50';
    if (raw === '75' || raw === 'pct75') return '75';
    return 'deposit';
}

function computeBuildSignupAmount(buildAmount, payMode) {
    const mode = normalizeBuildPayMode(payMode);
    const plan = BUILD_PAY_PLANS[mode] || BUILD_PAY_PLANS.deposit;
    const total = Math.round(Number(buildAmount) * 100) / 100;
    const amount = Math.round(total * (plan.pct / 100) * 100) / 100;
    return {
        mode,
        pct: plan.pct,
        amount,
        label: plan.label,
        shortLabel: plan.shortLabel,
        chargeType: plan.chargeType,
        formatted: `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    };
}

/** Unpaid build balance after signup prepay — divided over monthly installments. */
function computeBuildRemainderFinance(buildAmount, payMode, months = ONE_TIME_FINANCE_MONTHS) {
    const signup = computeBuildSignupAmount(buildAmount, payMode);
    const remaining = Math.round((Number(buildAmount || 0) - signup.amount) * 100) / 100;
    if (remaining <= 0) {
        return {
            payMode: signup.mode,
            pctPaidToday: signup.pct,
            paidToday: signup.amount,
            remaining: 0,
            months: Math.max(1, Math.floor(Number(months) || ONE_TIME_FINANCE_MONTHS)),
            monthlyAmount: 0
        };
    }
    const schedule = computeInstallmentSchedule(remaining, months);
    return {
        payMode: signup.mode,
        pctPaidToday: signup.pct,
        paidToday: signup.amount,
        remaining: schedule.total,
        months: schedule.months,
        monthlyAmount: schedule.monthlyAmount
    };
}

function describeBuildPayPlans(buildTierId) {
    const buildAmount = buildAmountForTier(buildTierId);
    return Object.fromEntries(
        Object.keys(BUILD_PAY_PLANS).map((key) => [key, computeBuildSignupAmount(buildAmount, key)])
    );
}

function buildTierFromHosting(hostingTier) {
    const hosting = normalizeHostingTier(hostingTier);
    return HOSTING_TO_BUILD_TIER[hosting] || 'basic';
}

function buildAmountForTier(buildTierId) {
    const key = String(buildTierId || 'basic').toLowerCase();
    return BUILD_TIER_AMOUNTS[key] ?? BUILD_TIER_AMOUNTS.basic;
}

function computeMilestoneAmounts(buildAmount) {
    const total = Math.round(Number(buildAmount) * 100) / 100;
    let allocated = 0;
    return BUILD_MILESTONE_DEFS.map((def, index) => {
        if (index === BUILD_MILESTONE_DEFS.length - 1) {
            const amount = Math.round((total - allocated) * 100) / 100;
            return { ...def, amount, pct: def.pct };
        }
        const amount = Math.round(total * (def.pct / 100) * 100) / 100;
        allocated += amount;
        return { ...def, amount, pct: def.pct };
    });
}

function describeBuildMilestones(buildTierId) {
    const buildTier = String(buildTierId || 'basic').toLowerCase();
    const buildAmount = buildAmountForTier(buildTier);
    const milestones = computeMilestoneAmounts(buildAmount);
    const deposit = milestones.find((m) => m.key === 'deposit');
    return {
        buildTier,
        buildAmount,
        formattedBuild: `$${buildAmount.toLocaleString('en-US')}`,
        milestones: milestones.map((m) => ({
            ...m,
            formatted: `$${m.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            refundableBeforeKickoff: m.key === 'deposit'
        })),
        depositAmount: deposit?.amount || 0,
        depositFormatted: deposit ? `$${deposit.amount.toFixed(2)}` : '$0.00',
        payPlans: describeBuildPayPlans(buildTier),
        refundPolicy:
            'Full refund of paid milestones if no project work has started. After kickoff, completed milestones are non-refundable.'
    };
}

function describeBuildFromHosting(hostingTier) {
    const buildTier = buildTierFromHosting(hostingTier);
    return describeBuildMilestones(buildTier);
}

async function getBuildContract(pool, accountId) {
    const [contracts] = await pool.execute(
        `SELECT * FROM billing_build_contracts WHERE account_id = ? AND status != 'canceled' ORDER BY id DESC LIMIT 1`,
        [accountId]
    );
    if (!contracts.length) return null;
    const contract = contracts[0];
    const [milestones] = await pool.execute(
        `SELECT * FROM billing_build_milestones WHERE contract_id = ? ORDER BY sort_order ASC`,
        [contract.id]
    );
    return {
        contract: {
            id: contract.id,
            buildTier: contract.build_tier,
            buildAmount: Number(contract.build_amount),
            status: contract.status,
            workStartedAt: contract.work_started_at
                ? String(contract.work_started_at).slice(0, 19)
                : null,
            kickoffAt: contract.kickoff_at ? String(contract.kickoff_at).slice(0, 19) : null
        },
        milestones: milestones.map((m) => ({
            id: m.id,
            key: m.milestone_key,
            label: m.label,
            amount: Number(m.amount),
            status: m.status,
            workStatus: m.work_status,
            chargeId: m.charge_id || null,
            paidAt: m.paid_at ? String(m.paid_at).slice(0, 19) : null,
            completedAt: m.completed_at ? String(m.completed_at).slice(0, 19) : null,
            sortOrder: m.sort_order
        }))
    };
}

async function createBuildContract(pool, accountId, { hostingTier, buildTier: buildTierOverride } = {}) {
    const buildTier = buildTierOverride || buildTierFromHosting(hostingTier);
    const buildAmount = buildAmountForTier(buildTier);
    const milestoneAmounts = computeMilestoneAmounts(buildAmount);

    const [ins] = await pool.execute(
        `INSERT INTO billing_build_contracts (account_id, build_tier, build_amount, hosting_tier, status)
         VALUES (?, ?, ?, ?, 'active')`,
        [accountId, buildTier, buildAmount, normalizeHostingTier(hostingTier)]
    );
    const contractId = ins.insertId;

    for (const m of milestoneAmounts) {
        await pool.execute(
            `INSERT INTO billing_build_milestones
                (contract_id, milestone_key, label, amount, sort_order, status, work_status)
             VALUES (?, ?, ?, ?, ?, 'pending', 'not_started')`,
            [contractId, m.key, m.label, m.amount, m.order]
        );
    }

    return getBuildContract(pool, accountId);
}

async function markMilestonePaid(pool, contractId, milestoneKey, chargeId) {
    await pool.execute(
        `UPDATE billing_build_milestones SET
            status = 'paid',
            paid_at = CURRENT_TIMESTAMP,
            charge_id = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE contract_id = ? AND milestone_key = ?`,
        [chargeId, contractId, milestoneKey]
    );
}

async function markAllMilestonesPaid(pool, contractId, chargeId) {
    await pool.execute(
        `UPDATE billing_build_milestones SET
            status = 'paid',
            paid_at = CURRENT_TIMESTAMP,
            charge_id = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE contract_id = ? AND status != 'paid'`,
        [chargeId, contractId]
    );
}

async function markMilestonesForPrepay(pool, contractId, prepayAmount, chargeId) {
    const [rows] = await pool.execute(
        `SELECT id, milestone_key, amount, sort_order, status
         FROM billing_build_milestones
         WHERE contract_id = ? AND status = 'pending'
         ORDER BY sort_order ASC`,
        [contractId]
    );

    let remaining = Math.round(Number(prepayAmount) * 100) / 100;
    for (const row of rows) {
        if (remaining <= 0) break;
        const milestoneAmount = Math.round(Number(row.amount) * 100) / 100;
        if (remaining >= milestoneAmount) {
            await markMilestonePaid(pool, contractId, row.milestone_key, chargeId);
            remaining = Math.round((remaining - milestoneAmount) * 100) / 100;
        } else {
            await pool.execute(
                `UPDATE billing_build_milestones SET
                    amount = ?,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [Math.round((milestoneAmount - remaining) * 100) / 100, row.id]
            );
            remaining = 0;
        }
    }
}

/** Mark unpaid milestones as financed so they are not charged again separately. */
async function markRemainingMilestonesFinanced(pool, contractId) {
    await pool.execute(
        `UPDATE billing_build_milestones SET
            status = 'financed',
            amount = 0,
            updated_at = CURRENT_TIMESTAMP
         WHERE contract_id = ? AND status = 'pending'`,
        [contractId]
    );
}

async function markKickoffStarted(pool, contractId) {
    await pool.execute(
        `UPDATE billing_build_contracts SET
            kickoff_at = COALESCE(kickoff_at, CURRENT_TIMESTAMP),
            work_started_at = COALESCE(work_started_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [contractId]
    );
    await pool.execute(
        `UPDATE billing_build_milestones SET
            work_status = CASE WHEN milestone_key = 'deposit' THEN 'in_progress' ELSE work_status END,
            updated_at = CURRENT_TIMESTAMP
         WHERE contract_id = ? AND milestone_key = 'deposit'`,
        [contractId]
    );
}

async function completeMilestone(pool, contractId, milestoneKey) {
    await pool.execute(
        `UPDATE billing_build_milestones SET
            status = CASE WHEN status = 'paid' THEN 'completed' ELSE status END,
            work_status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
         WHERE contract_id = ? AND milestone_key = ?`,
        [contractId, milestoneKey]
    );
    if (milestoneKey === 'deposit') {
        await markKickoffStarted(pool, contractId);
    }
}

async function refundBuildIfNoWorkStarted(pool, accountId, { note } = {}) {
    const { refundOrVoidCharge } = require('./prochargeRefunds');
    const data = await getBuildContract(pool, accountId);
    if (!data) {
        const err = new Error('No website build contract found');
        err.code = 'NO_BUILD_CONTRACT';
        throw err;
    }
    if (data.contract.workStartedAt || data.contract.kickoffAt) {
        const err = new Error('Project work has started — milestone refunds follow the return policy');
        err.code = 'WORK_STARTED';
        throw err;
    }

    const paidMilestones = data.milestones.filter((m) => m.status === 'paid');
    const refundTotal = paidMilestones.reduce((sum, m) => sum + m.amount, 0);
    if (refundTotal <= 0) {
        const err = new Error('No paid build milestones to refund');
        err.code = 'NOTHING_TO_REFUND';
        throw err;
    }

    const refundResults = [];
    for (const m of paidMilestones) {
        if (!m.chargeId) {
            const err = new Error(`Paid milestone "${m.key}" has no linked charge to refund`);
            err.code = 'CHARGE_NOT_FOUND';
            throw err;
        }
        const result = await refundOrVoidCharge(pool, accountId, m.chargeId, {
            description: `Website build refund — ${m.label} (before kickoff)`,
            amountOverride: m.amount
        });
        refundResults.push({ milestoneKey: m.key, amount: m.amount, ...result });
    }

    for (const m of paidMilestones) {
        await pool.execute(
            `UPDATE billing_build_milestones SET
                status = 'refunded',
                work_status = 'not_started',
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [m.id]
        );
    }

    await pool.execute(
        `UPDATE billing_accounts SET
            notes = CONCAT(COALESCE(notes, ''), ?),
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            `\n[${new Date().toISOString().slice(0, 16)}] Build refund $${refundTotal.toFixed(2)} to card before kickoff`,
            accountId
        ]
    );

    await pool.execute(
        `UPDATE billing_build_contracts SET
            status = 'canceled',
            canceled_at = CURRENT_TIMESTAMP,
            cancel_note = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [note || 'Refunded before kickoff — no work performed', data.contract.id]
    );

    return {
        contractId: data.contract.id,
        refundAmount: refundTotal,
        refunds: refundResults,
        milestones: paidMilestones.map((m) => ({ key: m.key, amount: m.amount, chargeId: m.chargeId }))
    };
}

module.exports = {
    BUILD_TIER_AMOUNTS,
    BUILD_MILESTONE_DEFS,
    BUILD_PAY_PLANS,
    ONE_TIME_FINANCE_MONTHS,
    normalizeBuildPayMode,
    computeBuildSignupAmount,
    computeBuildRemainderFinance,
    describeBuildPayPlans,
    buildTierFromHosting,
    buildAmountForTier,
    computeMilestoneAmounts,
    describeBuildMilestones,
    describeBuildFromHosting,
    getBuildContract,
    createBuildContract,
    markMilestonePaid,
    markAllMilestonesPaid,
    markMilestonesForPrepay,
    markRemainingMilestonesFinanced,
    markKickoffStarted,
    completeMilestone,
    refundBuildIfNoWorkStarted
};
