'use strict';

const {
    buildProductJsonLd,
    injectJsonLdIntoHtml,
    JSONLD_SCRIPT_ID,
} = require('../services/productPageJsonLd');

describe('productPageJsonLd', () => {
    const base = 'https://store.example.com';
    const product = {
        sku: 'SKU-DEMO-1',
        slug: 'demo-product',
        name: 'Demo Product',
        short_description: 'A sample product for schema tests.',
        price: 19.99,
        inventory_quantity: 5,
        track_inventory: 1,
        brand_name: 'Demo Brand',
    };

    test('buildProductJsonLd sets sku and productID to catalog SKU for Merchant offer id', () => {
        const schema = buildProductJsonLd(
            product,
            [
                {
                    image_url: '/images/products/a.jpg',
                    is_primary: 1,
                    sort_order: 0,
                },
            ],
            { baseUrl: base, sellerName: 'Example Store' }
        );
        expect(schema.sku).toBe('SKU-DEMO-1');
        expect(schema.productID).toBe('SKU-DEMO-1');
        expect(schema.url).toBe(`${base}/product.html?slug=demo-product`);
        expect(schema.image).toBe(`${base}/images/products/a.jpg`);
        expect(schema.offers.price).toBe('19.99');
        expect(schema.offers.itemCondition).toBe('https://schema.org/NewCondition');
        expect(schema.offers.seller.name).toBe('Example Store');
    });

    test('buildProductJsonLd returns null without sku', () => {
        expect(buildProductJsonLd({ ...product, sku: '' }, [], { baseUrl: base })).toBeNull();
    });

    test('injectJsonLdIntoHtml places script in head and replaces existing id', () => {
        const schema = buildProductJsonLd(product, [], {
            baseUrl: base,
            sellerName: 'Example Store',
        });
        const html = '<html><head><title>x</title></head><body></body></html>';
        const once = injectJsonLdIntoHtml(html, schema);
        expect(once).toContain(`id="${JSONLD_SCRIPT_ID}"`);
        expect(once).toContain('"sku":"SKU-DEMO-1"');
        expect(once).toContain('"productID":"SKU-DEMO-1"');

        const twice = injectJsonLdIntoHtml(once, {
            ...schema,
            sku: '999',
            productID: '999',
        });
        expect((twice.match(new RegExp(JSONLD_SCRIPT_ID, 'g')) || []).length).toBe(1);
        expect(twice).toContain('"sku":"999"');
        expect(twice).not.toContain('"sku":"SKU-DEMO-1"');
    });
});
