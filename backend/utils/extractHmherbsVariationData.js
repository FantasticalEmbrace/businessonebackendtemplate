/**
 * Parse hmherbs.com window.variationData blobs (per-option SKU, price, image).
 */
const BASE = process.env.CATALOG_SCRAPE_DOMAIN || 'https://hmherbs.com';

function absolutizeHmherbsPath(href) {
    if (!href) return null;
    const h = String(href).trim();
    if (h.startsWith('http://') || h.startsWith('https://')) return h;
    if (h.startsWith('//')) return `https:${h}`;
    if (h.startsWith('/')) return `${BASE}${h}`;
    return `${BASE}/${h}`;
}

function normalizeSku(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/^#/, '');
}

/**
 * @param {string} html
 * @returns {Array<{ optionKey: string, sku: string, price: number|null, imageUrl: string|null, imageThumb: string|null, raw: object }>}
 */
function extractAllHmherbsVariationData(html) {
    const out = [];
    const re = /\(window\.variationData[^)]*\)\[\d+\]\s*=\s*(\{[\s\S]*?\});/g;
    let m;
    while ((m = re.exec(String(html))) !== null) {
        try {
            const blob = JSON.parse(m[1]);
            for (const optionKey of Object.keys(blob)) {
                const v = blob[optionKey];
                if (!v || typeof v !== 'object') continue;
                const price = parseFloat(v.price);
                const imageUrl = absolutizeHmherbsPath(v.image || v.imageUrl || v.image_thumb);
                const imageThumb = absolutizeHmherbsPath(v.imageThumb || v.image_thumb);
                out.push({
                    optionKey: String(optionKey),
                    sku: normalizeSku(v.sku),
                    price: Number.isFinite(price) && price > 0 ? price : null,
                    imageUrl: imageUrl || imageThumb,
                    imageThumb: imageThumb || imageUrl,
                    raw: v,
                });
            }
        } catch {
            /* ignore malformed blob */
        }
    }
    return out;
}

function indexVariationDataBySku(html) {
    const bySku = new Map();
    const byOptionKey = new Map();
    for (const row of extractAllHmherbsVariationData(html)) {
        if (row.sku) bySku.set(row.sku, row);
        if (row.optionKey) byOptionKey.set(row.optionKey, row);
    }
    return { bySku, byOptionKey, all: extractAllHmherbsVariationData(html) };
}

function matchVariationImageForOption(option, index) {
    const { bySku, byOptionKey } = index;
    const external = String(option.externalValue || option.external_value || '').trim();
    if (external && byOptionKey.has(external)) {
        return byOptionKey.get(external).imageUrl;
    }
    const hint = normalizeSku(option.skuHint || option.sku_hint);
    if (hint && bySku.has(hint)) {
        return bySku.get(hint).imageUrl;
    }
    return null;
}

module.exports = {
    extractAllHmherbsVariationData,
    indexVariationDataBySku,
    matchVariationImageForOption,
    absolutizeHmherbsPath,
    normalizeSku,
};
