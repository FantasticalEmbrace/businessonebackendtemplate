'use strict';

const {
    pickImagesForProduct,
    toAbsoluteUrl,
    productLink,
    MAX_ADDITIONAL_IMAGES,
} = require('../services/googleMerchantProductFeed');

describe('googleMerchantProductFeed image picking', () => {
    const base = 'https://store.example.com';
    const product = { slug: 'demo-product', sku: 'SKU-1' };

    test('keeps primary as image_link and only same-product gallery as additional', () => {
        const rows = [
            { id: 2, image_url: '/images/products/b.jpg', is_primary: 0, sort_order: 1 },
            { id: 1, image_url: '/images/products/a.jpg', is_primary: 1, sort_order: 0 },
            { id: 3, image_url: '/images/products/c.jpg', is_primary: 0, sort_order: 2 },
        ];
        const { imageLink, additional } = pickImagesForProduct(rows, product, base);
        expect(imageLink).toBe(`${base}/images/products/a.jpg`);
        expect(additional).toEqual([
            `${base}/images/products/b.jpg`,
            `${base}/images/products/c.jpg`,
        ]);
    });

    test('does not invent extras when only one image exists', () => {
        const rows = [
            { id: 1, image_url: 'https://cdn.example/only.jpg', is_primary: 1, sort_order: 0 },
        ];
        const { imageLink, additional } = pickImagesForProduct(rows, product, base);
        expect(imageLink).toBe('https://cdn.example/only.jpg');
        expect(additional).toEqual([]);
    });

    test('caps additional images at Google max', () => {
        const rows = [];
        for (let i = 0; i < 15; i += 1) {
            rows.push({
                id: i + 1,
                image_url: `/images/products/n${i}.jpg`,
                is_primary: i === 0 ? 1 : 0,
                sort_order: i,
            });
        }
        const { imageLink, additional } = pickImagesForProduct(rows, product, base);
        expect(imageLink).toContain('n0.jpg');
        expect(additional).toHaveLength(MAX_ADDITIONAL_IMAGES);
        expect(additional[0]).toContain('n1.jpg');
        expect(additional[MAX_ADDITIONAL_IMAGES - 1]).toContain(`n${MAX_ADDITIONAL_IMAGES}.jpg`);
    });

    test('returns empty when product has no product_images rows', () => {
        const { imageLink, additional } = pickImagesForProduct([], product, base);
        expect(imageLink).toBe('');
        expect(additional).toEqual([]);
    });

    test('toAbsoluteUrl and productLink stay on store origin', () => {
        expect(toAbsoluteUrl(base, '/images/products/x.jpg')).toBe(`${base}/images/products/x.jpg`);
        expect(productLink(base, 'foo-bar')).toBe(`${base}/product.html?slug=foo-bar`);
    });
});
