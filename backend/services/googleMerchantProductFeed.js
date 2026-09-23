'use strict';

/**
 * Read-only Google Merchant product feed builder.
 *
 * SAFETY: Only emits image URLs already stored in `product_images` for that
 * product_id. Never invents, scrapes, folder-matches, or cross-attaches images.
 * Does not write to the database or filesystem.
 *
 * Brand / store domain come from store branding + STOREFRONT_PUBLIC_URL (or opts),
 * not a hard-coded merchant domain.
 *
 * Offer matching: `id` MUST equal the Product.sku / productID emitted in PDP
 * JSON-LD (see productPageJsonLd.js). Google Merchant website-crawl primary
 * sources use that sku as the offer identifier.
 *
 * Pricing: parent `products.price`, with primary variant fallback when parent is
 * missing/zero. Google `price` is always a positive `12.99 USD` value; on sale,
 * regular goes in `price` and the discounted amount in `sale_price`.
 *
 * Shipping: offer-level `shipping` + `free_shipping_threshold` match checkout
 * (`FREE_SHIPPING_THRESHOLD` / flat first-class rate from shippingConfig). US only.
 */

const { STOREFRONT_VISIBLE_WHERE } = require('../utils/storefrontProductVisibility');
const { sanitizeLegacyProductImageUrl } = require('../utils/catalogOverrides');
const { getStorefrontPublicBaseUrl } = require('../utils/storefrontUrl');
const { enrichProductListPricesFromVariants } = require('../utils/storefrontProductPrice');
const { getShippingConfig } = require('../config/shippingConfig');
const { resolveStoreBranding } = require('./storeBranding');

/** Google allows 1 image_link + up to 10 additional_image_link. */
const MAX_ADDITIONAL_IMAGES = 10;

/**
 * Standard USPS transit (business days) — matches typical Standard checkout copy
 * ("3–7 business days"). US only. Service label is generic, not store-branded.
 */
const FEED_SHIPPING_MIN_TRANSIT_DAYS = 3;
const FEED_SHIPPING_MAX_TRANSIT_DAYS = 7;
const FEED_SHIPPING_SERVICE = 'USPS Standard';

/**
 * Offer-level shipping for Google Merchant TSV.
 * Cost + free threshold come from the same env as checkout (`shippingConfig`).
 * Format: https://support.google.com/merchants/answer/6324484
 * free_shipping_threshold: https://support.google.com/merchants/answer/14768922
 */
function buildFeedShippingFields() {
    const cfg = getShippingConfig();
    const threshold = Number(cfg.FREE_SHIPPING_THRESHOLD);
    const flat = Math.max(
        Number(cfg.FIRST_CLASS_SHIPPING) || 0,
        Number(cfg.MIN_PAID_SHIPPING_RATE) || 0
    );
    const price = Number.isFinite(flat) && flat > 0 ? flat.toFixed(2) : '0.00';
    const freeAt =
        Number.isFinite(threshold) && threshold > 0 ? threshold.toFixed(2) : '0.00';

    return {
        shipping: `US:${FEED_SHIPPING_SERVICE}:${price} USD:${FEED_SHIPPING_MIN_TRANSIT_DAYS}:${FEED_SHIPPING_MAX_TRANSIT_DAYS}`,
        freeShippingThreshold: `US:${freeAt} USD`,
    };
}

function stripHtml(text) {
    return String(text || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeTsvCell(value) {
    return String(value == null ? '' : value)
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/\t/g, ' ')
        .trim();
}

function toAbsoluteUrl(base, url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    const origin = String(base || '').replace(/\/+$/, '');
    if (!origin) return raw;
    return raw.startsWith('/') ? `${origin}${raw}` : `${origin}/${raw}`;
}

function productLink(base, slug) {
    const s = String(slug || '').trim();
    if (!s) return '';
    return `${String(base).replace(/\/+$/, '')}/product.html?slug=${encodeURIComponent(s)}`;
}

/** Google requires amount > 0 with ISO 4217 currency, e.g. `12.99 USD`. */
function moneyWithCurrency(price) {
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) return '';
    return `${n.toFixed(2)} USD`;
}

/**
 * Resolve Google price + optional sale_price from storefront fields.
 * @returns {{ price: string, salePrice: string } | null}
 */
function resolveFeedPrices(product) {
    const selling = Number(product && product.price);
    if (!Number.isFinite(selling) || selling <= 0) return null;

    const compare = Number(product && product.compare_price);
    const onSale = Number.isFinite(compare) && compare > selling;

    if (onSale) {
        return {
            price: moneyWithCurrency(compare),
            salePrice: moneyWithCurrency(selling),
        };
    }

    return {
        price: moneyWithCurrency(selling),
        salePrice: '',
    };
}

function availabilityForRow(row) {
    if (row.track_inventory === 0 || row.track_inventory === false || row.track_inventory === '0') {
        return 'in_stock';
    }
    const qty = Number(row.inventory_quantity);
    if (Number.isFinite(qty) && qty <= 0) return 'out_of_stock';
    return 'in_stock';
}

/**
 * Split product_images rows for one product into primary + additional (same product_id only).
 * @param {Array<{ image_url: string, is_primary?: any, sort_order?: any, id?: any }>} imageRows
 * @param {{ slug?: string, sku?: string }} product
 * @param {string} baseUrl
 */
function pickImagesForProduct(imageRows, product, baseUrl) {
    const ordered = [...(imageRows || [])].sort((a, b) => {
        const ap = a.is_primary ? 1 : 0;
        const bp = b.is_primary ? 1 : 0;
        if (bp !== ap) return bp - ap;
        const as = Number(a.sort_order);
        const bs = Number(b.sort_order);
        const aOrd = Number.isFinite(as) ? as : 0;
        const bOrd = Number.isFinite(bs) ? bs : 0;
        if (aOrd !== bOrd) return aOrd - bOrd;
        return Number(a.id || 0) - Number(b.id || 0);
    });

    const urls = [];
    const seen = new Set();
    for (const row of ordered) {
        const sanitized = sanitizeLegacyProductImageUrl(
            row.image_url,
            product.slug,
            product.sku
        );
        const abs = toAbsoluteUrl(baseUrl, sanitized);
        if (!abs || seen.has(abs)) continue;
        seen.add(abs);
        urls.push(abs);
    }

    if (!urls.length) {
        return { imageLink: '', additional: [] };
    }
    return {
        imageLink: urls[0],
        additional: urls.slice(1, 1 + MAX_ADDITIONAL_IMAGES),
    };
}

/**
 * Build Google Merchant TSV from live catalog (READ ONLY).
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ baseUrl?: string, defaultBrand?: string }} [opts]
 * @returns {Promise<{ tsv: string, productCount: number, multiImageCount: number, skippedNoPrice: number }>}
 */
async function buildGoogleMerchantProductFeedTsv(pool, opts = {}) {
    const baseUrl = String(opts.baseUrl || getStorefrontPublicBaseUrl()).replace(/\/+$/, '');
    let defaultBrand = String(opts.defaultBrand || '').trim();
    if (!defaultBrand) {
        try {
            const branding = await resolveStoreBranding(pool);
            defaultBrand = String(branding?.storeName || '').trim();
        } catch (_) {
            defaultBrand = '';
        }
    }
    if (!defaultBrand) {
        defaultBrand =
            String(process.env.STORE_NAME || process.env.POS_STORE_NAME || 'Store').trim() || 'Store';
    }

    const [products] = await pool.execute(
        `SELECT p.id, p.sku, p.slug, p.name, p.short_description, p.long_description,
                p.price, p.compare_price, p.inventory_quantity, p.track_inventory,
                b.name AS brand_name
           FROM products p
           LEFT JOIN brands b ON b.id = p.brand_id
          WHERE p.is_active = 1
            AND ${STOREFRONT_VISIBLE_WHERE}
            AND p.sku IS NOT NULL
            AND TRIM(p.sku) <> ''
          ORDER BY p.id ASC`
    );

    if (!products.length) {
        const header = buildHeaderRow(0);
        return { tsv: `${header}\n`, productCount: 0, multiImageCount: 0, skippedNoPrice: 0 };
    }

    await enrichProductListPricesFromVariants(pool, products);

    const ids = products.map((p) => p.id);
    const placeholders = ids.map(() => '?').join(',');
    const [imageRows] = await pool.execute(
        `SELECT id, product_id, image_url, is_primary, sort_order
           FROM product_images
          WHERE product_id IN (${placeholders})
          ORDER BY product_id ASC, is_primary DESC, sort_order ASC, id ASC`,
        ids
    );

    /** @type {Map<number, typeof imageRows>} */
    const imagesByProductId = new Map();
    for (const row of imageRows || []) {
        const pid = Number(row.product_id);
        if (!imagesByProductId.has(pid)) imagesByProductId.set(pid, []);
        imagesByProductId.get(pid).push(row);
    }

    let maxAdditional = 0;
    let skippedNoPrice = 0;
    const prepared = [];
    for (const product of products) {
        const imgs = imagesByProductId.get(Number(product.id)) || [];
        const { imageLink, additional } = pickImagesForProduct(imgs, product, baseUrl);
        if (!imageLink) continue;

        const priced = resolveFeedPrices(product);
        if (!priced || !priced.price) {
            skippedNoPrice += 1;
            continue;
        }

        if (additional.length > maxAdditional) maxAdditional = additional.length;
        prepared.push({ product, imageLink, additional, priced });
    }

    const ship = buildFeedShippingFields();
    const header = buildHeaderRow(maxAdditional);
    const lines = [header];
    let multiImageCount = 0;

    for (const item of prepared) {
        const { product, imageLink, additional, priced } = item;
        if (additional.length > 0) multiImageCount += 1;

        const description =
            stripHtml(product.short_description) ||
            stripHtml(product.long_description) ||
            stripHtml(product.name);

        // Required attrs before additional images so positional mappers still see price.
        const cells = [
            escapeTsvCell(product.sku),
            escapeTsvCell(product.name),
            escapeTsvCell(description),
            escapeTsvCell(productLink(baseUrl, product.slug)),
            escapeTsvCell(imageLink),
            escapeTsvCell(availabilityForRow(product)),
            escapeTsvCell(priced.price),
            escapeTsvCell(priced.salePrice),
            escapeTsvCell(product.brand_name || defaultBrand),
            'new',
            escapeTsvCell(ship.shipping),
            escapeTsvCell(ship.freeShippingThreshold),
        ];
        for (let i = 0; i < maxAdditional; i += 1) {
            cells.push(escapeTsvCell(additional[i] || ''));
        }
        lines.push(cells.join('\t'));
    }

    return {
        tsv: `${lines.join('\n')}\n`,
        productCount: prepared.length,
        multiImageCount,
        skippedNoPrice,
    };
}

function buildHeaderRow(additionalCount) {
    const cols = [
        'id',
        'title',
        'description',
        'link',
        'image_link',
        'availability',
        'price',
        'sale_price',
        'brand',
        'condition',
        'shipping(country:service:price:min_transit_time:max_transit_time)',
        'free_shipping_threshold(country:price_threshold)',
    ];
    for (let i = 0; i < additionalCount; i += 1) {
        cols.push('additional_image_link');
    }
    return cols.join('\t');
}

module.exports = {
    MAX_ADDITIONAL_IMAGES,
    FEED_SHIPPING_MIN_TRANSIT_DAYS,
    FEED_SHIPPING_MAX_TRANSIT_DAYS,
    FEED_SHIPPING_SERVICE,
    buildFeedShippingFields,
    buildGoogleMerchantProductFeedTsv,
    pickImagesForProduct,
    toAbsoluteUrl,
    productLink,
    moneyWithCurrency,
    resolveFeedPrices,
};
