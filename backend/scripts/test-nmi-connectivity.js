#!/usr/bin/env node
/**
 * Manual / CI smoke test: verifies Direct Post URL, parses NMI response, and optionally runs a sandbox sale.
 *
 * Usage (from backend/):
 *   node scripts/test-nmi-connectivity.js
 *
 * Requires in .env:
 *   NMI_PRIVATE_API_KEY — must be the Payment API **security key** from the gateway (not the Collect.js tokenization key).
 *
 * Exit codes: 0 = gateway accepted sale (response=1), 2 = gateway replied but declined/config error, 3 = network/script error
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getNmiTransactUrl, getNmiPrivateApiKey } = require('../utils/nmiEnv');
const { nmiSale } = require('../services/nmiGateway');

const TEST_TOKEN = '00000000-000000-000000-000000000000';

async function resolveSecurityKey() {
    let key = getNmiPrivateApiKey();
    if (key) return key;

    try {
        const dbConfig = require('../utils/dbConfig');
        const mysql = require('mysql2/promise');
        const pool = mysql.createPool({ ...dbConfig, connectionLimit: 1 });
        const creds = require('../services/integrationCredentials');
        await creds.hydrateFromDatabase(pool);
        key = getNmiPrivateApiKey();
        await pool.end();
    } catch (e) {
        console.warn('Could not load NMI key from database:', e.message);
    }
    return key;
}

async function main() {
    const key = await resolveSecurityKey();
    if (!key) {
        console.error('Missing NMI private API key. Set NMI_PRIVATE_API_KEY in backend/.env or save cred_nmi_private_api_key in Admin → Developer tools.');
        process.exit(3);
    }
    const url = getNmiTransactUrl();
    console.log('Transact URL:', url);

    const cents = String(Date.now() % 100).padStart(2, '0');
    const amount = `1.${cents}`;

    const r = await nmiSale({
        securityKey: key,
        amount,
        paymentToken: TEST_TOKEN
    });

    console.log('response=', r.responseCode, 'ok=', r.ok);
    console.log('responsetext=', r.responseText);
    if (r.transactionId && r.transactionId !== '0') console.log('transactionid=', r.transactionId);

    if (r.ok) {
        console.log('OK: sandbox sale succeeded.');
        process.exit(0);
    }
    if (/duplicate transaction/i.test(String(r.responseText))) {
        console.log('OK: sandbox gateway reachable (duplicate transaction on rapid retest).');
        process.exit(0);
    }
    if (String(r.responseText).includes('API key not found') || String(r.responseText).includes('Specified API key')) {
        console.error(
            'FAIL: NMI does not recognize this key as a Direct Post security_key. In the merchant portal, copy the Payment API / "security key" (often different from the tokenization public key).'
        );
        process.exit(2);
    }
    console.error('FAIL: gateway returned an error (see responsetext above).');
    process.exit(2);
}

main().catch((e) => {
    console.error(e);
    process.exit(3);
});
