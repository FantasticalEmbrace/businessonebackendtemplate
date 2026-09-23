'use strict';

/**
 * Server-rendered Product JSON-LD for /product.html.
 *
 * Google Merchant website crawl requires structured data in the initial HTML
 * (not JS-injected). Product.sku / productID become the Merchant offer id, so
 * the supplemental feed id column must use the same value (catalog SKU).
 *
 * Seller Organization name comes from store branding / env — never a hard-coded
 * single-merchant brand.
 */

const fs = require('fs/promises');
const path = require('path');
const { STOREFRONT_VISIBLE_WHERE } = require('../utils/storefrontProductVisibility');
const { sanitizeLegacyProductImageUrl } = require('../utils/catalogOverrides');
const { getStorefrontPublicBaseUrl } = require('../utils/storefrontUrl');
const { toAbsoluteUrl, productLink } = require('./googleMerchantProductFeed');
const { resolveStoreBranding } = require('./storeBranding');

const JSONLD_SCRIPT_ID = 'product-jsonld-ssr';
const MAX_SCHEMA_IMAGES = 11;

function stripHtml(text) {
    return String(text || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function availabilityUrl(row) {
    if (row.track_inventory === 0 || row.track_inventory === false || row.track_inventory === '0') {
        return 'https://schema.org/InStock';
    }
    const qty = Number(row.inventory_quantity);
    if (Number.isFinite(qty) && qty <= 0) return 'https://schema.org/OutOfStock';
    return 'https://schema.org/InStock';
}

/**
 * Build schema.org Product + Offer for Merchant / Search crawl.
 * Offer id in Merchant Center = sku (also mirrored as productID).
 *
 * @param {object} product
 * @param {Array<{ image_url?: string, is_primary?: any, sort_order?: any }>} imageRows
 * @param {{ baseUrl?: string, sellerName?: string }} [opts]
 */
function buildProductJsonLd(product, imageRows = [], opts = {}) {
    const baseUrl = String(opts.baseUrl || getStorefrontPublicBaseUrl()).replace(/\/+$/, '');
    const sku = String(product.sku || '').trim();
    if (!sku) return null;

    const slug = String(product.slug || '').trim();
    const url = productLink(baseUrl, slug) || `${baseUrl}/product.html`;
    const sellerName =
        String(opts.sellerName || process.env.STORE_NAME || process.env.POS_STORE_NAME || 'Store').trim() ||
        'Store';

    const ordered = [...(imageRows || [])].sort((a, b) => {
        const ap = a.is_primary ? 1 : 0;
        const bp = b.is_primary ? 1 : 0;
        if (bp !== ap) return bp - ap;
        return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });

    const images = [];
    const seen = new Set();
    for (const row of ordered) {
        const sanitized = sanitizeLegacyProductImageUrl(row.image_url, product.slug, product.sku);
        const abs = toAbsoluteUrl(baseUrl, sanitized);
        if (!abs || seen.has(abs)) continue;
        seen.add(abs);
        images.push(abs);
        if (images.length >= MAX_SCHEMA_IMAGES) break;
    }

    const selling = Number(product.price);
    const hasSelling = Number.isFinite(selling) && selling > 0;
    const description =
        stripHtml(product.short_description) ||
        stripHtml(product.meta_description) ||
        stripHtml(product.long_description) ||
        stripHtml(product.name);

    const schema = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: String(product.name || '').trim(),
        description,
        sku,
        productID: sku,
        url,
        offers: {
            '@type': 'Offer',
            url,
            priceCurrency: 'USD',
            price: hasSelling ? selling.toFixed(2) : undefined,
            availability: availabilityUrl(product),
            itemCondition: 'https://schema.org/NewCondition',
            seller: {
                '@type': 'Organization',
                name: sellerName,
            },
        },
    };

    if (images.length === 1) schema.image = images[0];
    else if (images.length > 1) schema.image = images;

    if (product.brand_name) {
        schema.brand = { '@type': 'Brand', name: String(product.brand_name) };
    }

    return schema;
}

function injectJsonLdIntoHtml(html, schema) {
    if (!schema || !html) return html;
    const json = JSON.stringify(schema).replace(/</g, '\\u003c');
    const tag = `<script type="application/ld+json" id="${JSONLD_SCRIPT_ID}">${json}</script>`;
    const existing = new RegExp(
        `<script\\b[^>]*\\bid=["']${JSONLD_SCRIPT_ID}["'][^>]*>[\\s\\S]*?<\\/script>`,
        'i'
    );
    if (existing.test(html)) {
        return html.replace(existing, tag);
    }
    if (/<\/head>/i.test(html)) {
        return html.replace(/<\/head>/i, `    ${tag}\n</head>`);
    }
    return `${tag}\n${html}`;
}

/**
 * Load storefront product + images by slug (or numeric id) for SSR markup.
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} slugOrId
 */
async function loadStorefrontProductForJsonLd(pool, slugOrId) {
    const raw = String(slugOrId || '').trim();
    if (!raw) return null;
    const isNumericId = /^\d+$/.test(raw);
    const idParam = isNumericId ? Number(raw) : -1;

    const [rows] = await pool.execute(
        `SELECT p.id, p.sku, p.slug, p.name, p.short_description, p.long_description,
                p.meta_description, p.price, p.compare_price, p.inventory_quantity, p.track_inventory,
                b.name AS brand_name
           FROM products p
           LEFT JOIN brands b ON b.id = p.brand_id
          WHERE p.is_active = 1
            AND ${STOREFRONT_VISIBLE_WHERE}
            AND (p.slug = ? OR p.id = ?)
          LIMIT 1`,
        [raw, idParam]
    );
    if (!rows.length) return null;
    const product = rows[0];
    if (!String(product.sku || '').trim()) return null;

    const { enrichProductListPricesFromVariants } = require('../utils/storefrontProductPrice');
    await enrichProductListPricesFromVariants(pool, [product]);

    const [imageRows] = await pool.execute(
        `SELECT image_url, is_primary, sort_order
           FROM product_images
          WHERE product_id = ?
          ORDER BY is_primary DESC, sort_order ASC, id ASC`,
        [product.id]
    );
    return { product, imageRows: imageRows || [] };
}

/**
 * Render product.html with Product JSON-LD for Merchant crawl offer-id = SKU.
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ rootPath: string, slug: string, baseUrl?: string, sellerName?: string }} opts
 * @returns {Promise<{ html: string, sku: string } | null>}
 */
async function renderProductHtmlWithJsonLd(pool, opts) {
    const rootPath = opts.rootPath;
    const slug = String(opts.slug || '').trim();
    if (!rootPath || !slug) return null;

    const loaded = await loadStorefrontProductForJsonLd(pool, slug);
    if (!loaded) return null;

    let sellerName = String(opts.sellerName || '').trim();
    if (!sellerName) {
        try {
            const branding = await resolveStoreBranding(pool);
            sellerName = String(branding?.storeName || '').trim();
        } catch (_) {
            sellerName = '';
        }
    }

    const schema = buildProductJsonLd(loaded.product, loaded.imageRows, {
        baseUrl: opts.baseUrl,
        sellerName,
    });
    if (!schema) return null;

    const filePath = path.join(rootPath, 'product.html');
    const rawHtml = await fs.readFile(filePath, 'utf8');
    const html = injectJsonLdIntoHtml(rawHtml, schema);
    return { html, sku: schema.sku };
}

module.exports = {
    JSONLD_SCRIPT_ID,
    MAX_SCHEMA_IMAGES,
    buildProductJsonLd,
    injectJsonLdIntoHtml,
    loadStorefrontProductForJsonLd,
    renderProductHtmlWithJsonLd,
};
