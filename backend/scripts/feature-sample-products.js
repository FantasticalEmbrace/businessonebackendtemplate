#!/usr/bin/env node
/**
 * Restore the locally configured homepage spotlight (is_featured products).
 * Spotlight is normally set in Admin → Products (is_featured checkbox).
 * This script only re-applies the owner's chosen set after an accidental overwrite.
 *
 * Usage (from backend/):
 *   node scripts/feature-sample-products.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadBackendEnv, createConnection } = require('../utils/dbConfig');
loadBackendEnv();

const REPO_ROOT = path.join(__dirname, '..', '..');
const IMAGES_DIR = path.join(REPO_ROOT, 'images', 'products');

/** Owner's spotlight — order preserved for homepage grid. */
const SPOTLIGHT_MATCHERS = [
    {
        exactSlugs: ['advanced-blood-pressure-support', 'advanced-blood-pressure-support-sku-12414'],
        slugLike: 'advanced-blood-pressure%'
    },
    {
        exactSlugs: ['3-in-1-nitric-oxide-booster', '3-in-1-nitric-oxide-booster-sku-27967'],
        slugLike: '3-in-1-nitric-oxide%'
    },
    {
        exactSlugs: ['cardio-amaze-nitric-oxide', 'cardio-amaze-nitric-oxide-sku-00060'],
        slugLike: 'cardio-amaze-nitric%'
    },
    {
        exactSlugs: ['organic-beetroot-powder', 'organic-beetroot-powder-sku-02966'],
        slugLike: 'organic-beetroot%'
    }
];

async function findSpotlightProduct(conn, matcher) {
    const exactPh = matcher.exactSlugs.map(() => '?').join(',');
    const [exactRows] = await conn.query(
        `SELECT p.id, p.name, p.slug, pi.image_url
         FROM products p
         LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
         WHERE p.slug IN (${exactPh})
           AND p.is_active = 1
           AND p.show_on_web = 1
         LIMIT 1`,
        matcher.exactSlugs
    );
    if (exactRows.length) return exactRows[0];

    const [likeRows] = await conn.query(
        `SELECT p.id, p.name, p.slug, pi.image_url
         FROM products p
         LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
         WHERE p.slug LIKE ?
           AND p.is_active = 1
           AND p.show_on_web = 1
         ORDER BY p.id
         LIMIT 1`,
        [matcher.slugLike]
    );
    return likeRows[0] || null;
}

function slugImageStem(slug) {
    return String(slug || '')
        .replace(/-sku-.*$/i, '')
        .replace(/-id\d+.*$/i, '');
}

function findLocalImageFile(slug) {
    let files;
    try {
        files = fs.readdirSync(IMAGES_DIR);
    } catch {
        return null;
    }
    const stem = slugImageStem(slug);
    const match = files.find(
        (f) =>
            f.startsWith(stem) &&
            /\.(jpe?g|png|webp)$/i.test(f) &&
            fs.statSync(path.join(IMAGES_DIR, f)).size > 500
    );
    return match ? `/images/products/${match}` : null;
}

function isRemoteOnlyImage(url) {
    if (!url) return true;
    if (url.startsWith('/images/products/')) return false;
    return /^https?:\/\//i.test(url) || url.startsWith('//');
}

async function ensurePrimaryImage(conn, product) {
    const localUrl = findLocalImageFile(product.slug);
    const needsLocal =
        localUrl && (isRemoteOnlyImage(product.image_url) || !product.image_url);
    if (!needsLocal) return product.image_url || null;
    const publicUrl = localUrl;

    const [existing] = await conn.query(
        'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1 LIMIT 1',
        [product.id]
    );
    const alt = (product.name || '').substring(0, 500);
    if (existing.length) {
        await conn.query('UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?', [
            publicUrl,
            alt,
            existing[0].id
        ]);
    } else {
        await conn.query(
            'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
            [product.id, publicUrl, alt]
        );
    }
    return publicUrl;
}

(async () => {
    const conn = await createConnection();
    try {
        const ordered = [];
        for (const matcher of SPOTLIGHT_MATCHERS) {
            const row = await findSpotlightProduct(conn, matcher);
            if (row) {
                row.image_url = await ensurePrimaryImage(conn, row);
                ordered.push(row);
            }
        }

        if (!ordered.length) {
            console.log('featured_products 0 (spotlight slugs not found)');
            return;
        }

        await conn.query('UPDATE products SET is_featured = 0');
        const ids = ordered.map((r) => r.id);
        const idPh = ids.map(() => '?').join(',');
        await conn.query(`UPDATE products SET is_featured = 1 WHERE id IN (${idPh})`, ids);

        console.log(
            'featured_products',
            ordered.length,
            ordered.map((r) => ({ id: r.id, name: r.name, image: r.image_url }))
        );
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
