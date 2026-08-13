'use strict';

/**
 * Automatic in-store promotion pricing — same rules as web checkout, no code typing.
 * Evaluates active POS promotions when items are on the ticket; picks the best eligible deal.
 */
const promoEngine = require('./webPromotionEngine');
const groupDiscount = require('./customerGroupDiscount');
const employeeDiscount = require('./employeeDiscount');

const { promotionAppliesPos } = promoEngine;

function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function columnExists(pool, table, column) {
    try {
        const [rows] = await pool.execute(
            `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
            [table, column]
        );
        return rows.length > 0;
    } catch {
        return false;
    }
}

async function loadActivePosAutoPromotions(pool) {
    const hasPosCols = await columnExists(pool, 'web_promotions', 'applies_pos');
    const sql = hasPosCols
        ? `SELECT * FROM web_promotions
            WHERE is_active = 1
              AND applies_pos = 1
              AND auto_apply_pos = 1
              AND (starts_at IS NULL OR starts_at <= NOW())
              AND (ends_at IS NULL OR ends_at >= NOW())
            ORDER BY id ASC`
        : `SELECT * FROM web_promotions
            WHERE is_active = 1
              AND (starts_at IS NULL OR starts_at <= NOW())
              AND (ends_at IS NULL OR ends_at >= NOW())
            ORDER BY id ASC`;
    const [rows] = await pool.execute(sql);
    return (rows || []).filter((row) => promotionAppliesPos(row));
}

async function enrichPosCartLines(pool, normalizedItems) {
    const ids = [...new Set(normalizedItems.map((i) => i.product_id).filter(Boolean))];
    if (!ids.length) return [];

    const [rows] = await pool.execute(
        `SELECT id, name, sku, category_id, price FROM products
          WHERE id IN (${ids.map(() => '?').join(',')}) AND is_active = 1`,
        ids
    );
    const map = new Map(rows.map((r) => [r.id, r]));

    const variantIds = [
        ...new Set(
            normalizedItems
                .map((n) => Number(n.variant_id))
                .filter((n) => Number.isFinite(n) && n > 0)
        )
    ];
    let variantPriceMap = new Map();
    if (variantIds.length) {
        const [vrows] = await pool.execute(
            `SELECT id, product_id, price FROM product_variants WHERE id IN (${variantIds
                .map(() => '?')
                .join(',')})`,
            variantIds
        );
        variantPriceMap = new Map(vrows.map((v) => [`${v.product_id}:${v.id}`, Number(v.price)]));
    }

    const enriched = [];
    for (const item of normalizedItems) {
        const p = map.get(item.product_id);
        if (!p) continue;
        let unitPrice = Number(p.price);
        if (item.variant_id != null && item.variant_id !== '') {
            const key = `${item.product_id}:${Number(item.variant_id)}`;
            const vp = variantPriceMap.get(key);
            if (Number.isFinite(vp)) unitPrice = vp;
        }
        enriched.push({
            product_id: item.product_id,
            variant_id: item.variant_id != null ? Number(item.variant_id) || null : null,
            quantity: item.quantity,
            unitPrice: roundMoney(unitPrice),
            name: p.name,
            sku: p.sku,
            category_id: p.category_id
        });
    }
    return enriched;
}

function posEvaluateOpts({ applyTaxExemption, taxRate }) {
    return {
        applyTaxExemption: Boolean(applyTaxExemption),
        shippingMethod: 'pickup',
        shippingAmount: 0,
        taxRate: Number.isFinite(Number(taxRate)) ? Number(taxRate) : 0
    };
}

function stackGroupAndEmployee(totals, enriched, groupBenefits, empSettings, customerType, taxExempt, taxRate) {
    let out = { ...totals };
    let groupStandingApplied = null;

    if (groupBenefits?.standingDiscount) {
        const standingResult = groupDiscount.applyStandingGroupDiscountToTotals(
            {
                merchandiseSubtotal: out.merchandiseSubtotal,
                merchandiseDiscount: out.merchandiseDiscount,
                shippingDiscount: out.shippingDiscount || 0,
                shippingAfter: out.shippingAfter || 0,
                taxAmount: out.taxAmount,
                totalAmount: out.totalAmount,
                totalDiscountAmount: out.totalDiscountAmount
            },
            groupBenefits.standingDiscount
        );
        out = standingResult.totals;
        groupStandingApplied = standingResult.applied;
    }

    out = employeeDiscount.applyEmployeeDiscountToTotals(
        out,
        empSettings,
        customerType,
        taxExempt,
        taxRate
    );

    return { totals: out, groupStandingApplied };
}

async function evaluatePromotionCandidate(pool, promotion, enriched, stackOpts) {
    let rulesParsed;
    try {
        rulesParsed = promoEngine.parseRules(promotion.rules);
    } catch {
        return null;
    }
    if (!promoEngine.promotionHasApplicableMerchOrShipping(rulesParsed)) return null;

    const usage = await promoEngine.promotionUsageExceeded(pool, promotion, stackOpts.email);
    if (usage) return null;

    const promoTotals = promoEngine.evaluateTotals(rulesParsed, enriched, stackOpts.evalOpts);
    if (!Number(promoTotals.merchandiseDiscount) && !Number(promoTotals.shippingDiscount)) {
        return null;
    }

    const stacked = stackGroupAndEmployee(
        promoTotals,
        enriched,
        stackOpts.groupBenefits,
        stackOpts.empSettings,
        stackOpts.customerType,
        stackOpts.applyTaxExemption,
        stackOpts.taxRate
    );

    const merchDisc = Number(stacked.totals.merchandiseDiscount) || 0;
    const promoMerchDisc = Number(promoTotals.merchandiseDiscount) || 0;

    return {
        promotion,
        rulesParsed,
        totals: stacked.totals,
        groupStandingApplied: stacked.groupStandingApplied,
        promoMerchandiseDiscount: promoMerchDisc,
        totalMerchandiseDiscount: merchDisc,
        source: 'promotion'
    };
}

async function evaluateBaseline(enriched, stackOpts) {
    const baseline = promoEngine.evaluateTotals(
        { scope: 'all', productIds: [], categoryIds: [], effects: [], triggerReward: null },
        enriched,
        stackOpts.evalOpts
    );
    const stacked = stackGroupAndEmployee(
        baseline,
        enriched,
        stackOpts.groupBenefits,
        stackOpts.empSettings,
        stackOpts.customerType,
        stackOpts.applyTaxExemption,
        stackOpts.taxRate
    );
    return {
        promotion: null,
        totals: stacked.totals,
        groupStandingApplied: stacked.groupStandingApplied,
        promoMerchandiseDiscount: 0,
        totalMerchandiseDiscount: Number(stacked.totals.merchandiseDiscount) || 0,
        source: 'baseline'
    };
}

/**
 * Price a POS cart with automatic promotions (no promo code entry).
 * @returns {{ merchandiseSubtotal, promoDiscountAmount, cartDiscountAmount, cartDiscountLabel, promotion, appliedPromotions, totals }}
 */
async function pricePosCart(pool, opts = {}) {
    const catalogLines = opts.catalogLines || [];
    const customerUser = opts.customerUser || null;
    const taxExempt = Boolean(opts.taxExempt);
    const taxRate = Number(opts.taxRate) || 0;
    const allowManualDiscounts = Boolean(opts.allowManualDiscounts);
    const manualCartDiscountPercent = allowManualDiscounts
        ? Math.min(100, Math.max(0, Number(opts.manualCartDiscountPercent) || 0))
        : 0;

    const cartItems = catalogLines.map((line) => ({
        product_id: line.product_id,
        variant_id: line.variant_id,
        quantity: line.quantity,
        price: line.catalogUnitPrice ?? line.unitPrice
    }));

    const normalized = promoEngine.normalizeIncomingCartItems(cartItems);
    if (!normalized.length) {
        return {
            merchandiseSubtotal: 0,
            promoDiscountAmount: 0,
            cartDiscountAmount: 0,
            cartDiscountLabel: null,
            promotion: null,
            appliedPromotions: [],
            groupStandingApplied: null
        };
    }

    const enriched = await enrichPosCartLines(pool, normalized);
    const merchandiseSubtotal = roundMoney(
        enriched.reduce((sum, row) => sum + roundMoney(row.unitPrice * row.quantity), 0)
    );

    const userId = customerUser?.id || null;
    const email = customerUser?.email || null;
    const customerType = customerUser?.customer_type || null;
    const groupBenefits = userId
        ? await groupDiscount.loadUserGroupBenefits(pool, userId, 'pos')
        : { standingDiscount: null, autoApplyPromotions: [], linkedPromotions: [] };

    const empSettings = await employeeDiscount.loadEmployeeDiscountSettings(pool);
    const evalOpts = posEvaluateOpts({ applyTaxExemption: taxExempt, taxRate });
    const stackOpts = {
        groupBenefits,
        empSettings,
        customerType,
        applyTaxExemption: taxExempt,
        taxRate,
        email,
        evalOpts
    };

    const candidates = [];
    candidates.push(await evaluateBaseline(enriched, stackOpts));

    const storePromos = await loadActivePosAutoPromotions(pool);
    for (const promotion of storePromos) {
        const hit = await evaluatePromotionCandidate(pool, promotion, enriched, stackOpts);
        if (hit) candidates.push(hit);
    }

    if (groupBenefits.autoApplyPromotions?.length) {
        for (const linked of groupBenefits.autoApplyPromotions) {
            const [rows] = await pool.execute(
                `SELECT * FROM web_promotions
                  WHERE id = ? AND is_active = 1
                    AND (starts_at IS NULL OR starts_at <= NOW())
                    AND (ends_at IS NULL OR ends_at >= NOW())
                  LIMIT 1`,
                [Number(linked.promotionId)]
            );
            const promotion = rows[0];
            if (!promotion || !promotionAppliesPos(promotion)) continue;
            const hit = await evaluatePromotionCandidate(pool, promotion, enriched, stackOpts);
            if (hit) {
                hit.source = 'group_auto';
                candidates.push(hit);
            }
        }
    }

    let best = candidates[0];
    for (const c of candidates.slice(1)) {
        if ((c.totals.totalAmount ?? Infinity) < (best.totals.totalAmount ?? Infinity)) {
            best = c;
        } else if (
            Math.abs((c.totals.totalAmount ?? 0) - (best.totals.totalAmount ?? 0)) < 0.01 &&
            (c.promoMerchandiseDiscount || 0) > (best.promoMerchandiseDiscount || 0)
        ) {
            best = c;
        }
    }

    const promoDiscountAmount = roundMoney(best.promoMerchandiseDiscount || 0);
    let cartDiscountAmount = roundMoney(Number(best.totalMerchandiseDiscount) || 0);

    if (manualCartDiscountPercent > 0 && allowManualDiscounts) {
        const manualAmount = roundMoney(merchandiseSubtotal * (manualCartDiscountPercent / 100));
        if (manualAmount > cartDiscountAmount) {
            cartDiscountAmount = manualAmount;
        }
    }

    let cartDiscountLabel = null;
    const appliedPromotions = [];
    if (best.promotion && promoDiscountAmount > 0) {
        cartDiscountLabel = best.promotion.description
            ? `${best.promotion.code} — ${best.promotion.description}`
            : String(best.promotion.code);
        appliedPromotions.push({
            code: best.promotion.code,
            description: best.promotion.description || '',
            amount: promoDiscountAmount,
            promotionId: best.promotion.id
        });
    } else if (best.groupStandingApplied?.label) {
        cartDiscountLabel = best.groupStandingApplied.label;
    }

    return {
        merchandiseSubtotal,
        promoDiscountAmount,
        cartDiscountAmount,
        cartDiscountLabel,
        promotion: best.promotion,
        appliedPromotions,
        groupStandingApplied: best.groupStandingApplied,
        pricingTotals: best.totals
    };
}

module.exports = {
    pricePosCart,
    enrichPosCartLines,
    loadActivePosAutoPromotions
};
