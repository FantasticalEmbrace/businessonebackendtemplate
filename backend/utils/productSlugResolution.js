'use strict';

const { STOREFRONT_VISIBLE_WHERE } = require('./storefrontProductVisibility');

const MIN_PREFIX_SLUG_LEN = 12;
const MIN_SHORT_SLUG_LEN = 8;
const MIN_TOKEN_PREFIX = 3;
const MIN_OVERLAP_TOKENS = 3;
const MIN_OVERLAP_COVERAGE = 0.75;

/** Tokens that add little identity when matching Magento ↔ current slugs. */
const SLUG_STOP_TOKENS = new Set([
    'a',
    'an',
    'and',
    'for',
    'of',
    'the',
    'to',
    'with',
    'without',
    'w',
    'wo',
    'sku',
]);

function stripSkuSuffix(slug) {
    return String(slug || '').replace(/-sku-[a-z0-9-]+$/i, '');
}

function normalizeSlugToken(token) {
    let t = String(token || '').toLowerCase();
    if (t === 'with') return 'w';
    if (t === 'without') return 'wo';
    return t;
}

function significantSlugTokens(slug) {
    return String(slug || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map(normalizeSlugToken)
        .filter((t) => t && !SLUG_STOP_TOKENS.has(t) && !/^\d+$/.test(t));
}

function slugLookupVariants(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return [];
    const out = new Set([s, stripSkuSuffix(s)]);
    if (/-\d+$/.test(s)) out.add(s.replace(/-\d+$/, ''));
    // Magento often used "with"; catalog often uses "w".
    out.add(s.replace(/-with-/g, '-w-'));
    out.add(stripSkuSuffix(s).replace(/-with-/g, '-w-'));
    out.add(s.replace(/-w-/g, '-with-'));
    out.add(stripSkuSuffix(s).replace(/-w-/g, '-with-'));
    if (/^3-1-/.test(s)) out.add(s.replace(/^3-1-/, '3-in-1-'));
    if (/^doctors-blend-/.test(s)) out.add(s.replace(/^doctors-blend-/, 'doctor-s-blend-'));
    if (/^doctors-/.test(s)) out.add(s.replace(/^doctors-/, 'doctor-s-'));
    if (/^doctor-blend-/.test(s)) out.add(s.replace(/^doctor-blend-/, 'doctor-s-blend-'));
    return [...out].filter(Boolean);
}

function tokenPrefixLength(a, b) {
    const left = String(a || '').split('-');
    const right = String(b || '').split('-');
    let i = 0;
    while (i < left.length && i < right.length && left[i] === right[i]) i++;
    return i;
}

/**
 * Score Magento/Google slugs that share distinctive tokens with a live catalog slug
 * even when word order / filler brand words / with↔w differ.
 */
function tokenOverlapScore(raw, slug) {
    const rawTokens = significantSlugTokens(raw);
    const slugTokens = significantSlugTokens(slug);
    if (rawTokens.length < MIN_OVERLAP_TOKENS || slugTokens.length < MIN_OVERLAP_TOKENS) {
        return -1;
    }
    const slugSet = new Set(slugTokens);
    let hits = 0;
    for (const t of rawTokens) {
        if (slugSet.has(t)) {
            hits += 1;
            continue;
        }
        // Allow mild stem containment (ephedra / ephedrine-style near matches stay exact-only).
    }
    const coverage = hits / rawTokens.length;
    if (hits < MIN_OVERLAP_TOKENS || coverage < MIN_OVERLAP_COVERAGE) {
        return -1;
    }
    // Prefer denser overlap; slight bonus when most live tokens are also covered.
    const rawSet = new Set(rawTokens);
    let reverseHits = 0;
    for (const t of slugTokens) {
        if (rawSet.has(t)) reverseHits += 1;
    }
    const reverseCoverage = reverseHits / slugTokens.length;
    return 620 + hits * 10 + Math.round(coverage * 40) + Math.round(reverseCoverage * 20);
}

/**
 * Pick the best catalog slug when the requested slug is missing but closely related
 * (truncated Magento slugs, -sku- suffix variants, barcode suffixes, -1 duplicates).
 */
function rankSlugMatch(raw, slug) {
    if (slug === raw) return 1000;
    if (slug.startsWith(`${raw}-sku-`)) return 900;
    if (raw.startsWith(slug) && slug.length >= MIN_PREFIX_SLUG_LEN) return 800 + slug.length;
    if (slug.startsWith(raw) && raw.length >= MIN_SHORT_SLUG_LEN) return 750 - slug.length;
    const tokens = tokenPrefixLength(raw, slug);
    if (tokens >= MIN_TOKEN_PREFIX) return 600 + tokens;
    return tokenOverlapScore(raw, slug);
}

function findBestSlugMatch(raw, dbSlugs) {
    const variants = slugLookupVariants(raw);
    if (!variants.length) return null;

    let best = null;
    let bestScore = -1;
    for (const variant of variants) {
        for (const slug of dbSlugs) {
            const score = rankSlugMatch(variant, slug);
            if (score > bestScore) {
                bestScore = score;
                best = slug;
            }
        }
    }
    return bestScore >= 600 ? best : null;
}

async function findProductSlugByPrefix(pool, raw) {
    const variants = slugLookupVariants(raw);
    for (const needle of variants) {
        if (!needle || needle.length < MIN_SHORT_SLUG_LEN) continue;

        const [rows] = await pool.execute(
            `SELECT p.slug
             FROM products p
             WHERE p.is_active = 1 AND ${STOREFRONT_VISIBLE_WHERE}
               AND (
                 p.slug = ?
                 OR ? LIKE CONCAT(p.slug, '%')
                 OR p.slug LIKE CONCAT(?, '%')
               )
             ORDER BY
               (p.slug = ?) DESC,
               (p.slug LIKE CONCAT(?, '-sku-%')) DESC,
               (CASE WHEN ? LIKE CONCAT(p.slug, '%') THEN LENGTH(p.slug) ELSE 0 END) DESC,
               (CASE WHEN p.slug LIKE CONCAT(?, '%') THEN -LENGTH(p.slug) ELSE 0 END) DESC
             LIMIT 1`,
            [needle, needle, needle, needle, needle, needle, needle]
        );
        if (rows[0]?.slug) return rows[0].slug;
    }
    return null;
}

async function findProductSlugWithFallback(pool, raw, dbSlugs) {
    const fromSql = await findProductSlugByPrefix(pool, raw);
    if (fromSql) return fromSql;
    let slugs = dbSlugs;
    if (!slugs) {
        const [rows] = await pool.query(
            `SELECT p.slug FROM products p
              WHERE p.is_active = 1 AND ${STOREFRONT_VISIBLE_WHERE}`
        );
        slugs = rows.map((r) => String(r.slug || '').trim()).filter(Boolean);
    }
    return findBestSlugMatch(raw, slugs);
}

module.exports = {
    MIN_PREFIX_SLUG_LEN,
    stripSkuSuffix,
    slugLookupVariants,
    significantSlugTokens,
    tokenOverlapScore,
    tokenPrefixLength,
    rankSlugMatch,
    findBestSlugMatch,
    findProductSlugByPrefix,
    findProductSlugWithFallback,
};
