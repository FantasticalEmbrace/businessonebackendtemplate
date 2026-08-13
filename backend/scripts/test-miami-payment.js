#!/usr/bin/env node
'use strict';
/** One-off: full website checkout charge against remote staging via public API. */
const BASE = (process.argv[2] || 'http://172.235.131.160').replace(/\/+$/, '');
const NMI_SANDBOX_PAYMENT_TOKEN = '00000000-000000-000000-000000000000';

async function main() {
    console.log('Base URL:', BASE);

    const cfgRes = await fetch(`${BASE}/api/payments/nmi-client-config`);
    const cfg = await cfgRes.json().catch(() => ({}));
    console.log('nmi-client-config:', JSON.stringify(cfg));

    const prodRes = await fetch(`${BASE}/api/products?limit=20&sort=price&order=asc`);
    const prodJson = await prodRes.json().catch(() => ({}));
    const products = Array.isArray(prodJson.products) ? prodJson.products : Array.isArray(prodJson) ? prodJson : [];
    const product = products.find((p) => p.in_stock !== false && Number(p.inventory_quantity ?? 1) > 0) || products[0];
    if (!product?.id) {
        console.error('No product found:', prodRes.status, JSON.stringify(prodJson).slice(0, 300));
        process.exit(2);
    }
    console.log('Product:', product.id, product.name, product.price);

    const email = `nmi-staging-${Date.now()}@hmherbs-test.local`;
    const previewRes = await fetch(`${BASE}/api/promotions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            cartItems: [{ product_id: product.id, quantity: 1, price: 0 }],
            email,
        }),
    });
    const preview = await previewRes.json().catch(() => ({}));
    if (!previewRes.ok) {
        console.error('Preview failed:', previewRes.status, preview);
        process.exit(2);
    }

    const orderBody = {
        customerInfo: {
            first_name: 'NMI',
            last_name: 'Sandbox',
            email,
            phone: '(706) 861-9454',
        },
        shippingAddress: {
            address_line_1: '1140 Battlefield Pkwy',
            city: 'Fort Oglethorpe',
            state: 'GA',
            postal_code: '30742',
            country: 'United States',
        },
        billingAddress: {
            address_line_1: '1140 Battlefield Pkwy',
            city: 'Fort Oglethorpe',
            state: 'GA',
            postal_code: '30742',
            country: 'United States',
        },
        paymentMethod: 'credit_card',
        awaitingNmiPayment: true,
        cartItems: [
            {
                product_id: product.id,
                name: product.name,
                price: Number(product.price),
                quantity: 1,
            },
        ],
        shippingMethod: preview.totals?.shippingMethod || 'standard',
        shippingAmount: preview.totals?.shippingAfter ?? 0,
    };

    const orderRes = await fetch(`${BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody),
    });
    const orderJson = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !orderJson.orderId) {
        console.error('Order create failed:', orderRes.status, orderJson);
        process.exit(2);
    }
    console.log('Pending order:', orderJson.orderNumber || orderJson.orderId);

    const payRes = await fetch(`${BASE}/api/payments/process-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            orderId: orderJson.orderId,
            payment_token: NMI_SANDBOX_PAYMENT_TOKEN,
            customerEmail: email,
        }),
    });
    const payJson = await payRes.json().catch(() => ({}));
    console.log('process-payment status:', payRes.status);
    console.log('process-payment body:', JSON.stringify(payJson));

    if (payRes.ok && payJson.success) {
        console.log('OK: test payment approved. transactionId=', payJson.transactionId);
        process.exit(0);
    }
    if (/duplicate/i.test(String(payJson.error || ''))) {
        console.log('OK: gateway reachable (duplicate transaction).');
        process.exit(0);
    }
    process.exit(payRes.ok ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(3);
});
