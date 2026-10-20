'use strict';

const logger = require('./logger');
const { CBD_PRODUCT_SLUGS, CATEGORY_SLUG } = require('./cbdProductSlugs');

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

/**
 * Ensures the CBD category rows exist. Does not move products, set flags, or
 * change health tags — staff assign those in admin.
 * @param {import('mysql2/promise').Pool} pool
 */
async function ensureCbdCategory(pool) {
    if (!(await tableExists(pool, 'product_categories'))) return;
    if (!(await tableExists(pool, 'health_categories'))) return;

    try {
        await ensureProductCategory(pool);
        await ensureHealthCategory(pool);
    } catch (err) {
        logger.warn(`[cbd-category] ensure skipped or partial — ${logger.formatMysqlError(err)}`);
    }
}

module.exports = { ensureCbdCategory, CATEGORY_SLUG, CBD_PRODUCT_SLUGS };
