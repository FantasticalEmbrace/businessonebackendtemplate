'use strict';

const employeeDiscount = require('./employeeDiscount');
const groupDiscount = require('./customerGroupDiscount');
const { loadStoreTaxRate } = require('../utils/storeTaxRate');

const {
    FREE_SHIPPING_THRESHOLD,
    FIRST_CLASS_SHIPPING,
} = require('../config/shippingConfig');

const TAX_RATE = 0.08;
const STANDARD_SHIPPING = FIRST_CLASS_SHIPPING;

function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeIncomingCartItems(cartItems = []) {
    if (!Array.isArray(cartItems)) return [];
    return cartItems
        .map((item) => {
            const quantity = Number(item.quantity);
            const price = Number(item.price);
            const giftCard = item.giftCard || item.gift_card || null;
            return {
                product_id: Number(item.product_id ?? item.productId ?? item.id ?? 0),
                variant_id: item.variant_id ?? item.variantId ?? null,
                quantity: Number.isFinite(quantity) ? quantity : 0,
                price: Number.isFinite(price) ? price : 0,
                giftCard: giftCard && typeof giftCard === 'object' ? giftCard : null
            };
        })
        .filter((item) => item.product_id > 0 && item.quantity > 0 && item.price >= 0);
}

function normalizePositiveIntIds(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const x of arr) {
        const n = Number(x);
        if (Number.isFinite(n) && n > 0) out.push(n);
    }
    return [...new Set(out)].sort((a, b) => a - b);
}

function normalizedRewardDiscountType(t) {
    const s = String(t || '').toLowerCase();
    if (s === 'percent_off' || s === 'percent') return 'percent_off';
    if (s === 'fixed_off' || s === 'fixed' || s === 'dollar_off') return 'fixed_off';
    if (s === 'set_price' || s === 'setprice' || s === 'fixed_price') return 'set_price';
    if (s === 'free' || s === '100_off' || s === 'full_off') return 'free';
    return '';
}

/**
 * Validates trigger SKU list + reward rule rows (% / flat $ / set price / free).
 * Returns canonical object or null.
 */
function normalizeTriggerReward(raw) {
    if (raw == null || typeof raw !== 'object') return null;
    const triggerProductIds = normalizePositiveIntIds(raw.triggerProductIds || raw.triggerSkuIds);
    const minTriggerQty = Math.floor(
        Number(raw.minTriggerQty ?? raw.minimumPurchaseQuantity ?? raw.minimumTriggerQty ?? raw.minQty)
    );
    const rewardRulesIn = Array.isArray(raw.rewardRules) ? raw.rewardRules : [];
    if (triggerProductIds.length === 0) return null;
    if (!Number.isFinite(minTriggerQty) || minTriggerQty < 1) return null;

    const rewardRules = [];
    for (const rr of rewardRulesIn) {
        if (!rr || typeof rr !== 'object') continue;
        const targetProductIds = normalizePositiveIntIds(
            rr.targetProductIds || rr.rewardProductIds || rr.rewardSkuIds || rr.productIds
        );
        if (!targetProductIds.length) continue;
        const discountType = normalizedRewardDiscountType(rr.discountType || rr.type);
        if (!discountType) continue;
        const rule = { targetProductIds, discountType };
        if (discountType === 'percent_off') {
            const p = Number(rr.percent);
            if (!Number.isFinite(p) || p <= 0 || p > 100) continue;
            rule.percent = p;
        } else if (discountType === 'fixed_off') {
            const a = Number(rr.amount);
            if (!Number.isFinite(a) || a <= 0) continue;
            rule.amount = roundMoney(a);
        } else if (discountType === 'free') {
            rewardRules.push({
                targetProductIds,
                discountType: 'set_price',
                setPrice: 0
            });
            continue;
        } else {
            const sp = Number(rr.setPrice ?? rr.price ?? rr.targetPrice);
            if (!Number.isFinite(sp) || sp < 0) continue;
            rule.setPrice = roundMoney(sp);
        }
        rewardRules.push(rule);
    }
    if (!rewardRules.length) return null;

    return { triggerProductIds, minTriggerQty, rewardRules };
}

function parseRules(raw) {
    if (!raw) return { scope: 'all', productIds: [], categoryIds: [], effects: [], triggerReward: null };
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== 'object') {
        return { scope: 'all', productIds: [], categoryIds: [], effects: [], triggerReward: null };
    }
    const scopeRaw = String(obj.scope || 'all').toLowerCase();
    const scope = scopeRaw === 'products' ? 'products' : scopeRaw === 'categories' ? 'categories' : 'all';
    const productIds = Array.isArray(obj.productIds)
        ? obj.productIds.map((n) => Number(n)).filter((n) => n > 0)
        : [];
    const categoryIds = Array.isArray(obj.categoryIds)
        ? obj.categoryIds.map((n) => Number(n)).filter((n) => n > 0)
        : [];
    const effects = Array.isArray(obj.effects) ? obj.effects : [];
    let triggerReward = null;
    if (obj.triggerReward != null && typeof obj.triggerReward === 'object') {
        triggerReward = normalizeTriggerReward(obj.triggerReward);
    }
    return { scope, productIds, categoryIds, effects, triggerReward };
}

function enrichmentLineKey(row) {
    const v =
        row.variant_id != null && row.variant_id !== '' ? Number(row.variant_id) : 0;
    return `${Number(row.product_id)}:${Number.isFinite(v) ? v : 0}`;
}

function cartLineSubtotal(row) {
    return roundMoney(Number(row.unitPrice) * Number(row.quantity));
}

/**
 * If trigger threshold is met: apply each reward rule row separately (different SKUs can have different mechanics).
 * Order of rules matters; discounts on the same line never exceed that line’s merchandise subtotal.
 */
function evaluateTriggerRewardDiscount(allRows, tr) {
    const triggerSet = new Set(tr.triggerProductIds);
    let triggerQty = 0;
    for (const r of allRows) {
        if (triggerSet.has(Number(r.product_id))) triggerQty += Number(r.quantity) || 0;
    }
    if (triggerQty < tr.minTriggerQty) return 0;

    const consumed = new Map();
    for (const line of allRows) {
        consumed.set(enrichmentLineKey(line), 0);
    }

    let total = 0;
    for (const rr of tr.rewardRules) {
        const targetSet = new Set(rr.targetProductIds);
        for (const line of allRows) {
            if (!targetSet.has(Number(line.product_id))) continue;
            const key = enrichmentLineKey(line);
            const lineSub = cartLineSubtotal(line);
            if (lineSub <= 0) continue;
            const already = consumed.get(key) || 0;
            const room = roundMoney(lineSub - already);
            if (room <= 0) continue;

            let rawDiscount = 0;
            if (rr.discountType === 'percent_off') {
                rawDiscount = roundMoney(lineSub * (Number(rr.percent) / 100));
            } else if (rr.discountType === 'fixed_off') {
                rawDiscount = roundMoney(Math.min(Number(rr.amount), lineSub));
            } else {
                const perUnit = Math.max(0, Number(line.unitPrice) - Number(rr.setPrice));
                rawDiscount = roundMoney(perUnit * Number(line.quantity));
            }
            const apply = roundMoney(Math.min(rawDiscount, room));
            if (apply > 0) {
                consumed.set(key, roundMoney(already + apply));
                total = roundMoney(total + apply);
            }
        }
    }
    const cap = merchandiseSubtotal(allRows);
    return roundMoney(Math.min(total, cap));
}

function promotionHasApplicableMerchOrShipping(parsed) {
    if (parsed.effects && parsed.effects.length > 0) return true;
    return normalizeTriggerReward(parsed.triggerReward) != null;
}

function lineEligible(row, rules) {
    if (rules.scope === 'all') return true;
    if (rules.scope === 'products') return rules.productIds.includes(row.product_id);
    if (rules.scope === 'categories') return rules.categoryIds.includes(Number(row.category_id));
    return false;
}

/** Stable sort keys so ties are deterministic (different SKUs same price → consistent “who’s free”). */
function compareEligibleUnitPriceDesc(u, v) {
    const dp = Number(v.unitPrice) - Number(u.unitPrice);
    if (dp !== 0) return dp;
    const di = Number(v.product_id) - Number(u.product_id);
    if (di !== 0) return di;
    return Number(v.variant_key) - Number(u.variant_key);
}

function compareEligibleUnitPriceAsc(u, v) {
    return compareEligibleUnitPriceDesc(v, u);
}

function normalizeBuyGetRewardOpts(effectOrOpts) {
    const o = effectOrOpts && typeof effectOrOpts === 'object' ? effectOrOpts : {};
    const raw = String(o.getRewardType ?? 'free').toLowerCase();
    let getRewardType = 'free';
    if (raw === 'percent_off' || raw === 'percent') getRewardType = 'percent_off';
    else if (raw === 'fixed_off' || raw === 'fixed' || raw === 'dollar') getRewardType = 'fixed_off';
    return {
        getRewardType,
        getPercent: Number(o.getPercent),
        getFixedAmount: Number(o.getFixedAmount != null ? o.getFixedAmount : o.getAmount)
    };
}

/**
 * Turns the pre-selected “get” subtotal for one bundle into merchandise discount dollars.
 */
function buyGetDiscountForGetSubtotal(getSubtotal, rewardOpts) {
    const base = Number(getSubtotal);
    if (!Number.isFinite(base) || base <= 0) return 0;
    const { getRewardType, getPercent, getFixedAmount } = normalizeBuyGetRewardOpts(rewardOpts);
    if (getRewardType === 'percent_off') {
        const p = Number(getPercent);
        if (!Number.isFinite(p) || p <= 0) return 0;
        return roundMoney(base * (Math.min(p, 100) / 100));
    }
    if (getRewardType === 'fixed_off') {
        const a = Number(getFixedAmount);
        if (!Number.isFinite(a) || a <= 0) return 0;
        return roundMoney(Math.min(a, base));
    }
    return roundMoney(base);
}

/**
 * Buy-X-get-Y split across two SKU pools (“buy these” vs “discount these”).
 * Consumes buyQty units from buyPool only and getQty units from getPool only per bundle;
 * reward discount is derived from the selected get units (cheapest-first within the chunk).
 */
function buyGetDiscountSplitPools(buyPoolUnits, getPoolUnits, buyQty, getQty, rewardOpts) {
    const b = Number(buyQty);
    const g = Number(getQty);
    const groupBuy = b;
    const groupGet = g;
    if (!Number.isFinite(b) || !Number.isFinite(g) || b < 1 || g < 1) return 0;
    const buys = [...buyPoolUnits].sort(compareEligibleUnitPriceDesc);
    const gets = [...getPoolUnits].sort(compareEligibleUnitPriceDesc);
    let bi = 0;
    let gi = 0;
    let discount = 0;
    while (bi + groupBuy <= buys.length && gi + groupGet <= gets.length) {
        const getChunk = gets.slice(gi, gi + groupGet);
        const ascendingGet = [...getChunk].sort(compareEligibleUnitPriceAsc);
        let getSubtotal = 0;
        for (let j = 0; j < groupGet; j++) getSubtotal += Number(ascendingGet[j].unitPrice);
        discount += buyGetDiscountForGetSubtotal(getSubtotal, rewardOpts);
        bi += groupBuy;
        gi += groupGet;
    }
    return roundMoney(discount);
}

/**
 * Buy-X-get-Y: bundle units by sorting highest-priced first, then each bundle’s reward portion is
 * the Y lowest-priced units in the chunk. Ties use product / variant for stable ordering.
 */
function buyGetDiscountForEligibleUnits(eligibleUnits, buyQty, getQty, rewardOpts) {
    const b = Number(buyQty);
    const g = Number(getQty);
    const group = b + g;
    if (!Number.isFinite(b) || !Number.isFinite(g) || group <= 1 || b < 1 || g < 1) return 0;
    const sorted = [...eligibleUnits].sort(compareEligibleUnitPriceDesc);
    let discount = 0;
    for (let i = 0; i + group <= sorted.length; i += group) {
        const chunk = sorted.slice(i, i + group);
        const ascending = [...chunk].sort(compareEligibleUnitPriceAsc);
        let getSubtotal = 0;
        for (let j = 0; j < g; j++) getSubtotal += Number(ascending[j].unitPrice);
        discount += buyGetDiscountForGetSubtotal(getSubtotal, rewardOpts);
    }
    return roundMoney(discount);
}

function merchandiseSubtotal(rows) {
    return roundMoney(rows.reduce((s, r) => s + r.unitPrice * r.quantity, 0));
}

/** Filter cart lines eligible for scoped buy-get / % / fixed discounts. */
function eligibleLines(rows, rules) {
    return rows.filter((r) => lineEligible(r, rules));
}

function expandEligibleUnits(eligibleRows) {
    const eligibleUnits = [];
    for (const r of eligibleRows) {
        const vk = r.variant_id == null || r.variant_id === '' ? 0 : Number(r.variant_id);
        for (let q = 0; q < r.quantity; q++) {
            eligibleUnits.push({
                unitPrice: Number(r.unitPrice),
                product_id: Number(r.product_id),
                variant_key: Number.isFinite(vk) ? vk : 0
            });
        }
    }
    return eligibleUnits;
}

/**
 * Run buy-X-get-Y separately for each product + variant so one code on many SKUs does not
 * merge units into cross-SKU bundles (pooling by price). Explicit “buy these / get those”
 * disjoint lists still use {@link buyGetDiscountSplitPools} instead.
 */
function buyGetDiscountPerProductEligibleRows(eligibleRows, buyQty, getQty, rewardOpts) {
    const expanded = expandEligibleUnits(eligibleRows);
    const byKey = new Map();
    for (const u of expanded) {
        const k = `${u.product_id}:${u.variant_key}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(u);
    }
    let discount = 0;
    for (const units of byKey.values()) {
        discount += buyGetDiscountForEligibleUnits(units, buyQty, getQty, rewardOpts);
    }
    return roundMoney(discount);
}

function evaluateMerchandiseDiscounts(rules, eligibleRows, eligibleSubtotal) {
    let percentOff = 0;
    let fixedOff = 0;
    let buyGetOff = 0;

    for (const eff of rules.effects || []) {
        const t = String(eff?.type || '').toLowerCase();
        if (t === 'percent_off') {
            const pct = Number(eff.percent);
            if (Number.isFinite(pct) && pct > 0) {
                percentOff = Math.max(percentOff, roundMoney(eligibleSubtotal * (pct / 100)));
            }
        } else if (t === 'fixed_off') {
            const amt = Number(eff.amount);
            if (Number.isFinite(amt) && amt > 0) {
                fixedOff = Math.max(fixedOff, Math.min(roundMoney(amt), eligibleSubtotal));
            }
        } else if (t === 'buy_get' || t === 'bogo') {
            const buyQty = Number(eff.buyQty);
            const getQty = Number(eff.getQty);
            const buyIdsRaw = Array.isArray(eff.buyProductIds) ? eff.buyProductIds : [];
            const getIdsRaw = Array.isArray(eff.getProductIds) ? eff.getProductIds : [];
            const buyIds = buyIdsRaw.map((n) => Number(n)).filter((n) => n > 0);
            const getIds = getIdsRaw.map((n) => Number(n)).filter((n) => n > 0);
            const rewardOpts = normalizeBuyGetRewardOpts(eff);

            let off = 0;
            if (buyIds.length > 0 && getIds.length > 0) {
                const buySet = new Set(buyIds);
                const getSet = new Set(getIds);
                const overlap = [...buySet].some((id) => getSet.has(id));
                if (overlap) {
                    const poolRows = eligibleRows.filter(
                        (r) => buySet.has(r.product_id) || getSet.has(r.product_id)
                    );
                    off = buyGetDiscountPerProductEligibleRows(poolRows, buyQty, getQty, rewardOpts);
                } else {
                    const buyRows = eligibleRows.filter((r) => buySet.has(r.product_id));
                    const getRows = eligibleRows.filter((r) => getSet.has(r.product_id));
                    off = buyGetDiscountSplitPools(
                        expandEligibleUnits(buyRows),
                        expandEligibleUnits(getRows),
                        buyQty,
                        getQty,
                        rewardOpts
                    );
                }
            } else {
                off = buyGetDiscountPerProductEligibleRows(eligibleRows, buyQty, getQty, rewardOpts);
            }
            buyGetOff = Math.max(buyGetOff, off);
        }
    }

    let merchandiseDiscount = Math.max(percentOff, fixedOff, buyGetOff);
    merchandiseDiscount = roundMoney(Math.min(merchandiseDiscount, eligibleSubtotal));
    return merchandiseDiscount;
}

function hasFreeStandardShippingEffect(rules) {
    return (rules.effects || []).some((e) => String(e?.type || '').toLowerCase() === 'free_standard_shipping');
}

function resolveShippingBefore(merchandiseSub, opts = {}) {
    const method = String(opts.shippingMethod || '').trim();
    if (method === 'free_standard' && merchandiseSub >= FREE_SHIPPING_THRESHOLD) return 0;
    if (method === 'first_class' && merchandiseSub < FREE_SHIPPING_THRESHOLD) return STANDARD_SHIPPING;
    if (method.startsWith('shippo:') && Number.isFinite(Number(opts.shippingAmount))) {
        return roundMoney(Number(opts.shippingAmount));
    }
    return merchandiseSub >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING;
}

function evaluateTotals(rulesParsed, enrichedRows, opts) {
    const { applyTaxExemption } = opts;
    const merchandiseSub = merchandiseSubtotal(enrichedRows);

    let shippingBefore = resolveShippingBefore(merchandiseSub, opts);

    const nt = normalizeTriggerReward(rulesParsed.triggerReward);
    let eligibleSub;
    let merchandiseDiscount;
    if (nt) {
        merchandiseDiscount = evaluateTriggerRewardDiscount(enrichedRows, nt);
        const idPool = new Set(nt.triggerProductIds);
        for (const rr of nt.rewardRules) {
            for (const pid of rr.targetProductIds) idPool.add(pid);
        }
        eligibleSub = merchandiseSubtotal(
            enrichedRows.filter((r) => idPool.has(Number(r.product_id)))
        );
    } else {
        const eligible = eligibleLines(enrichedRows, rulesParsed);
        eligibleSub = merchandiseSubtotal(eligible);
        merchandiseDiscount = evaluateMerchandiseDiscounts(rulesParsed, eligible, eligibleSub);
    }

    let shippingDiscount = 0;
    if (hasFreeStandardShippingEffect(rulesParsed) && shippingBefore > 0) {
        shippingDiscount = roundMoney(Math.min(STANDARD_SHIPPING, shippingBefore));
    }

    const shippingAfter = roundMoney(Math.max(0, shippingBefore - shippingDiscount));

    const taxBase = roundMoney(Math.max(0, merchandiseSub - merchandiseDiscount));
    const taxRate = Number.isFinite(Number(opts.taxRate)) && Number(opts.taxRate) >= 0
        ? Number(opts.taxRate)
        : TAX_RATE;
    const taxAmount = applyTaxExemption ? 0 : roundMoney(taxBase * taxRate);
    const totalAmount = roundMoney(taxBase + shippingAfter + taxAmount);
    const totalDiscountAmount = roundMoney(merchandiseDiscount + shippingDiscount);

    return {
        merchandiseSubtotal: merchandiseSub,
        eligibleSubtotal: eligibleSub,
        merchandiseDiscount,
        shippingBefore,
        shippingDiscount,
        shippingAfter,
        taxAmount,
        totalAmount,
        totalDiscountAmount
    };
}

async function enrichCartLines(pool, normalizedItems) {
    const ids = [...new Set(normalizedItems.map((i) => i.product_id).filter(Boolean))];
    if (ids.length === 0) return [];
    let rows;
    try {
        [rows] = await pool.execute(
            `SELECT id, name, sku, category_id, price, gift_card_type FROM products
              WHERE id IN (${ids.map(() => '?').join(',')})
                AND is_active = 1 AND COALESCE(show_on_web, 1) = 1`,
            ids
        );
    } catch (e) {
        if (e.errno !== 1054 && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
        [rows] = await pool.execute(
            `SELECT id, name, sku, category_id, price FROM products
              WHERE id IN (${ids.map(() => '?').join(',')})
                AND is_active = 1`,
            ids
        );
    }
    const map = new Map(rows.map((r) => [r.id, r]));

    const variantsNeeded = normalizedItems.filter((n) => n.variant_id != null && n.variant_id !== '');
    const variantIds = [...new Set(variantsNeeded.map((n) => Number(n.variant_id)).filter(Number.isFinite))];

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
        if (!p) {
            const err = new Error('INVALID_CART_PRODUCT');
            err.code = 'INVALID_CART_PRODUCT';
            throw err;
        }
        let unitPrice = Number(p.price);
        if (item.variant_id != null && item.variant_id !== '') {
            const key = `${item.product_id}:${Number(item.variant_id)}`;
            const vp = variantPriceMap.get(key);
            if (vp == null || !Number.isFinite(vp)) {
                const err = new Error('INVALID_CART_VARIANT');
                err.code = 'INVALID_CART_VARIANT';
                throw err;
            }
            unitPrice = vp;
        }

        enriched.push({
            product_id: item.product_id,
            variant_id: item.variant_id != null ? Number(item.variant_id) || null : null,
            quantity: item.quantity,
            unitPrice: roundMoney(unitPrice),
            name: p.name,
            sku: p.sku,
            category_id: p.category_id,
            gift_card_type: p.gift_card_type || null,
            giftCard: item.giftCard || null
        });
    }
    return enriched;
}

function promotionAppliesWeb(promotion) {
    if (!promotion) return false;
    if (promotion.applies_web == null || promotion.applies_web === undefined) return true;
    return Number(promotion.applies_web) !== 0;
}

function promotionAppliesPos(promotion) {
    if (!promotion) return false;
    if (promotion.applies_pos == null || promotion.applies_pos === undefined) return true;
    return Number(promotion.applies_pos) !== 0;
}

async function loadActivePromotionByCode(pool, rawCode, { channel = 'web' } = {}) {
    const trimmed = String(rawCode || '').trim();
    if (!trimmed) return null;
    const [rows] = await pool.execute(
        `SELECT * FROM web_promotions
          WHERE UPPER(TRIM(code)) = UPPER(TRIM(?))
            AND is_active = 1
            AND (starts_at IS NULL OR starts_at <= NOW())
            AND (ends_at IS NULL OR ends_at >= NOW())
         LIMIT 1`,
        [trimmed]
    );
    const promotion = rows[0] || null;
    if (!promotion) return null;
    if (channel === 'web' && !promotionAppliesWeb(promotion)) return null;
    if (channel === 'pos' && !promotionAppliesPos(promotion)) return null;
    return promotion;
}

async function promotionUsageExceeded(pool, promotion, email) {
    if (promotion.usage_limit_total != null) {
        const lim = Number(promotion.usage_limit_total);
        if (Number.isFinite(lim) && lim >= 0) {
            const [[r]] = await pool.execute(
                'SELECT COUNT(*) AS c FROM web_promotion_redemptions WHERE promotion_id = ?',
                [promotion.id]
            );
            if (Number(r.c) >= lim) return 'TOTAL_USAGE';
        }
    }
    if (promotion.usage_limit_per_email != null && email) {
        const lim = Number(promotion.usage_limit_per_email);
        if (Number.isFinite(lim) && lim >= 0) {
            const [[r]] = await pool.execute(
                `SELECT COUNT(*) AS c FROM web_promotion_redemptions
                  WHERE promotion_id = ? AND LOWER(email) = LOWER(?)`,
                [promotion.id, String(email).trim()]
            );
            if (Number(r.c) >= lim) return 'EMAIL_USAGE';
        }
    }
    return null;
}

/**
 * Validates code + carts; returns totals and metadata. Throws with .code / .status for HTTP mapping.
 */
async function previewOrApplyTotals(pool, {
    cartItems,
    promoCode,
    email,
    applyTaxExemption,
    customerType,
    userId,
    shippingMethod,
    shippingAmount,
}) {
    const normalized = normalizeIncomingCartItems(cartItems);
    if (normalized.length === 0) {
        const err = new Error('EMPTY_CART');
        err.code = 'EMPTY_CART';
        throw err;
    }

    let enriched = await enrichCartLines(pool, normalized);
    let rulesParsed = { scope: 'all', productIds: [], categoryIds: [], effects: [], triggerReward: null };
    let promotion = null;
    let groupAutoPromotion = null;

    const trimmedCode = String(promoCode || '').trim();
    const taxExempt = Boolean(applyTaxExemption);
    const storeTaxRate = await loadStoreTaxRate(pool);
    const shippingOpts = {
        applyTaxExemption: taxExempt,
        shippingMethod,
        shippingAmount,
        taxRate: storeTaxRate
    };

    let groupBenefits = null;
    if (userId) {
        groupBenefits = await groupDiscount.loadUserGroupBenefits(pool, userId, 'web');
    }

    if (trimmedCode) {
        promotion = await loadActivePromotionByCode(pool, trimmedCode, { channel: 'web' });
        if (!promotion) {
            const err = new Error('INVALID_PROMO_CODE');
            err.code = 'INVALID_PROMO_CODE';
            throw err;
        }
        const usage = await promotionUsageExceeded(pool, promotion, email);
        if (usage) {
            const err = new Error('PROMO_USAGE_EXCEEDED');
            err.code = usage;
            throw err;
        }
        try {
            rulesParsed = parseRules(promotion.rules);
        } catch {
            const err = new Error('MALFORMED_PROMO_RULES');
            err.code = 'MALFORMED_PROMO_RULES';
            throw err;
        }
        if (!promotionHasApplicableMerchOrShipping(rulesParsed)) {
            const err = new Error('PROMO_NO_EFFECTS');
            err.code = 'PROMO_NO_EFFECTS';
            throw err;
        }
    } else if (groupBenefits?.autoApplyPromotions?.length) {
        groupAutoPromotion = await groupDiscount.pickBestAutoApplyPromotion(pool, groupBenefits, {
            cartItems,
            email,
            applyTaxExemption: taxExempt,
            shippingMethod,
            shippingAmount,
            taxRate: storeTaxRate
        });
        if (groupAutoPromotion) {
            promotion = groupAutoPromotion.promotion;
            rulesParsed = groupAutoPromotion.rulesParsed;
        }
    }

    let totalsBase = evaluateTotals(rulesParsed, enriched, shippingOpts);

    let groupStandingApplied = null;
    if (groupBenefits?.standingDiscount) {
        const standingResult = groupDiscount.applyStandingGroupDiscountToTotals(
            totalsBase,
            groupBenefits.standingDiscount
        );
        totalsBase = standingResult.totals;
        groupStandingApplied = standingResult.applied;
    }

    const empSettings = await employeeDiscount.loadEmployeeDiscountSettings(pool);
    totalsBase = employeeDiscount.applyEmployeeDiscountToTotals(
        totalsBase,
        empSettings,
        customerType,
        taxExempt,
        storeTaxRate
    );

    let totalsNoPromo = null;
    if (promotion) {
        totalsNoPromo = evaluateTotals(
            { scope: 'all', productIds: [], categoryIds: [], effects: [] },
            enriched,
            shippingOpts
        );
        if (groupBenefits?.standingDiscount) {
            totalsNoPromo = groupDiscount.applyStandingGroupDiscountToTotals(
                totalsNoPromo,
                groupBenefits.standingDiscount
            ).totals;
        }
        totalsNoPromo = employeeDiscount.applyEmployeeDiscountToTotals(
            totalsNoPromo,
            empSettings,
            customerType,
            taxExempt,
            storeTaxRate
        );
    }

    return {
        enrichment: enriched,
        promotion,
        rulesApplied: promotion ? rulesParsed : null,
        totals: totalsBase,
        baselineTotals: totalsNoPromo,
        employeeDiscountApplied: Boolean(totalsBase.employeeDiscountApplied),
        employeeDiscountAmount: Number(totalsBase.employeeDiscount) || 0,
        groupDiscountApplied: Boolean(groupStandingApplied),
        groupDiscountAmount: Number(groupStandingApplied?.amount) || 0,
        groupDiscountLabel: groupStandingApplied?.label || null,
        groupAutoPromotionApplied: Boolean(groupAutoPromotion),
        groupAutoPromotionCode: groupAutoPromotion?.promotion?.code || null,
        customerGroups: groupBenefits?.groups || [],
        availableGroupPromotions: (groupBenefits?.manualPromotions || []).map((p) => ({
            code: p.code,
            description: p.description,
            groupName: p.groupName
        }))
    };
}

/**
 * Server-side total for cart + optional promo (trigger/reward, BOGO, % / $ off, etc.).
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ cartItems: unknown[], promoCode?: string, email?: string, applyTaxExemption?: boolean }} opts
 */
async function calculateTotal(pool, opts) {
    const { cartItems, promoCode, email, applyTaxExemption, customerType } = opts || {};
    const result = await previewOrApplyTotals(pool, {
        cartItems,
        promoCode,
        email,
        applyTaxExemption: Boolean(applyTaxExemption),
        customerType
    });
    return result.totals;
}

async function insertRedemptionRow(connection, { promotionId, orderId, email, userId, merchandiseDisc, shippingDisc }) {
    await connection.execute(
        `INSERT INTO web_promotion_redemptions
            (promotion_id, order_id, email, user_id, discount_merchandise, discount_shipping)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            promotionId,
            orderId,
            String(email || '').trim(),
            userId ?? null,
            roundMoney(merchandiseDisc ?? 0),
            roundMoney(shippingDisc ?? 0)
        ]
    );
}

module.exports = {
    roundMoney,
    FREE_SHIPPING_THRESHOLD,
    STANDARD_SHIPPING,
    TAX_RATE,
    normalizeIncomingCartItems,
    enrichCartLines,
    loadActivePromotionByCode,
    promotionUsageExceeded,
    parseRules,
    normalizeTriggerReward,
    promotionHasApplicableMerchOrShipping,
    evaluateTotals,
    previewOrApplyTotals,
    calculateTotal,
    insertRedemptionRow,
    promotionAppliesWeb,
    promotionAppliesPos
};
