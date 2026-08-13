#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined
    });

    try {
        const { ensureDefaultAccount } = require('../services/platformBillingAccount');
        const { syncPrincipalContact } = require('../services/principalBilling');
        const account = await ensureDefaultAccount(pool);
        await syncPrincipalContact(pool, account.id);
        const [ba] = await pool.query(
            'SELECT business_name, billing_email FROM billing_accounts WHERE id = ?',
            [account.id]
        );
        const [lic] = await pool.query(
            'SELECT business_name, billing_email FROM pos_merchant_license WHERE id = 1'
        );
        console.log(JSON.stringify({ billing_accounts: ba[0], pos_merchant_license: lic[0] }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
