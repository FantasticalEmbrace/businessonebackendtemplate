/**
 * Extract manufacturer / catalog SKU from product slug, name, or scraped row.
 * These codes match what brands use on their own sites (not HM-* internal codes).
 */

function normalizeCatalogSku(sku, { preserveLeadingZeros = false } = {}) {
    const t = String(sku || '').trim().toUpperCase();
    if (!t) return '';
    if (/[A-Z]/i.test(t.replace(/^HM-/, ''))) return t;
    if (preserveLeadingZeros && /^0+\d+$/.test(t)) return t;
    const asNum = Number(t);
    if (Number.isFinite(asNum) && asNum >= 0 && asNum === Math.floor(asNum)) {
        return String(Math.floor(asNum));
    }
    return t;
}

function extractCatalogSkuFromSlug(slug) {
    if (!slug || typeof slug !== 'string') return '';
    const m = String(slug).match(/-sku-([a-z0-9-]+)$/i);
    if (!m) return '';
    const raw = m[1].toUpperCase();
    if (/^0+\d+$/.test(raw)) return raw;
    return normalizeCatalogSku(raw);
}

function extractCatalogSkuFromName(name) {
    if (!name || typeof name !== 'string') return '';
    const m = String(name).match(/\bsku\s*:\s*([A-Za-z0-9-]+)/i);
    return m ? m[1].toUpperCase() : '';
}

function extractCatalogSkuFromProduct(row) {
    if (!row) return '';
    return (
        extractCatalogSkuFromSlug(row.slug) ||
        extractCatalogSkuFromName(row.name) ||
        ''
    );
}

function isInternalHmSku(sku) {
    return /^HM-/i.test(String(sku || '').trim());
}

function isReservedInternalSku(sku) {
    const s = String(sku || '').trim().toUpperCase();
    return s.startsWith('GC-') || s === 'GC-DIGITAL' || s === 'GC-PHYSICAL';
}

function slugFromHmherbsUrl(url) {
    const m = String(url || '').match(/\/products\/([^/?#]+)/i);
    if (!m) return '';
    return m[1].toLowerCase().replace(/_/g, '-');
}

module.exports = {
    extractCatalogSkuFromSlug,
    extractCatalogSkuFromName,
    extractCatalogSkuFromProduct,
    isInternalHmSku,
    isReservedInternalSku,
    normalizeCatalogSku,
    slugFromHmherbsUrl,
};
