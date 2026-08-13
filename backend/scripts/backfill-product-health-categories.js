#!/usr/bin/env node
'use strict';

/**
 * Backfill product_health_categories from backend/data/complete-scraped-products.json
 * Usage: node backend/scripts/backfill-product-health-categories.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');

loadBackendEnv();

const DRY_RUN = process.argv.includes('--dry-run');
const DATA_FILE = path.join(__dirname, '..', 'data', 'complete-scraped-products.json');

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeKey(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function slugFromProductUrl(url) {
    const match = String(url || '').match(/\/products\/([^/?#]+)/i);
    return match ? match[1].toLowerCase() : '';
}

function skuDigits(sku) {
    return String(sku || '').replace(/\D/g, '');
}

async function loadHealthCategoryMap(pool) {
    const [rows] = await pool.query('SELECT id, name, slug FROM health_categories WHERE is_active = 1');
    const byNorm = new Map();
    for (const row of rows) {
        byNorm.set(normalizeKey(row.name), row.id);
        byNorm.set(normalizeKey(row.slug), row.id);
    }
    // Common scraped labels -> DB taxonomy
    const aliases = {
        menshealth: ['men products', 'mens health', "men's health", 'male'],
        womenshealth: ['women products', 'womens health', "women's health", 'female'],
        digestivehealth: ['digestion', 'digestive health'],
        sleephealth: ['sleep support', 'sleep health'],
        immunesupport: ['immune', 'immune support'],
        jointarthritis: ['joint pain', 'joint & arthritis', 'joint and arthritis'],
        energyvitality: ['energy & vitality', 'energy and vitality'],
        stressanxiety: ['stress & anxiety', 'stress and anxiety'],
        visionhealthsupport: ['eye health', 'vision health support'],
    };
    for (const [norm, labels] of Object.entries(aliases)) {
        const id = byNorm.get(norm);
        if (!id) continue;
        for (const label of labels) {
            byNorm.set(normalizeKey(label), id);
        }
    }
    return byNorm;
}

async function findProductId(pool, item) {
    const urlSlug = slugFromProductUrl(item.url);
    if (urlSlug) {
        const [bySlug] = await pool.execute(
            `SELECT id FROM products
              WHERE is_active = 1
                AND (slug = ? OR slug LIKE ? OR slug LIKE ?)
              ORDER BY (slug = ?) DESC, LENGTH(slug) ASC
              LIMIT 1`,
            [urlSlug, `${urlSlug}%`, `%${urlSlug.replace(/-/g, '%')}%`, urlSlug]
        );
        if (bySlug.length) return bySlug[0].id;
    }

    const digits = skuDigits(item.sku);
    if (digits.length >= 3) {
        const [bySku] = await pool.execute(
            `SELECT id FROM products
              WHERE is_active = 1
                AND (sku LIKE ? OR name LIKE ?)
              LIMIT 1`,
            [`%${digits}%`, `%${digits}%`]
        );
        if (bySku.length) return bySku[0].id;
    }

    const namePrefix = String(item.name || '')
        .replace(/\s*SKU:.*$/i, '')
        .trim()
        .slice(0, 48);
    if (namePrefix.length >= 8) {
        const [byName] = await pool.execute(
            `SELECT id FROM products
              WHERE is_active = 1 AND name LIKE ?
              ORDER BY LENGTH(name) ASC
              LIMIT 1`,
            [`${namePrefix}%`]
        );
        if (byName.length) return byName[0].id;
    }

    return null;
}

async function main() {
    if (!fs.existsSync(DATA_FILE)) {
        console.error('Missing data file:', DATA_FILE);
        process.exit(1);
    }

    const payload = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const products = Array.isArray(payload.products) ? payload.products : [];
    const pool = createPool({ connectionLimit: 4 });
    const hcMap = await loadHealthCategoryMap(pool);

    let matchedProducts = 0;
    let insertedLinks = 0;
    let skippedNoProduct = 0;
    let skippedNoCategories = 0;

    try {
        for (const item of products) {
            const categories = Array.isArray(item.healthCategories)
                ? item.healthCategories.filter(Boolean)
                : [];
            if (!categories.length) {
                skippedNoCategories++;
                continue;
            }

            const productId = await findProductId(pool, item);
            if (!productId) {
                skippedNoProduct++;
                continue;
            }
            matchedProducts++;

            if (!DRY_RUN) {
                await pool.execute('DELETE FROM product_health_categories WHERE product_id = ?', [productId]);
            }

            for (const label of categories) {
                const hcId = hcMap.get(normalizeKey(label)) || hcMap.get(normalizeKey(slugify(label)));
                if (!hcId) continue;
                if (DRY_RUN) {
                    insertedLinks++;
                    continue;
                }
                const [result] = await pool.execute(
                    'INSERT IGNORE INTO product_health_categories (product_id, health_category_id) VALUES (?, ?)',
                    [productId, hcId]
                );
                if (result.affectedRows) insertedLinks++;
            }
        }

        const [[countRow]] = await pool.query('SELECT COUNT(*) AS c FROM product_health_categories');
        console.log(
            JSON.stringify(
                {
                    dryRun: DRY_RUN,
                    sourceProducts: products.length,
                    matchedProducts,
                    linksInserted: insertedLinks,
                    skippedNoProduct,
                    skippedNoCategories,
                    totalLinksInDb: countRow.c,
                },
                null,
                2
            )
        );
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
