'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const shipping = require('../services/shippingService');
const { getShippingConfig } = require('../config/shippingConfig');
const { auditShippoCarriers } = require('../services/shippoCarrierAudit');

async function main() {
    const cfg = getShippingConfig();
    const origin = cfg.STORE_ORIGIN;
    const audit = await auditShippoCarriers();
    const report = {
        tokenConfigured: audit.tokenConfigured,
        testMode: audit.testMode,
        carriers: audit.requiredCarriers,
        originConfigured: Boolean(origin.street1 && origin.city && origin.state && origin.zip),
        originPhoneConfigured: String(origin.phone || '').replace(/\D/g, '').length >= 10,
        origin: {
            city: origin.city,
            state: origin.state,
            zip: origin.zip,
            phone: origin.phone ? '[set]' : '[missing]',
        },
        carrierAccounts: audit.accounts,
        rateQuote: audit.rates,
        blockers: audit.blockers,
        warnings: audit.warnings,
        db: null,
        checkoutOptions: null,
    };

    if (!report.tokenConfigured) {
        console.log(JSON.stringify({ ok: false, report, error: 'SHIPPO_API_TOKEN missing' }, null, 2));
        process.exit(1);
    }

    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT || 3306,
        });

        const [boxes] = await pool.query('SELECT COUNT(*) AS c FROM shipping_boxes');
        const [cols] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME LIKE 'shippo%'`
        );
        report.db = {
            shippingBoxes: Number(boxes[0]?.c || 0),
            shippoOrderColumns: cols.map((r) => r.COLUMN_NAME),
        };

        const checkout = await shipping.getCheckoutOptions(pool, {
            cartItems: [{ product_id: 1, quantity: 1, price: 25, name: 'Test' }],
            postalCode: '84101',
            state: 'UT',
            country: 'US',
            merchandiseSubtotal: 25,
        });
        report.checkoutOptions = {
            count: checkout.options.length,
            shippoEnabled: checkout.shippoEnabled,
            weightsKnown: checkout.weightInfo.allWeightsKnown,
            methods: checkout.options.map((o) => ({
                label: o.label,
                amount: o.amount,
                provider: o.provider || null,
            })),
            carrierMethods: checkout.options
                .filter((o) => o.provider && o.provider !== 'standard')
                .map((o) => o.provider),
        };
    } catch (e) {
        report.db = { ok: false, message: e.message };
    } finally {
        if (pool) await pool.end();
    }

    const ok =
        audit.ready &&
        report.originConfigured &&
        report.db?.shippingBoxes > 0;

    console.log(JSON.stringify({ ok, report }, null, 2));
    process.exit(ok ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
