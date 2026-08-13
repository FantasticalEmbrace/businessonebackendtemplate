'use strict';

const promoEngine = require('./webPromotionEngine');

function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeDiscountType(raw) {
    const t = String(raw || 'none').trim().toLowerCase();
    if (t === 'percent' || t === 'fixed') return t;
    return 'none';
}

function parseDiscountPayload(body = {}) {
    const discount = body.discount && typeof body.discount === 'object' ? body.discount : body;
    const type = normalizeDiscountType(discount.discount_type ?? discount.type);
    let value = Number(discount.discount_value ?? discount.value);
    if (!Number.isFinite(value) || value < 0) value = 0;
    if (type === 'percent' && value > 100) value = 100;
    const label = String(discount.discount_label ?? discount.label ?? '').trim().slice(0, 100) || null;
    const appliesWeb = discount.discount_applies_web ?? discount.applies_web;
    const appliesPos = discount.discount_applies_pos ?? discount.applies_pos;
    return {
        discount_type: type === 'none' || value <= 0 ? 'none' : type,
        discount_value: type === 'none' || value <= 0 ? null : roundMoney(value),
        discount_label: label,
        discount_applies_web: appliesWeb === false || appliesWeb === 0 || appliesWeb === '0' ? 0 : 1,
        discount_applies_pos: appliesPos === false || appliesPos === 0 || appliesPos === '0' ? 0 : 1
    };
}

function mapGroupDiscountRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        discountType: row.discount_type || 'none',
        discountValue: row.discount_value != null ? Number(row.discount_value) : null,
        discountLabel: row.discount_label || null,
        appliesWeb: Boolean(row.discount_applies_web),
        appliesPos: Boolean(row.discount_applies_pos)
    };
}

async function loadLinkedPromotionsForGroup(pool, groupId) {
    const [rows] = await pool.execute(
        `SELECT cgp.promotion_id, cgp.auto_apply,
                wp.code, wp.description, wp.is_active, wp.starts_at, wp.ends_at
           FROM customer_group_promotions cgp
           JOIN web_promotions wp ON wp.id = cgp.promotion_id
          WHERE cgp.customer_group_id = ?
          ORDER BY wp.code ASC`,
        [Number(groupId)]
    );
    return (rows || []).map((r) => ({
        promotionId: r.promotion_id,
        autoApply: Boolean(r.auto_apply),
        code: r.code,
        description: r.description || '',
        isActive: Boolean(r.is_active)
    }));
}

async function syncLinkedPromotions(pool, groupId, linkedPromotions = []) {
    const gid = Number(groupId);
    await pool.execute('DELETE FROM customer_group_promotions WHERE customer_group_id = ?', [gid]);
    const list = Array.isArray(linkedPromotions) ? linkedPromotions : [];
    for (const item of list) {
        const promotionId = Number(item.promotion_id ?? item.promotionId);
        if (!Number.isInteger(promotionId) || promotionId <= 0) continue;
        const autoApply = item.auto_apply === true || item.auto_apply === 1 || item.autoApply === true ? 1 : 0;
        await pool.execute(
            `INSERT INTO customer_group_promotions (customer_group_id, promotion_id, auto_apply)
             VALUES (?, ?, ?)`,
            [gid, promotionId, autoApply]
        );
    }
}

async function loadUserActiveGroups(pool, userId) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) return [];
    const [rows] = await pool.execute(
        `SELECT cg.id, cg.name, cg.slug, cg.discount_type, cg.discount_value, cg.discount_label,
                cg.discount_applies_web, cg.discount_applies_pos
           FROM user_customer_groups ucg
           JOIN customer_groups cg ON cg.id = ucg.customer_group_id
          WHERE ucg.user_id = ? AND cg.is_active = 1
          ORDER BY cg.name ASC`,
        [uid]
    );
    return rows || [];
}

async function loadUserGroupBenefits(pool, userId, channel = 'web') {
    const groups = await loadUserActiveGroups(pool, userId);
    const appliesField = channel === 'pos' ? 'discount_applies_pos' : 'discount_applies_web';

    const standingCandidates = groups
        .filter((g) => {
            if (g.discount_type === 'none' || g.discount_value == null) return false;
            return Boolean(g[appliesField]);
        })
        .map(mapGroupDiscountRow);

    let bestStanding = null;
    for (const g of standingCandidates) {
        if (!bestStanding) {
            bestStanding = g;
            continue;
        }
        if (g.discountType === 'percent' && bestStanding.discountType === 'percent') {
            if ((g.discountValue || 0) > (bestStanding.discountValue || 0)) bestStanding = g;
        } else if (g.discountType === 'fixed' && bestStanding.discountType === 'fixed') {
            if ((g.discountValue || 0) > (bestStanding.discountValue || 0)) bestStanding = g;
        } else if (g.discountType === 'percent') {
            bestStanding = g;
        }
    }

    const groupIds = groups.map((g) => g.id);
    let linkedPromotions = [];
    if (groupIds.length) {
        const [promoRows] = await pool.query(
            `SELECT DISTINCT cgp.promotion_id, cgp.auto_apply, wp.code, wp.description, wp.is_active,
                    wp.starts_at, wp.ends_at, wp.rules, cg.name AS group_name
               FROM customer_group_promotions cgp
               JOIN web_promotions wp ON wp.id = cgp.promotion_id
               JOIN customer_groups cg ON cg.id = cgp.customer_group_id
              WHERE cgp.customer_group_id IN (${groupIds.map(() => '?').join(',')})
                AND wp.is_active = 1
                AND (wp.starts_at IS NULL OR wp.starts_at <= NOW())
                AND (wp.ends_at IS NULL OR wp.ends_at >= NOW())
              ORDER BY wp.code ASC`,
            groupIds
        );
        linkedPromotions = (promoRows || []).map((r) => ({
            promotionId: r.promotion_id,
            autoApply: Boolean(r.auto_apply),
            code: r.code,
            description: r.description || '',
            groupName: r.group_name,
            rules: r.rules
        }));
    }

    return {
        groups: groups.map((g) => ({
            id: g.id,
            name: g.name,
            slug: g.slug
        })),
        standingDiscount: bestStanding,
        linkedPromotions,
        autoApplyPromotions: linkedPromotions.filter((p) => p.autoApply),
        manualPromotions: linkedPromotions.filter((p) => !p.autoApply)
    };
}

function applyStandingGroupDiscountToTotals(totals, standingDiscount) {
    if (!totals || !standingDiscount || standingDiscount.discountType === 'none') {
        return { totals, applied: null };
    }

    const merchandiseSub = Number(totals.merchandiseSubtotal) || 0;
    const existingMerchDisc = Number(totals.merchandiseDiscount) || 0;
    const shippingDiscount = Number(totals.shippingDiscount) || 0;
    const remaining = roundMoney(Math.max(0, merchandiseSub - existingMerchDisc));
    if (remaining <= 0) return { totals, applied: null };

    let groupMerchDisc = 0;
    if (standingDiscount.discountType === 'percent') {
        groupMerchDisc = roundMoney(Math.min(remaining, remaining * ((Number(standingDiscount.discountValue) || 0) / 100)));
    } else if (standingDiscount.discountType === 'fixed') {
        groupMerchDisc = roundMoney(Math.min(remaining, Number(standingDiscount.discountValue) || 0));
    }
    if (groupMerchDisc <= 0) return { totals, applied: null };

    const newMerchDiscount = roundMoney(existingMerchDisc + groupMerchDisc);
    const taxBase = roundMoney(Math.max(0, merchandiseSub - newMerchDiscount));
    const taxAmount = Number(totals.taxAmount) || 0;
    const shippingAfter = Number(totals.shippingAfter) || 0;
    const priorTaxBase = roundMoney(Math.max(0, merchandiseSub - existingMerchDisc));
    const taxRate = priorTaxBase > 0 ? taxAmount / priorTaxBase : 0;
    const newTaxAmount = taxRate > 0 ? roundMoney(taxBase * taxRate) : taxAmount;
    const totalAmount = roundMoney(taxBase + shippingAfter + newTaxAmount);

    const label =
        standingDiscount.discountLabel ||
        (standingDiscount.discountType === 'percent'
            ? `${standingDiscount.name} (${standingDiscount.discountValue}%)`
            : `${standingDiscount.name} ($${Number(standingDiscount.discountValue).toFixed(2)} off)`);

    return {
        totals: {
            ...totals,
            merchandiseDiscount: newMerchDiscount,
            taxAmount: newTaxAmount,
            totalAmount,
            totalDiscountAmount: roundMoney(newMerchDiscount + shippingDiscount)
        },
        applied: {
            groupId: standingDiscount.id,
            groupName: standingDiscount.name,
            label,
            amount: groupMerchDisc,
            type: standingDiscount.discountType,
            value: standingDiscount.discountValue
        }
    };
}

async function pickBestAutoApplyPromotion(pool, benefits, previewOpts) {
    const candidates = benefits?.autoApplyPromotions || [];
    if (!candidates.length) return null;

    let best = null;
    for (const promo of candidates) {
        const [rows] = await pool.execute(
            `SELECT * FROM web_promotions
              WHERE id = ?
                AND is_active = 1
                AND (starts_at IS NULL OR starts_at <= NOW())
                AND (ends_at IS NULL OR ends_at >= NOW())
              LIMIT 1`,
            [Number(promo.promotionId)]
        );
        const promotion = rows[0];
        if (!promotion || !promotionAppliesWeb(promotion)) continue;

        let rulesParsed;
        try {
            rulesParsed = promoEngine.parseRules(promotion.rules);
        } catch {
            continue;
        }
        if (!promoEngine.promotionHasApplicableMerchOrShipping(rulesParsed)) continue;

        const usage = await promoEngine.promotionUsageExceeded(pool, promotion, previewOpts.email);
        if (usage) continue;

        const normalized = promoEngine.normalizeIncomingCartItems(previewOpts.cartItems);
        if (!normalized.length) continue;
        const enriched = await promoEngine.enrichCartLines(pool, normalized);
        const totals = promoEngine.evaluateTotals(rulesParsed, enriched, {
            applyTaxExemption: Boolean(previewOpts.applyTaxExemption),
            shippingMethod: previewOpts.shippingMethod,
            shippingAmount: previewOpts.shippingAmount,
            taxRate: previewOpts.taxRate
        });

        if (!best || totals.totalAmount < best.totals.totalAmount) {
            best = { promotion, rulesParsed, totals, groupName: promo.groupName };
        }
    }
    return best;
}

function resolvePosStandingDiscount(benefits, merchandiseSubtotal) {
    const standing = benefits?.standingDiscount;
    if (!standing || standing.discountType === 'none') {
        return { percent: 0, fixedAmount: 0, label: null, groupName: null };
    }
    const sub = Number(merchandiseSubtotal) || 0;
    if (standing.discountType === 'percent') {
        return {
            percent: Math.min(100, Math.max(0, Number(standing.discountValue) || 0)),
            fixedAmount: 0,
            label: standing.discountLabel || `${standing.name} discount`,
            groupName: standing.name
        };
    }
    if (standing.discountType === 'fixed' && sub > 0) {
        const fixed = Math.min(sub, Number(standing.discountValue) || 0);
        return {
            percent: roundMoney((fixed / sub) * 100),
            fixedAmount: fixed,
            label: standing.discountLabel || `${standing.name} discount`,
            groupName: standing.name
        };
    }
    return { percent: 0, fixedAmount: 0, label: null, groupName: null };
}

function mergePosCartDiscount(clientPercent, groupResolved) {
    const client = Math.min(100, Math.max(0, Number(clientPercent) || 0));
    const groupPct = Math.min(100, Math.max(0, Number(groupResolved.percent) || 0));
    if (groupPct <= 0) {
        return { percent: client, fromGroup: false, label: null, groupName: null };
    }
    if (client >= groupPct) {
        return { percent: client, fromGroup: false, label: null, groupName: null };
    }
    return {
        percent: groupPct,
        fromGroup: true,
        label: groupResolved.label,
        groupName: groupResolved.groupName
    };
}

async function loadGroupDetail(pool, groupId) {
    const [[group]] = await pool.execute(
        `SELECT id, name, slug, description, is_active, created_at, updated_at,
                discount_type, discount_value, discount_label,
                discount_applies_web, discount_applies_pos
           FROM customer_groups WHERE id = ?`,
        [Number(groupId)]
    );
    if (!group) return null;
    const linkedPromotions = await loadLinkedPromotionsForGroup(pool, group.id);
    return {
        ...group,
        discount: {
            type: group.discount_type || 'none',
            value: group.discount_value != null ? Number(group.discount_value) : null,
            label: group.discount_label || null,
            applies_web: Boolean(group.discount_applies_web),
            applies_pos: Boolean(group.discount_applies_pos)
        },
        linked_promotions: linkedPromotions
    };
}

module.exports = {
    roundMoney,
    normalizeDiscountType,
    parseDiscountPayload,
    mapGroupDiscountRow,
    loadLinkedPromotionsForGroup,
    syncLinkedPromotions,
    loadUserActiveGroups,
    loadUserGroupBenefits,
    applyStandingGroupDiscountToTotals,
    pickBestAutoApplyPromotion,
    resolvePosStandingDiscount,
    mergePosCartDiscount,
    loadGroupDetail
};
