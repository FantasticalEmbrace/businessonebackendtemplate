'use strict';

/**
 * Build the customer/admin-facing line label for an order item.
 * Prefers snapshot fields; falls back to live variant name when snapshot is empty.
 */
function composeOrderLineDisplayName(productName, variantName) {
    const product = String(productName || '').trim();
    const variant = String(variantName || '').trim();
    if (!variant) return product;
    if (!product) return variant;
    const productLower = product.toLowerCase();
    const variantLower = variant.toLowerCase();
    if (productLower === variantLower || productLower.includes(variantLower)) {
        return product;
    }
    return `${product} — ${variant}`;
}

/** Prefer stored variant SKU, else live variant SKU, else product SKU. */
function resolveOrderLineSku(productSku, variantSku) {
    const v = String(variantSku || '').trim();
    if (v) return v;
    return String(productSku || '').trim();
}

module.exports = {
    composeOrderLineDisplayName,
    resolveOrderLineSku
};
