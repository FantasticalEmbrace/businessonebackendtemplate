/**
 * Shared storefront product search helpers (homepage hero + products page).
 */
(function (global) {
    'use strict';

    function getStorefrontApiBase() {
        if (typeof global.hmHerbsStorefrontApiBase === 'function') {
            const base = String(global.hmHerbsStorefrontApiBase() || '').trim().replace(/\/+$/, '');
            // '' means same-origin relative /api/... (see customer-auth.js).
            if (base) return base;
            if (global.location && global.location.origin) return global.location.origin;
            return '';
        }
        if (global.location.protocol === 'file:') return 'http://localhost:3001';
        const h = global.location.hostname;
        if ((h === 'localhost' || h === '127.0.0.1') && global.location.port !== '3001') {
            return 'http://localhost:3001';
        }
        return global.location.origin;
    }

    /** Build /api/... URL; works with empty base (same-origin relative path). */
    function buildStorefrontApiUrl(pathAndQuery) {
        const base = getStorefrontApiBase();
        const path = String(pathAndQuery || '').startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
        return base ? `${base}${path}` : path;
    }

    function resolveProductImageUrl(imageUrl, apiBaseUrl) {
        if (!imageUrl) return '';
        if (imageUrl.startsWith('http') || imageUrl.startsWith('//')) return imageUrl;
        return imageUrl.startsWith('/') ? `${apiBaseUrl}${imageUrl}` : `${apiBaseUrl}/${imageUrl}`;
    }

    function transformApiProduct(product, apiBaseUrl) {
        const imageUrl = resolveProductImageUrl(product.image_url || product.image || '', apiBaseUrl);
        const slug = product.slug || '';
        return {
            id: product.id,
            name: product.name,
            price: parseFloat(product.price) || 0,
            image: imageUrl,
            category: product.category_slug || product.category_name || '',
            brand: product.brand_slug || product.brand_name || '',
            brandName: product.brand_name || '',
            description: product.short_description || product.long_description || '',
            inventory: product.inventory_quantity || 0,
            featured: product.is_featured || false,
            inStock: (product.inventory_quantity || 0) > 0 || product.inventory_quantity === null,
            slug,
            url: slug ? `product.html?slug=${encodeURIComponent(slug)}` : null
        };
    }

    function matchProducts(products, searchQuery) {
        const list = Array.isArray(products) ? products : [];
        const searchKeywords = String(searchQuery || '')
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .filter((word) => word.length > 0);

        if (searchKeywords.length === 0) return list;

        return list.filter((product) => {
            const name = (product.name || '').toLowerCase();
            const description = (product.description || '').toLowerCase();
            const category = (product.category || '').toLowerCase();
            const brandSlug = (product.brand || '').toLowerCase();
            const brandName = (product.brandName || '').toLowerCase();
            const brandNameClean = brandName.replace(/[^a-z0-9]/g, '');

            return searchKeywords.every((keyword) => {
                const keywordClean = keyword.replace(/[^a-z0-9]/g, '');
                return (
                    name.includes(keyword) ||
                    description.includes(keyword) ||
                    category.includes(keyword) ||
                    brandSlug.includes(keyword) ||
                    brandName.includes(keyword) ||
                    (keywordClean.length > 0 && brandNameClean.includes(keywordClean))
                );
            });
        });
    }

    function formatProductPrice(price) {
        const amount = Number(price);
        if (!Number.isFinite(amount)) return '';
        return `$${amount.toFixed(2)}`;
    }

    const PRODUCT_THUMB_PLACEHOLDER =
        'data:image/svg+xml,' +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">' +
                '<rect width="44" height="44" fill="#f3f4f6" rx="6"/>' +
                '<path d="M14 28l6-7 5 5 8-10 6 8" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>'
        );

    global.hmGetStorefrontApiBase = getStorefrontApiBase;
    global.hmBuildStorefrontApiUrl = buildStorefrontApiUrl;
    global.hmTransformStorefrontProduct = transformApiProduct;
    global.hmProductSearchMatch = matchProducts;
    global.hmFormatProductPrice = formatProductPrice;
    global.hmProductThumbPlaceholder = PRODUCT_THUMB_PLACEHOLDER;
})(typeof window !== 'undefined' ? window : globalThis);
