'use strict';

const {
    needsVariantPriceFallback,
    pickPrimaryVariant,
    primaryActiveVariantPrice,
    minActiveVariantPrice,
    applyVariantPriceFallback,
    applyVariantPriceFallbackFromVariants
} = require('../utils/storefrontProductPrice');

describe('storefrontProductPrice', () => {
    const liquid = { id: 1, sku: 'P010L01-LIQUID', name: '1oz Liquid', price: 17.99, sort_order: 0, is_active: 1 };
    const dropper = { id: 2, sku: 'P010L01-DROPPER', name: '1oz Glass Dropper', price: 2.95, sort_order: 1, is_active: 1 };

    test('applyVariantPriceFallback uses primary price when parent is zero', () => {
        const row = { id: 1, price: 0 };
        applyVariantPriceFallback(row, 17.99);
        expect(row.price).toBe(17.99);
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

    test('primaryActiveVariantPrice prefers lowest sort_order over cheapest accessory', () => {
        expect(primaryActiveVariantPrice([liquid, dropper])).toBe(17.99);
        expect(minActiveVariantPrice([liquid, dropper])).toBe(2.95);
    });

    test('pickPrimaryVariant matches parent SKU when present', () => {
        const pellet = { id: 3, sku: 'F007PEL01', name: '1oz Pellets', price: 25.95, sort_order: 1, is_active: 1 };
        const primary = pickPrimaryVariant(
            [liquid, pellet, dropper],
            'F007PEL01'
        );
        expect(primary.sku).toBe('F007PEL01');
        expect(primaryActiveVariantPrice([liquid, pellet, dropper], 'F007PEL01')).toBe(25.95);
    });

    test('applyVariantPriceFallbackFromVariants uses primary not min', () => {
        const product = { price: 0, sku: 'P010L01' };
        applyVariantPriceFallbackFromVariants(product, [liquid, dropper]);
        expect(product.price).toBe(17.99);
    });

    test('needsVariantPriceFallback', () => {
        expect(needsVariantPriceFallback(0)).toBe(true);
        expect(needsVariantPriceFallback(null)).toBe(true);
        expect(needsVariantPriceFallback(9.99)).toBe(false);
    });
});
