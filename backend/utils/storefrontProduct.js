'use strict';

/** Internal product fields that must never appear on the public storefront API. */
const STOREFRONT_OMIT_FIELDS = [
    'cost_price',
    'cost_synced_at',
    'octopos_product_id',
];

function toStorefrontProduct(product) {
    if (!product || typeof product !== 'object') return product;
    const out = { ...product };
    for (const key of STOREFRONT_OMIT_FIELDS) {
        delete out[key];
    }
    if (Array.isArray(out.variants)) {
        out.variants = out.variants.map((variant) => {
            const v = { ...variant };
            delete v.cost_price;
            return v;
        });
    }
    return out;
}

module.exports = { toStorefrontProduct, STOREFRONT_OMIT_FIELDS };
