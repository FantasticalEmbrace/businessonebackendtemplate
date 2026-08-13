/**
 * Match a variant row to the best image from a scraped hmherbs gallery.
 */

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function variantTokens(name) {
    const n = normalizeText(name);
    const tokens = new Set();
    const add = (t) => {
        if (t) tokens.add(t);
    };

    if (/\btube\b/.test(n)) add('tube');
    if (/\bjar\b/.test(n)) add('jar');
    if (/\bbottle\b/.test(n)) add('bottle');
    if (/\bdropper\b/.test(n)) add('dropper');
    if (/\bliquid\b/.test(n)) add('liquid');
    if (/\bpellet/.test(n)) add('pellet');
    if (/\bcapsule|\bcaps\b/.test(n)) add('capsule');
    if (/\btablet/.test(n)) add('tablet');
    if (/\bpowder\b/.test(n)) add('powder');
    if (/\bcherry\b/.test(n)) add('cherry');
    if (/\bmango\b/.test(n)) add('mango');
    if (/\b2\s*pk|\b2\s*pack|\btwo\b/.test(n)) add('2');
    if (/\b3\s*pk|\b3\s*pack|\bthree\b/.test(n)) add('3');

    const oz = n.match(/(\d+(?:\.\d+)?)\s*oz/);
    if (oz) {
        add(`${oz[1]}oz`);
        add(`${oz[1]} oz`);
    }

    const caps = n.match(/(\d+)\s*caps/);
    if (caps) add(`${caps[1]} caps`);

    const hint = String(name || '').match(/#([A-Za-z0-9-]+)/);
    if (hint) add(hint[1].toLowerCase());

    n.split(/\s+/).filter((w) => w.length > 2).forEach((w) => add(w));
    return [...tokens];
}

function imageHaystack(img) {
    const url = String(img.url || img.image_url || '');
    const alt = String(img.alt || img.alt_text || '');
    return normalizeText(`${alt} ${url.split('/').pop()}`);
}

function scoreVariantImageMatch(variantName, img) {
    const hay = imageHaystack(img);
    if (!hay) return -999;
    if (/ingredient|supplement fact|label back|nutrition fact|directions only/.test(hay)) {
        return -50;
    }

    const tokens = variantTokens(variantName);
    let score = 0;
    for (const token of tokens) {
        const compact = token.replace(/\s+/g, '');
        if (hay.includes(compact)) score += 12;
        else if (hay.includes(token)) score += 8;
    }
    return score;
}

function pickBestScrapedImageForVariant(variantName, images) {
    const list = (images || []).filter((im) => im && (im.url || im.image_url));
    if (!list.length) return null;

    let best = null;
    let bestScore = 0;
    for (const img of list) {
        const score = scoreVariantImageMatch(variantName, img);
        if (score > bestScore) {
            bestScore = score;
            best = img.url || img.image_url;
        }
    }
    return bestScore >= 8 ? best : null;
}

function slugBase(slug) {
    return String(slug || '')
        .toLowerCase()
        .replace(/-sku-[a-z0-9-]+$/i, '')
        .replace(/-free-shipping.*$/i, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function findScrapedProduct(product, scrapedList) {
    const slug = String(product.slug || '').toLowerCase();
    const base = slugBase(slug);
    const name = normalizeText(product.name);

    let best = null;
    let bestScore = 0;

    for (const row of scrapedList) {
        const rowUrl = String(row.url || '');
        const rowSlug = rowUrl.match(/\/products\/([^/?#]+)/i);
        const rowBase = rowSlug ? slugBase(decodeURIComponent(rowSlug[1])) : '';
        let score = 0;

        if (base && rowBase && (base === rowBase || base.includes(rowBase) || rowBase.includes(base))) {
            score += 80;
        }
        const rowName = normalizeText(row.name);
        if (rowName && name && (rowName === name || rowName.includes(name) || name.includes(rowName))) {
            score += 60;
        }
        if (score > bestScore) {
            bestScore = score;
            best = row;
        }
    }

    return bestScore >= 60 ? best : null;
}

module.exports = {
    pickBestScrapedImageForVariant,
    findScrapedProduct,
    variantTokens,
    scoreVariantImageMatch,
};
