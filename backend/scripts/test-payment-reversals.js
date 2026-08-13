#!/usr/bin/env node
'use strict';

/**
 * Live sandbox test: sale + reversal for EPI, NMI, and MX.
 *
 * Usage (from backend/):
 *   node scripts/test-payment-reversals.js
 *   node scripts/test-payment-reversals.js --scope website
 *   node scripts/test-payment-reversals.js --processor epi
 *
 * Requires sandbox credentials in .env or Admin → Developer tools (cred_* keys).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { nmiSale } = require('../services/nmiGateway');
const { reverseCardPayment } = require('../services/orderPaymentReversal');
const {
    resolveProcessorCredentials,
    resolvePosProcessorCredentials,
} = require('../services/storePaymentProcessor');
const { createPayment, refundPayment, getPayment, testConnection } = require('../services/mxmerchantGateway');
const { buildWebsitePosData } = require('../utils/mxmerchantEnv');

const NMI_SANDBOX_TOKEN = '00000000-000000-000000-000000000000';
const MX_SANDBOX_CARD = {
    number: '4000000000002701',
    expiryMonth: '12',
    expiryYear: '2030',
    cvv: '123',
    avsZip: '30742',
    avsStreet: '1140 Battlefield Pkwy',
};

function parseArgs() {
    const args = process.argv.slice(2);
    const out = { scope: 'website', processors: ['epi', 'nmi', 'mxmerchant'] };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--scope' && args[i + 1]) {
            out.scope = args[++i] === 'pos' ? 'pos' : 'website';
        } else if (args[i] === '--processor' && args[i + 1]) {
            out.processors = [String(args[++i]).toLowerCase()];
        }
    }
    return out;
}

function maskKey(key) {
    const s = String(key || '');
    if (!s) return '(missing)';
    if (s.length <= 6) return '***';
    return `${s.slice(0, 3)}…${s.slice(-3)}`;
}

async function hydrateCredentials() {
    try {
        const dbConfig = require('../utils/dbConfig');
        const mysql = require('mysql2/promise');
        const pool = mysql.createPool({ ...dbConfig, connectionLimit: 1 });
        const creds = require('../services/integrationCredentials');
        await creds.hydrateFromDatabase(pool);
        await pool.end();
    } catch (e) {
        console.warn('DB credential hydrate skipped:', e.message);
    }
}

function uniqueAmount() {
    const cents = String(Date.now() % 100).padStart(2, '0');
    return `1.${cents}`;
}

async function testNmiProcessor(processor, scope) {
    const label = processor === 'epi' ? 'EPI (NMI Direct Post)' : 'NMI (nmi)';
    const creds =
        scope === 'pos' ? resolvePosProcessorCredentials(processor) : resolveProcessorCredentials(processor);
    const securityKey = creds.privateKey;
    const transactUrl = creds.transactUrl;

    console.log(`\n--- ${label} [${scope}] ---`);
    console.log('  privateKey:', maskKey(securityKey));
    console.log('  transactUrl:', transactUrl || '(default)');

    if (!securityKey) {
        return { processor, scope, ok: false, skipped: true, message: 'Private API key not configured' };
    }

    const amount = uniqueAmount();
    console.log('  sale amount:', amount);

    const sale = await nmiSale({
        securityKey,
        amount,
        paymentToken: NMI_SANDBOX_TOKEN,
        transactUrl,
    });

    console.log('  sale:', sale.ok ? 'APPROVED' : 'DECLINED', '-', sale.responseText);
    if (sale.transactionId) console.log('  transactionId:', sale.transactionId);

    if (!sale.ok) {
        if (/duplicate transaction/i.test(String(sale.responseText))) {
            return {
                processor,
                scope,
                ok: false,
                skipped: true,
                message: 'Sale declined (duplicate) — cannot test reversal without fresh txn',
            };
        }
        return { processor, scope, ok: false, message: `Sale failed: ${sale.responseText}` };
    }

    const reverse = await reverseCardPayment({
        processor,
        scope,
        transactionId: sale.transactionId,
        operation: 'auto',
    });

    console.log('  reverse:', reverse.ok ? 'OK' : 'FAIL', '-', reverse.responseText || reverse.operation);
    if (reverse.operation) console.log('  operation:', reverse.operation);
    if (reverse.voidAttemptMessage) console.log('  void attempt:', reverse.voidAttemptMessage);

    return {
        processor,
        scope,
        ok: reverse.ok,
        saleTransactionId: sale.transactionId,
        operation: reverse.operation,
        message: reverse.responseText,
    };
}

async function testMxProcessor(scope) {
    console.log(`\n--- MX [${scope}] ---`);

    const conn = await testConnection(scope);
    console.log('  connection:', conn.ok ? 'OK' : 'FAIL', '-', conn.message);
    if (!conn.ok) {
        return { processor: 'mxmerchant', scope, ok: false, skipped: true, message: conn.message };
    }

    const amount = Number(uniqueAmount());
    console.log('  sale amount:', amount);

    const sale = await createPayment({
        scope,
        amount,
        cardAccount: MX_SANDBOX_CARD,
        clientReference: `rev${String(Date.now()).slice(-8)}`,
        posData: buildWebsitePosData(),
        paymentType: 'Sale',
    });

    console.log('  sale:', sale.ok ? 'APPROVED' : 'DECLINED', '-', sale.responseText);
    if (sale.paymentId) console.log('  paymentId:', sale.paymentId);
    if (sale.paymentToken) console.log('  paymentToken:', `${sale.paymentToken.slice(0, 8)}…`);

    if (!sale.ok) {
        return { processor: 'mxmerchant', scope, ok: false, message: `Sale failed: ${sale.responseText}` };
    }

    const reverse = await reverseCardPayment({
        processor: 'mxmerchant',
        scope,
        paymentId: sale.paymentId,
        operation: 'auto',
        paymentToken: sale.paymentToken,
    });

    console.log('  reverse:', reverse.ok ? 'OK' : 'FAIL', '-', reverse.responseText || reverse.operation);
    if (reverse.operation) console.log('  operation:', reverse.operation);

    let verify = null;
    if (reverse.ok && sale.paymentId) {
        verify = await getPayment(sale.paymentId, scope);
        console.log('  post-reverse status:', verify.status || verify.responseText);
    }

    return {
        processor: 'mxmerchant',
        scope,
        ok: reverse.ok,
        paymentId: sale.paymentId,
        operation: reverse.operation,
        postStatus: verify?.status,
        message: reverse.responseText,
    };
}

async function main() {
    const { scope, processors } = parseArgs();

    console.log('='.repeat(60));
    console.log('Payment reversal live test — EPI / NMI / MX');
    console.log('Scope:', scope);
    console.log('='.repeat(60));

    await hydrateCredentials();

    const results = [];

    if (processors.includes('epi') || processors.includes('nmi')) {
        if (processors.includes('epi')) {
            results.push(await testNmiProcessor('epi', scope));
        }
        if (processors.includes('nmi')) {
            results.push(await testNmiProcessor('nmi', scope));
        }
    }

    if (processors.includes('mxmerchant')) {
        results.push(await testMxProcessor(scope));
    }

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    let failed = 0;
    let skipped = 0;
    for (const r of results) {
        const status = r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
        if (r.skipped) skipped += 1;
        else if (!r.ok) failed += 1;
        console.log(
            `  [${status}] ${r.processor} (${r.scope}): ${r.message || r.operation || 'ok'}`
        );
    }

    console.log('');
    if (failed) {
        console.log(`FAILED: ${failed} processor(s)`);
        process.exit(1);
    }
    if (skipped === results.length) {
        console.log('All processors skipped — configure sandbox credentials and retry.');
        process.exit(2);
    }
    console.log(`PASSED: ${results.length - skipped - failed} of ${results.length} processor(s)`);
    if (skipped) console.log(`Skipped: ${skipped} (missing credentials)`);
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(3);
});
