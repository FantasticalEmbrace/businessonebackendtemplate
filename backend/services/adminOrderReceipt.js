'use strict';

const { resolveStoreBranding } = require('./storeBranding');
const { loadPosReceiptSettings } = require('./posReceiptSettings');
const { getInStorePosOrderReceipt } = require('./posOrderHistory');
const { sendReceiptEmail } = require('./posReceiptDelivery');
const { sendOrderConfirmationEmail } = require('./orderConfirmationEmail');
const { composeOrderLineDisplayName, resolveOrderLineSku } = require('../utils/orderLineDisplay');
const { printEscposReceipt } = require('./posEscposPrint');
const { buildRegisterHardwareProfile } = require('./posRegisterHardware');
const { loadPosRegisterExperienceSettings } = require('./posRegisterExperienceSettings');
const { loadPosCardCheckoutSettings } = require('./posCardCheckoutSettings');
const { listEquipment } = require('./posEquipment');

function formatMoney(amount) {
    const n = Number(amount);
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : '$0.00';
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatReceiptDate(value) {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function isInStoreOrder(order) {
    return String(order?.sales_channel || '').toLowerCase() === 'in_store';
}

function resolveCustomerEmail(order) {
    return String(order?.email || order?.account_email || '').trim();
}

function resolveCustomerName(order) {
    const shipping = [order?.shipping_first_name, order?.shipping_last_name].filter(Boolean).join(' ').trim();
    if (shipping) return shipping;
    const account = [order?.account_first_name, order?.account_last_name].filter(Boolean).join(' ').trim();
    if (account) return account;
    return '';
}

function formatAddressBlock(order, prefix) {
    const lines = [
        [order[`${prefix}_first_name`], order[`${prefix}_last_name`]].filter(Boolean).join(' '),
        order[`${prefix}_company`],
        order[`${prefix}_address_line_1`],
        order[`${prefix}_address_line_2`],
        [order[`${prefix}_city`], order[`${prefix}_state`], order[`${prefix}_postal_code`]]
            .filter(Boolean)
            .join(', '),
        order[`${prefix}_country`]
    ].filter((line) => line && String(line).trim());
    return lines;
}

async function loadAdminOrderReceiptContext(pool, orderId) {
    const oid = Number(orderId);
    if (!Number.isFinite(oid) || oid < 1) {
        const err = new Error('Invalid order id');
        err.code = 'INVALID_ORDER_ID';
        throw err;
    }

    const [orders] = await pool.execute(
        `SELECT o.*,
                u.first_name AS account_first_name,
                u.last_name AS account_last_name,
                u.email AS account_email,
                e.first_name AS cashier_first_name,
                e.last_name AS cashier_last_name
           FROM orders o
           LEFT JOIN users u ON u.id = o.user_id
           LEFT JOIN pos_employees e ON e.id = o.pos_employee_id
          WHERE o.id = ?
          LIMIT 1`,
        [oid]
    );
    if (!orders.length) {
        const err = new Error('Order not found');
        err.code = 'ORDER_NOT_FOUND';
        throw err;
    }
    const order = orders[0];

    const [items] = await pool.execute(
        `SELECT oi.product_name, oi.product_sku, oi.variant_name, oi.quantity, oi.price, oi.total,
                COALESCE(NULLIF(TRIM(pv.sku), ''), oi.product_sku) AS resolved_sku
           FROM order_items oi
           LEFT JOIN product_variants pv ON pv.id = oi.variant_id
          WHERE oi.order_id = ?
          ORDER BY oi.id ASC`,
        [oid]
    );

    const lineItems = (items || []).map((row) => ({
        name: composeOrderLineDisplayName(row.product_name, row.variant_name),
        sku: resolveOrderLineSku(row.product_sku, row.resolved_sku),
        quantity: Number(row.quantity) || 0,
        price: Number(row.price) || 0,
        total: Number(row.total) || 0
    }));

    const branding = await resolveStoreBranding(pool);
    const receiptSettings = await loadPosReceiptSettings(pool, branding.logoUrl);

    let posReceipt = null;
    if (isInStoreOrder(order)) {
        try {
            posReceipt = await getInStorePosOrderReceipt(pool, order.order_number);
        } catch {
            posReceipt = null;
        }
    }

    let paymentTenders = posReceipt?.payment?.paymentTenders || [];
    if (!paymentTenders.length) {
        try {
            const [tenderRows] = await pool.execute(
                `SELECT tender_type, amount, loyalty_points, gift_card_id,
                        cash_tendered, cash_change, check_number,
                        terminal_last_four, terminal_auth_code, payment_reference
                   FROM order_payment_tenders
                  WHERE order_id = ?
                  ORDER BY id ASC`,
                [oid]
            );
            paymentTenders = tenderRows || [];
        } catch (e) {
            if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
        }
    }

    return {
        order,
        lineItems,
        branding,
        receiptSettings,
        posReceipt,
        paymentTenders,
        customerEmail: resolveCustomerEmail(order),
        customerName: resolveCustomerName(order),
        isInStore: isInStoreOrder(order)
    };
}

function buildOrderReceiptHtml(context, { autoPrint = false } = {}) {
    const { order, lineItems, branding, receiptSettings, posReceipt, paymentTenders, customerName, isInStore } = context;
    const { formatTenderLinesHtml, paymentMethodLabel } = require('../utils/paymentTenderLines');
    const primary = branding.colors?.primary || '#658d0b';
    const orderNumber = String(order.order_number || order.id || '');
    const createdAt = formatReceiptDate(order.created_at);
    const tenders = paymentTenders || posReceipt?.payment?.paymentTenders || [];
    const paymentLabel = paymentMethodLabel(order.payment_method, tenders) ||
        posReceipt?.paymentLabel ||
        String(order.payment_method || order.payment_status || 'Paid');
    const cashierName =
        posReceipt?.cashierName ||
        [order.cashier_first_name, order.cashier_last_name].filter(Boolean).join(' ').trim();

    const storeLines = [];
    if (receiptSettings.showAddress && receiptSettings.storeAddress) {
        storeLines.push(...String(receiptSettings.storeAddress).split('\n'));
    }
    if (receiptSettings.showPhone && (receiptSettings.storePhone || branding.storePhone)) {
        storeLines.push(String(receiptSettings.storePhone || branding.storePhone));
    }

    const itemRows = lineItems
        .map((line) => {
            const skuLine =
                receiptSettings.showSku && line.sku
                    ? `<div style="font-size:11px;color:#6b7280;">SKU ${escapeHtml(line.sku)}</div>`
                    : '';
            return `<tr>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;vertical-align:top;">
                    <div>${escapeHtml(line.name)}</div>${skuLine}
                </td>
                <td style="padding:8px 8px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top;">${line.quantity}</td>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;">${formatMoney(line.total)}</td>
            </tr>`;
        })
        .join('');

    const shippingBlock = !isInStore
        ? (() => {
              const ship = formatAddressBlock(order, 'shipping');
              if (!ship.length) return '';
              return `<div style="margin-top:16px;">
                <div style="font-weight:600;margin-bottom:4px;">Ship to</div>
                ${ship.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
              </div>`;
          })()
        : '';

    const totals = posReceipt?.receiptSnapshot?.totals || {
        subtotal: Number(order.subtotal) || 0,
        discountAmount: Number(order.discount_amount) || 0,
        taxAmount: Number(order.tax_amount) || 0,
        total: Number(order.total_amount) || 0,
        shippingAmount: Number(order.shipping_amount) || 0,
        cartDiscountAmount: 0,
        cashDiscountAmount: 0
    };

    const discountRows = [];
    if (Number(totals.cartDiscountAmount) > 0) {
        discountRows.push(
            `<div style="display:flex;justify-content:space-between;"><span>Sale / promo discount</span><span>-${formatMoney(totals.cartDiscountAmount)}</span></div>`
        );
    }
    if (Number(totals.cashDiscountAmount) > 0) {
        discountRows.push(
            `<div style="display:flex;justify-content:space-between;"><span>Cash discount</span><span>-${formatMoney(totals.cashDiscountAmount)}</span></div>`
        );
    }
    if (
        !discountRows.length &&
        Number(totals.discountAmount) > 0
    ) {
        discountRows.push(
            `<div style="display:flex;justify-content:space-between;"><span>Discount</span><span>-${formatMoney(totals.discountAmount)}</span></div>`
        );
    }
    if (order.promo_code) {
        discountRows.push(
            `<div style="font-size:13px;color:#6b7280;">Promo: ${escapeHtml(order.promo_code)}</div>`
        );
    }
    const shippingRow =
        !isInStore && Number(totals.shippingAmount ?? order.shipping_amount) > 0
            ? `<div style="display:flex;justify-content:space-between;"><span>Shipping</span><span>${formatMoney(totals.shippingAmount ?? order.shipping_amount)}</span></div>`
            : '';

    const tenderHtml = formatTenderLinesHtml(tenders, { escapeHtml });
    const paymentBlock = tenderHtml
        ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:14px;line-height:1.6;">
            <div style="font-weight:600;margin-bottom:4px;">${tenders.length > 1 ? 'Payment breakdown' : 'Payment'}</div>
            ${tenderHtml}
           </div>`
        : `<div style="margin-top:12px;font-size:14px;"><strong>Payment:</strong> ${escapeHtml(paymentLabel)}</div>`;

    const footerText = String(receiptSettings.footerText || 'Thank you for your purchase!').trim();
    const headerText = String(receiptSettings.headerText || '').trim();
    const returnPolicy = String(receiptSettings.returnPolicy || '').trim();

    const logoBlock =
        receiptSettings.showLogo && branding.logoUrl
            ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.storeName)}" style="max-width:180px;max-height:64px;margin-bottom:8px;" />`
            : `<div style="font-size:22px;font-weight:700;color:${primary};">${escapeHtml(branding.storeName)}</div>`;

    const printScript = autoPrint
        ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},150);});</script>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Receipt ${escapeHtml(orderNumber)}</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; color: #111827; margin: 0; padding: 24px; background: #f3f4f6; }
  .receipt { max-width: 520px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; }
  @media print {
    body { background: #fff; padding: 0; }
    .receipt { border: none; border-radius: 0; max-width: none; padding: 0; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="receipt">
    <div style="text-align:center;margin-bottom:16px;">
      ${logoBlock}
      ${storeLines.map((line) => `<div style="font-size:13px;color:#4b5563;">${escapeHtml(line)}</div>`).join('')}
      ${headerText ? `<div style="margin-top:8px;font-size:13px;">${escapeHtml(headerText)}</div>` : ''}
    </div>
    <div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-bottom:12px;font-size:14px;line-height:1.5;">
      <div><strong>Order:</strong> ${escapeHtml(orderNumber)}</div>
      <div><strong>Date:</strong> ${escapeHtml(createdAt)}</div>
      ${customerName ? `<div><strong>Customer:</strong> ${escapeHtml(customerName)}</div>` : ''}
      ${receiptSettings.showCashier && cashierName ? `<div><strong>Cashier:</strong> ${escapeHtml(cashierName)}</div>` : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="border-bottom:2px solid #d1d5db;">
          <th style="text-align:left;padding:6px 0;">Item</th>
          <th style="text-align:center;padding:6px 8px;">Qty</th>
          <th style="text-align:right;padding:6px 0;">Total</th>
        </tr>
      </thead>
      <tbody>${itemRows || '<tr><td colspan="3">No items</td></tr>'}</tbody>
    </table>
    <div style="margin-top:12px;font-size:14px;line-height:1.7;">
      <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>${formatMoney(totals.subtotal)}</span></div>
      ${discountRows.join('')}
      ${shippingRow}
      <div style="display:flex;justify-content:space-between;"><span>Tax</span><span>${formatMoney(totals.taxAmount)}</span></div>
      <div style="display:flex;justify-content:space-between;font-weight:700;margin-top:6px;padding-top:6px;border-top:1px solid #d1d5db;"><span>Total</span><span>${formatMoney(totals.total)}</span></div>
    </div>
    ${paymentBlock}
    ${shippingBlock}
  </div>
  <p class="no-print" style="text-align:center;margin-top:16px;font-size:13px;color:#6b7280;">
    ${escapeHtml(footerText)}
    ${returnPolicy ? `<br>${escapeHtml(returnPolicy)}` : ''}
  </p>
  ${printScript}
</body>
</html>`;
}

function padLine(left, right, width = 42) {
    const l = String(left || '');
    const r = String(right || '');
    const spaces = Math.max(1, width - l.length - r.length);
    return `${l}${' '.repeat(spaces)}${r}`;
}

function buildOrderReceiptEscposLines(context) {
    const { order, lineItems, branding, receiptSettings, posReceipt, customerName, isInStore } = context;
    const lines = [];
    const width = 42;

    lines.push(String(branding.storeName || 'Store').slice(0, width));
    if (receiptSettings.showAddress && receiptSettings.storeAddress) {
        for (const line of String(receiptSettings.storeAddress).split('\n')) {
            if (line.trim()) lines.push(line.trim().slice(0, width));
        }
    }
    if (receiptSettings.showPhone && (receiptSettings.storePhone || branding.storePhone)) {
        lines.push(String(receiptSettings.storePhone || branding.storePhone).slice(0, width));
    }
    if (receiptSettings.headerText) lines.push(receiptSettings.headerText.slice(0, width));
    lines.push('-'.repeat(width));
    lines.push(`Order: ${String(order.order_number || order.id || '').slice(0, width - 7)}`);
    lines.push(`Date: ${formatReceiptDate(order.created_at).slice(0, width - 6)}`);
    if (customerName) lines.push(`Customer: ${customerName.slice(0, width - 10)}`);
    const cashierName =
        posReceipt?.cashierName ||
        [order.cashier_first_name, order.cashier_last_name].filter(Boolean).join(' ').trim();
    if (receiptSettings.showCashier && cashierName) {
        lines.push(`Cashier: ${cashierName.slice(0, width - 9)}`);
    }
    lines.push('-'.repeat(width));

    for (const line of lineItems) {
        const label = String(line.name || 'Item').slice(0, width);
        lines.push(label);
        const detail = `${line.quantity} x ${formatMoney(line.price)}`;
        lines.push(padLine(detail, formatMoney(line.total), width));
        if (receiptSettings.showSku && line.sku) {
            lines.push(`SKU ${String(line.sku).slice(0, width - 4)}`);
        }
    }

    lines.push('-'.repeat(width));
    const totals = posReceipt?.receiptSnapshot?.totals || {
        subtotal: Number(order.subtotal) || 0,
        discountAmount: Number(order.discount_amount) || 0,
        taxAmount: Number(order.tax_amount) || 0,
        total: Number(order.total_amount) || 0,
        shippingAmount: Number(order.shipping_amount) || 0
    };
    lines.push(padLine('Subtotal', formatMoney(totals.subtotal), width));
    if (Number(totals.discountAmount) > 0) {
        lines.push(padLine('Discount', `-${formatMoney(totals.discountAmount)}`, width));
    }
    if (!isInStore && Number(totals.shippingAmount ?? order.shipping_amount) > 0) {
        lines.push(padLine('Shipping', formatMoney(totals.shippingAmount ?? order.shipping_amount), width));
    }
    lines.push(padLine('Tax', formatMoney(totals.taxAmount), width));
    lines.push(padLine('TOTAL', formatMoney(totals.total), width));
    lines.push('-'.repeat(width));
    const { formatTenderLines, paymentMethodLabel } = require('../utils/paymentTenderLines');
    const tenders = context.paymentTenders || posReceipt?.payment?.paymentTenders || [];
    const tenderLines = formatTenderLines(tenders);
    if (tenderLines.length) {
        if (tenderLines.length > 1) lines.push('Payment breakdown:');
        for (const line of tenderLines) {
            lines.push(String(line).slice(0, width));
        }
    } else {
        const paymentLabel = paymentMethodLabel(order.payment_method, tenders) ||
            posReceipt?.paymentLabel ||
            String(order.payment_method || 'Paid');
        lines.push(`Payment: ${String(paymentLabel).slice(0, width - 9)}`);
    }
    if (receiptSettings.footerText) lines.push(receiptSettings.footerText.slice(0, width));
    if (receiptSettings.returnPolicy) lines.push(receiptSettings.returnPolicy.slice(0, width));
    return lines;
}

async function resolveNetworkReceiptPrinter(pool, order) {
    const deviceId = Number(order?.pos_device_id);
    if (Number.isFinite(deviceId) && deviceId > 0) {
        const [experience, cardCheckout] = await Promise.all([
            loadPosRegisterExperienceSettings(pool),
            loadPosCardCheckoutSettings(pool)
        ]);
        const hardware = await buildRegisterHardwareProfile(pool, deviceId, {
            globalCheckout: cardCheckout,
            globalPrinter: experience.hardwarePrinter
        });
        const runtime = hardware?.runtime || {};
        const driver = String(runtime.printerDriver || 'browser').toLowerCase();
        if (
            driver !== 'browser' &&
            driver !== 'elo_star' &&
            driver !== 'star_android' &&
            runtime.printerAddress
        ) {
            return {
                host: runtime.printerAddress,
                port: Number(runtime.printerPort) || 9100,
                copyCount: hardware?.receiptPrinter?.config?.copyCount || 1
            };
        }
    }

    const equipment = await listEquipment(pool, { includeInactive: false });
    const printer = (equipment || []).find((row) => {
        if (row.equipmentType !== 'receipt_printer') return false;
        const connection = String(row.config?.connection || '').toLowerCase();
        const address = String(row.config?.address || '').trim();
        return connection === 'network' && address;
    });
    if (!printer) return null;
    return {
        host: String(printer.config.address).trim(),
        port: Number(printer.config.port) || 9100,
        copyCount: 1
    };
}

async function emailAdminOrderReceipt(pool, orderId, options = {}) {
    const context = await loadAdminOrderReceiptContext(pool, orderId);
    const to = String(options.to || context.customerEmail || '').trim();
    if (!to) {
        const err = new Error('This order has no customer email on file.');
        err.code = 'NO_CUSTOMER_EMAIL';
        throw err;
    }

    if (String(context.order.payment_status || '').toLowerCase() !== 'paid') {
        const err = new Error('Receipt email is only available for paid orders.');
        err.code = 'ORDER_NOT_PAID';
        throw err;
    }

    if (context.isInStore) {
        const html = buildOrderReceiptHtml(context);
        const text = buildOrderReceiptEscposLines(context).join('\n');
        await sendReceiptEmail({
            to,
            storeName: context.branding.storeName,
            orderNumber: context.order.order_number,
            html,
            text
        });
        return { sent: true, email: to, method: 'pos_receipt' };
    }

    const result = await sendOrderConfirmationEmail(pool, orderId, {
        adminResend: true,
        to
    });
    if (!result?.sent) {
        const err = new Error(result?.reason || 'Could not send receipt email');
        err.code = result?.code || 'EMAIL_FAILED';
        throw err;
    }
    return { sent: true, email: result.email || to, method: 'order_confirmation' };
}

async function printAdminOrderReceipt(pool, orderId) {
    const context = await loadAdminOrderReceiptContext(pool, orderId);
    if (!context.isInStore) {
        const err = new Error('Network receipt printing is only available for in-store POS orders. Use browser print instead.');
        err.code = 'BROWSER_PRINT_ONLY';
        throw err;
    }

    const printer = await resolveNetworkReceiptPrinter(pool, context.order);
    if (!printer?.host) {
        const err = new Error('No network receipt printer is configured for this store.');
        err.code = 'PRINTER_NOT_NETWORK';
        throw err;
    }

    const lines = buildOrderReceiptEscposLines(context);
    const result = await printEscposReceipt({
        host: printer.host,
        port: printer.port,
        lines,
        copyCount: printer.copyCount || 1
    });
    return { ok: true, method: 'network', ...result };
}

module.exports = {
    loadAdminOrderReceiptContext,
    buildOrderReceiptHtml,
    buildOrderReceiptEscposLines,
    emailAdminOrderReceipt,
    printAdminOrderReceipt
};
