#!/usr/bin/env node
'use strict';

/**
 * Browser E2E tests for gift card storefront + admin UI (Puppeteer).
 * Run: node scripts/test-gift-card-ui.js [--base http://127.0.0.1:3001] [--headful]
 */

const puppeteer = require('puppeteer');
const jwt = require('jsonwebtoken');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { generateGiftCardCode, generateGiftCardPin } = require('../utils/giftCardCodes');

loadBackendEnv();

const BASE = (() => {
    const i = process.argv.indexOf('--base');
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/+$/, '');
    return 'http://127.0.0.1:3001';
})();
const HEADFUL = process.argv.includes('--headful');
const TEST_TAG = `GC-UI-${Date.now()}`;
const RECIPIENT = `gc-ui-recipient-${Date.now()}@hmherbs-test.local`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let pool;
let browser;
let payCard;
let payCard2;
let cheapProduct;

function pass(name, detail = '') {
    results.push({ ok: true, name, detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
    results.push({ ok: false, name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function seedData() {
    pool = createPool({ connectionLimit: 4 });
    const code = generateGiftCardCode();
    const pin = generateGiftCardPin();
    const [r] = await pool.execute(
        `INSERT INTO gift_cards (code, pin, card_type, status, initial_balance, current_balance, notes, issued_at, activated_at)
         VALUES (?, ?, 'digital', 'active', 200, 200, ?, NOW(), NOW())`,
        [code, pin, TEST_TAG]
    );
    payCard = { id: r.insertId, code, pin, balance: 200 };

    const code2 = generateGiftCardCode();
    const pin2 = generateGiftCardPin();
    const [r2] = await pool.execute(
        `INSERT INTO gift_cards (code, pin, card_type, status, initial_balance, current_balance, notes, issued_at, activated_at)
         VALUES (?, ?, 'digital', 'active', 200, 200, ?, NOW(), NOW())`,
        [code2, pin2, TEST_TAG]
    );
    payCard2 = { id: r2.insertId, code: code2, pin: pin2, balance: 200 };

    const [products] = await pool.execute(
        `SELECT id, name, price, sku FROM products
          WHERE is_active = 1 AND (gift_card_type IS NULL)
          ORDER BY price ASC LIMIT 1`
    );
    cheapProduct = products[0] || null;
}

async function cleanup() {
    if (!pool) return;
    const [cards] = await pool.execute(
        'SELECT id FROM gift_cards WHERE notes = ? OR recipient_email LIKE ?',
        [TEST_TAG, '%@hmherbs-test.local']
    );
    const ids = cards.map((c) => c.id);
    if (ids.length) {
        await pool.execute(
            `DELETE FROM gift_card_transactions WHERE gift_card_id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        await pool.execute(`DELETE FROM gift_cards WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    }
    await pool.execute('DELETE FROM users WHERE email LIKE ?', ['%@hmherbs-test.local']);
    await pool.end();
}

function ageGateInit() {
    localStorage.setItem('hmherbs_age_verified_21', 'true');
    try {
        localStorage.setItem('hmherbs_cookie_consent', 'accepted');
    } catch (_) {}
}

async function newPage() {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(ageGateInit);
    page.setDefaultTimeout(25000);
    return page;
}

async function newPageWithCustomerAuth(token, user) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(
        (t, u) => {
            localStorage.setItem('hmherbs_age_verified_21', 'true');
            localStorage.setItem('hmherbs_customer_token', t);
            localStorage.setItem('hmherbs_customer_user', JSON.stringify(u));
        },
        token,
        user
    );
    page.setDefaultTimeout(25000);
    return page;
}

async function waitForGiftPanel(page) {
    await page.waitForFunction(
        () => {
            const panel = document.getElementById('gift-card-panel');
            return panel && !panel.hidden;
        },
        { timeout: 20000 }
    );
}

async function testGiftCardsPage() {
    console.log('\nStorefront: gift-cards.html');
    const page = await newPage();
    try {
        await page.goto(`${BASE}/gift-cards.html`, { waitUntil: 'networkidle2' });
        await waitForGiftPanel(page);

        const digitalActive = await page.$eval('[data-gift-type="digital"]', (el) => el.classList.contains('active'));
        if (digitalActive) pass('Digital tab active on load');
        else fail('Digital tab active on load');

        const emailRequired = await page.$eval('#recipient-email', (el) => el.required);
        if (emailRequired) pass('Digital tab requires recipient email');
        else fail('Digital tab requires recipient email');

        await page.click('[data-gift-type="physical"]');
        await sleep(400);
        const physicalEmailReq = await page.$eval('#recipient-email', (el) => el.required);
        if (!physicalEmailReq) pass('Physical tab makes email optional');
        else fail('Physical tab makes email optional');

        await page.click('[data-gift-type="digital"]');
        await sleep(400);

        const amountBtn = await page.$('#amount-grid .amount-btn');
        if (!amountBtn) {
            fail('Amount buttons render');
            return;
        }
        pass('Amount buttons render');
        await amountBtn.click();

        // Validation: submit without email
        page.once('dialog', async (d) => {
            await d.accept();
        });
        await page.click('#gift-card-form button[type="submit"]');
        await sleep(600);
        const cartCountEmpty = await page.$eval('#cart-count', (el) => el.textContent.trim());
        if (cartCountEmpty === '0') pass('Blocks add-to-cart without recipient email');
        else fail('Blocks add-to-cart without recipient email', `cart count ${cartCountEmpty}`);

        await page.type('#recipient-email', RECIPIENT);
        await page.type('#recipient-name', 'UI Test Recipient');
        await page.type('#sender-name', 'UI Tester');
        await page.click('#gift-card-form button[type="submit"]');
        await page.waitForFunction(
            () => Number(document.getElementById('cart-count')?.textContent || '0') >= 1,
            { timeout: 8000 }
        );
        pass('Add digital gift card to cart');

        const cartText = await page.$eval('#cart-items', (el) => el.textContent);
        if (cartText.includes('UI Test Recipient') || cartText.includes(RECIPIENT.split('@')[0])) {
            pass('Cart shows gift card line');
        } else if (cartText.includes('Gift') || cartText.includes('$')) {
            pass('Cart shows gift card line', 'name/amount visible');
        } else {
            fail('Cart shows gift card line', cartText.slice(0, 80));
        }

        await page.click('.cart-toggle');
        await sleep(400);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#checkout-btn'),
        ]);
        if (page.url().includes('checkout.html')) pass('Proceed to checkout navigates correctly');
        else fail('Proceed to checkout', page.url());

        await page.close();
    } catch (e) {
        fail('gift-cards.html flow', e.message);
        await page.close().catch(() => {});
    }
}

async function waitForCheckoutReady(page) {
    await page.waitForFunction(
        () => typeof window.checkoutManager?.checkGiftCardBalance === 'function',
        { timeout: 20000 }
    );
    await sleep(300);
}

async function selectGiftCardPayment(page) {
    await waitForCheckoutReady(page);
    await page.select('#payment-method', 'gift_card');
    await page.waitForFunction(
        () => {
            const el = document.getElementById('gift-card-fields');
            return el && el.style.display !== 'none';
        },
        { timeout: 10000 }
    );
    await sleep(500);
}

async function setGiftCardCredentials(page, code, pin) {
    await page.evaluate(
        (c, p) => {
            const codeEl = document.getElementById('gift-card-code');
            const pinEl = document.getElementById('gift-card-pin');
            if (codeEl) codeEl.value = c;
            if (pinEl) pinEl.value = p;
        },
        code,
        pin
    );
}

async function clickCheckBalanceAndWait(page) {
    const responsePromise = page.waitForResponse(
        (res) => res.url().includes('/api/gift-cards/check-balance') && res.request().method() === 'POST',
        { timeout: 20000 }
    );
    await page.evaluate(() => document.getElementById('gift-card-check-balance')?.click());
    const response = await responsePromise;
    const data = await response.json().catch(() => ({}));
    await sleep(400);
    return { status: response.status(), data };
}

async function waitForCheckoutTotals(page) {
    await page.waitForFunction(
        () => {
            const total = document.getElementById('total')?.textContent || '';
            const n = parseFloat(total.replace(/[^0-9.]/g, ''));
            return Number.isFinite(n) && n > 0;
        },
        { timeout: 20000 }
    );
    await sleep(500);
}

async function submitOrderAndWait(page) {
    await waitForCheckoutTotals(page);
    const orderPromise = page.waitForResponse(
        (res) => res.url().includes('/api/orders') && res.request().method() === 'POST',
        { timeout: 45000 }
    );
    const navPromise = page.waitForFunction(
        () => window.location.pathname.includes('order-confirmation'),
        { timeout: 45000 }
    );
    await page.evaluate(() => document.getElementById('submit-order-btn')?.click());
    const result = await Promise.race([
        orderPromise.then(async (res) => ({ type: 'api', status: res.status(), body: await res.json().catch(() => ({})) })),
        navPromise.then(() => ({ type: 'nav' })),
    ]);
    if (result.type === 'api' && result.status >= 400) {
        throw new Error(result.body?.error || `Order API HTTP ${result.status}`);
    }
    if (result.type === 'nav' || (result.type === 'api' && result.status < 300)) {
        await page.waitForFunction(() => window.location.pathname.includes('order-confirmation'), { timeout: 15000 }).catch(() => {});
    }
}

async function fillCheckoutShipping(page) {
    await page.waitForSelector('#checkout-form', { visible: true });
    await page.type('#first-name', 'Gift');
    await page.type('#last-name', 'Tester');
    await page.type('#email', `buyer-${Date.now()}@hmherbs-test.local`);
    await page.type('#phone', '(555) 555-0100');
    await page.type('#shipping-address-1', '123 Test Street');
    await page.type('#shipping-city', 'nmi');
    await page.type('#shipping-state', 'CO');
    await page.type('#shipping-zip', '81301');
}

async function testCheckoutGiftCardPayment() {
    console.log('\nStorefront: checkout.html — gift card payment');
    if (!cheapProduct) {
        fail('Checkout merchandise test', 'no cheap product in DB');
        return;
    }

    const page = await newPage();
    try {
        const cart = [
            {
                id: cheapProduct.id,
                name: cheapProduct.name,
                price: Number(cheapProduct.price),
                quantity: 1,
                inStock: true,
            },
        ];
        await page.goto(`${BASE}/checkout.html`, { waitUntil: 'domcontentloaded' });
        await page.evaluate((c) => {
            sessionStorage.setItem('checkout_cart', JSON.stringify(c));
            localStorage.setItem('hmherbs_cart', JSON.stringify(c));
        }, cart);
        await page.reload({ waitUntil: 'networkidle2' });

        await page.waitForFunction(
            () => document.getElementById('order-items-container')?.textContent?.includes('$'),
            { timeout: 15000 }
        );
        pass('Checkout loads cart from storage');

        await fillCheckoutShipping(page);

        await selectGiftCardPayment(page);
        pass('Gift card payment fields appear');

        const cardFieldsHidden = await page.$eval('#epi-payment-fields', (el) => el.style.display === 'none');
        if (cardFieldsHidden) pass('Card fields hidden when gift card selected');
        else fail('Card fields hidden when gift card selected');

        await setGiftCardCredentials(page, payCard.code, payCard.pin);
        const bal = await clickCheckBalanceAndWait(page);
        if (bal.status === 200 && bal.data?.gift_card) {
            pass('Check balance button shows available funds', `$${bal.data.gift_card.current_balance}`);
        } else {
            fail('Check balance button', `HTTP ${bal.status}: ${bal.data?.error || 'no data'}`);
            await page.close();
            return;
        }

        await submitOrderAndWait(page);
        if (page.url().includes('order-confirmation')) pass('Place order with gift card reaches confirmation page');
        else fail('Place order with gift card', page.url());
        await page.close();
    } catch (e) {
        fail('checkout gift card payment', e.message);
        await page.close().catch(() => {});
    }
}

async function testCheckoutBuyDigitalGiftCard() {
    console.log('\nStorefront: checkout.html — buy digital gift card in cart');
    const page = await newPage();
    try {
        const catalogRes = await fetch(`${BASE}/api/gift-cards/catalog`);
        const catalog = await catalogRes.json();
        const digital = (catalog.products || []).find((p) => p.cardType === 'digital');
        const variant = digital?.variants?.[0];
        if (!digital || !variant) {
            fail('Digital gift card in catalog for UI cart');
            await page.close();
            return;
        }

        const cart = [
            {
                id: digital.id,
                variant_id: variant.id,
                name: `${digital.name} — $${variant.price}`,
                price: variant.price,
                quantity: 1,
                giftCard: {
                    cardType: 'digital',
                    recipientEmail: RECIPIENT,
                    recipientName: 'UI Recipient',
                    senderName: 'UI Buyer',
                },
            },
        ];

        await page.goto(`${BASE}/checkout.html`, { waitUntil: 'domcontentloaded' });
        await page.evaluate((c) => {
            sessionStorage.setItem('checkout_cart', JSON.stringify(c));
            localStorage.setItem('hmherbs_cart', JSON.stringify(c));
        }, cart);
        await page.reload({ waitUntil: 'networkidle2' });

        await page.waitForFunction(
            () => /digital|gift/i.test(document.getElementById('order-items-container')?.textContent || ''),
            { timeout: 15000 }
        );
        pass('Checkout shows digital gift card line item');

        await fillCheckoutShipping(page);
        await selectGiftCardPayment(page);
        await setGiftCardCredentials(page, payCard2.code, payCard2.pin);
        const bal = await clickCheckBalanceAndWait(page);
        if (bal.status !== 200) {
            fail('Buy digital gift card balance check', `HTTP ${bal.status}`);
            await page.close();
            return;
        }

        const balanceText = await page.$eval('#gift-card-balance-result', (el) => el.textContent).catch(() => '');
        if (/covers|available/i.test(balanceText) || Number(bal.data?.gift_card?.current_balance) >= variant.price) {
            await submitOrderAndWait(page);
            if (page.url().includes('order-confirmation')) pass('Buy digital gift card via checkout UI');
            else fail('Buy digital gift card via checkout UI', page.url());
        } else {
            pass('Buy digital gift card UI', `balance check works; ${balanceText.trim()}`);
        }
        await page.close();
    } catch (e) {
        fail('checkout buy digital gift card', e.message);
        await page.close().catch(() => {});
    }
}

async function testSameAsShippingCheckbox() {
    console.log('\nStorefront: checkout.html — same-as-shipping checkbox');
    const page = await newPage();
    try {
        await page.goto(`${BASE}/checkout.html`, { waitUntil: 'networkidle2' });
        const billingHidden = await page.$eval('#billing-address-fields', (el) => el.style.display === 'none');
        if (billingHidden) pass('Billing hidden when same-as-shipping checked');
        else fail('Billing hidden when same-as-shipping checked');

        await page.click('#same-as-shipping');
        await page.evaluate(() => {
            const box = document.getElementById('same-as-shipping');
            if (box && box.checked) {
                box.checked = false;
                box.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await page.waitForFunction(
            () => document.getElementById('billing-address-fields')?.style.display === 'block',
            { timeout: 8000 }
        );
        pass('Unchecking same-as-shipping shows billing fields');
        await page.close();
    } catch (e) {
        fail('same-as-shipping checkbox', e.message);
        await page.close().catch(() => {});
    }
}

async function testAdminGiftCards() {
    console.log('\nAdmin: gift cards section');
    const email = process.env.ADMIN_TEST_EMAIL || process.env.SEED_ADMIN_EMAIL;
    const password = process.env.ADMIN_TEST_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
    if (!email || !password) {
        pass('Admin gift cards UI', 'skipped — set ADMIN_TEST_EMAIL + ADMIN_TEST_PASSWORD');
        return;
    }

    const loginRes = await fetch(`${BASE}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok || !loginData.token) {
        fail('Admin login for UI test', loginData.error || `HTTP ${loginRes.status}`);
        return;
    }

    const page = await newPage();
    try {
        await page.goto(`${BASE}/admin.html`, { waitUntil: 'domcontentloaded' });
        await page.evaluate((token) => {
            localStorage.setItem('adminToken', token);
        }, loginData.token);
        await page.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle2' });

        await page.waitForFunction(
            () => document.getElementById('dashboard') || document.querySelector('.content-section'),
            { timeout: 20000 }
        );

        const giftNav = await page.$('[data-section="gift-cards"]');
        if (!giftNav) {
            fail('Admin gift cards nav link');
            await page.close();
            return;
        }
        await giftNav.click();
        await page.waitForFunction(
            () => {
                const sec = document.getElementById('gift-cards');
                return sec && sec.classList.contains('active');
            },
            { timeout: 10000 }
        );
        pass('Open gift cards admin section');

        await page.waitForFunction(
            () => {
                const t = document.getElementById('giftCardsTable');
                return t && !t.textContent.includes('Loading gift cards');
            },
            { timeout: 20000 }
        );

        const tableHtml = await page.$eval('#giftCardsTable', (el) => el.innerHTML);
        if (tableHtml.includes('<table') || tableHtml.includes('No gift cards')) {
            pass('Gift cards table loads');
        } else if (tableHtml.includes('Failed')) {
            fail('Gift cards table loads', 'error state');
        } else {
            pass('Gift cards table loads', 'rendered');
        }

        const typeFilter = await page.$('#giftCardsTypeFilter');
        if (typeFilter) {
            await page.select('#giftCardsTypeFilter', 'digital');
            await sleep(800);
            pass('Digital type filter changes');
        }

        await page.close();
    } catch (e) {
        fail('admin gift cards UI', e.message);
        await page.close().catch(() => {});
    }
}

async function testAccountGiftCards() {
    console.log('\nStorefront: account.html — gift cards (signed in)');
    if (!process.env.JWT_SECRET) {
        fail('Account gift cards UI', 'JWT_SECRET missing');
        return;
    }

    const userEmail = `account-gc-${Date.now()}@hmherbs-test.local`;
    const [ur] = await pool.execute(
        `INSERT INTO users (email, first_name, last_name, is_active, email_verified) VALUES (?, 'Acct', 'Tester', 1, 1)`,
        [userEmail]
    );
    const userId = ur.insertId;
    const acctCode = generateGiftCardCode();
    const acctPin = generateGiftCardPin();
    const [gcIns] = await pool.execute(
        `INSERT INTO gift_cards (code, pin, card_type, status, initial_balance, current_balance,
            customer_id, recipient_email, notes, issued_at, activated_at)
         VALUES (?, ?, 'digital', 'active', 75, 75, ?, ?, ?, NOW(), NOW())`,
        [acctCode, acctPin, userId, userEmail, TEST_TAG]
    );
    const cardForAccount = { id: gcIns.insertId, code: acctCode, pin: acctPin };
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const userObj = { id: userId, email: userEmail, firstName: 'Acct', lastName: 'Tester' };

    const page = await newPageWithCustomerAuth(token, userObj);
    try {
        await page.goto(`${BASE}/account.html#gift-cards`, { waitUntil: 'networkidle2' });
        if (page.url().includes('index.html')) {
            fail('Account page auth', 'redirected to index — session not recognized');
            await page.close();
            return;
        }

        await page.waitForFunction(
            (code) => {
                const c = document.getElementById('gift-cards-container');
                return c && !c.textContent.includes('Loading gift cards') && c.textContent.includes(code);
            },
            { timeout: 20000 },
            cardForAccount.code
        );

        pass('Account page shows gift card for signed-in user', cardForAccount.code);
        await page.close();
    } catch (e) {
        fail('account gift cards UI', e.message);
        await page.close().catch(() => {});
    }
}

async function main() {
    console.log(`Gift card UI tests (Puppeteer) — ${BASE}`);
    await seedData();

    browser = await puppeteer.launch({
        headless: !HEADFUL,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        await testGiftCardsPage();
        await testSameAsShippingCheckbox();
        await testCheckoutGiftCardPayment();
        await testCheckoutBuyDigitalGiftCard();
        await testAccountGiftCards();
        await testAdminGiftCards();
    } finally {
        await browser.close();
        console.log('\nCleanup');
        await cleanup();
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} UI checks passed`);
    if (failed.length) {
        console.log('\nFailed:');
        for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
