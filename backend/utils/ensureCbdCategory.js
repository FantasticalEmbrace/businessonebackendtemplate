'use strict';

const logger = require('./logger');
const { CBD_PRODUCT_SLUGS, CATEGORY_SLUG } = require('./cbdProductSlugs');
const { applyProductCoaMap } = require('./applyProductCoaMap');

async function tableExists(pool, tableName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return Number(rows[0].c) > 0;
}

async function ensureProductCategory(pool) {
    const [[existing]] = await pool.execute(
        'SELECT id FROM product_categories WHERE slug = ? LIMIT 1',
        [CATEGORY_SLUG]
    );
    if (existing?.id) return existing.id;

    const [r] = await pool.execute(
        `INSERT INTO product_categories (name, slug, description, sort_order, is_active)
         VALUES ('CBD', ?, 'Hemp-derived CBD oils, gummies, topicals, and wellness products', 16, 1)`,
        [CATEGORY_SLUG]
    );
    logger.info('[cbd-category] Created CBD product category');
    return r.insertId;
}

async function ensureHealthCategory(pool) {
    const [[existing]] = await pool.execute(
        'SELECT id FROM health_categories WHERE slug = ? LIMIT 1',
        [CATEGORY_SLUG]
    );
    if (existing?.id) return existing.id;

    const [r] = await pool.execute(
        `INSERT INTO health_categories (name, slug, description, sort_order, is_active)
         VALUES ('CBD', ?, 'Premium hemp and CBD products for natural wellness support', 0, 1)`,
        [CATEGORY_SLUG]
    );
    logger.info('[cbd-category] Created CBD health category');
    return r.insertId;
}

async function findCbdProductIds(pool) {
    const slugPlaceholders = CBD_PRODUCT_SLUGS.map(() => '?').join(', ');
    const [rows] = await pool.query(
        `SELECT DISTINCT id FROM products
         WHERE is_active = 1 AND (
            slug IN (${slugPlaceholders})
            OR is_cannabis = 1
            OR LOWER(name) LIKE '%cbd%'
            OR LOWER(name) LIKE '%cannabis%'
            OR LOWER(slug) LIKE '%cbd%'
            OR LOWER(slug) LIKE '%cannabis%'
            OR LOWER(slug) LIKE '%delta-9%'
            OR LOWER(slug) LIKE '%hemp-gumm%'
         )`,
        CBD_PRODUCT_SLUGS
    );
    return rows.map((row) => row.id);
}

async function assignProducts(pool, productCategoryId, healthCategoryId) {
    const productIds = await findCbdProductIds(pool);
    if (!productIds.length) return 0;

    const idPlaceholders = productIds.map(() => '?').join(', ');
    await pool.execute(
        `UPDATE products SET category_id = ?, is_cannabis = 1 WHERE id IN (${idPlaceholders})`,
        [productCategoryId, ...productIds]
    );

    for (const productId of productIds) {
        await pool.execute(
            `INSERT IGNORE INTO product_health_categories (product_id, health_category_id) VALUES (?, ?)`,
            [productId, healthCategoryId]
        );
    }

    return productIds.length;
}

/**
 * Ensures the CBD category exists and assigns hemp/CBD products to it.
 * @param {import('mysql2/promise').Pool} pool
 */
async function ensureCbdCategory(pool) {
    if (!(await tableExists(pool, 'products'))) return;
    if (!(await tableExists(pool, 'product_categories'))) return;
    if (!(await tableExists(pool, 'health_categories'))) return;
    if (!(await tableExists(pool, 'product_health_categories'))) return;

    try {
        const productCategoryId = await ensureProductCategory(pool);
        const healthCategoryId = await ensureHealthCategory(pool);
        const count = await assignProducts(pool, productCategoryId, healthCategoryId);
        if (count > 0) {
            logger.info(`[cbd-category] Assigned ${count} product(s) to CBD category`);
        }

        const coaResult = await applyProductCoaMap(pool);
        if (coaResult.applied > 0) {
            logger.info(
                `[cbd-category] Applied COA URLs to ${coaResult.applied} product(s) (${coaResult.skipped} already had COA)`
            );
        }
    } catch (err) {
        logger.warn(`[cbd-category] seed skipped or partial — ${logger.formatMysqlError(err)}`);
    }
}

module.exports = { ensureCbdCategory, CATEGORY_SLUG, CBD_PRODUCT_SLUGS };
