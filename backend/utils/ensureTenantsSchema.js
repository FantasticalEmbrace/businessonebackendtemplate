'use strict';

const crypto = require('crypto');
const logger = require('./logger');

function tenancyShared() {
    const v = String(process.env.MERCHANT_TENANCY || process.env.MERCHANT_ACCOUNTS_ENABLED || '')
        .trim()
        .toLowerCase();
    return v === 'shared' || v === 'true' || v === '1';
}

async function columnExists(pool, tableName, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows[0].c) > 0;
}

async function tableExists(pool, tableName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return Number(rows[0].c) > 0;
}

async function ensureMerchantIdColumn(pool, tableName) {
    if (!(await tableExists(pool, tableName))) return;
    if (await columnExists(pool, tableName, 'merchant_id')) return;
    try {
        await pool.query(
            `ALTER TABLE \`${tableName}\`
             ADD COLUMN merchant_id VARCHAR(36) NULL,
             ADD INDEX idx_${tableName}_merchant (merchant_id)`
        );
        logger.info(`Database: ${tableName} added merchant_id`);
    } catch (e) {
        if (e?.errno === 1060) return;
        logger.warn(`Database: merchant_id on ${tableName} — ${e.message}`);
    }
}

/**
 * Shared-schema tenancy tables + merchant_id on POS-critical tables.
 */
async function ensureTenantsSchema(pool) {
    if (!tenancyShared()) {
        logger.info('Merchant tenancy: single-store mode (MERCHANT_TENANCY not shared)');
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS platform_merchants (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            slug VARCHAR(64) NOT NULL,
            business_name VARCHAR(200) NOT NULL,
            billing_email VARCHAR(255) NOT NULL DEFAULT '',
            website_origin VARCHAR(500) NOT NULL DEFAULT '',
            status ENUM('active','suspended') NOT NULL DEFAULT 'active',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_platform_merchants_slug (slug),
            UNIQUE KEY uq_platform_merchants_email (billing_email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS platform_merchant_keys (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            merchant_id VARCHAR(36) NOT NULL,
            kind ENUM('website_key','device_key') NOT NULL,
            key_hash CHAR(64) NOT NULL,
            key_prefix VARCHAR(24) NOT NULL,
            label VARCHAR(120) NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_platform_merchant_key_hash (key_hash),
            KEY idx_platform_merchant_keys_merchant (merchant_id),
            CONSTRAINT fk_platform_merchant_keys_merchant
                FOREIGN KEY (merchant_id) REFERENCES platform_merchants(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const tables = [
        'products',
        'orders',
        'order_items',
        'pos_devices',
        'admin_users',
        'users',
        'product_categories',
        'brands',
        'pos_equipment',
        'store_settings'
    ];
    for (const t of tables) {
        await ensureMerchantIdColumn(pool, t);
    }

    logger.info('Merchant tenancy: shared-schema tables ready');
}

function hashTenantSecret(value) {
    const pepper = String(
        process.env.MERCHANT_TENANCY_PEPPER || process.env.JWT_SECRET || 'bo-tenant-local'
    ).trim();
    return crypto.createHash('sha256').update(`${pepper}:${String(value || '')}`).digest('hex');
}

function randomId() {
    return crypto.randomUUID();
}

function slugify(input) {
    const base = String(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return base || `shop-${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = {
    tenancyShared,
    ensureTenantsSchema,
    hashTenantSecret,
    randomId,
    slugify
};
