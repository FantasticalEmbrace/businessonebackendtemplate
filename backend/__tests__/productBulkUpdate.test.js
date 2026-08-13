'use strict';

const {
    normalizeProductFieldValue,
    buildProductUpdateClause,
    PRODUCT_BULK_ALLOWED_FIELDS
} = require('../utils/productFieldNormalizer');

describe('productFieldNormalizer', () => {
    it('normalizes booleans from select values', () => {
        expect(normalizeProductFieldValue('is_active', '1')).toBe(true);
        expect(normalizeProductFieldValue('is_active', '0')).toBe(false);
        expect(normalizeProductFieldValue('show_on_web', false)).toBe(false);
    });

    it('normalizes numeric nullable fields', () => {
        expect(normalizeProductFieldValue('cost_price', '')).toBe(null);
        expect(normalizeProductFieldValue('cost_price', '12.5')).toBe(12.5);
        expect(normalizeProductFieldValue('price', '19.99')).toBe(19.99);
        expect(normalizeProductFieldValue('weight', '')).toBe(null);
    });

    it('normalizes integer ids', () => {
        expect(normalizeProductFieldValue('brand_id', '42')).toBe(42);
        expect(normalizeProductFieldValue('category_id', 7)).toBe(7);
        expect(normalizeProductFieldValue('inventory_quantity', '100')).toBe(100);
    });

    it('builds SQL clause for all bulk fields', () => {
        const updates = {
            brand_id: 2,
            category_id: 3,
            price: 24.99,
            cost_price: null,
            compare_price: 29.99,
            weight: 8,
            inventory_quantity: 50,
            low_stock_threshold: 5,
            is_active: true,
            is_featured: false,
            show_on_web: true,
            is_cannabis: false
        };
        const { setParts, setValues, applied } = buildProductUpdateClause(
            updates,
            PRODUCT_BULK_ALLOWED_FIELDS
        );
        expect(setParts.length).toBe(12);
        expect(setValues).toEqual([
            2, 3, 24.99, 29.99, null, 8, 50, 5, true, false, true, false
        ]);
        expect(applied.brand_id).toBe(2);
        expect(applied.is_featured).toBe(false);
    });
});
