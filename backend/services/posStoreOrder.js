'use strict';

const { finalizePaidOrder, recalcUserOrderAggregates } = require('./finalizePaidOrder');
const { reverseOrderFinancials } = require('./orderTenderReversal');
const { normalizeSalesChannel } = require('../utils/orderChannel');
const { verifyManagerPin, verifyRefundPin, getEmployeeById, employeeAllowManualDiscounts } = require('./posPersonnel');
const {
    loadCashDiscountSettings,
    applyCartDiscountToEnriched,
    merchandiseSubtotal,
    computeDualPricing,
    resolveTotalsForPayment
} = require('./posCashDiscount');
const { loadPosPaymentMethodsSettings } = require('./posPaymentMethodsSettings');
const { loadStoreTaxRate } = require('../utils/storeTaxRate');
const {
    loadPosSecuritySettings,
    lineDiscountNeedsManagerPin
} = require('./posSecuritySettings');
const InventoryService = require('./inventory');
const { loadPosPaymentProcessor } = require('./storePaymentProcessor');
const { pricePosCart } = require('./posPromotionPricing');
const promoEngine = require('./webPromotionEngine');
const { loadLoyaltyProgramSettings } = require('./customerLoyalty');
const {
    normalizeTendersFromPayload,
    validateTendersForSale,
    formatTenderNotes,
    applyTendersToOrder,
    persistOrderTenders,
    recordTendersOnShift,
    usesCardPricing,
    resolvePrimaryPaymentMethod,
    buildPaymentReference: buildSplitPaymentReference
} = require('./posSplitTender');

const ALLOWED_PAYMENT_METHODS = new Set(['cash', 'check', 'card_terminal', 'gift_card']);
const POS_CUSTOM_SKU = 'POS-CUSTOM';
const POS_CUSTOM_SLUG = 'pos-custom';
const FORBIDDEN_PAYMENT_KEYS = new Set([
    'card_number',
    'cardNumber',
    'pan',
    'cvv',
    'cvc',
    'card_cvv',
    'expiry',
    'expiration',
    'track_data',
    'magstripe'
]);

function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
}

function sqlBind(value) {
    return value === undefined ? null : value;
}

function generatePosOrderNumber() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `POS${y}${m}${day}-${seq}`;
}

function parseTaxExemptSale(payload) {
    const root = payload && typeof payload === 'object' ? payload : {};
    const payment = root.payment && typeof root.payment === 'object' ? root.payment : {};
    const exempt = Boolean(
        root.taxExempt || root.tax_exempt || payment.taxExempt || payment.tax_exempt
    );
    const reason = String(
        root.taxExemptReason
        || root.tax_exempt_reason
        || payment.taxExemptReason
        || payment.tax_exempt_reason
        || ''
    ).trim().slice(0, 500);
    return { exempt, reason };
}

function getInStoreEmail() {
    return String(process.env.POS_IN_STORE_EMAIL || 'pos-instore@hmherbs.local').trim();
}

function parseCustomerId(payload) {
    const raw =
        payload.userId
        ?? payload.user_id
        ?? payload.customerId
        ?? payload.customer_id
        ?? null;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function parseGiftCardTender(payload) {
    const gc = payload.giftCard || payload.gift_card;
    if (!gc || typeof gc !== 'object') return null;
    const amount = Number(gc.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
        giftCardId: gc.giftCardId != null ? Number(gc.giftCardId) : gc.id != null ? Number(gc.id) : null,
        code: gc.code ? String(gc.code).trim() : null,
        pin: gc.pin != null ? String(gc.pin).trim() : null,
        amount: roundMoney(amount)
    };
}

function parseLoyaltyPointsRedeem(payload) {
    const pts = Number(payload.loyaltyPointsRedeem ?? payload.loyalty_points_redeem ?? 0);
    if (!Number.isFinite(pts) || pts <= 0) return 0;
    return Math.floor(pts);
}

function parseLoyaltyCashRedeem(payload) {
    const amt = Number(payload.loyaltyCashRedeem ?? payload.loyalty_cash_redeem ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) return 0;
    return roundMoney(amt);
}

function appendTenderNotes(notes, { loyaltyCash, loyaltyPoints, giftCard, amountDue }) {
    const parts = [notes];
    if (loyaltyCash?.cashRedeemed > 0) {
        parts.push(`Store credit redeemed: $${loyaltyCash.cashRedeemed.toFixed(2)}`);
    }
    if (loyaltyPoints?.pointsRedeemed > 0) {
        parts.push(`Loyalty points redeemed: ${loyaltyPoints.pointsRedeemed} pts ($${loyaltyPoints.dollarValue.toFixed(2)})`);
    }
    if (giftCard?.amount > 0) {
        parts.push(`Gift card applied: $${giftCard.amount.toFixed(2)}`);
    }
    if (amountDue <= 0.005 && (loyaltyCash?.cashRedeemed || loyaltyPoints?.pointsRedeemed || giftCard?.amount)) {
        parts.push('Balance paid with store credit (loyalty / gift card).');
    }
    return parts.filter(Boolean).join('\n');
}

function assertPaymentCoversDue(method, paymentMeta, amountDue) {
    const due = roundMoney(amountDue);
    if (due <= 0.005) return method;

    if (method === 'cash') {
        const tendered = Number(paymentMeta.cashTendered ?? paymentMeta.cash_tendered);
        if (Number.isFinite(tendered) && tendered + 0.0001 < due) {
            const err = new Error('INSUFFICIENT_CASH_TENDER');
            err.code = 'INSUFFICIENT_CASH_TENDER';
            err.message = 'Cash tendered is less than the amount due after store credit.';
            throw err;
        }
    }
    return method;
}

function assertCompliantPaymentPayload(body, enabledMethods, opts = {}) {
    const amountDue = opts.amountDue != null ? roundMoney(opts.amountDue) : null;
    const skipTenderChecks = amountDue != null && amountDue <= 0.005;
    if (!body || typeof body !== 'object') {
        const err = new Error('INVALID_PAYMENT');
        err.code = 'INVALID_PAYMENT';
        throw err;
    }

    for (const key of Object.keys(body)) {
        if (FORBIDDEN_PAYMENT_KEYS.has(key)) {
            const err = new Error('CARD_DATA_NOT_ALLOWED');
            err.code = 'CARD_DATA_NOT_ALLOWED';
            err.message = 'Card numbers and CVV must never be sent to this POS API. Use the external card terminal.';
            throw err;
        }
    }

    const method = String(body.paymentMethod || body.payment_method || '').trim().toLowerCase();
    const allowed = enabledMethods instanceof Set
        ? enabledMethods
        : new Set(
              Array.isArray(enabledMethods) && enabledMethods.length
                  ? enabledMethods
                  : [...ALLOWED_PAYMENT_METHODS]
          );
    if (!allowed.has(method)) {
        const err = new Error('PAYMENT_METHOD_NOT_AVAILABLE');
        err.code = method && ALLOWED_PAYMENT_METHODS.has(method) ? 'PAYMENT_METHOD_DISABLED' : 'INVALID_PAYMENT_METHOD';
        err.message =
            err.code === 'PAYMENT_METHOD_DISABLED'
                ? 'This payment method is turned off for this store.'
                : 'Invalid payment method';
        throw err;
    }

    if (method === 'card_terminal' && !skipTenderChecks) {
        const lastFour = String(body.terminalLastFour || body.terminal_last_four || '').replace(/\D/g, '');
        const auth = String(body.terminalAuthCode || body.terminal_auth_code || '').trim();
        const approved = body.terminalApprovedConfirmed || body.terminal_approved_confirmed;
        if (lastFour.length > 0 && lastFour.length !== 4) {
            const err = new Error('TERMINAL_LAST_FOUR_INVALID');
            err.code = 'TERMINAL_LAST_FOUR_INVALID';
            throw err;
        }
        if (!approved && lastFour.length !== 4 && !auth) {
            const err = new Error('TERMINAL_APPROVAL_REQUIRED');
            err.code = 'TERMINAL_APPROVAL_REQUIRED';
            err.message = 'Confirm card approval on the terminal before completing the sale.';
            throw err;
        }
    }

    return method;
}

function buildPaymentReference(method, paymentMeta = {}) {
    if (method === 'cash') return 'pos:cash';
    if (method === 'check') return `pos:check:${String(paymentMeta.checkNumber || paymentMeta.check_number || 'na').slice(0, 32)}`;

    const auth = String(paymentMeta.terminalAuthCode || paymentMeta.terminal_auth_code || '').trim();
    const lastFour = String(paymentMeta.terminalLastFour || paymentMeta.terminal_last_four || '').replace(/\D/g, '');
    const ref = String(paymentMeta.terminalReference || paymentMeta.terminal_reference || '').trim();
    const offline = paymentMeta.terminalOfflineApproved || paymentMeta.terminal_offline_approved ? 'offline' : 'online';
    return `pos:terminal:${offline}:${lastFour}:${auth || 'na'}:${ref || 'na'}`.slice(0, 120);
}

function buildOrderNotes(method, paymentMeta = {}, discountAmount = 0, taxExemptInfo = null, cartDiscountAmount = 0, groupDiscountLabel = null) {
    const parts = [`Payment method: ${method}`, 'Channel: in_store POS'];
    if (taxExemptInfo?.exempt) {
        parts.push(`Tax exempt: ${taxExemptInfo.reason || 'no reason recorded'}`);
    }
    if (cartDiscountAmount > 0) {
        const label = groupDiscountLabel || 'Automatic discount';
        parts.push(`${label}: -$${cartDiscountAmount.toFixed(2)}`);
    }
    const cashDiscountAmount = roundMoney(Number(discountAmount) - Number(cartDiscountAmount));
    if (cashDiscountAmount > 0) {
        parts.push(`Cash discount: -$${cashDiscountAmount.toFixed(2)}`);
    }
    if (method === 'card_terminal') {
        const lastFour = String(paymentMeta.terminalLastFour || paymentMeta.terminal_last_four || '').replace(/\D/g, '');
        const auth = String(paymentMeta.terminalAuthCode || paymentMeta.terminal_auth_code || '').trim();
        const brand = String(paymentMeta.terminalCardBrand || paymentMeta.terminal_card_brand || 'card').trim();
        const ref = String(paymentMeta.terminalReference || paymentMeta.terminal_reference || '').trim();
        const isQuickPay = ref === 'mx_quick_pay' || auth === 'QUICKPAY';
        if (isQuickPay) {
            parts.push(
                lastFour.length === 4
                    ? `MX Quick Pay: ${brand} •••• ${lastFour}`
                    : 'MX Quick Pay (approved in portal)'
            );
        } else if (lastFour.length === 4) {
            parts.push(`Terminal: ${brand} •••• ${lastFour}`);
        } else {
            parts.push(`Terminal: ${brand} (approved on device)`);
        }
        if (auth && auth !== 'QUICKPAY') parts.push(`Auth: ${auth}`);
        if (paymentMeta.terminalOfflineApproved || paymentMeta.terminal_offline_approved) {
            parts.push('Terminal offline approval — batch may settle when online.');
        }
    }
    if (paymentMeta.note) parts.push(String(paymentMeta.note).trim());
    return parts.join('\n');
}

function isCustomPosLine(raw) {
    if (!raw || typeof raw !== 'object') return false;
    if (raw.custom === true || raw.customItem === true || raw.custom_item === true) return true;
    const sku = String(raw.sku || '').trim().toUpperCase();
    return sku === POS_CUSTOM_SKU || sku.startsWith(`${POS_CUSTOM_SKU}-`);
}

function parseCustomUnitPrice(raw) {
    const price = roundMoney(raw.unitPrice ?? raw.unit_price ?? raw.price ?? raw.customPrice);
    if (!Number.isFinite(price) || price < 0.01 || price > 99999.99) {
        const err = new Error('CUSTOM_ITEM_PRICE_INVALID');
        err.code = 'CUSTOM_ITEM_PRICE_INVALID';
        err.message = 'Custom item price must be between $0.01 and $99,999.99.';
        throw err;
    }
    return price;
}

function parseCustomItemName(raw) {
    const name = String(raw.name || raw.productName || raw.product_name || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 120);
    if (name.length < 1) {
        const err = new Error('CUSTOM_ITEM_NAME_REQUIRED');
        err.code = 'CUSTOM_ITEM_NAME_REQUIRED';
        err.message = 'Enter a name for the custom item.';
        throw err;
    }
    return name;
}

async function ensurePosCustomProduct(pool) {
    const [existing] = await pool.execute(
        `SELECT id, sku, name, price, is_taxable, is_active FROM products WHERE sku = ? LIMIT 1`,
        [POS_CUSTOM_SKU]
    );
    if (existing[0]) {
        if (!existing[0].is_active) {
            await pool.execute(`UPDATE products SET is_active = 1, track_inventory = 0 WHERE id = ?`, [
                existing[0].id
            ]);
        }
        return existing[0];
    }

    const [brandRows] = await pool.execute(
        `SELECT id FROM brands ORDER BY is_active DESC, id ASC LIMIT 1`
    );
    const [categoryRows] = await pool.execute(
        `SELECT id FROM product_categories ORDER BY is_active DESC, id ASC LIMIT 1`
    );
    const brand = brandRows[0];
    const category = categoryRows[0];
    if (!brand?.id || !category?.id) {
        const err = new Error('CUSTOM_ITEM_UNAVAILABLE');
        err.code = 'CUSTOM_ITEM_UNAVAILABLE';
        err.message = 'Custom items need at least one brand and category in the catalog.';
        throw err;
    }

    const columns = [
        'sku',
        'name',
        'slug',
        'short_description',
        'brand_id',
        'category_id',
        'price',
        'is_taxable',
        'track_inventory',
        'inventory_quantity',
        'is_active',
        'requires_shipping'
    ];
    const values = [
        POS_CUSTOM_SKU,
        'Custom item',
        POS_CUSTOM_SLUG,
        'Open-price POS custom item (not sold on the website).',
        brand.id,
        category.id,
        0,
        1,
        0,
        0,
        1,
        0
    ];

    try {
        const [showCol] = await pool.query(
            `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'show_on_web'`
        );
        if (Number(showCol[0]?.c) > 0) {
            columns.push('show_on_web');
            values.push(0);
        }
    } catch {
        /* optional column */
    }

    try {
        await pool.execute(
            `INSERT INTO products (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
            values
        );
    } catch (e) {
        if (!/duplicate/i.test(e.message || '') && e.code !== 'ER_DUP_ENTRY') throw e;
    }

    const [created] = await pool.execute(
        `SELECT id, sku, name, price, is_taxable FROM products WHERE sku = ? LIMIT 1`,
        [POS_CUSTOM_SKU]
    );
    if (!created[0]) {
        const err = new Error('CUSTOM_ITEM_UNAVAILABLE');
        err.code = 'CUSTOM_ITEM_UNAVAILABLE';
        err.message = 'Could not create the POS custom item product.';
        throw err;
    }
    return created[0];
}

async function loadCatalogLines(pool, lineItems) {
    const enriched = [];
    let customProduct = null;
    for (const raw of lineItems) {
        const quantity = Number(raw.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999) {
            const err = new Error('INVALID_LINE_QUANTITY');
            err.code = 'INVALID_LINE_QUANTITY';
            throw err;
        }

        if (isCustomPosLine(raw)) {
            if (!customProduct) customProduct = await ensurePosCustomProduct(pool);
            const name = parseCustomItemName(raw);
            const unitPrice = parseCustomUnitPrice(raw);
            const isTaxable =
                raw.isTaxable === false ||
                raw.is_taxable === false ||
                raw.isTaxable === 0 ||
                raw.is_taxable === 0 ||
                String(raw.isTaxable || raw.is_taxable || '').toLowerCase() === 'false'
                    ? false
                    : true;
            enriched.push({
                product_id: customProduct.id,
                variant_id: null,
                sku: POS_CUSTOM_SKU,
                name,
                quantity,
                unitPrice,
                catalogUnitPrice: unitPrice,
                lineDiscountPercent: 0,
                lineTotal: roundMoney(unitPrice * quantity),
                is_taxable: isTaxable,
                custom: true
            });
            continue;
        }

        const sku = String(raw.sku || '').trim();
        const productId = Number(raw.productId || raw.product_id || 0);
        const variantId = raw.variantId || raw.variant_id ? Number(raw.variantId || raw.variant_id) : null;

        let productRow = null;
        let variantRow = null;

        if (variantId) {
            const [variants] = await pool.execute(
                `SELECT pv.*, p.name AS product_name, p.is_taxable, p.track_inventory, p.is_active AS product_active
                 FROM product_variants pv
                 JOIN products p ON p.id = pv.product_id
                 WHERE pv.id = ? AND pv.is_active = 1 AND p.is_active = 1
                 LIMIT 1`,
                [variantId]
            );
            variantRow = variants[0] || null;
            if (variantRow) productRow = variantRow;
        }

        if (!productRow && sku) {
            const [byVariantSku] = await pool.execute(
                `SELECT pv.*, p.id AS parent_product_id, p.name AS product_name, p.is_taxable, p.track_inventory, p.is_active AS product_active
                 FROM product_variants pv
                 JOIN products p ON p.id = pv.product_id
                 WHERE pv.sku = ? AND pv.is_active = 1 AND p.is_active = 1
                 LIMIT 1`,
                [sku]
            );
            if (byVariantSku[0]) {
                variantRow = byVariantSku[0];
                productRow = byVariantSku[0];
            } else {
                const [byProductSku] = await pool.execute(
                    `SELECT id, sku, name, price, is_taxable, track_inventory, inventory_quantity
                     FROM products WHERE sku = ? AND is_active = 1 LIMIT 1`,
                    [sku]
                );
                productRow = byProductSku[0] || null;
            }
        }

        if (!productRow && productId) {
            const [byId] = await pool.execute(
                `SELECT id, sku, name, price, is_taxable, track_inventory, inventory_quantity
                 FROM products WHERE id = ? AND is_active = 1 LIMIT 1`,
                [productId]
            );
            productRow = byId[0] || null;
        }

        if (!productRow) {
            const err = new Error('PRODUCT_NOT_FOUND');
            err.code = 'PRODUCT_NOT_FOUND';
            err.sku = sku;
            throw err;
        }

        const unitPriceCatalog = variantRow
            ? roundMoney(variantRow.price)
            : roundMoney(productRow.price);
        const lineDiscountPercent = Math.min(
            100,
            Math.max(0, Number(raw.lineDiscountPercent || raw.line_discount_percent || 0))
        );
        const unitPrice = roundMoney(unitPriceCatalog * (1 - lineDiscountPercent / 100));
        const resolvedProductId = variantRow ? variantRow.product_id || variantRow.parent_product_id : productRow.id;
        const resolvedVariantId = variantRow ? variantRow.id : null;
        const lineSku = variantRow ? variantRow.sku : productRow.sku;
        const lineName = variantRow
            ? `${variantRow.product_name || productRow.name} — ${variantRow.name}`
            : productRow.name;

        enriched.push({
            product_id: resolvedProductId,
            variant_id: resolvedVariantId,
            sku: lineSku,
            name: lineName,
            quantity,
            unitPrice,
            catalogUnitPrice: unitPriceCatalog,
            lineDiscountPercent,
            lineTotal: roundMoney(unitPrice * quantity),
            is_taxable: Boolean(productRow.is_taxable)
        });
    }
    return enriched;
}

function computeTotals(enriched, taxRate) {
    const subtotal = roundMoney(enriched.reduce((sum, line) => sum + line.lineTotal, 0));
    const taxableSubtotal = roundMoney(
        enriched.filter((line) => line.is_taxable).reduce((sum, line) => sum + line.lineTotal, 0)
    );
    const taxAmount = roundMoney(taxableSubtotal * taxRate);
    const totalAmount = roundMoney(subtotal + taxAmount);
    return { subtotal, taxAmount, totalAmount };
}

async function findExistingByClientTx(pool, clientTransactionId) {
    if (!clientTransactionId) return null;
    const [rows] = await pool.execute(
        `SELECT id, order_number, payment_status, total_amount, payment_reference, status
         FROM orders WHERE pos_client_transaction_id = ? LIMIT 1`,
        [clientTransactionId]
    );
    return rows[0] || null;
}

async function resumePendingPosOrder(pool, existing, options = {}) {
    const result = {
        duplicate: true,
        orderId: existing.id,
        orderNumber: existing.order_number,
        paymentStatus: existing.payment_status,
        totalAmount: Number(existing.total_amount)
    };
    if (existing.payment_status !== 'pending') return result;

    const finalized = await finalizePaidOrder(pool, {
        orderId: existing.id,
        paymentId: existing.payment_reference || `pos:retry:${existing.id}`,
        paymentStatus: 'paid',
        skipConfirmationEmail: true,
        allowOversell: Boolean(options.allowOversell ?? true)
    });
    return {
        ...result,
        paymentStatus: 'paid',
        orderNumber: finalized.orderNumber || result.orderNumber
    };
}

async function validateSaleManagerAuth(pool, lineItems, managerPin, context = {}, cartDiscountPercent = 0) {
    const settings = await loadPosSecuritySettings(pool);
    const needsPin = (lineItems || []).some((raw) =>
        lineDiscountNeedsManagerPin(raw.lineDiscountPercent || raw.line_discount_percent, settings)
    ) || lineDiscountNeedsManagerPin(cartDiscountPercent, settings);
    if (!needsPin) return null;
    if (!managerPin) {
        const err = new Error('MANAGER_PIN_REQUIRED');
        err.code = 'MANAGER_PIN_REQUIRED';
        err.message = 'Manager PIN required for discounts above the allowed limit.';
        throw err;
    }
    return verifyManagerPin(pool, managerPin, context);
}

function parseCartDiscountPercent(payload) {
    const pct = Number(payload?.cartDiscountPercent ?? payload?.cart_discount_percent ?? 0);
    if (!Number.isFinite(pct)) return 0;
    return Math.min(100, Math.max(0, pct));
}

function assertManualDiscountsAllowed(allowManual, lineItems, cartDiscountPercent) {
    if (allowManual) return;
    const cartPct = Number(cartDiscountPercent) || 0;
    if (cartPct > 0) {
        const err = new Error('MANUAL_DISCOUNT_DISABLED');
        err.code = 'MANUAL_DISCOUNT_DISABLED';
        err.message = 'Manual sale discounts are disabled for this employee.';
        throw err;
    }
    for (const raw of lineItems || []) {
        const linePct = Number(raw.lineDiscountPercent || raw.line_discount_percent) || 0;
        if (linePct > 0) {
            const err = new Error('MANUAL_DISCOUNT_DISABLED');
            err.code = 'MANUAL_DISCOUNT_DISABLED';
            err.message = 'Manual line discounts are disabled for this employee.';
            throw err;
        }
    }
}

/**
 * Create and finalize an in-store POS order (PCI-safe: no card PAN/CVV).
 */
async function createInStorePosOrder(pool, payload, deviceId, verifiedEmployeeId = null) {
    const posProcessor = await loadPosPaymentProcessor(pool);
    const clientTransactionId = String(
        payload.clientTransactionId || payload.client_transaction_id || ''
    ).trim().slice(0, 64);
    if (!verifiedEmployeeId) {
        const err = new Error('EMPLOYEE_AUTH_REQUIRED');
        err.code = 'EMPLOYEE_AUTH_REQUIRED';
        err.message = 'Employee sign-in required to complete sales.';
        throw err;
    }
    const employeeId = Number(verifiedEmployeeId);
    const payloadEmployeeId =
        payload.employeeId || payload.employee_id ? Number(payload.employeeId || payload.employee_id) : null;
    const fromOfflineSync = Boolean(payload.fromOfflineSync || payload._fromOfflineSync);
    if (!fromOfflineSync && payloadEmployeeId && payloadEmployeeId !== employeeId) {
        const err = new Error('EMPLOYEE_MISMATCH');
        err.code = 'EMPLOYEE_MISMATCH';
        err.message = 'Sale employee does not match signed-in employee.';
        throw err;
    }
    const shiftSessionId = payload.shiftSessionId || payload.shift_session_id
        ? Number(payload.shiftSessionId || payload.shift_session_id)
        : null;

    if (clientTransactionId) {
        const existing = await findExistingByClientTx(pool, clientTransactionId);
        if (existing) {
            return resumePendingPosOrder(pool, existing, {
                allowOversell: fromOfflineSync || Boolean(
                    payload.payment?.terminalApprovedConfirmed ||
                        payload.payment?.terminal_approved_confirmed ||
                        payload.terminalApprovedConfirmed ||
                        payload.terminal_approved_confirmed
                )
            });
        }
    }

    const lineItems = Array.isArray(payload.items) ? payload.items : [];
    if (!lineItems.length) {
        const err = new Error('EMPTY_CART');
        err.code = 'EMPTY_CART';
        throw err;
    }

    const managerPin = String(payload.managerPin || payload.manager_pin || '').replace(/\D/g, '').slice(0, 4);
    const securitySettings = await loadPosSecuritySettings(pool);
    const employee = await getEmployeeById(pool, employeeId);
    const allowManualDiscounts = employeeAllowManualDiscounts(employee);
    const clientCartDiscountPercent = parseCartDiscountPercent(payload);
    assertManualDiscountsAllowed(allowManualDiscounts, lineItems, clientCartDiscountPercent);

    const paymentSettings = await loadPosPaymentMethodsSettings(pool);
    const loyaltySettings = await loadLoyaltyProgramSettings(pool);
    const customerUserId = parseCustomerId(payload);
    const customerUser = customerUserId ? await resolveCustomerUser(pool, customerUserId) : null;
    if (customerUserId && !customerUser) {
        const err = new Error('CUSTOMER_NOT_FOUND');
        err.code = 'CUSTOMER_NOT_FOUND';
        err.message = 'Attached customer profile was not found.';
        throw err;
    }

    const enrichedPreview = await loadCatalogLines(pool, lineItems);
    const preCartSubtotal = merchandiseSubtotal(enrichedPreview);

    const paymentMeta = payload.payment || payload;
    let taxExemptInfo = parseTaxExemptSale(payload);
    if (!taxExemptInfo.exempt && customerUser?.tax_exempt) {
        taxExemptInfo = {
            exempt: true,
            reason: String(customerUser.tax_exempt_id || 'Customer tax-exempt on file').slice(0, 500)
        };
    }
    if (taxExemptInfo.exempt && taxExemptInfo.reason.length < 3) {
        const err = new Error('TAX_EXEMPT_REASON_REQUIRED');
        err.code = 'TAX_EXEMPT_REASON_REQUIRED';
        err.message = 'A tax exemption reason note is required (at least 3 characters).';
        throw err;
    }
    const storeTaxRate = await loadStoreTaxRate(pool);
    const taxRate = taxExemptInfo.exempt ? 0 : storeTaxRate;

    const promoPricing = await pricePosCart(pool, {
        catalogLines: enrichedPreview,
        customerUser,
        taxExempt: taxExemptInfo.exempt,
        taxRate,
        allowManualDiscounts,
        manualCartDiscountPercent: clientCartDiscountPercent
    });

    let effectiveCartDiscountPercent = 0;
    let groupDiscountLabel = promoPricing.cartDiscountLabel || null;
    if (preCartSubtotal > 0 && promoPricing.cartDiscountAmount > 0) {
        effectiveCartDiscountPercent = Math.min(
            100,
            (promoPricing.cartDiscountAmount / preCartSubtotal) * 100
        );
    }

    const authorizer = fromOfflineSync
        ? null
        : await validateSaleManagerAuth(pool, lineItems, managerPin || null, {
              deviceId,
              ip: payload.clientIp
          }, allowManualDiscounts ? effectiveCartDiscountPercent : 0);

    const enriched = enrichedPreview;
    const preCartSubtotalFinal = preCartSubtotal;
    const pricedLines = applyCartDiscountToEnriched(enriched, effectiveCartDiscountPercent);
    const cashSettings = await loadCashDiscountSettings(pool);
    const pricing = computeDualPricing(pricedLines, taxRate, cashSettings.enabled ? cashSettings.percent : 0);
    const cartDiscountAmount = roundMoney(preCartSubtotalFinal - pricing.card.subtotal);

    const draftTenders = normalizeTendersFromPayload(
        payload,
        loyaltySettings,
        null,
        fromOfflineSync ? { trustClientAmount: true } : {}
    );
    const pricingMethod = usesCardPricing(draftTenders) ? 'card_terminal' : 'cash';
    let totalsFinal = resolveTotalsForPayment(pricing, pricingMethod, cartDiscountAmount);
    let saleTotal = totalsFinal.totalAmount;

    const tenders = Array.isArray(payload.paymentTenders) && payload.paymentTenders.length
        ? draftTenders
        : normalizeTendersFromPayload(
              payload,
              loyaltySettings,
              saleTotal,
              fromOfflineSync ? { trustClientAmount: true } : {}
          );

    if (fromOfflineSync && tenders.length) {
        const snap = payload.offlinePricing || payload.offline_pricing;
        const tenderSum = roundMoney(tenders.reduce((sum, t) => sum + roundMoney(t.amount), 0));
        const snapTotal = roundMoney(Number(snap?.totalAmount ?? snap?.total) || 0);
        let targetTotal = saleTotal;
        if (snapTotal > 0.005 && tenderSum > 0.005 && Math.abs(snapTotal - tenderSum) <= 0.02) {
            targetTotal = snapTotal;
        } else if (tenderSum > 0.005) {
            targetTotal = tenderSum;
        } else if (snapTotal > 0.005) {
            targetTotal = snapTotal;
        }
        if (Math.abs(targetTotal - saleTotal) > 0.005) {
            const ratio = saleTotal > 0.005 ? targetTotal / saleTotal : 1;
            totalsFinal = {
                ...totalsFinal,
                subtotal: roundMoney(totalsFinal.subtotal * ratio),
                taxAmount: roundMoney(totalsFinal.taxAmount * ratio),
                totalAmount: targetTotal,
                discountAmount: roundMoney(totalsFinal.discountAmount * ratio)
            };
            saleTotal = targetTotal;
        }
    }

    if (!tenders.length) {
        const err = new Error('PAYMENT_REQUIRED');
        err.code = 'PAYMENT_REQUIRED';
        err.message = 'At least one payment tender is required.';
        throw err;
    }

    for (const key of Object.keys(paymentMeta || {})) {
        if (FORBIDDEN_PAYMENT_KEYS.has(key)) {
            const err = new Error('CARD_DATA_NOT_ALLOWED');
            err.code = 'CARD_DATA_NOT_ALLOWED';
            err.message = 'Card numbers and CVV must never be sent to this POS API. Use the external card terminal.';
            throw err;
        }
    }

    const enabledMethods = new Set([...paymentSettings.methods, 'gift_card', 'split']);
    for (const t of tenders) {
        if (t.type === 'cash' && !enabledMethods.has('cash')) {
            const err = new Error('PAYMENT_METHOD_DISABLED');
            err.code = 'PAYMENT_METHOD_DISABLED';
            err.message = 'Cash payments are turned off for this store.';
            throw err;
        }
        if (t.type === 'check' && !enabledMethods.has('check')) {
            const err = new Error('PAYMENT_METHOD_DISABLED');
            err.code = 'PAYMENT_METHOD_DISABLED';
            err.message = 'Check payments are turned off for this store.';
            throw err;
        }
        if (t.type === 'card_terminal' && !enabledMethods.has('card_terminal')) {
            const err = new Error('PAYMENT_METHOD_DISABLED');
            err.code = 'PAYMENT_METHOD_DISABLED';
            err.message = 'Card terminal payments are turned off for this store.';
            throw err;
        }
    }

    validateTendersForSale(tenders, saleTotal, {
        customerUserId: customerUser?.id || null,
        cardApprovedConfirmed: Boolean(
            paymentMeta.terminalApprovedConfirmed ||
                paymentMeta.terminal_approved_confirmed ||
                fromOfflineSync
        ),
        skipCardTerminalChecks: tenders.every((t) => t.type !== 'card_terminal' || t.amount <= 0.005)
    });

    const paymentMethod = resolvePrimaryPaymentMethod(tenders);
    const primaryCash = tenders.find((t) => t.type === 'cash');
    const primaryCard = tenders.find((t) => t.type === 'card_terminal');
    const paymentReference = primaryCard
        ? buildSplitPaymentReference('card_terminal', primaryCard)
        : primaryCash
          ? buildSplitPaymentReference('cash', primaryCash)
          : buildSplitPaymentReference(tenders[0].type, tenders[0]);

    const orderNumber = generatePosOrderNumber();
    const orderEmail = customerUser?.email || getInStoreEmail();
    const shippingFirst = customerUser?.first_name || 'In-Store';
    const shippingLast = customerUser?.last_name || 'Customer';
    const salesChannel = normalizeSalesChannel('in_store');
    const notesBase = buildOrderNotes(
        paymentMethod,
        paymentMeta,
        totalsFinal.discountAmount,
        taxExemptInfo,
        cartDiscountAmount,
        groupDiscountLabel
    );
    const notesWithAuth = authorizer
        ? `${notesBase}\nManager approval: ${authorizer.name} (${authorizer.employeeCode})`
        : notesBase;
    const notesFinal = `${notesWithAuth}\n${formatTenderNotes(tenders)}`.trim();

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        const [orderResult] = await connection.execute(
            `INSERT INTO orders (
                order_number, user_id, email, status, payment_status,
                subtotal, tax_amount, shipping_amount, discount_amount, total_amount,
                shipping_first_name, shipping_last_name,
                billing_first_name, billing_last_name,
                notes, payment_method, payment_reference, sales_channel,
                pos_client_transaction_id, pos_device_id, pos_employee_id, pos_shift_session_id
            ) VALUES (?, ?, ?, 'pending', 'pending', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                orderNumber,
                customerUser?.id || null,
                orderEmail,
                totalsFinal.subtotal,
                totalsFinal.taxAmount,
                totalsFinal.discountAmount,
                saleTotal,
                shippingFirst,
                shippingLast,
                shippingFirst,
                shippingLast,
                notesFinal,
                paymentMethod,
                paymentReference,
                salesChannel,
                clientTransactionId || null,
                deviceId || null,
                employeeId,
                shiftSessionId
            ].map(sqlBind)
        );

        const orderId = orderResult.insertId;

        if (promoPricing.promotion?.id) {
            try {
                await connection.execute(
                    'UPDATE orders SET web_promotion_id = ?, promo_code = ? WHERE id = ?',
                    [promoPricing.promotion.id, promoPricing.promotion.code, orderId]
                );
                await promoEngine.insertRedemptionRow(connection, {
                    promotionId: promoPricing.promotion.id,
                    orderId,
                    email: orderEmail,
                    userId: customerUser?.id || null,
                    merchandiseDisc: promoPricing.promoDiscountAmount,
                    shippingDisc: 0
                });
            } catch (promoErr) {
                if (promoErr.code !== 'ER_BAD_FIELD_ERROR' && promoErr.errno !== 1054) {
                    throw promoErr;
                }
            }
        }

        const redemptionTypes = new Set(['loyalty_cash', 'loyalty_points', 'gift_card']);
        const redeemTenders = tenders.filter((t) => redemptionTypes.has(t.type));
        let redemptionResults = { loyaltyCash: null, loyaltyPoints: null, giftCards: [] };
        const needsAttachedCustomer = redeemTenders.some(
            (t) =>
                t.type === 'loyalty_cash' ||
                t.type === 'loyalty_points' ||
                (t.type === 'gift_card' && t.giftCardId)
        );
        if (needsAttachedCustomer && !customerUser) {
            const err = new Error('CUSTOMER_REQUIRED_FOR_LOYALTY');
            err.code = 'CUSTOMER_REQUIRED_FOR_LOYALTY';
            err.message = 'Attach a customer profile to use store credit, points, or account gift cards.';
            throw err;
        }
        if (redeemTenders.length) {
            redemptionResults = await applyTendersToOrder(connection, {
                tenders: redeemTenders,
                orderId,
                customerUser: customerUser || null,
                loyaltySettings,
                source: 'pos'
            });
        }

        try {
            await persistOrderTenders(connection, orderId, tenders);
        } catch (persistErr) {
            if (persistErr?.code !== 'ER_NO_SUCH_TABLE') throw persistErr;
        }

        for (const line of enriched) {
            await connection.execute(
                `INSERT INTO order_items (
                    order_id, product_id, variant_id, product_name, product_sku,
                    variant_name, quantity, price, total
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    line.product_id,
                    line.variant_id,
                    line.name,
                    line.sku,
                    line.variant_id ? line.name.split(' — ').pop() : null,
                    line.quantity,
                    line.unitPrice,
                    line.lineTotal
                ].map(sqlBind)
            );
        }

        await connection.commit();

        const paymentCaptured = Boolean(
            fromOfflineSync ||
                paymentMeta.terminalApprovedConfirmed ||
                paymentMeta.terminal_approved_confirmed
        );
        const finalized = await finalizePaidOrder(pool, {
            orderId,
            paymentId: paymentReference,
            paymentStatus: 'paid',
            paymentProcessor: posProcessor,
            skipConfirmationEmail: true,
            allowOversell: paymentCaptured
        });

        if (shiftSessionId) {
            await recordTendersOnShift(pool, shiftSessionId, tenders);
        }

        const cashTender = tenders.find((t) => t.type === 'cash');
        const giftCardTotal = tenders
            .filter((t) => t.type === 'gift_card')
            .reduce((s, t) => s + roundMoney(t.amount), 0);

        return {
            duplicate: false,
            orderId: finalized.orderId,
            orderNumber: finalized.orderNumber,
            paymentStatus: 'paid',
            totalAmount: saleTotal,
            paymentTenders: tenders,
            subtotal: totalsFinal.subtotal,
            taxAmount: totalsFinal.taxAmount,
            cashDiscountAmount: pricing.cash?.cashDiscountAmount || 0,
            customerId: customerUser?.id || null,
            loyaltyEarned: loyaltySettings.enabled && customerUser ? undefined : null,
            loyaltyCashRedeemed: redemptionResults.loyaltyCash?.cashRedeemed || 0,
            loyaltyPointsRedeemed: redemptionResults.loyaltyPoints?.pointsRedeemed || 0,
            giftCardApplied: giftCardTotal,
            cashChange: cashTender?.cashChange || 0
        };
    } catch (e) {
        await connection.rollback();
        if (e?.code === 'ER_DUP_ENTRY' && clientTransactionId) {
            const existing = await findExistingByClientTx(pool, clientTransactionId);
            if (existing) {
                return resumePendingPosOrder(pool, existing, { allowOversell: true });
            }
        }
        throw e;
    } finally {
        connection.release();
    }
}

async function syncPosOrderBatch(pool, sales, deviceId, verifiedEmployeeId = null) {
    const results = [];
    for (const sale of sales) {
        try {
            const normalized = { ...sale, fromOfflineSync: true };
            delete normalized.employeeId;
            delete normalized.employee_id;
            const result = await createInStorePosOrder(pool, normalized, deviceId, verifiedEmployeeId);
            results.push({
                clientTransactionId: sale.clientTransactionId || sale.client_transaction_id,
                success: true,
                duplicate: Boolean(result.duplicate),
                orderId: result.orderId,
                orderNumber: result.orderNumber,
                totalAmount: result.totalAmount
            });
        } catch (error) {
            results.push({
                clientTransactionId: sale.clientTransactionId || sale.client_transaction_id,
                success: false,
                code: error.code || error.errno || 'SYNC_FAILED',
                error: error.message || 'Failed to sync sale'
            });
        }
    }
    return results;
}

async function refundInStorePosOrder(pool, orderNumber, payload, employeeId, deviceId, context = {}) {
    const managerPin = String(payload.managerPin || payload.manager_pin || '').replace(/\D/g, '').slice(0, 4);
    if (!managerPin) {
        const err = new Error('MANAGER_PIN_REQUIRED');
        err.code = 'MANAGER_PIN_REQUIRED';
        err.message = 'An authorized employee PIN is required to process refunds.';
        throw err;
    }
    const authorizer = await verifyRefundPin(pool, managerPin, { deviceId, ip: context.ip });

    const reason = String(payload.reason || payload.refundReason || '').trim().slice(0, 500);
    if (reason.length < 3) {
        const err = new Error('REFUND_REASON_REQUIRED');
        err.code = 'REFUND_REASON_REQUIRED';
        err.message = 'A refund reason is required (at least 3 characters).';
        throw err;
    }

    const orderNum = String(orderNumber || '').trim();
    const [orders] = await pool.execute(
        `SELECT id, order_number, payment_status, status, sales_channel, pos_employee_id,
                payment_reference, payment_processor, payment_token, total_amount
         FROM orders WHERE order_number = ? LIMIT 1`,
        [orderNum]
    );
    const order = orders[0];
    if (!order) {
        const err = new Error('ORDER_NOT_FOUND');
        err.code = 'ORDER_NOT_FOUND';
        throw err;
    }
    if (String(order.sales_channel || '').toLowerCase() !== 'in_store') {
        const err = new Error('ORDER_NOT_POS');
        err.code = 'ORDER_NOT_POS';
        err.message = 'Only in-store POS orders can be refunded from the register.';
        throw err;
    }
    if (order.payment_status === 'refunded') {
        const err = new Error('ORDER_ALREADY_REFUNDED');
        err.code = 'ORDER_ALREADY_REFUNDED';
        throw err;
    }
    if (order.payment_status !== 'paid') {
        const err = new Error('ORDER_NOT_REFUNDABLE');
        err.code = 'ORDER_NOT_REFUNDABLE';
        throw err;
    }

    const [orderItems] = await pool.execute(
        `SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = ?`,
        [order.id]
    );

    const { reverseOrderCardPayment } = require('./orderPaymentReversal');
    const refundAmount = payload.amount != null ? payload.amount : payload.refundAmount;
    const gatewayReverse = await reverseOrderCardPayment(pool, order, {
        amount: refundAmount,
        operation: 'auto',
    });
    if (!gatewayReverse.skipped && !gatewayReverse.ok) {
        const err = new Error('GATEWAY_REFUND_FAILED');
        err.code = 'GATEWAY_REFUND_FAILED';
        err.message = gatewayReverse.responseText || 'Card refund failed at payment processor';
        throw err;
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        const refundNote = `POS refund by employee #${employeeId}: ${reason}\nRefund authorized by: ${authorizer.name} (${authorizer.employeeCode})${
            gatewayReverse.ok
                ? `\nGateway ${gatewayReverse.operation || 'refund'}: ${gatewayReverse.transactionId || gatewayReverse.paymentId || 'ok'}`
                : ''
        }`;
        await connection.execute(
            `UPDATE orders SET status = 'cancelled', payment_status = 'refunded',
                notes = CONCAT(COALESCE(notes, ''), IF(COALESCE(notes, '') = '', '', '\n'), ?)
             WHERE id = ?`,
            [refundNote, order.id]
        );

        const inventoryService = new InventoryService(pool);
        const inventoryItems = orderItems.map((item) => ({
            productId: item.product_id,
            variantId: item.variant_id,
            quantity: item.quantity
        }));
        await inventoryService.restoreInventoryForOrder(
            inventoryItems,
            order.id,
            `POS refund ${orderNum} — ${reason}`,
            connection
        );

        const [[fullOrder]] = await connection.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [order.id]);
        await reverseOrderFinancials(connection, order.id, fullOrder || order, {
            clawbackEarn: true,
            reversePromo: true
        });

        const [[refreshed]] = await connection.execute(
            'SELECT user_id FROM orders WHERE id = ? LIMIT 1',
            [order.id]
        );
        if (refreshed?.user_id) {
            await recalcUserOrderAggregates(connection, refreshed.user_id);
        }

        await connection.commit();
        return {
            orderId: order.id,
            orderNumber: order.order_number,
            paymentStatus: 'refunded'
        };
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
}

module.exports = {
    createInStorePosOrder,
    syncPosOrderBatch,
    refundInStorePosOrder,
    assertCompliantPaymentPayload,
    loadCatalogLines,
    ensurePosCustomProduct,
    POS_CUSTOM_SKU,
    ALLOWED_PAYMENT_METHODS
};
