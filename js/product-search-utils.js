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
            sku: product.sku || '',
            price: parseFloat(product.price) || 0,
            image: imageUrl,
            category: product.category_slug || product.category_name || '',
            brand: product.brand_slug || product.brand_name || '',
            brandName: product.brand_name || '',
            // Prefer short description for client search re-filter (long copy is noisy)
            description: product.short_description || product.long_description || '',
            short_description: product.short_description || '',
            inventory: product.inventory_quantity || 0,
            featured: product.is_featured || false,
            inStock: (product.inventory_quantity || 0) > 0 || product.inventory_quantity === null,
            slug,
            url: slug ? `product?slug=${encodeURIComponent(slug)}` : null
        };
    }

    /** Collapse punctuation/spaces so "fhs" matches "F H S" and "alphagest" matches "Alpha-Gest". */
    function cleanSearchToken(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    }

    const SEARCH_STOPWORDS = new Set([
        'a',
        'an',
        'the',
        'of',
        'and',
        'or',
        'for',
        'to',
        'in',
        'on',
        'with',
        'by'
    ]);

    /**
     * Tokenize a search query. Drops stopwords / 1-char tokens when possible;
     * if nothing meaningful remains (e.g. "F H S", "3 in 1"), collapses to one alnum token.
     */
    function tokenizeSearchQuery(searchQuery) {
        const raw = String(searchQuery || '')
            .toLowerCase()
            .trim();
        if (!raw) return [];
        const tokens = raw.split(/\s+/).filter((word) => word.length > 0);
        const meaningful = tokens.filter(
            (word) => word.length >= 2 && !SEARCH_STOPWORDS.has(word)
        );
        if (meaningful.length > 0) return meaningful;
        const collapsed = cleanSearchToken(raw);
        return collapsed ? [collapsed] : tokens;
    }

    function matchProducts(products, searchQuery) {
        const list = Array.isArray(products) ? products : [];
        const searchKeywords = tokenizeSearchQuery(searchQuery);

        if (searchKeywords.length === 0) return list;

        return list.filter((product) => {
            const name = (product.name || '').toLowerCase();
            const slug = (product.slug || '').toLowerCase();
            // Prefer short_description; fall back to description (products page map)
            const description = String(
                product.short_description || product.description || ''
            ).toLowerCase();
            const category = (product.category || '').toLowerCase();
            const brandSlug = (product.brand || '').toLowerCase();
            const brandName = (product.brandName || '').toLowerCase();
            const sku = String(product.sku || '').toLowerCase();

            const nameClean = cleanSearchToken(name);
            const slugClean = cleanSearchToken(slug);
            const descriptionClean = cleanSearchToken(description);
            const categoryClean = cleanSearchToken(category);
            const brandSlugClean = cleanSearchToken(brandSlug);
            const brandNameClean = cleanSearchToken(brandName);
            const skuClean = cleanSearchToken(sku);

            return searchKeywords.every((keyword) => {
                const keywordClean = cleanSearchToken(keyword);
                return (
                    name.includes(keyword) ||
                    slug.includes(keyword) ||
                    description.includes(keyword) ||
                    category.includes(keyword) ||
                    brandSlug.includes(keyword) ||
                    brandName.includes(keyword) ||
                    (sku && sku.includes(keyword)) ||
                    (keywordClean.length > 0 &&
                        (nameClean.includes(keywordClean) ||
                            slugClean.includes(keywordClean) ||
                            descriptionClean.includes(keywordClean) ||
                            categoryClean.includes(keywordClean) ||
                            brandSlugClean.includes(keywordClean) ||
                            brandNameClean.includes(keywordClean) ||
                            skuClean.includes(keywordClean)))
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

    /**
     * Spotlight / catalog cards: ~160–190px wide on mobile (2-col, 100px-tall thumbs),
     * ~22vw tablet / 260–280px desktop. Keep sizes tight so Lighthouse mobile (412)
     * selects 280w instead of 400/800w.
     */
    const PRODUCT_CARD_SIZES = '(max-width: 767px) 160px, (max-width: 1100px) 22vw, 260px';

    /**
     * Homepage Lighthouse offenders only — card WebP derivatives we generated.
     * Other catalog images keep the original src so missing -w400.webp never blanks a card.
     */
    const PRODUCT_CARD_WEBP = {
        '3-in-1-nitric-oxide-booster-id1237-hmherbs-primary': { widths: [400, 800], w: 1000, h: 1089 },
        'standard-enzyme-alpha-gest-ii-id1605-hmherbs-primary': { widths: [400, 800], w: 1280, h: 1280 },
        'advanced-blood-pressure-support-sku-12414-45-hm-advancedbloodpressurecherry-858': { widths: [280, 400], w: 500, h: 600 },
        '5-day-forecast-1600mg-free-shipping-id1238-hmherbs-primary': { widths: [400], w: 500, h: 500 }
    };

    function productImagePath(imageUrl) {
        const raw = String(imageUrl || '').split('?')[0];
        if (!raw) return '';
        try {
            if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname;
        } catch (e) {
            /* keep raw */
        }
        const slash = raw.indexOf('/images/');
        return slash >= 0 ? raw.slice(slash) : raw;
    }

    /**
     * Responsive product-card <img>: width/height (CLS), sizes, lazy, and WebP srcset
     * only when a card derivative is known to exist.
     */
    function applyProductCardImage(img, imageUrl, options) {
        const opts = options || {};
        const src = String(imageUrl || '').trim();
        if (!img || !src) return img;

        img.src = src;
        img.decoding = 'async';
        if (!opts.eager) {
            img.loading = 'lazy';
        } else {
            img.loading = 'eager';
        }

        const path = productImagePath(src);
        const file = path.split('/').pop() || '';
        const stem = file.replace(/\.(jpe?g|png|webp)$/i, '');
        const info = PRODUCT_CARD_WEBP[stem];

        img.width = info ? info.w : 400;
        img.height = info ? info.h : 400;
        img.sizes = opts.sizes || PRODUCT_CARD_SIZES;

        if (info && info.widths && info.widths.length) {
            const dir = path.slice(0, path.lastIndexOf('/') + 1);
            img.srcset = info.widths
                .map((w) => `${dir}${stem}-w${w}.webp ${w}w`)
                .join(', ');
        }

        return img;
    }

    global.hmGetStorefrontApiBase = getStorefrontApiBase;
    global.hmBuildStorefrontApiUrl = buildStorefrontApiUrl;
    global.hmTransformStorefrontProduct = transformApiProduct;
    global.hmProductSearchMatch = matchProducts;
    global.hmFormatProductPrice = formatProductPrice;
    global.hmProductThumbPlaceholder = PRODUCT_THUMB_PLACEHOLDER;
    global.hmApplyProductCardImage = applyProductCardImage;
})(typeof window !== 'undefined' ? window : globalThis);
