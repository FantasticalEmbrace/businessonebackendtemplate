'use strict';

const logger = require('./logger');

const ORDER_PATCHES = [
    {
        column: 'pos_client_transaction_id',
        sql: `ALTER TABLE orders ADD COLUMN pos_client_transaction_id VARCHAR(64) NULL
              COMMENT 'Idempotency key from Business One POS offline queue'`
    },
    {
        column: 'pos_device_id',
        sql: `ALTER TABLE orders ADD COLUMN pos_device_id VARCHAR(64) NULL
              COMMENT 'Register/device identifier from POS'`
    }
];

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

function isDuplicateError(e) {
    return e?.errno === 1060 || e?.code === 'ER_DUP_FIELDNAME' || /duplicate column/i.test(e?.message || '');
}

async function applyColumnPatches(pool, tableName, patches) {
    if (!(await tableExists(pool, tableName))) return;
    for (const { column, sql } of patches) {
        try {
            if (await columnExists(pool, tableName, column)) continue;
            await pool.query(sql);
            logger.info(`Database: ${tableName} added column ${column}`);
        } catch (e) {
            if (isDuplicateError(e)) continue;
            logger.warn(`Database: POS patch failed — ${logger.formatMysqlError(e)}`);
        }
    }
}

async function ensurePosIndex(pool) {
    if (!(await columnExists(pool, 'orders', 'pos_client_transaction_id'))) return;
    try {
        await pool.query(
            `CREATE UNIQUE INDEX idx_orders_pos_client_tx ON orders (pos_client_transaction_id)`
        );
        logger.info('Database: orders added index idx_orders_pos_client_tx');
    } catch (e) {
        if (e?.errno === 1061 || /duplicate key/i.test(e?.message || '')) return;
        logger.warn(`Database: POS index patch failed — ${logger.formatMysqlError(e)}`);
    }
}

async function ensurePosSchema(pool) {
    await applyColumnPatches(pool, 'orders', ORDER_PATCHES);
    await ensurePosIndex(pool);
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_display_snapshots (
                device_id VARCHAR(64) NOT NULL PRIMARY KEY,
                payload JSON NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
    } catch (e) {
        logger.warn(`Database: pos_display_snapshots — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_checkout_intents (
                id CHAR(36) NOT NULL PRIMARY KEY,
                device_id VARCHAR(64) NOT NULL,
                employee_id INT NULL,
                status VARCHAR(24) NOT NULL DEFAULT 'awaiting',
                amount DECIMAL(10,2) NOT NULL,
                cart_json JSON NULL,
                checkout_mode VARCHAR(24) NULL,
                auth_code VARCHAR(64) NULL,
                last_four CHAR(4) NULL,
                card_brand VARCHAR(32) NULL,
                nmi_transaction_id VARCHAR(64) NULL,
                error_message VARCHAR(500) NULL,
                expires_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_pos_checkout_device (device_id),
                INDEX idx_pos_checkout_status (status)
            )`);
    } catch (e) {
        logger.warn(`Database: pos_checkout_intents — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            ALTER TABLE pos_checkout_intents
            ADD COLUMN checkout_mode VARCHAR(24) NULL AFTER cart_json
        `);
    } catch (e) {
        if (!String(e.message || '').includes('Duplicate column')) {
            logger.warn(`Database: pos_checkout_intents checkout_mode — ${logger.formatMysqlError(e)}`);
        }
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_display_ads (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(120) NULL,
                subtitle VARCHAR(240) NULL,
                image_url VARCHAR(500) NOT NULL,
                link_url VARCHAR(500) NULL,
                source_label VARCHAR(120) NULL,
                sort_order INT NOT NULL DEFAULT 0,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                starts_at TIMESTAMP NULL,
                ends_at TIMESTAMP NULL,
                created_by INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_pos_display_ads_active (is_active, sort_order)
            )`);
    } catch (e) {
        logger.warn(`Database: pos_display_ads — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_display_ad_assignments (
                equipment_id INT NOT NULL,
                ad_id INT NOT NULL,
                sort_order INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (equipment_id, ad_id),
                INDEX idx_display_ad_assign_equipment (equipment_id, sort_order),
                INDEX idx_display_ad_assign_ad (ad_id),
                CONSTRAINT fk_display_ad_assign_equipment
                    FOREIGN KEY (equipment_id) REFERENCES pos_equipment(id) ON DELETE CASCADE,
                CONSTRAINT fk_display_ad_assign_ad
                    FOREIGN KEY (ad_id) REFERENCES pos_display_ads(id) ON DELETE CASCADE
            )`);
    } catch (e) {
        logger.warn(`Database: pos_display_ad_assignments — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_pin_attempts (
                attempt_key VARCHAR(128) NOT NULL PRIMARY KEY,
                fail_count INT NOT NULL DEFAULT 0,
                locked_until TIMESTAMP NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
    } catch (e) {
        logger.warn(`Database: pos_pin_attempts — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_devices (
                id INT AUTO_INCREMENT PRIMARY KEY,
                device_label VARCHAR(64) NOT NULL,
                api_key_hash CHAR(64) NOT NULL,
                key_prefix VARCHAR(12) NOT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                last_seen_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_pos_devices_label (device_label)
            )`);
    } catch (e) {
        logger.warn(`Database: pos_devices — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_equipment (
                id INT AUTO_INCREMENT PRIMARY KEY,
                equipment_type VARCHAR(32) NOT NULL,
                label VARCHAR(128) NOT NULL,
                manufacturer VARCHAR(128) NULL,
                model VARCHAR(128) NULL,
                serial_number VARCHAR(128) NULL,
                pos_device_id INT NULL,
                config_json JSON NULL,
                notes TEXT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_pos_equipment_device (pos_device_id),
                INDEX idx_pos_equipment_type (equipment_type)
            )`);
    } catch (e) {
        logger.warn(`Database: pos_equipment — ${logger.formatMysqlError(e)}`);
    }
    const EQUIPMENT_PATCHES = [
        {
            column: 'mac_address',
            sql: `ALTER TABLE pos_equipment ADD COLUMN mac_address VARCHAR(17) NULL`
        }
    ];
    await applyColumnPatches(pool, 'pos_equipment', EQUIPMENT_PATCHES);
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_register_network_reports (
                pos_device_id INT NOT NULL PRIMARY KEY,
                reported_ip VARCHAR(64) NOT NULL,
                user_agent VARCHAR(500) NULL,
                reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                CONSTRAINT fk_pos_register_net_device
                    FOREIGN KEY (pos_device_id) REFERENCES pos_devices(id) ON DELETE CASCADE
            )`);
    } catch (e) {
        logger.warn(`Database: pos_register_network_reports — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_failover_usage_period (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                period_month CHAR(7) NOT NULL,
                bytes_used BIGINT UNSIGNED NOT NULL DEFAULT 0,
                last_source VARCHAR(32) NULL,
                last_reported_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_failover_usage_period (period_month)
            )`);
    } catch (e) {
        logger.warn(`Database: pos_failover_usage_period — ${logger.formatMysqlError(e)}`);
    }

    try {
        if (await tableExists(pool, 'pos_failover_usage_period')) {
            if (!(await columnExists(pool, 'pos_failover_usage_period', 'account_id'))) {
                await pool.query(
                    `ALTER TABLE pos_failover_usage_period ADD COLUMN account_id INT NULL AFTER id`
                );
            }
            const { ensureDefaultAccount } = require('../services/platformBillingAccount');
            const account = await ensureDefaultAccount(pool);
            await pool.execute(
                `UPDATE pos_failover_usage_period SET account_id = ? WHERE account_id IS NULL`,
                [account.id]
            );
            try {
                await pool.query(`ALTER TABLE pos_failover_usage_period DROP INDEX uq_failover_usage_period`);
            } catch {
                /* index may already be replaced */
            }
            try {
                await pool.query(
                    `ALTER TABLE pos_failover_usage_period
                     ADD UNIQUE KEY uq_failover_usage_account_period (account_id, period_month)`
                );
            } catch {
                /* already exists */
            }
            try {
                await pool.query(
                    `ALTER TABLE pos_failover_usage_period
                     ADD CONSTRAINT fk_failover_usage_account
                     FOREIGN KEY (account_id) REFERENCES billing_accounts(id) ON DELETE CASCADE`
                );
            } catch {
                /* optional */
            }
        }
    } catch (e) {
        logger.warn(`Database: pos_failover_usage_period migrate — ${logger.formatMysqlError(e)}`);
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_admin_handoffs (
                code VARCHAR(64) NOT NULL PRIMARY KEY,
                admin_user_id INT NOT NULL,
                employee_id INT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_pos_handoff_expires (expires_at)
            )`);
    } catch (e) {
        logger.warn(`Database: pos_admin_handoffs — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_support_agents (
                id INT AUTO_INCREMENT PRIMARY KEY,
                agent_key_hash VARCHAR(64) NOT NULL,
                agent_key_prefix VARCHAR(16) NOT NULL,
                machine_label VARCHAR(128) NOT NULL,
                hostname VARCHAR(128) NULL,
                platform VARCHAR(32) NULL,
                os_version VARCHAR(128) NULL,
                rustdesk_id VARCHAR(32) NULL,
                rustdesk_password_enc TEXT NULL,
                register_label VARCHAR(64) NULL,
                notes TEXT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                last_seen_at TIMESTAMP NULL,
                last_remote_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_pos_support_agent_key (agent_key_hash),
                INDEX idx_pos_support_last_seen (last_seen_at)
            )`);
    } catch (e) {
        logger.warn(`Database: pos_support_agents — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_support_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                agent_id INT NOT NULL,
                admin_user_id INT NOT NULL,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ended_at TIMESTAMP NULL,
                INDEX idx_pos_support_session_agent (agent_id),
                INDEX idx_pos_support_session_admin (admin_user_id)
            )`);
    } catch (e) {
        logger.warn(`Database: pos_support_sessions — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
            ('pos_cash_discount_enabled', 'true', 'Enable in-store cash discount (card price vs lower cash price)', 'boolean'),
            ('pos_cash_discount_percent', '3.5', 'Cash discount percent off merchandise (max 15)', 'number'),
            ('pos_payment_cash_enabled', 'true', 'Allow cash payments on Business One POS', 'boolean'),
            ('pos_payment_check_enabled', 'true', 'Allow check payments on Business One POS', 'boolean'),
            ('pos_payment_card_enabled', 'true', 'Allow card terminal payments on Business One POS', 'boolean'),
            ('pos_store_logo_url', '', 'Optional store logo URL for POS customer display', 'string'),
            ('pos_receipt_header_text', '', 'Optional extra line printed under store name on POS receipts', 'string'),
            ('pos_receipt_footer_text', 'Thank you for your purchase!', 'Closing message on POS receipts', 'string'),
            ('pos_receipt_show_address', 'true', 'Show store address on POS receipts', 'boolean'),
            ('pos_receipt_show_phone', 'true', 'Show store phone on POS receipts', 'boolean'),
            ('pos_receipt_show_logo', 'true', 'Show logo on POS receipts', 'boolean'),
            ('pos_receipt_show_sku', 'true', 'Show SKU on each line item on POS receipts', 'boolean'),
            ('pos_receipt_show_platform_line', 'true', 'Show Business One POS line on receipts', 'boolean'),
            ('pos_receipt_show_cashier', 'true', 'Show cashier name on POS receipts', 'boolean'),
            ('pos_receipt_show_cash_savings', 'true', 'Show cash savings line on POS receipts', 'boolean'),
            ('pos_receipt_auto_print', 'true', 'Auto-open print dialog after each sale', 'boolean'),
            ('pos_receipt_copy_count', '2', 'Number of receipt copies to print (1–3)', 'number'),
            ('pos_receipt_show_order_barcode', 'true', 'Show order number as barcode on receipts', 'boolean'),
            ('pos_session_timeout_minutes', '30', 'Minutes before POS employee must re-enter PIN', 'number'),
            ('pos_pin_max_attempts', '10', 'Failed PIN attempts before lockout', 'number'),
            ('pos_pin_lockout_minutes', '15', 'Minutes to lock PIN entry after too many failures', 'number'),
            ('pos_sign_out_after_sale', 'false', 'Sign cashier out after each completed sale (shared registers)', 'boolean'),
            ('pos_require_manager_pin_discounts', 'true', 'Require manager PIN for line discounts above threshold', 'boolean'),
            ('pos_require_manager_pin_void_refund', 'true', 'Require manager PIN to void sales or process refunds', 'boolean'),
            ('pos_max_line_discount_percent', '10', 'Max line discount percent without manager PIN', 'number'),
            ('pos_daily_sales_email_enabled', 'false', 'Email daily in-store sales summary to owner', 'boolean'),
            ('pos_daily_sales_email_to', '', 'Recipient for daily POS sales email', 'string'),
            ('pos_daily_sales_email_hour', '21', 'Hour to send daily sales email', 'number'),
            ('pos_daily_sales_email_minute', '0', 'Minute to send daily sales email', 'number'),
            ('pos_payroll_email_enabled', 'false', 'Email payroll hours to accountant/bookkeeper', 'boolean'),
            ('pos_payroll_email_to', '', 'Recipient for payroll hours email', 'string'),
            ('pos_payroll_email_frequency', 'weekly', 'Payroll email frequency: weekly, biweekly, semimonthly, monthly', 'string'),
            ('pos_payroll_email_weekday', '1', 'Weekday to send weekly/biweekly payroll (0=Sun..6=Sat)', 'number'),
            ('pos_payroll_email_hour', '8', 'Hour to send payroll email (0-23 server time)', 'number'),
            ('pos_payroll_email_minute', '0', 'Minute to send payroll email', 'number'),
            ('pos_payroll_email_include_pay', 'true', 'Include estimated pay from employee hourly rates', 'boolean'),
            ('pos_eod_reminder_enabled', 'true', 'Remind register if shift still open after end-of-day', 'boolean'),
            ('pos_eod_reminder_hour', '20', 'End-of-day reminder hour', 'number'),
            ('pos_eod_reminder_minute', '0', 'End-of-day reminder minute', 'number'),
            ('pos_support_phone', '', 'Support phone on POS register help', 'string'),
            ('pos_help_url', '', 'Help URL on POS register', 'string'),
            ('pos_remote_support_notice', 'Authorized IT or Business One support may connect to this register remotely only with your permission. You will be asked to approve each session.', 'Remote support notice on register', 'string'),
            ('pos_catalog_refresh_minutes', '60', 'Auto-refresh catalog interval in minutes', 'number'),
            ('pos_large_touch_mode', 'false', 'Larger category buttons on POS register', 'boolean'),
            ('pos_scan_beep_enabled', 'true', 'Beep when barcode scan finds a product', 'boolean'),
            ('pos_quick_keys', '[]', 'Pinned quick keys JSON for POS register', 'string'),
            ('pos_display_store_hours_idle', 'false', 'Show store hours on idle customer display', 'boolean'),
            ('pos_personnel_mode', 'time_clock_and_pos', 'Personnel: time_clock_only or time_clock_and_pos', 'string'),
            ('pos_receipt_return_policy', '', 'Return policy line on POS receipts', 'string'),
            ('pos_show_cost_in_cart', 'false', 'Show product cost in POS cart', 'boolean'),
            ('store_card_payment_processor', 'epi', 'Website card processor: epi, nmi, or mxmerchant', 'string'),
            ('pos_card_payment_processor', 'nmi', 'In-store POS processor: inherit (match website), epi, nmi, or mxmerchant', 'string'),
            ('pos_card_payment_adapter', 'integrated', 'POS card payment: semi-integrated NMI terminal only', 'string'),
            ('pos_custom_payment_driver_url', '', 'Optional URL to custom POS payment driver script when adapter is custom', 'string'),
            ('pos_hardware_printer', 'auto', 'POS receipt printer: auto, elo_star, or browser', 'string'),
            ('pos_display_card_checkout', 'true', 'NMI terminal card checkout (semi-integrated)', 'boolean'),
            ('pos_poi_device_id', '', 'NMI POI device ID for A3700 terminal (Customer Present Cloud)', 'string'),
            ('pos_card_display_mode', 'nmi_terminal', 'Card checkout: NMI terminal (semi-integrated)', 'string')
        `);
    } catch (e) {
        logger.warn(`Database: pos cash discount settings — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
            ('store_cash_discount_enabled', 'false', 'Enable website/host cash discount (card price vs lower cash price)', 'boolean'),
            ('store_cash_discount_percent', '0', 'Website cash discount percent off merchandise (max 15)', 'number')
        `);
    } catch (e) {
        logger.warn(`Database: store cash discount settings — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            INSERT IGNORE INTO settings (key_name, value, description, type) VALUES
            ('pos_network_router_url', '', 'Router admin URL for store LAN (Equipment network setup)', 'string'),
            ('pos_network_gateway_ip', '', 'Store router address (e.g. 192.168.1.1)', 'string'),
            ('pos_network_subnet_cidr', '', 'Store network range (e.g. 192.168.1.0/24)', 'string'),
            ('pos_network_notes', '', 'Notes about store network wiring and DHCP', 'string')
        `);
    } catch (e) {
        logger.warn(`Database: pos network settings — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(
            `UPDATE settings SET value = '10' WHERE key_name = 'pos_pin_max_attempts' AND value = '5'`
        );
    } catch (e) {
        logger.warn(`Database: pos_pin_max_attempts migration — ${logger.formatMysqlError(e)}`);
    }
    try {
        const [legacyRows] = await pool.execute(
            `SELECT value FROM settings WHERE key_name = 'pos_card_payment_adapter' LIMIT 1`
        );
        const legacyAdapter = String(legacyRows[0]?.value || '').toLowerCase();
        if (legacyAdapter === 'nmi' || legacyAdapter === 'epi') {
            await pool.execute(
                `UPDATE settings SET value = 'integrated' WHERE key_name = 'pos_card_payment_adapter'`
            );
            const [storeRows] = await pool.execute(
                `SELECT value FROM settings WHERE key_name = 'store_card_payment_processor' LIMIT 1`
            );
            if (!storeRows.length) {
                await pool.execute(
                    `INSERT INTO settings (key_name, value, description, type) VALUES (?, ?, ?, ?)`,
                    [
                        'store_card_payment_processor',
                        legacyAdapter,
                        'Store card processor for website and integrated POS: epi or nmi',
                        'string'
                    ]
                );
            }
        }
    } catch (e) {
        logger.warn(`Database: payment processor migration — ${logger.formatMysqlError(e)}`);
    }
    try {
        if (String(process.env.POS_NMI_PRIVATE_API_KEY || '').trim()) {
            await pool.query(
                `UPDATE settings SET value = 'integrated'
                 WHERE key_name = 'pos_card_payment_adapter' AND value = 'external_terminal'`
            );
            await pool.query(
                `UPDATE settings SET value = 'nmi'
                 WHERE key_name = 'pos_card_payment_processor' AND value IN ('inherit', 'epi', '')`
            );
        }
    } catch (e) {
        logger.warn(`Database: NMI integrated migration — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(
            `UPDATE settings SET value = 'nmi'
             WHERE key_name = 'store_card_payment_processor'
               AND value IN ('authorize_net', 'authnet')`
        );
        await pool.query(
            `UPDATE settings SET value = 'nmi'
             WHERE key_name = 'pos_card_payment_processor'
               AND value IN ('authorize_net', 'authnet', 'inherit', '')`
        );
    } catch (e) {
        logger.warn(`Database: authorize.net → NMI migration — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(
            `UPDATE settings SET value = 'nmi'
             WHERE key_name IN ('store_card_payment_processor', 'pos_card_payment_processor')
               AND value = 'nmi_durango'`
        );
        await pool.query(
            `UPDATE settings SET value = 'nmi_terminal'
             WHERE key_name = 'pos_card_display_mode' AND value = 'durango_terminal'`
        );
        await pool.query(
            `UPDATE settings SET key_name = 'cred_nmi_deployment_mode'
             WHERE key_name = 'cred_durango_deployment_mode'
               AND NOT EXISTS (
                   SELECT 1 FROM (SELECT key_name FROM settings WHERE key_name = 'cred_nmi_deployment_mode') t
               )`
        );
        await pool.query(
            `DELETE FROM settings WHERE key_name = 'cred_durango_deployment_mode'`
        );
    } catch (e) {
        logger.warn(`Database: legacy processor id migration — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(
            `UPDATE settings SET value = 'integrated' WHERE key_name = 'pos_card_payment_adapter'`
        );
        await pool.query(
            `UPDATE settings SET value = 'nmi' WHERE key_name = 'pos_card_payment_processor'`
        );
        await pool.query(
            `UPDATE settings SET value = 'true' WHERE key_name = 'pos_display_card_checkout'`
        );
    } catch (e) {
        logger.warn(`Database: POS card checkout defaults — ${logger.formatMysqlError(e)}`);
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_merchant_license (
                id INT NOT NULL PRIMARY KEY DEFAULT 1,
                status VARCHAR(20) NOT NULL DEFAULT 'trial',
                licensed_station_count INT NOT NULL DEFAULT 1,
                business_name VARCHAR(200) NULL,
                billing_email VARCHAR(255) NULL,
                payment_method_type VARCHAR(16) NOT NULL DEFAULT 'none',
                epi_customer_vault_id VARCHAR(64) NULL,
                epi_billing_id VARCHAR(64) NULL,
                billing_authorized_at TIMESTAMP NULL,
                license_expires_at TIMESTAMP NULL,
                next_bill_date DATE NULL,
                last_bill_amount DECIMAL(10,2) NULL,
                last_bill_status VARCHAR(32) NULL,
                last_bill_at TIMESTAMP NULL,
                notes TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
    } catch (e) {
        logger.warn(`Database: pos_merchant_license — ${logger.formatMysqlError(e)}`);
    }

    const LICENSE_PATCHES = [
        {
            column: 'billing_credit_balance',
            sql: `ALTER TABLE pos_merchant_license ADD COLUMN billing_credit_balance DECIMAL(10,2) NOT NULL DEFAULT 0`
        },
        {
            column: 'service_comped_until',
            sql: `ALTER TABLE pos_merchant_license ADD COLUMN service_comped_until DATE NULL`
        },
        {
            column: 'past_due_since',
            sql: `ALTER TABLE pos_merchant_license ADD COLUMN past_due_since TIMESTAMP NULL`
        },
        {
            column: 'billing_retry_count',
            sql: `ALTER TABLE pos_merchant_license ADD COLUMN billing_retry_count INT NOT NULL DEFAULT 0`
        },
        {
            column: 'next_billing_retry_at',
            sql: `ALTER TABLE pos_merchant_license ADD COLUMN next_billing_retry_at DATE NULL`
        },
        {
            column: 'grace_days_override',
            sql: `ALTER TABLE pos_merchant_license ADD COLUMN grace_days_override INT NULL`
        },
        {
            column: 'last_payment_failed_email_at',
            sql: `ALTER TABLE pos_merchant_license ADD COLUMN last_payment_failed_email_at TIMESTAMP NULL`
        },
        {
            column: 'grace_ended_email_at',
            sql: `ALTER TABLE pos_merchant_license ADD COLUMN grace_ended_email_at TIMESTAMP NULL`
        },
        {
            column: 'failover_gb_used',
            sql: `ALTER TABLE pos_merchant_license ADD COLUMN failover_gb_used DECIMAL(8,2) NOT NULL DEFAULT 0`
        },
        {
            column: 'billing_account_id',
            sql: 'ALTER TABLE pos_merchant_license ADD COLUMN billing_account_id INT NULL'
        },
        {
            column: 'procharge_token',
            sql: 'ALTER TABLE pos_merchant_license ADD COLUMN procharge_token VARCHAR(128) NULL'
        }
    ];
    await applyColumnPatches(pool, 'pos_merchant_license', LICENSE_PATCHES);

    const DEVICE_PATCHES = [
        {
            column: 'platform',
            sql: `ALTER TABLE pos_devices ADD COLUMN platform VARCHAR(16) NULL`
        },
        {
            column: 'app_version',
            sql: `ALTER TABLE pos_devices ADD COLUMN app_version VARCHAR(32) NULL`
        },
        {
            column: 'support_rustdesk_id',
            sql: `ALTER TABLE pos_devices ADD COLUMN support_rustdesk_id VARCHAR(32) NULL`
        }
    ];
    await applyColumnPatches(pool, 'pos_devices', DEVICE_PATCHES);

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pos_register_support_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pos_device_id INT NOT NULL,
                session_code VARCHAR(8) NOT NULL,
                status VARCHAR(24) NOT NULL DEFAULT 'pending',
                admin_user_id INT NULL,
                offer_sdp MEDIUMTEXT NULL,
                answer_sdp MEDIUMTEXT NULL,
                pos_ice_json MEDIUMTEXT NULL,
                admin_ice_json MEDIUMTEXT NULL,
                diagnostics_json MEDIUMTEXT NULL,
                consent_at TIMESTAMP NULL,
                started_at TIMESTAMP NULL,
                ended_at TIMESTAMP NULL,
                expires_at TIMESTAMP NOT NULL,
                signal_version INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_pos_reg_support_device (pos_device_id),
                INDEX idx_pos_reg_support_status (status),
                INDEX idx_pos_reg_support_expires (expires_at)
            )`);
    } catch (e) {
        logger.warn(`Database: pos_register_support_sessions — ${logger.formatMysqlError(e)}`);
    }

    try {
        const { pruneRevokedDevices } = require('../services/posDeviceRegistry');
        const removed = await pruneRevokedDevices(pool);
        if (removed > 0) {
            logger.info(`POS: removed ${removed} legacy revoked register(s)`);
        }
    } catch (e) {
        logger.warn(`Database: prune revoked pos_devices — ${logger.formatMysqlError(e)}`);
    }
}

module.exports = { ensurePosSchema };
