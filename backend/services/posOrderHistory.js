'use strict';

const { normalizeTenderRow } = require('./posSplitTender');
const { getStoreDayBoundsRfc3339 } = require('../utils/storeTimezone');

const PAYMENT_LABELS = {
    cash: 'Cash',
    card_terminal: 'Card',
    check: 'Check',
    gift_card: 'Gift card',
    split: 'Split payment',
    loyalty_cash: 'Store credit',
    loyalty_points: 'Points'
};

function paymentLabel(method, tenders) {
    if (Array.isArray(tenders) && tenders.length > 1) return PAYMENT_LABELS.split;
    if (Array.isArray(tenders) && tenders.length === 1) {
        return PAYMENT_LABELS[tenders[0].type] || tenders[0].type;
    }
    return PAYMENT_LABELS[method] || method || 'Paid';
}

function parseNotesMeta(notes) {
    const text = String(notes || '');
    const lines = text.split('\n');
    let taxExempt = false;
    let taxExemptReason = '';
    let cartDiscountAmount = 0;
    let cashDiscountAmount = 0;
    for (const line of lines) {
        if (line.startsWith('Tax exempt:')) {
            taxExempt = true;
            taxExemptReason = line.slice('Tax exempt:'.length).trim();
        }
        const saleDisc = line.match(/^Sale discount: -\$([\d.]+)/);
        if (saleDisc) cartDiscountAmount = Number(saleDisc[1]) || 0;
        const cashDisc = line.match(/^Cash discount: -\$([\d.]+)/);
        if (cashDisc) cashDiscountAmount = Number(cashDisc[1]) || 0;
    }
    return { taxExempt, taxExemptReason, cartDiscountAmount, cashDiscountAmount };
}

async function loadOrderTenders(pool, orderId, order) {
    try {
        const [rows] = await pool.execute(
            `SELECT tender_type, amount, loyalty_points, gift_card_id,
                    cash_tendered, cash_change, check_number,
                    terminal_last_four, terminal_auth_code
               FROM order_payment_tenders
              WHERE order_id = ?
              ORDER BY id ASC`,
            [orderId]
        );
        if (rows?.length) {
            return rows
                .map((row) =>
                    normalizeTenderRow(
                        {
                            type: row.tender_type,
                            amount: row.amount,
                            loyaltyPoints: row.loyalty_points,
                            giftCardId: row.gift_card_id,
                            cashTendered: row.cash_tendered,
                            cashChange: row.cash_change,
                            checkNumber: row.check_number,
                            terminalLastFour: row.terminal_last_four,
                            terminalAuthCode: row.terminal_auth_code
                        },
                        null
                    )
                )
                .filter(Boolean);
        }
    } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }

    const amount = Number(order.total_amount) || 0;
    if (amount <= 0) return [];
    const method = String(order.payment_method || 'cash');
    if (method === 'cash') {
        return [{ type: 'cash', amount, cashTendered: amount, cashChange: 0 }];
    }
    if (method === 'card_terminal') {
        return [{ type: 'card_terminal', amount }];
    }
    if (method === 'check') {
        return [{ type: 'check', amount }];
    }
    if (method === 'gift_card') {
        return [{ type: 'gift_card', amount }];
    }
    return [{ type: 'cash', amount }];
}

function buildReceiptPayload(order, items, tenders, employee) {
    const notesMeta = parseNotesMeta(order.notes);
    const discountAmount = Number(order.discount_amount) || 0;
    const subtotal = Number(order.subtotal) || 0;
    const taxAmount = Number(order.tax_amount) || 0;
    const total = Number(order.total_amount) || 0;
    const cartDiscountAmount = notesMeta.cartDiscountAmount;
    const cashDiscountAmount =
        notesMeta.cashDiscountAmount ||
        Math.max(0, Math.round((discountAmount - cartDiscountAmount) * 100) / 100);

    const lines = (items || []).map((row) => ({
        name: row.product_name,
        sku: row.product_sku || '',
        quantity: Number(row.quantity) || 0,
        price: Number(row.price) || 0
    }));

    const receiptSnapshot = {
        lines,
        totals: {
            subtotal,
            taxAmount,
            total,
            discountAmount,
            cartDiscountAmount,
            cashDiscountAmount,
            preCartSubtotal: cartDiscountAmount > 0 ? subtotal + cartDiscountAmount : subtotal
        },
        taxExempt: notesMeta.taxExempt || (taxAmount === 0 && notesMeta.taxExemptReason.length > 0),
        taxExemptReason: notesMeta.taxExemptReason,
        cartDiscountPercent: 0
    };

    const cashTender = tenders.find((t) => t.type === 'cash');
    const cashierName = employee
        ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim()
        : '';

    const payment = {
        paymentMethod: order.payment_method,
        paymentTenders: tenders,
        label: paymentLabel(order.payment_method, tenders),
        cashierName,
        cashTendered: cashTender?.cashTendered ?? null,
        cashChange: cashTender?.cashChange ?? null
    };

    return {
        orderNumber: order.order_number,
        paymentStatus: order.payment_status,
        status: order.status,
        createdAt: order.created_at,
        totalAmount: total,
        paymentLabel: payment.label,
        cashierName,
        receiptSnapshot,
        payment
    };
}

async function listInStorePosSales(pool, options = {}) {
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
    const offset = Math.max(0, Number(options.offset) || 0);
    const date = String(options.date || '').slice(0, 10);
    const q = String(options.q || '').trim();

    const where = [`o.sales_channel = 'in_store'`, `o.payment_status IN ('paid', 'refunded')`];
    const params = [];

    if (date) {
        const bounds = getStoreDayBoundsRfc3339(date);
        where.push('o.created_at >= ? AND o.created_at <= ?');
        params.push(bounds.timeMin, bounds.timeMax);
    }
    if (q) {
        where.push('o.order_number LIKE ?');
        params.push(`%${q}%`);
    }

    const whereSql = where.join(' AND ');
    const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total FROM orders o WHERE ${whereSql}`,
        params
    );
    const total = Number(countRows[0]?.total) || 0;

    const [rows] = await pool.execute(
        `SELECT o.id, o.order_number, o.total_amount, o.payment_status, o.payment_method, o.created_at,
                e.first_name, e.last_name, e.employee_code
           FROM orders o
           LEFT JOIN pos_employees e ON e.id = o.pos_employee_id
          WHERE ${whereSql}
          ORDER BY o.created_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params
    );

    const sales = rows.map((row) => ({
        orderNumber: row.order_number,
        totalAmount: Number(row.total_amount) || 0,
        paymentStatus: row.payment_status,
        paymentMethod: row.payment_method,
        paymentLabel: paymentLabel(row.payment_method),
        createdAt: row.created_at,
        cashierName: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
        employeeCode: row.employee_code || null
    }));

    return { sales, total, limit, offset };
}

async function getInStorePosOrderReceipt(pool, orderNumber) {
    const orderNum = String(orderNumber || '').trim();
    if (!orderNum) {
        const err = new Error('ORDER_NUMBER_REQUIRED');
        err.code = 'ORDER_NUMBER_REQUIRED';
        err.message = 'Order number is required.';
        throw err;
    }

    const [orders] = await pool.execute(
        `SELECT o.*, e.first_name, e.last_name, e.employee_code
           FROM orders o
           LEFT JOIN pos_employees e ON e.id = o.pos_employee_id
          WHERE o.order_number = ?
          LIMIT 1`,
        [orderNum]
    );
    const order = orders[0];
    if (!order) {
        const err = new Error('ORDER_NOT_FOUND');
        err.code = 'ORDER_NOT_FOUND';
        err.message = 'Sale not found.';
        throw err;
    }
    if (String(order.sales_channel || '').toLowerCase() !== 'in_store') {
        const err = new Error('ORDER_NOT_POS');
        err.code = 'ORDER_NOT_POS';
        err.message = 'Only in-store register sales can be viewed here.';
        throw err;
    }

    const [items] = await pool.execute(
        `SELECT product_name, product_sku, quantity, price, total
           FROM order_items
          WHERE order_id = ?
          ORDER BY id ASC`,
        [order.id]
    );

    const tenders = await loadOrderTenders(pool, order.id, order);
    return buildReceiptPayload(order, items, tenders, order);
}

module.exports = {
    listInStorePosSales,
    getInStorePosOrderReceipt,
    paymentLabel
};
