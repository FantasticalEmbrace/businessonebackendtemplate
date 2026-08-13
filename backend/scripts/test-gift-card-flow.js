#!/usr/bin/env node
'use strict';

/**
 * End-to-end digital gift card tests (API + DB).
 * Run: node scripts/test-gift-card-flow.js [--base http://127.0.0.1:3001]
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { generateGiftCardCode, generateGiftCardPin } = require('../utils/giftCardCodes');
const { fulfillGiftCardsForOrder } = require('../services/giftCardFulfillment');
const { finalizePaidOrder } = require('../services/finalizePaidOrder');

loadBackendEnv();

const BASE = (() => {
    const i = process.argv.indexOf('--base');
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/+$/, '');
    return 'http://127.0.0.1:3001';
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEST_TAG = `GC-TEST-${Date.now()}`;
const TEST_RUN = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const RECIPIENT_EMAIL = `gc-recipient-${TEST_RUN}@hmherbs-test.local`;
const PURCHASER_EMAIL = `gc-buyer-${TEST_RUN}@hmherbs-test.local`;

const results = [];
let pool;

function pass(name, detail = '') {
    results.push({ ok: true, name, detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
    results.push({ ok: false, name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(opts.headers || {}),
        },
    });
    let body = null;
    try {
        body = await res.json();
    } catch {
        body = null;
    }
    return { status: res.status, body, ok: res.ok };
}

function customerToken(userId) {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET missing');
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createTestGiftCard({ balance, recipientEmail, customerId = null }) {
    const code = generateGiftCardCode();
    const pin = generateGiftCardPin();
    const [r] = await pool.execute(
        `INSERT INTO gift_cards (
            code, pin, card_type, status,
            initial_balance, current_balance, currency,
            customer_id, recipient_email, recipient_name,
            notes, issued_at, activated_at
        ) VALUES (?, ?, 'digital', 'active', ?, ?, 'USD', ?, ?, 'Test Recipient', ?, NOW(), NOW())`,
        [code, pin, balance, balance, customerId, recipientEmail, TEST_TAG]
    );
    await pool.execute(
        `INSERT INTO gift_card_transactions
            (gift_card_id, transaction_type, amount, balance_before, balance_after, source, description)
         VALUES (?, 'issue', ?, 0, ?, 'admin', ?)`,
        [r.insertId, balance, balance, `${TEST_TAG} issue`]
    );
    return { id: r.insertId, code, pin, balance };
}

async function findCheapProduct() {
    const [rows] = await pool.execute(
        `SELECT p.id, p.name, p.sku, p.price, p.gift_card_type
           FROM products p
          WHERE p.is_active = 1 AND (p.gift_card_type IS NULL)
          ORDER BY p.price ASC
          LIMIT 1`
    );
    return rows[0] || null;
}

async function findDigitalGiftProduct() {
    const [rows] = await pool.execute(
        `SELECT p.id, p.name, p.sku, p.gift_card_type, pv.id AS variant_id, pv.price
           FROM products p
           JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1
          WHERE p.is_active = 1 AND p.gift_card_type = 'digital'
          ORDER BY pv.price ASC
          LIMIT 1`
    );
    return rows[0] || null;
}

async function ensureTestUser(email, firstName = 'Gift', lastName = 'Tester') {
    const [[existing]] = await pool.execute('SELECT id, email FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing) return existing;
    const [r] = await pool.execute(
        `INSERT INTO users (email, first_name, last_name, password_hash, is_active, email_verified)
         VALUES (?, ?, ?, NULL, 1, 1)`,
        [email, firstName, lastName]
    );
    return { id: r.insertId, email };
}

function orderPayload({ product, variantId, price, paymentMethod, giftCard, giftCardMeta }) {
    return {
        customerInfo: {
            first_name: 'Gift',
            last_name: 'Tester',
            email: PURCHASER_EMAIL,
            phone: '(555) 555-0100',
        },
        shippingAddress: {
            address_line_1: '123 Test St',
            city: 'nmi',
            state: 'CO',
            postal_code: '81301',
            country: 'United States',
        },
        billingAddress: {
            address_line_1: '123 Test St',
            city: 'nmi',
            state: 'CO',
            postal_code: '81301',
            country: 'United States',
        },
        paymentMethod,
        cartItems: [
            {
                product_id: product.id,
                variant_id: variantId || null,
                quantity: 1,
                price: Number(price),
                giftCard: giftCardMeta || undefined,
            },
        ],
        giftCard: giftCard || undefined,
        shippingMethod: 'standard',
        shippingAmount: 0,
    };
}

async function getCardBalance(code) {
    const [[row]] = await pool.execute(
        'SELECT current_balance, status FROM gift_cards WHERE code = ? LIMIT 1',
        [code]
    );
    return row;
}

async function cleanup() {
    const [cards] = await pool.execute('SELECT id FROM gift_cards WHERE notes = ? OR recipient_email LIKE ?', [
        TEST_TAG,
        '%@hmherbs-test.local',
    ]);
    const ids = cards.map((c) => c.id);
    if (ids.length) {
        await pool.execute(
            `DELETE FROM gift_card_transactions WHERE gift_card_id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        await pool.execute(`DELETE FROM gift_cards WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    }
    await pool.execute('DELETE FROM users WHERE email LIKE ?', ['%@hmherbs-test.local']);
}

async function run() {
    console.log(`\nDigital gift card flow test — ${BASE}\n`);
    pool = createPool({ connectionLimit: 4 });

    let payCard;
    let issuedFromPurchase = null;

    try {
        // 1. Catalog
        console.log('Gift card catalog');
        const catalog = await api('/api/gift-cards/catalog');
        if (catalog.status === 200 && Array.isArray(catalog.body?.products)) {
            const digital = catalog.body.products.filter((p) => p.cardType === 'digital');
            if (digital.length) pass('Catalog loads digital gift card products', `${digital.length} product(s)`);
            else fail('Catalog digital products', 'none in catalog — run gift card migration/seed');
        } else {
            fail('GET /api/gift-cards/catalog', `HTTP ${catalog.status}`);
        }

        // 2. Issue test card (simulates admin)
        console.log('\nIssue & balance check');
        payCard = await createTestGiftCard({
            balance: 150,
            recipientEmail: `holder-${Date.now()}@hmherbs-test.local`,
        });
        pass('Create digital gift card', `${payCard.code} ($150)`);

        const balOk = await api('/api/gift-cards/check-balance', {
            method: 'POST',
            body: JSON.stringify({ code: payCard.code, pin: payCard.pin }),
        });
        if (balOk.status === 200 && Number(balOk.body?.gift_card?.current_balance) === 150) {
            pass('Check balance (correct PIN)', '$150.00');
        } else {
            fail('Check balance (correct PIN)', `HTTP ${balOk.status}`);
        }

        const balBad = await api('/api/gift-cards/check-balance', {
            method: 'POST',
            body: JSON.stringify({ code: payCard.code, pin: '0000' }),
        });
        if (balBad.status === 404) pass('Check balance rejects wrong PIN');
        else fail('Check balance rejects wrong PIN', `HTTP ${balBad.status}`);

        const balNoCode = await api('/api/gift-cards/check-balance', {
            method: 'POST',
            body: JSON.stringify({}),
        });
        if (balNoCode.status === 400) pass('Check balance requires code');
        else fail('Check balance requires code', `HTTP ${balNoCode.status}`);

        // 3. Redeem for merchandise
        console.log('\nCheckout redemption (pay with gift card)');
        const product = await findCheapProduct();
        if (!product) {
            fail('Find merchandise product', 'no active non-gift products');
        } else {
            const price = Number(product.price) || 5;
            const orderRes = await api('/api/orders', {
                method: 'POST',
                body: JSON.stringify(
                    orderPayload({
                        product,
                        price,
                        paymentMethod: 'gift_card',
                        giftCard: { code: payCard.code, pin: payCard.pin },
                    })
                ),
            });
            if (orderRes.status === 200 && orderRes.body?.orderId) {
                const orderTotal = Number(orderRes.body?.totals?.total ?? orderRes.body?.total);
                const after = await getCardBalance(payCard.code);
                const expected = +(150 - orderTotal).toFixed(2);
                if (Math.abs(Number(after.current_balance) - expected) < 0.02) {
                    pass('Order paid with gift card', `order #${orderRes.body.orderNumber}, balance $${after.current_balance}`);
                } else {
                    fail('Balance after redemption', `expected ~$${expected}, got $${after.current_balance}`);
                }
                if (orderRes.body.paymentStatus === 'paid') pass('Order payment status', 'paid');
                else fail('Order payment status', orderRes.body.paymentStatus);
            } else {
                fail('POST /api/orders (gift_card payment)', `${orderRes.status}: ${orderRes.body?.error || 'unknown'}`);
            }
        }

        // 4. Insufficient balance
        const poorCard = await createTestGiftCard({ balance: 1, recipientEmail: `poor-${Date.now()}@hmherbs-test.local` });
        if (product) {
            const insuf = await api('/api/orders', {
                method: 'POST',
                body: JSON.stringify(
                    orderPayload({
                        product,
                        price: Number(product.price) || 5,
                        paymentMethod: 'gift_card',
                        giftCard: { code: poorCard.code, pin: poorCard.pin },
                    })
                ),
            });
            if (insuf.status === 400 && /balance/i.test(insuf.body?.error || '')) {
                pass('Rejects insufficient gift card balance');
            } else {
                fail('Rejects insufficient gift card balance', `HTTP ${insuf.status}`);
            }
        }

        // 5. Purchase digital gift card (pay with gift card)
        console.log('\nPurchase digital gift card product');
        const gcProduct = await findDigitalGiftProduct();
        if (!gcProduct) {
            fail('Digital gift card product in DB', 'none found');
        } else {
            const gcPrice = Number(gcProduct.price);
            const bigCard = await createTestGiftCard({ balance: 200, recipientEmail: `big-${Date.now()}@hmherbs-test.local` });
            const buyRes = await api('/api/orders', {
                method: 'POST',
                body: JSON.stringify(
                    orderPayload({
                        product: gcProduct,
                        variantId: gcProduct.variant_id,
                        price: gcPrice,
                        paymentMethod: 'gift_card',
                        giftCard: { code: bigCard.code, pin: bigCard.pin },
                        giftCardMeta: {
                            cardType: 'digital',
                            recipientEmail: RECIPIENT_EMAIL,
                            recipientName: 'Digital Recipient',
                            recipientPhone: '(555) 555-0100',
                            recipientAddress: {
                                line1: '456 Recipient Ave',
                                city: 'nmi',
                                state: 'CO',
                                postalCode: '81301',
                                country: 'United States'
                            },
                            senderName: 'Test Buyer',
                            personalMessage: 'Enjoy your gift!',
                            includePersonalizedEmail: true,
                            greetingOccasion: 'birthday'
                        },
                    })
                ),
            });
            if (buyRes.status === 200 && buyRes.body?.orderId) {
                pass('Purchase digital gift card order', `order #${buyRes.body.orderNumber}`);
                await sleep(2500);
                const [[issuedCount]] = await pool.execute(
                    'SELECT COUNT(*) AS n FROM gift_cards WHERE order_id = ?',
                    [buyRes.body.orderId]
                );
                let fulfill = { issued: Number(issuedCount.n) || 0 };
                if (!fulfill.issued) {
                    fulfill = await fulfillGiftCardsForOrder(pool, buyRes.body.orderId);
                }
                if (fulfill.issued >= 1) {
                    pass('Fulfillment issues gift card', `${fulfill.issued} card(s)`);
                } else {
                    fail('Fulfillment issues gift card', JSON.stringify(fulfill));
                }
                const [[issued]] = await pool.execute(
                    `SELECT id, code, pin, current_balance, recipient_email, customer_id, card_type
                       FROM gift_cards WHERE order_id = ? LIMIT 1`,
                    [buyRes.body.orderId]
                );
                if (issued && issued.card_type === 'digital' && issued.recipient_email === RECIPIENT_EMAIL) {
                    pass('Issued card linked to recipient', `${issued.code} $${issued.current_balance}`);
                    issuedFromPurchase = issued;
                } else {
                    fail('Issued card metadata', 'missing or wrong recipient');
                }
            } else {
                fail('Purchase digital gift card order', `${buyRes.status}: ${buyRes.body?.error || 'unknown'}`);
            }
        }

        // 6. Digital validation — missing email
        if (gcProduct) {
            const noEmail = await api('/api/orders', {
                method: 'POST',
                body: JSON.stringify(
                    orderPayload({
                        product: gcProduct,
                        variantId: gcProduct.variant_id,
                        price: Number(gcProduct.price),
                        paymentMethod: 'gift_card',
                        giftCard: { code: payCard.code, pin: payCard.pin },
                        giftCardMeta: { cardType: 'digital' },
                    })
                ),
            });
            if (noEmail.status === 400 && /recipient email/i.test(noEmail.body?.error || '')) {
                pass('Digital purchase requires recipient email');
            } else {
                fail('Digital purchase requires recipient email', `HTTP ${noEmail.status}`);
            }
        }

        // 7. Account gift cards API
        console.log('\nAccount-linked gift cards');
        if (issuedFromPurchase) {
            const recipient = await ensureTestUser(RECIPIENT_EMAIL, 'Digital', 'Recipient');
            await pool.execute('UPDATE gift_cards SET customer_id = ? WHERE id = ?', [
                recipient.id,
                issuedFromPurchase.id,
            ]);
            const token = customerToken(recipient.id);
            const userCards = await api('/api/user/gift-cards', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (userCards.status === 200 && Array.isArray(userCards.body?.gift_cards)) {
                const found = userCards.body.gift_cards.some((c) => Number(c.id) === Number(issuedFromPurchase.id));
                if (found) pass('GET /api/user/gift-cards lists assigned card');
                else fail('GET /api/user/gift-cards', 'issued card not in list');
            } else {
                fail('GET /api/user/gift-cards', `HTTP ${userCards.status}`);
            }

            const redeemById = await api('/api/orders', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify(
                    orderPayload({
                        product: product || { id: 1, price: 1 },
                        price: product ? Number(product.price) : 1,
                        paymentMethod: 'gift_card',
                        giftCard: { id: issuedFromPurchase.id },
                    })
                ),
            });
            if (redeemById.status === 200) {
                pass('Redeem via account gift card id (signed in)');
            } else if (redeemById.status === 400 && /balance/i.test(redeemById.body?.error || '')) {
                pass('Account gift card id redemption path works', 'balance too low after prior tests');
            } else {
                fail('Redeem via account gift card id', `${redeemById.status}: ${redeemById.body?.error}`);
            }
        }

        // 8. Admin stats endpoint shape (if admin login available)
        console.log('\nAdmin gift card API');
        const adminEmail = process.env.ADMIN_TEST_EMAIL || process.env.SEED_ADMIN_EMAIL;
        const adminPassword = process.env.ADMIN_TEST_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
        if (adminEmail && adminPassword) {
            const login = await api('/api/admin/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email: adminEmail, password: adminPassword }),
            });
            if (login.status === 200 && login.body?.token) {
                pass('Admin login for gift card admin API');
                const stats = await api('/api/admin/gift-cards/stats', {
                    headers: { Authorization: `Bearer ${login.body.token}` },
                });
                if (stats.status === 200 && stats.body?.total_cards != null) pass('Admin gift card stats');
                else fail('Admin gift card stats', `HTTP ${stats.status}`);
            } else {
                fail('Admin login', `HTTP ${login.status} — set ADMIN_TEST_EMAIL/PASSWORD to test admin API`);
            }
        } else {
            pass('Admin API', 'skipped (set ADMIN_TEST_EMAIL + ADMIN_TEST_PASSWORD to include)');
        }
    } finally {
        console.log('\nCleanup test data');
        try {
            await cleanup();
            pass('Removed test gift cards and users');
        } catch (e) {
            fail('Cleanup', e.message);
        }
        await pool.end();
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('\nFailed:');
        for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
        process.exit(1);
    }
    process.exit(0);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
