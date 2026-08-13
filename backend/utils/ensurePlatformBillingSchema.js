'use strict';

const logger = require('../utils/logger');

async function columnExists(pool, table, column) {
    const [rows] = await pool.execute(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
}

async function applyColumnPatches(pool, table, patches) {
    for (const patch of patches) {
        try {
            if (!(await columnExists(pool, table, patch.column))) {
                await pool.query(patch.sql);
            }
        } catch (e) {
            logger.warn(`Database: ${table}.${patch.column} — ${logger.formatMysqlError(e)}`);
        }
    }
}

const DEFAULT_HARDWARE = [
    {
        sku: 'wti-6500',
        name: 'WTI 6500 standard setup modem',
        price: 250,
        description: '5 Ethernet ports · 4G LTE-A · up to 300/50 Mbps · dual-SIM',
        max_months: 0,
        installment: 0,
        signup_visible: 1,
        sort_order: 1
    },
    {
        sku: 'wti-5419',
        name: 'WTI 5419 premium setup modem',
        price: 500,
        description: '4 Ethernet ports · 5G + LTE · up to 3.4 Gbps down · dual-SIM',
        max_months: 0,
        installment: 0,
        signup_visible: 1,
        sort_order: 2
    }
];

async function ensurePlatformBillingSchema(pool) {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_accounts (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                account_key VARCHAR(64) NOT NULL,
                store_instance_id VARCHAR(64) NULL,
                business_name VARCHAR(200) NULL,
                billing_email VARCHAR(255) NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'trial',
                payment_method_type VARCHAR(16) NOT NULL DEFAULT 'none',
                procharge_token VARCHAR(128) NULL,
                procharge_profile_id VARCHAR(64) NULL,
                ach_customer_uuid VARCHAR(64) NULL,
                billing_authorized_at TIMESTAMP NULL,
                billing_credit_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
                service_comped_until DATE NULL,
                past_due_since TIMESTAMP NULL,
                billing_retry_count INT NOT NULL DEFAULT 0,
                next_billing_retry_at DATE NULL,
                grace_days_override INT NULL,
                next_bill_date DATE NULL,
                last_bill_amount DECIMAL(10,2) NULL,
                last_bill_status VARCHAR(32) NULL,
                last_bill_at TIMESTAMP NULL,
                notes TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_billing_account_key (account_key)
            )`);
    } catch (e) {
        logger.warn(`Database: billing_accounts — ${logger.formatMysqlError(e)}`);
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_subscriptions (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                account_id INT NOT NULL,
                product_type VARCHAR(32) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                config_json JSON NULL,
                monthly_amount_override DECIMAL(10,2) NULL,
                next_bill_date DATE NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_billing_sub_account (account_id),
                KEY idx_billing_sub_type (product_type),
                CONSTRAINT fk_billing_sub_account FOREIGN KEY (account_id)
                    REFERENCES billing_accounts(id) ON DELETE CASCADE
            )`);
    } catch (e) {
        logger.warn(`Database: billing_subscriptions — ${logger.formatMysqlError(e)}`);
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_usage_lines (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                account_id INT NOT NULL,
                period_month CHAR(7) NOT NULL,
                usage_type VARCHAR(32) NOT NULL,
                quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
                amount DECIMAL(10,2) NOT NULL DEFAULT 0,
                label VARCHAR(255) NULL,
                billed_charge_id INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_billing_usage_account (account_id, period_month),
                CONSTRAINT fk_billing_usage_account FOREIGN KEY (account_id)
                    REFERENCES billing_accounts(id) ON DELETE CASCADE
            )`);
    } catch (e) {
        logger.warn(`Database: billing_usage_lines — ${logger.formatMysqlError(e)}`);
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_installment_plans (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                account_id INT NOT NULL,
                sku VARCHAR(64) NOT NULL,
                description VARCHAR(255) NULL,
                total_amount DECIMAL(10,2) NOT NULL,
                months_total INT NOT NULL,
                months_remaining INT NOT NULL,
                monthly_amount DECIMAL(10,2) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                next_due_date DATE NULL,
                hardware_order_ref VARCHAR(64) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_billing_installment_account (account_id),
                CONSTRAINT fk_billing_installment_account FOREIGN KEY (account_id)
                    REFERENCES billing_accounts(id) ON DELETE CASCADE
            )`);
    } catch (e) {
        logger.warn(`Database: billing_installment_plans — ${logger.formatMysqlError(e)}`);
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_charges (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                account_id INT NOT NULL,
                charge_type VARCHAR(32) NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                procharge_transaction_id VARCHAR(64) NULL,
                line_items_json JSON NULL,
                failure_reason VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_billing_charges_account (account_id),
                CONSTRAINT fk_billing_charges_account FOREIGN KEY (account_id)
                    REFERENCES billing_accounts(id) ON DELETE CASCADE
            )`);
    } catch (e) {
        logger.warn(`Database: billing_charges — ${logger.formatMysqlError(e)}`);
    }

    await applyColumnPatches(pool, 'billing_charges', [
        {
            column: 'procharge_approval_code',
            sql: 'ALTER TABLE billing_charges ADD COLUMN procharge_approval_code VARCHAR(32) NULL'
        },
        {
            column: 'refund_method',
            sql: 'ALTER TABLE billing_charges ADD COLUMN refund_method VARCHAR(16) NULL'
        },
        {
            column: 'procharge_refund_transaction_id',
            sql: 'ALTER TABLE billing_charges ADD COLUMN procharge_refund_transaction_id VARCHAR(64) NULL'
        },
        {
            column: 'refunded_at',
            sql: 'ALTER TABLE billing_charges ADD COLUMN refunded_at TIMESTAMP NULL'
        }
    ]);

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_hardware_catalog (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                sku VARCHAR(64) NOT NULL,
                name VARCHAR(200) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                description TEXT NULL,
                installment_eligible TINYINT(1) NOT NULL DEFAULT 0,
                max_installment_months INT NOT NULL DEFAULT 0,
                signup_visible TINYINT(1) NOT NULL DEFAULT 1,
                sort_order INT NOT NULL DEFAULT 0,
                active TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_hardware_sku (sku)
            )`);
    } catch (e) {
        logger.warn(`Database: billing_hardware_catalog — ${logger.formatMysqlError(e)}`);
    }

    await applyColumnPatches(pool, 'billing_hardware_catalog', [
        {
            column: 'description',
            sql: 'ALTER TABLE billing_hardware_catalog ADD COLUMN description TEXT NULL'
        },
        {
            column: 'signup_visible',
            sql: 'ALTER TABLE billing_hardware_catalog ADD COLUMN signup_visible TINYINT(1) NOT NULL DEFAULT 1'
        },
        {
            column: 'sort_order',
            sql: 'ALTER TABLE billing_hardware_catalog ADD COLUMN sort_order INT NOT NULL DEFAULT 0'
        }
    ]);

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_hardware_orders (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                account_id INT NOT NULL,
                charge_id INT NULL,
                sku VARCHAR(64) NOT NULL,
                quantity INT NOT NULL DEFAULT 1,
                total_amount DECIMAL(10,2) NOT NULL,
                ship_name VARCHAR(200) NULL,
                ship_street VARCHAR(255) NULL,
                ship_city VARCHAR(100) NULL,
                ship_state VARCHAR(32) NULL,
                ship_zip VARCHAR(20) NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'pending_fulfillment',
                notes TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_hardware_orders_account (account_id),
                CONSTRAINT fk_hardware_orders_account FOREIGN KEY (account_id)
                    REFERENCES billing_accounts(id) ON DELETE CASCADE
            )`);
    } catch (e) {
        logger.warn(`Database: billing_hardware_orders — ${logger.formatMysqlError(e)}`);
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_build_contracts (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                account_id INT NOT NULL,
                build_tier VARCHAR(32) NOT NULL,
                build_amount DECIMAL(10,2) NOT NULL,
                hosting_tier VARCHAR(32) NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                kickoff_at TIMESTAMP NULL,
                work_started_at TIMESTAMP NULL,
                canceled_at TIMESTAMP NULL,
                cancel_note VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_build_contract_account (account_id),
                CONSTRAINT fk_build_contract_account FOREIGN KEY (account_id)
                    REFERENCES billing_accounts(id) ON DELETE CASCADE
            )`);
    } catch (e) {
        logger.warn(`Database: billing_build_contracts — ${logger.formatMysqlError(e)}`);
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_build_milestones (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                contract_id INT NOT NULL,
                milestone_key VARCHAR(32) NOT NULL,
                label VARCHAR(255) NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                sort_order INT NOT NULL DEFAULT 0,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                work_status VARCHAR(20) NOT NULL DEFAULT 'not_started',
                charge_id INT NULL,
                paid_at TIMESTAMP NULL,
                completed_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_build_milestone_contract (contract_id),
                UNIQUE KEY uq_build_milestone_key (contract_id, milestone_key),
                CONSTRAINT fk_build_milestone_contract FOREIGN KEY (contract_id)
                    REFERENCES billing_build_contracts(id) ON DELETE CASCADE
            )`);
    } catch (e) {
        logger.warn(`Database: billing_build_milestones — ${logger.formatMysqlError(e)}`);
    }

    await applyColumnPatches(pool, 'billing_accounts', [
        {
            column: 'principal_meta_json',
            sql: 'ALTER TABLE billing_accounts ADD COLUMN principal_meta_json JSON NULL'
        }
    ]);

    await applyColumnPatches(pool, 'pos_merchant_license', [
        {
            column: 'billing_account_id',
            sql: 'ALTER TABLE pos_merchant_license ADD COLUMN billing_account_id INT NULL'
        },
        {
            column: 'procharge_token',
            sql: 'ALTER TABLE pos_merchant_license ADD COLUMN procharge_token VARCHAR(128) NULL'
        }
    ]);

    for (const item of DEFAULT_HARDWARE) {
        try {
            await pool.execute(
                `INSERT INTO billing_hardware_catalog
                    (sku, name, price, description, installment_eligible, max_installment_months, signup_visible, sort_order, active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
                 ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    price = VALUES(price),
                    description = VALUES(description),
                    installment_eligible = VALUES(installment_eligible),
                    max_installment_months = VALUES(max_installment_months),
                    signup_visible = VALUES(signup_visible),
                    sort_order = VALUES(sort_order),
                    active = 1`,
                [
                    item.sku,
                    item.name,
                    item.price,
                    item.description || null,
                    item.installment ? 1 : 0,
                    item.max_months || 0,
                    item.signup_visible ? 1 : 0,
                    item.sort_order || 0
                ]
            );
        } catch (e) {
            logger.warn(`Database: billing_hardware_catalog seed — ${logger.formatMysqlError(e)}`);
        }
    }

    try {
        await pool.execute(
            `UPDATE billing_hardware_catalog SET active = 0, signup_visible = 0 WHERE sku NOT LIKE 'wti-%'`
        );
        await pool.execute(
            `UPDATE billing_hardware_catalog SET active = 0, signup_visible = 0 WHERE sku = 'wti-6200'`
        );
    } catch (e) {
        logger.warn(`Database: billing_hardware_catalog deactivate — ${logger.formatMysqlError(e)}`);
    }

    await syncDefaultBillingAccount(pool);
}

async function syncDefaultBillingAccount(pool) {
    try {
        const [accounts] = await pool.execute(
            `SELECT id FROM billing_accounts WHERE account_key = 'default' LIMIT 1`
        );
        let accountId = accounts[0]?.id;
        if (!accountId) {
            const [licenseRows] = await pool.execute(
                `SELECT business_name, billing_email, status FROM pos_merchant_license WHERE id = 1 LIMIT 1`
            );
            const lic = licenseRows[0] || {};
            const [ins] = await pool.execute(
                `INSERT INTO billing_accounts (account_key, business_name, billing_email, status)
                 VALUES ('default', ?, ?, ?)`,
                [lic.business_name || null, lic.billing_email || null, lic.status || 'trial']
            );
            accountId = ins.insertId;
        }

        await pool.execute(
            `UPDATE pos_merchant_license SET billing_account_id = ? WHERE id = 1 AND billing_account_id IS NULL`,
            [accountId]
        );

        const [subs] = await pool.execute(
            `SELECT id FROM billing_subscriptions WHERE account_id = ? AND product_type = 'pos' LIMIT 1`,
            [accountId]
        );
        if (!subs.length) {
            const [lic] = await pool.execute(
                `SELECT licensed_station_count, failover_gb_used FROM pos_merchant_license WHERE id = 1`
            );
            const row = lic[0] || {};
            await pool.execute(
                `INSERT INTO billing_subscriptions (account_id, product_type, status, config_json)
                 VALUES (?, 'pos', 'active', ?)`,
                [
                    accountId,
                    JSON.stringify({
                        stationCount: row.licensed_station_count || 1,
                        failoverGbUsed: row.failover_gb_used || 0
                    })
                ]
            );
        }

        await syncPrincipalAccountRates(pool, accountId);
    } catch (e) {
        logger.warn(`Database: syncDefaultBillingAccount — ${logger.formatMysqlError(e)}`);
    }
}

/** Custom monthly rates for the principal account (e.g. HM Herbs) — never shown on public signup. */
async function syncPrincipalAccountRates(pool, accountId) {
    const accountKey = String(process.env.BILLING_PRINCIPAL_ACCOUNT_KEY || 'default').trim();
    const posMonthly = Number(process.env.BILLING_PRINCIPAL_POS_MONTHLY || 100);
    const hostingMonthly = Number(process.env.BILLING_PRINCIPAL_HOSTING_MONTHLY || 200);

    try {
        const [rows] = await pool.execute(
            `SELECT id FROM billing_accounts WHERE id = ? AND account_key = ? LIMIT 1`,
            [accountId, accountKey]
        );
        if (!rows.length) return;

        const { upsertSubscription } = require('../services/platformBillingAccount');

        await upsertSubscription(pool, accountId, 'pos', {
            status: 'active',
            config: {
                stationCount: 1,
                licensedStationCount: 1,
                label: 'POS'
            },
            monthlyAmountOverride: posMonthly
        });

        await upsertSubscription(pool, accountId, 'hosting', {
            status: 'active',
            config: {
                tier: 'growth',
                label: 'Web hosting'
            },
            monthlyAmountOverride: hostingMonthly
        });

        const { syncPrincipalMeta } = require('../services/principalBilling');
        await syncPrincipalMeta(pool, accountId);
    } catch (e) {
        logger.warn(`Database: syncPrincipalAccountRates — ${logger.formatMysqlError(e)}`);
    }
}

module.exports = { ensurePlatformBillingSchema, syncDefaultBillingAccount, syncPrincipalAccountRates };
