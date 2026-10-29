/**
 * Shared product-search tokenization + light English plural variants
 * so "standard enzymes" matches brand "STANDARD ENZYME".
 */

const SEARCH_STOPWORDS = new Set([
    'a',
    'an',
    'the',
    'of',
    'and',
    'or',
    'for',
    'to',
    'in',
    'on',
    'with',
    'by'
]);

function cleanSearchToken(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function tokenizeProductSearch(search) {
    const raw = String(search || '')
        .toLowerCase()
        .trim();
    if (!raw) return [];
    const tokens = raw.split(/\s+/).filter((word) => word.length > 0);
    const meaningful = tokens.filter(
        (word) => word.length >= 2 && !SEARCH_STOPWORDS.has(word)
    );
    if (meaningful.length > 0) return meaningful;
    const collapsed = cleanSearchToken(raw);
    return collapsed ? [collapsed] : tokens;
}

/** Return singular/plural-ish variants for one token (includes original). */
function searchTokenVariants(token) {
    const raw = String(token || '').toLowerCase().trim();
    const variants = new Set();
    if (!raw) return [];
    variants.add(raw);
    const clean = cleanSearchToken(raw);
    if (clean) variants.add(clean);

    const addStem = (stem) => {
        if (stem && stem.length >= 2) {
            variants.add(stem);
            const stemClean = cleanSearchToken(stem);
            if (stemClean) variants.add(stemClean);
        }
    };

    if (clean.endsWith('ies') && clean.length > 4) {
        addStem(`${clean.slice(0, -3)}y`);
    } else if (clean.endsWith('oes') && clean.length > 4) {
        addStem(clean.slice(0, -2));
    } else if (
        clean.endsWith('ses') ||
        clean.endsWith('xes') ||
        clean.endsWith('zes') ||
        clean.endsWith('ches') ||
        clean.endsWith('shes')
    ) {
        if (clean.length > 4) addStem(clean.slice(0, -2));
    } else if (clean.endsWith('es') && clean.length > 3) {
        addStem(clean.slice(0, -2));
        addStem(clean.slice(0, -1));
    } else if (clean.endsWith('s') && !clean.endsWith('ss') && clean.length > 3) {
        addStem(clean.slice(0, -1));
    }

    return [...variants];
}

/**
 * True if haystack (already lowercased preferred) contains any variant of needle.
 */
function textMatchesSearchToken(haystack, token) {
    const text = String(haystack || '').toLowerCase();
    const textClean = cleanSearchToken(text);
    return searchTokenVariants(token).some((variant) => {
        if (!variant) return false;
        if (text.includes(variant)) return true;
        const vClean = cleanSearchToken(variant);
        return vClean.length > 0 && textClean.includes(vClean);
    });
}

module.exports = {
    SEARCH_STOPWORDS,
    cleanSearchToken,
    tokenizeProductSearch,
    searchTokenVariants,
    textMatchesSearchToken
};
