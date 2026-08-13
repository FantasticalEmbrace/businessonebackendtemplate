'use strict';

/**
 * Cross-channel payment test: website wallet reads, POS split tenders, web checkout tenders.
 * Usage: node scripts/test-cross-channel-payments.js
 */

const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { createInStorePosOrder } = require('../services/posStoreOrder');
const { getCustomerForPos } = require('../services/posCustomerService');
const { validateTendersForSale, formatTenderNotes } = require('../services/posSplitTender');
const { finalizePaidOrder } = require('../services/finalizePaidOrder');
const promoEngine = require('../services/webPromotionEngine');
const {
    normalizeWebStoreTenders,
    splitWebCheckoutPayment,
    applyWebStoreTenders,
    persistOrderTenders,
    getCardAmountDueForOrder,
    getNonEarnTenderTotal,
    loadLoyaltyProgramSettings
} = require('../services/webCheckoutPayments');
const { loadStoreTaxRate } = require('../utils/storeTaxRate');
const {
    computeDualPricing,
    applyCartDiscountToEnriched,
    resolveTotalsForPayment,
    loadCashDiscountSettings,
    roundMoney
} = require('../services/posCashDiscount');
const { adjustLoyaltyCash } = require('../services/customerLoyalty');

function log(section, msg) {
    console.log(`[${section}] ${msg}`);
}

async function verifySchema(pool) {
    const [cols] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_loyalty'
         AND COLUMN_NAME IN ('cash_balance', 'loyalty_enrollment')`
    );
    const [tbl] = await pool.query("SHOW TABLES LIKE 'order_payment_tenders'");
    if (!cols.some((c) => c.COLUMN_NAME === 'cash_balance')) {
        throw new Error('Run migration 20260621_loyalty_cash_back.sql');
    }
    if (!tbl.length) throw new Error('Run migration 20260622_pos_split_payment_tenders.sql');
    log('schema', 'OK');
}

async function readWalletFromDb(pool, userId) {
    const [[loyalty]] = await pool.query(
        `SELECT cash_balance, points_balance, loyalty_enrollment FROM customer_loyalty WHERE user_id = ?`,
        [userId]
    );
    const [giftCards] = await pool.query(
        `SELECT id, current_balance FROM gift_cards
         WHERE status = 'active' AND current_balance > 0
           AND (customer_id = ? OR recipient_email = (SELECT email FROM users WHERE id = ?))
         ORDER BY current_balance DESC`,
        [userId, userId]
    );
    return {
        cashBalance: Number(loyalty?.cash_balance) || 0,
        pointsBalance: Number(loyalty?.points_balance) || 0,
        enrollment: loyalty?.loyalty_enrollment || 'cash',
        giftCards: giftCards.map((g) => ({ id: g.id, balance: Number(g.current_balance) }))
    };
}

async function assertWalletParity(pool, userId) {
    const db = await readWalletFromDb(pool, userId);
    const pos = await getCustomerForPos(pool, userId);
    if (Math.abs(db.cashBalance - pos.loyalty.cashBalance) > 0.001) {
        throw new Error(`Cash balance mismatch: DB $${db.cashBalance} vs POS $${pos.loyalty.cashBalance}`);
    }
    if (db.pointsBalance !== pos.loyalty.pointsBalance) {
        throw new Error(`Points mismatch: DB ${db.pointsBalance} vs POS ${pos.loyalty.pointsBalance}`);
    }
    const dbGcTotal = db.giftCards.reduce((s, g) => s + g.balance, 0);
    const posGcTotal = pos.giftCards.reduce((s, g) => s + Number(g.currentBalance), 0);
    if (Math.abs(dbGcTotal - posGcTotal) > 0.02) {
        throw new Error(`Gift card total mismatch: DB $${dbGcTotal.toFixed(2)} vs POS $${posGcTotal.toFixed(2)}`);
    }
    log('parity', `OK for user #${userId} — credit $${db.cashBalance.toFixed(2)}, ${db.pointsBalance} pts, ${db.giftCards.length} gift card(s)`);
    return { db, pos };
}

async function findFixtures(pool) {
    const [productRows] = await pool.query(
        'SELECT id, sku, name, price FROM products WHERE is_active = 1 AND price BETWEEN 5 AND 50 LIMIT 1'
    );
    const [empRows] = await pool.query('SELECT id FROM pos_employees WHERE is_active = 1 LIMIT 1');
    let [userRows] = await pool.query(
        `SELECT u.id, u.email FROM users u
         JOIN customer_loyalty cl ON cl.user_id = u.id
         WHERE u.is_active = 1 AND cl.cash_balance >= 3
         ORDER BY cl.cash_balance DESC LIMIT 1`
    );
    if (!userRows[0]) {
        const [anyUser] = await pool.query(
            `SELECT u.id, u.email FROM users u
             WHERE u.is_active = 1 AND u.email NOT LIKE 'pos+%'
             ORDER BY u.id ASC LIMIT 1`
        );
        if (anyUser[0]) {
            await adjustLoyaltyCash(pool, anyUser[0].id, 15, {
                description: 'Cross-channel test seed credit',
                adminUserId: null
            });
            userRows = anyUser;
            log('seed', `Added $15 store credit to ${anyUser[0].email}`);
        }
    }
    const userId = userRows[0]?.id || null;
    let giftCard = null;
    if (userId) {
        const [gcRows] = await pool.query(
            `SELECT id, customer_id, current_balance FROM gift_cards
             WHERE status = 'active' AND current_balance >= 3
               AND (customer_id = ? OR recipient_email = (SELECT email FROM users WHERE id = ?))
             ORDER BY current_balance DESC LIMIT 1`,
            [userId, userId]
        );
        giftCard = gcRows[0] || null;
    }
    return {
        product: productRows[0],
        employeeId: empRows[0]?.id,
        userId,
        giftCard: giftCard && userId ? giftCard : null
    };
}

async function estimatePosCardTotal(pool, productId, sku) {
    const [rows] = await pool.query(
        'SELECT id, sku, name, price, is_taxable FROM products WHERE id = ?',
        [productId]
    );
    const p = rows[0];
    const enriched = [{
        productId: p.id,
        sku: p.sku || sku,
        quantity: 1,
        lineTotal: roundMoney(Number(p.price)),
        is_taxable: p.is_taxable !== 0
    }];
    const taxRate = await loadStoreTaxRate(pool);
    const cashSettings = await loadCashDiscountSettings(pool);
    const priced = applyCartDiscountToEnriched(enriched, 0);
    const pricing = computeDualPricing(priced, taxRate, cashSettings.enabled ? cashSettings.percent : 0);
    return resolveTotalsForPayment(pricing, 'card_terminal', 0).totalAmount;
}

async function estimateWebTotal(pool, productId) {
    const checkout = await promoEngine.previewOrApplyTotals(pool, {
        cartItems: [{ product_id: productId, quantity: 1, price: 0 }],
        promoCode: '',
        email: 'test@example.com',
        applyTaxExemption: false
    });
    return Number(checkout.totals.totalAmount) || 0;
}

function buildPosTenders(total, userId, wallet, giftCard) {
    const tenders = [];
    let remaining = total;
    if (wallet.cashBalance >= 2) {
        const amt = roundMoney(Math.min(3, wallet.cashBalance, remaining));
        tenders.push({ type: 'loyalty_cash', amount: amt });
        remaining = roundMoney(remaining - amt);
    }
    if (giftCard && Number(giftCard.current_balance) >= 2 && remaining > 0) {
        const amt = roundMoney(Math.min(3, Number(giftCard.current_balance), remaining));
        tenders.push({ type: 'gift_card', amount: amt, giftCardId: giftCard.id });
        remaining = roundMoney(remaining - amt);
    }
    if (remaining > 0.005) {
        tenders.push({
            type: 'card_terminal',
            amount: remaining,
            terminalLastFour: '4242',
            terminalAuthCode: 'CROSS-TEST-POS'
        });
    }
    if (!userId && tenders.some((t) => t.type === 'loyalty_cash')) {
        throw new Error('Customer required for loyalty tender test');
    }
    return tenders;
}

async function runPosSplitTest(pool, fixtures, wallet) {
    const total = await estimatePosCardTotal(pool, fixtures.product.id, fixtures.product.sku);
    const tenders = buildPosTenders(total, fixtures.userId, wallet.db, fixtures.giftCard);
    validateTendersForSale(tenders, total, {
        customerUserId: fixtures.userId,
        cardApprovedConfirmed: true
    });
    log('pos', `Split sale $${total.toFixed(2)} — ${tenders.map((t) => `${t.type} $${t.amount}`).join(', ')}`);
    const result = await createInStorePosOrder(
        pool,
        {
            clientTransactionId: `cross-pos-${Date.now()}`,
            userId: fixtures.userId,
            items: [{ productId: fixtures.product.id, sku: fixtures.product.sku, quantity: 1 }],
            paymentTenders: tenders,
            payment: { paymentMethod: 'split', terminalApprovedConfirmed: true }
        },
        'Cross-channel test',
        fixtures.employeeId
    );
    const [rows] = await pool.query(
        'SELECT tender_type, amount FROM order_payment_tenders WHERE order_id = ? ORDER BY id',
        [result.orderId]
    );
    if (rows.length !== tenders.length) {
        throw new Error(`POS tender row count ${rows.length} !== ${tenders.length}`);
    }
    const [[order]] = await pool.query(
        'SELECT sales_channel, user_id, payment_method FROM orders WHERE id = ?',
        [result.orderId]
    );
    if (order.sales_channel !== 'in_store') throw new Error('POS order missing in_store channel');
    if (fixtures.userId && Number(order.user_id) !== Number(fixtures.userId)) {
        throw new Error('POS order user_id not attached');
    }
    log('pos', `OK order ${result.orderNumber} — ${rows.map((r) => r.tender_type).join(' + ')}`);
    return result;
}

async function createWebOrderWithTenders(pool, { userId, product, storeTenders, email }) {
    const loyaltySettings = await loadLoyaltyProgramSettings(pool);
    const checkout = await promoEngine.previewOrApplyTotals(pool, {
        cartItems: [{ product_id: product.id, quantity: 1, price: Number(product.price) }],
        promoCode: '',
        email: email || 'cross-test@example.com',
        applyTaxExemption: false
    });
    const saleTotal = Number(checkout.totals.totalAmount) || 0;
    const { cardDue } = splitWebCheckoutPayment(storeTenders, saleTotal);

    const [[user]] = await pool.query(
        'SELECT id, email, first_name, last_name FROM users WHERE id = ?',
        [userId]
    );
    if (!user) throw new Error('User not found for web test');

    const orderNumber = `HMTEST${Date.now()}`;
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    let orderId;
    try {
        const [ins] = await conn.execute(
            `INSERT INTO orders (
                order_number, user_id, email, status, payment_status,
                subtotal, tax_amount, shipping_amount, discount_amount, total_amount,
                shipping_first_name, shipping_last_name,
                billing_first_name, billing_last_name,
                payment_method, sales_channel
             ) VALUES (?, ?, ?, 'pending', 'pending', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'online')`,
            [
                orderNumber,
                userId,
                user.email,
                checkout.totals.merchandiseSubtotal,
                checkout.totals.taxAmount,
                checkout.totals.totalDiscountAmount || 0,
                saleTotal,
                user.first_name || 'Test',
                user.last_name || 'Customer',
                user.first_name || 'Test',
                user.last_name || 'Customer',
                cardDue > 0.005 ? 'split' : 'loyalty'
            ]
        );
        orderId = ins.insertId;
        for (const line of checkout.enrichment) {
            await conn.execute(
                `INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, price, total)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    line.product_id,
                    line.name,
                    line.sku,
                    line.quantity,
                    line.unitPrice,
                    promoEngine.roundMoney(line.unitPrice * line.quantity)
                ]
            );
        }
        if (storeTenders.length) {
            await applyWebStoreTenders(conn, {
                storeTenders,
                orderId,
                user,
                loyaltySettings
            });
            await persistOrderTenders(conn, orderId, storeTenders);
        }
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }

    if (cardDue <= 0.005) {
        await finalizePaidOrder(pool, {
            orderId,
            paymentId: 'web:cross-test-wallet',
            paymentStatus: 'paid'
        });
    }

    return { orderId, orderNumber, saleTotal, cardDue };
}

async function runWebWalletTest(pool, fixtures, wallet) {
    if (!fixtures.userId) throw new Error('No user for web wallet test');

    const webTotal = await estimateWebTotal(pool, fixtures.product.id);
    const gc = wallet.db.giftCards[0] || fixtures.giftCard;
    const storeTenders = [];
    if (wallet.db.cashBalance >= 1) {
        storeTenders.push({
            type: 'loyalty_cash',
            amount: roundMoney(Math.min(2, wallet.db.cashBalance, webTotal))
        });
    }
    let remaining = roundMoney(webTotal - storeTenders.reduce((s, t) => s + t.amount, 0));
    if (gc && gc.balance >= 1 && remaining > 0) {
        storeTenders.push({
            type: 'gift_card',
            amount: roundMoney(Math.min(2, gc.balance, remaining)),
            giftCardId: gc.id
        });
    }
    remaining = roundMoney(webTotal - storeTenders.reduce((s, t) => s + t.amount, 0));
    if (!storeTenders.length) {
        log('web', 'Skipped — no wallet balance left for web tender test');
        return null;
    }

    const payFully = remaining <= 0.005;
    log(
        'web',
        `${payFully ? 'Full wallet' : 'Partial wallet'} checkout $${webTotal.toFixed(2)} — ` +
            storeTenders.map((t) => `${t.type} $${t.amount}`).join(', ') +
            (payFully ? '' : `, card due $${remaining.toFixed(2)}`)
    );

    const result = await createWebOrderWithTenders(pool, {
        userId: fixtures.userId,
        product: fixtures.product,
        storeTenders,
        email: wallet.pos.email
    });

    const [tenderRows] = await pool.query(
        'SELECT tender_type, amount FROM order_payment_tenders WHERE order_id = ?',
        [result.orderId]
    );
    if (tenderRows.length !== storeTenders.length) {
        throw new Error(`Web tender rows ${tenderRows.length} !== ${storeTenders.length}`);
    }

    const cardDue = await getCardAmountDueForOrder(pool, result.orderId);
    if (payFully) {
        if (cardDue > 0.005) throw new Error(`Expected $0 card due, got $${cardDue}`);
        const [[ord]] = await pool.query('SELECT payment_status FROM orders WHERE id = ?', [result.orderId]);
        if (ord.payment_status !== 'paid') throw new Error('Web wallet order should be paid');
    } else {
        if (Math.abs(cardDue - remaining) > 0.02) {
            throw new Error(`Card due mismatch: expected $${remaining}, got $${cardDue}`);
        }
        const [[ord]] = await pool.query('SELECT payment_status FROM orders WHERE id = ?', [result.orderId]);
        if (ord.payment_status !== 'pending') throw new Error('Partial web order should stay pending');
    }

    const nonEarn = await getNonEarnTenderTotal(pool, result.orderId);
    if (nonEarn <= 0) throw new Error('getNonEarnTenderTotal should be > 0 for wallet order');
    log('web', `OK order ${result.orderNumber} — tenders persisted, card due $${cardDue.toFixed(2)}`);
    return result;
}

async function main() {
    loadBackendEnv();
    const pool = await createPool();
    try {
        console.log('\n=== Cross-channel payment test ===\n');
        await verifySchema(pool);

        const fixtures = await findFixtures(pool);
        if (!fixtures.product) throw new Error('No suitable product');
        if (!fixtures.employeeId) throw new Error('No POS employee');
        if (!fixtures.userId) throw new Error('No customer for cross-channel test');

        log('fixtures', JSON.stringify({
            product: `${fixtures.product.sku} ($${fixtures.product.price})`,
            userId: fixtures.userId,
            giftCard: fixtures.giftCard ? `#${fixtures.giftCard.id} $${fixtures.giftCard.current_balance}` : null
        }));

        let wallet = await assertWalletParity(pool, fixtures.userId);

        await runPosSplitTest(pool, fixtures, wallet);
        wallet = await assertWalletParity(pool, fixtures.userId);
        log('parity', 'Balances updated consistently after POS sale');

        await runWebWalletTest(pool, fixtures, wallet);
        await assertWalletParity(pool, fixtures.userId);
        log('parity', 'Balances consistent after web wallet checkout');

        console.log('\n=== All cross-channel tests passed ===\n');
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('\n✗ Cross-channel test failed:', err.code || err.message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
});
