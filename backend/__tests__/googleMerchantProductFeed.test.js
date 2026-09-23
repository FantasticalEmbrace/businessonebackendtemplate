'use strict';

const {
    pickImagesForProduct,
    toAbsoluteUrl,
    productLink,
    moneyWithCurrency,
    resolveFeedPrices,
    buildFeedShippingFields,
    FEED_SHIPPING_SERVICE,
    FEED_SHIPPING_MIN_TRANSIT_DAYS,
    FEED_SHIPPING_MAX_TRANSIT_DAYS,
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

describe('googleMerchantProductFeed pricing', () => {
    test('moneyWithCurrency rejects zero/null/NaN', () => {
        expect(moneyWithCurrency(17.99)).toBe('17.99 USD');
        expect(moneyWithCurrency('17.99')).toBe('17.99 USD');
        expect(moneyWithCurrency(0)).toBe('');
        expect(moneyWithCurrency(null)).toBe('');
        expect(moneyWithCurrency('')).toBe('');
        expect(moneyWithCurrency(-1)).toBe('');
    });

    test('resolveFeedPrices uses selling price when not on sale', () => {
        expect(resolveFeedPrices({ price: 32.63, compare_price: null })).toEqual({
            price: '32.63 USD',
            salePrice: '',
        });
    });

    test('resolveFeedPrices emits regular + sale_price when compare is higher', () => {
        expect(resolveFeedPrices({ price: 17.99, compare_price: 20.95 })).toEqual({
            price: '20.95 USD',
            salePrice: '17.99 USD',
        });
    });

    test('resolveFeedPrices returns null without a positive selling price', () => {
        expect(resolveFeedPrices({ price: 0, compare_price: 20.95 })).toBeNull();
        expect(resolveFeedPrices({ price: null })).toBeNull();
    });
});

describe('googleMerchantProductFeed shipping', () => {
    test('buildFeedShippingFields emits US Standard + free threshold from shippingConfig', () => {
        const fields = buildFeedShippingFields();
        expect(fields.shipping).toMatch(
            new RegExp(
                `^US:${FEED_SHIPPING_SERVICE}:\\d+\\.\\d{2} USD:${FEED_SHIPPING_MIN_TRANSIT_DAYS}:${FEED_SHIPPING_MAX_TRANSIT_DAYS}$`
            )
        );
        expect(fields.freeShippingThreshold).toMatch(/^US:\d+\.\d{2} USD$/);
        expect(FEED_SHIPPING_MIN_TRANSIT_DAYS).toBe(3);
        expect(FEED_SHIPPING_MAX_TRANSIT_DAYS).toBe(7);
    });
});
