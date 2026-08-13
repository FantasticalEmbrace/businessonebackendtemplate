'use strict';

/**
 * Smoke test: split payment migrations + multi-tender POS order.
 * Usage: node scripts/test-split-payment.js
 */

const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { createInStorePosOrder } = require('../services/posStoreOrder');
const {
    validateTendersForSale,
    formatTenderNotes
} = require('../services/posSplitTender');
const { loadStoreTaxRate } = require('../utils/storeTaxRate');
const {
    computeDualPricing,
    applyCartDiscountToEnriched,
    resolveTotalsForPayment,
    loadCashDiscountSettings,
    roundMoney
} = require('../services/posCashDiscount');

async function verifySchema(pool) {
    const [cols] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_loyalty'
         AND COLUMN_NAME IN ('cash_balance', 'loyalty_enrollment')`
    );
    const [tbl] = await pool.query("SHOW TABLES LIKE 'order_payment_tenders'");
    const colNames = cols.map((c) => c.COLUMN_NAME);
    if (!colNames.includes('cash_balance') || !colNames.includes('loyalty_enrollment')) {
        throw new Error('customer_loyalty cash columns missing — run 20260621_loyalty_cash_back.sql');
    }
    if (!tbl.length) {
        throw new Error('order_payment_tenders table missing — run 20260622_pos_split_payment_tenders.sql');
    }
    console.log('✓ Schema OK (cash_balance, loyalty_enrollment, order_payment_tenders)');
}

async function estimateCardSaleTotal(pool, items) {
    const enriched = [];
    for (const item of items) {
        const [rows] = await pool.query(
            'SELECT id, sku, name, price, is_taxable FROM products WHERE id = ? LIMIT 1',
            [item.productId]
        );
        const p = rows[0];
        if (!p) throw new Error(`Product ${item.productId} not found`);
        const qty = Number(item.quantity) || 1;
        enriched.push({
            productId: p.id,
            sku: p.sku,
            name: p.name,
            quantity: qty,
            lineTotal: roundMoney(Number(p.price) * qty),
            is_taxable: p.is_taxable !== 0
        });
    }
    const taxRate = await loadStoreTaxRate(pool);
    const cashSettings = await loadCashDiscountSettings(pool);
    const priced = applyCartDiscountToEnriched(enriched, 0);
    const pricing = computeDualPricing(priced, taxRate, cashSettings.enabled ? cashSettings.percent : 0);
    return resolveTotalsForPayment(pricing, 'card_terminal', 0).totalAmount;
}

async function findFixtures(pool) {
    const [productRows] = await pool.query(
        'SELECT id, sku, name, price FROM products WHERE is_active = 1 AND price > 0 LIMIT 1'
    );
    const [empRows] = await pool.query('SELECT id FROM pos_employees WHERE is_active = 1 LIMIT 1');
    const [loyaltyRows] = await pool.query(
        `SELECT u.id, u.email, cl.cash_balance, cl.points_balance
         FROM users u
         JOIN customer_loyalty cl ON cl.user_id = u.id
         WHERE cl.cash_balance >= 1 OR cl.points_balance >= 100
         ORDER BY cl.cash_balance DESC
         LIMIT 1`
    );
    const [gcRows] = await pool.query(
        `SELECT id, customer_id, current_balance, CONCAT(LEFT(code, 4), '****') AS code_masked
         FROM gift_cards WHERE status = 'active' AND current_balance >= 1
         ORDER BY current_balance DESC LIMIT 1`
    );
    const customerId = loyaltyRows[0]?.id || null;
    let giftCard = gcRows[0] || null;
    if (customerId && giftCard && Number(giftCard.customer_id) !== Number(customerId)) {
        const [ownedGc] = await pool.query(
            `SELECT id, customer_id, current_balance, CONCAT(LEFT(code, 4), '****') AS code_masked
             FROM gift_cards WHERE status = 'active' AND current_balance >= 1 AND customer_id = ?
             ORDER BY current_balance DESC LIMIT 1`,
            [customerId]
        );
        giftCard = ownedGc[0] || null;
    }
    return {
        product: productRows[0] || null,
        employeeId: empRows[0]?.id || null,
        customer: loyaltyRows[0] || null,
        giftCard
    };
}

function testValidationUnit() {
    validateTendersForSale(
        [
            { type: 'loyalty_cash', amount: 20 },
            { type: 'gift_card', amount: 10, giftCardId: 1 },
            { type: 'cash', amount: 25, cashTendered: 30, cashChange: 5 },
            { type: 'card_terminal', amount: 40, terminalLastFour: '4242', terminalAuthCode: 'OK1' }
        ],
        95,
        { customerUserId: 1, cardApprovedConfirmed: true }
    );
    console.log('✓ validateTendersForSale accepts $20 + $10 + $25 + $40 = $95');

    const notes = formatTenderNotes([
        { type: 'loyalty_cash', amount: 20 },
        { type: 'gift_card', amount: 10 },
        { type: 'cash', amount: 25, cashTendered: 30, cashChange: 5 },
        { type: 'card_terminal', amount: 40, terminalLastFour: '4242', terminalCardBrand: 'Visa' }
    ]);
    console.log('✓ Receipt notes preview:\n' + notes.split('\n').map((l) => '    ' + l).join('\n'));
}

function buildSplitTenders(cardTotal, fixtures) {
    const splitTenders = [];
    let remaining = cardTotal;
    const userId = fixtures.customer?.id || fixtures.giftCard?.customer_id || null;

    if (fixtures.customer && Number(fixtures.customer.cash_balance) >= 1 && userId) {
        const amt = roundMoney(Math.min(5, Number(fixtures.customer.cash_balance), remaining));
        if (amt >= 0.01) {
            splitTenders.push({ type: 'loyalty_cash', amount: amt });
            remaining = roundMoney(remaining - amt);
        }
    }
    if (fixtures.giftCard && Number(fixtures.giftCard.current_balance) >= 1 && remaining > 0) {
        const amt = roundMoney(Math.min(5, Number(fixtures.giftCard.current_balance), remaining));
        if (amt >= 0.01) {
            splitTenders.push({
                type: 'gift_card',
                amount: amt,
                giftCardId: fixtures.giftCard.id
            });
            remaining = roundMoney(remaining - amt);
        }
    }
    const cashAmt = roundMoney(Math.min(10, remaining));
    if (cashAmt >= 0.01) {
        splitTenders.push({
            type: 'cash',
            amount: cashAmt,
            cashTendered: cashAmt,
            cashChange: 0
        });
        remaining = roundMoney(remaining - cashAmt);
    }
    if (remaining > 0.005) {
        splitTenders.push({
            type: 'card_terminal',
            amount: remaining,
            terminalLastFour: '4242',
            terminalAuthCode: 'TEST-SPLIT'
        });
    }
    return { splitTenders, userId };
}

async function assertTenderRows(pool, orderId, expectedCount) {
    const [tenderRows] = await pool.query(
        'SELECT tender_type, amount, loyalty_points, gift_card_id FROM order_payment_tenders WHERE order_id = ? ORDER BY id',
        [orderId]
    );
    console.log('✓ order_payment_tenders rows:');
    tenderRows.forEach((r) => {
        console.log(
            `    ${r.tender_type}: $${Number(r.amount).toFixed(2)}` +
                (r.loyalty_points ? ` (${r.loyalty_points} pts)` : '') +
                (r.gift_card_id ? ` (gc #${r.gift_card_id})` : '')
        );
    });
    if (tenderRows.length !== expectedCount) {
        throw new Error(`Expected ${expectedCount} tender rows, got ${tenderRows.length}`);
    }
    return tenderRows;
}

async function main() {
    loadBackendEnv();
    const pool = await createPool();
    try {
        await verifySchema(pool);
        testValidationUnit();

        const fixtures = await findFixtures(pool);
        if (!fixtures.product) throw new Error('No active product found');
        if (!fixtures.employeeId) throw new Error('No active POS employee found');

        console.log('\nFixtures:', {
            product: `${fixtures.product.sku} ($${fixtures.product.price})`,
            customer: fixtures.customer
                ? `${fixtures.customer.email} (credit $${fixtures.customer.cash_balance})`
                : null,
            giftCard: fixtures.giftCard
                ? `${fixtures.giftCard.code_masked} $${fixtures.giftCard.current_balance}`
                : null
        });

        const items = [{ productId: fixtures.product.id, sku: fixtures.product.sku, quantity: 1 }];
        const cardTotal = await estimateCardSaleTotal(pool, items);
        const { splitTenders, userId } = buildSplitTenders(cardTotal, fixtures);

        console.log(`\n→ Creating split order (total $${cardTotal.toFixed(2)}):`);
        splitTenders.forEach((t) => console.log(`    ${t.type}: $${Number(t.amount).toFixed(2)}`));

        const result = await createInStorePosOrder(
            pool,
            {
                clientTransactionId: `split-test-${Date.now()}`,
                userId,
                items,
                paymentTenders: splitTenders,
                payment: {
                    paymentMethod: 'split',
                    terminalApprovedConfirmed: true,
                    label: 'Split payment'
                }
            },
            'Split test register',
            fixtures.employeeId
        );

        console.log(`✓ Order ${result.orderNumber} created (id ${result.orderId})`);
        await assertTenderRows(pool, result.orderId, splitTenders.length);

        console.log('\nAll split-payment tests passed.');
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('\n✗ Test failed:', err.code || err.message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
});
