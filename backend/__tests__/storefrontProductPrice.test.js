'use strict';

const {
    needsVariantPriceFallback,
    minActiveVariantPrice,
    applyVariantPriceFallback,
    applyVariantPriceFallbackFromVariants
} = require('../utils/storefrontProductPrice');

describe('storefrontProductPrice', () => {
    test('applyVariantPriceFallback uses min variant price when parent is zero', () => {
        const row = { id: 1, price: 0 };
        applyVariantPriceFallback(row, 25.49);
        expect(row.price).toBe(25.49);
    });

    test('applyVariantPriceFallback does not override a positive parent price', () => {
        const row = { id: 1, price: 19.99 };
        applyVariantPriceFallback(row, 25.49);
        expect(row.price).toBe(19.99);
    });

    test('minActiveVariantPrice ignores inactive variants', () => {
        const min = minActiveVariantPrice([
            { price: 30, is_active: 0 },
            { price: 25.49, is_active: 1 },
            { price: 28, is_active: 1 }
        ]);
        expect(min).toBe(25.49);
    });

    test('applyVariantPriceFallbackFromVariants on variant array', () => {
        const product = { price: 0 };
        applyVariantPriceFallbackFromVariants(product, [{ price: 12.5, is_active: 1 }]);
        expect(product.price).toBe(12.5);
    });

    test('needsVariantPriceFallback', () => {
        expect(needsVariantPriceFallback(0)).toBe(true);
        expect(needsVariantPriceFallback(null)).toBe(true);
        expect(needsVariantPriceFallback(9.99)).toBe(false);
    });
});
