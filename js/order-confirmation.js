// Order thank-you page — reads URL params and optionally loads summary from API

function hmHerbsApiOrigin() {
    if (typeof window !== 'undefined' && typeof window.hmHerbsStorefrontApiBase === 'function') {
        return window.hmHerbsStorefrontApiBase();
    }
    const explicit = String(window.HMHERBS_API_ORIGIN || '').trim().replace(/\/+$/, '');
    if (explicit) return explicit;
    if (window.location.protocol === 'file:') return 'http://localhost:3001';
    const h = window.location.hostname;
    if ((h === 'localhost' || h === '127.0.0.1') && window.location.port && window.location.port !== '3001') {
        return 'http://localhost:3001';
    }
    if (window.location.protocol.startsWith('http')) {
        return window.location.origin;
    }
    return '';
}

function ordersApiBase() {
    const origin = hmHerbsApiOrigin();
    return origin ? `${origin}/api/orders` : '/api/orders';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

function formatMoney(amount) {
    const n = Number(amount);
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

function getQueryParams() {
    const p = new URLSearchParams(window.location.search);
    return {
        orderId: p.get('order') || p.get('orderId') || '',
        email: p.get('email') || '',
        orderNumber: p.get('orderNumber') || '',
        trackingNumber: p.get('tracking') || p.get('trackingNumber') || '',
        paymentStatus: p.get('payment') || p.get('paymentStatus') || ''
    };
}

/**
 * Optional paid-purchase page view for a Google tag when configured.
 * No-ops when no gtag function exists or when GOOGLE_TAG_ID meta tag is missing.
 */
function reportPaidPurchaseConversion(data) {
    try {
        if (String(data.paymentStatus || '').toLowerCase() !== 'paid') return;

        var metaTag = document.querySelector('meta[name="google-tag-id"]');
        var tagId = metaTag && metaTag.getAttribute('content');
        if (!tagId) return;

        var transactionId = String(data.orderNumber || data.orderId || '').trim();
        if (data.totalAmount == null || data.totalAmount === '') return;
        var value = Number(data.totalAmount);
        if (!transactionId || !Number.isFinite(value) || value <= 0) return;

        window.__boAdsPurchaseSent = window.__boAdsPurchaseSent || {};
        if (window.__boAdsPurchaseSent[transactionId]) return;
        window.__boAdsPurchaseSent[transactionId] = true;

        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function gtag() {
            window.dataLayer.push(arguments);
        };
        window.gtag('js', new Date());
        window.gtag('config', tagId, { send_page_view: false });
        var pageLocation = (typeof window.storeAdClickPageLocation === 'function'
            && window.storeAdClickPageLocation())
            || (location.origin.replace(/\/+$/, '') + '/order-confirmation');
        var hasAdClick = /[?&](?:gclid|wbraid|gbraid)=/.test(pageLocation);
        var consentUpdate = { analytics_storage: 'granted' };
        if (hasAdClick) {
            consentUpdate.ad_storage = 'granted';
            consentUpdate.ad_user_data = 'granted';
            consentUpdate.ad_personalization = 'denied';
        }
        window.gtag('consent', 'update', consentUpdate);
        window.gtag('event', 'page_view', {
            page_location: pageLocation,
            page_path: '/order-confirmation',
            value: value,
            currency: 'USD',
            transaction_id: transactionId
        });
    } catch (err) {
        console.warn('Purchase page view skipped:', err);
    }
}

function renderConfirmation(root, data) {
    const paid = String(data.paymentStatus || '').toLowerCase() === 'paid';
    const pending = !paid;
    const tracking = String(data.trackingNumber || '').trim();
    const trackingUrl = String(data.trackingUrl || '').trim();
    const items = Array.isArray(data.items) ? data.items : [];

    const itemsHtml = items.length
        ? `<div class="confirmation-items">
            <h2>Items ordered</h2>
            ${items
                .map(
                    (line) =>
                        `<div class="confirmation-item-row">
                            <span>${escapeHtml(line.name)} × ${line.quantity}</span>
                            <span>${formatMoney(line.total)}</span>
                        </div>`
                )
                .join('')}
           </div>`
        : '';

    const trackingRow = tracking && trackingUrl
        ? `<dt>Tracking</dt>
           <dd class="tracking-highlight"><a href="${escapeHtml(trackingUrl)}" target="_blank" rel="noopener">${escapeHtml(tracking)}</a></dd>`
        : tracking && !/^(BOTRK|HMTRK)/i.test(tracking)
          ? `<dt>Tracking number</dt><dd class="tracking-highlight">${escapeHtml(tracking)}</dd>`
          : null;
    const trackingSection = trackingRow != null
        ? trackingRow
        : paid
          ? `<dt>Tracking</dt><dd>We will send tracking updates by email when your package ships.</dd>`
          : '';

    root.className = `confirmation-card${pending ? ' confirmation-pending' : ''}`;
    root.innerHTML = `
        <div class="confirmation-icon" aria-hidden="true">
            <i class="fas ${paid ? 'fa-check' : 'fa-clock'}"></i>
        </div>
        <h1>${paid ? 'Thank you for your order!' : 'Order received'}</h1>
        <p class="confirmation-lead">
            ${
                paid
                    ? `A confirmation email has been sent to <strong>${escapeHtml(data.email)}</strong> with your order details and tracking number.`
                    : 'Your order has been placed. Complete payment to finish checkout — we will email you when your order is confirmed.'
            }
        </p>
        <div class="confirmation-details">
            <dl>
                <dt>Order number</dt>
                <dd>${escapeHtml(data.orderNumber || data.orderId)}</dd>
                <dt>Order total</dt>
                <dd>${formatMoney(data.totalAmount)}</dd>
                ${trackingSection}
            </dl>
            ${itemsHtml}
        </div>
        <div class="confirmation-actions">
            <a href="index.html" class="btn btn-primary">Continue shopping</a>
            <a href="account.html" class="btn btn-secondary">My account</a>
        </div>`;

    reportPaidPurchaseConversion(data);
}

function renderError(root, message) {
    root.innerHTML = `
        <div class="confirmation-icon" aria-hidden="true"><i class="fas fa-exclamation-circle"></i></div>
        <h1>Order confirmation</h1>
        <p class="confirmation-lead confirmation-error">${escapeHtml(message)}</p>
        <div class="confirmation-actions">
            <a href="index.html" class="btn btn-primary">Back to home</a>
        </div>`;
}

async function initOrderConfirmation() {
    const root = document.getElementById('confirmation-root');
    if (!root) return;

    const q = getQueryParams();
    const orderId = String(q.orderId || '').trim();
    const email = String(q.email || '').trim();

    if (!orderId) {
        renderError(root, 'Missing order information. If you just checked out, try again from your confirmation email.');
        return;
    }

    if (email) {
        try {
            const res = await fetch(
                `${ordersApiBase()}/${encodeURIComponent(orderId)}/confirmation-summary?email=${encodeURIComponent(email)}`,
                { headers: { Accept: 'application/json' } }
            );
            if (res.ok) {
                const data = await res.json();
                renderConfirmation(root, data);
                return;
            }
        } catch (e) {
            console.warn('Could not load order summary:', e);
        }
    }

    if (q.orderNumber || q.paymentStatus) {
        renderConfirmation(root, {
            orderId,
            orderNumber: q.orderNumber || orderId,
            email: email || 'your email',
            paymentStatus: q.paymentStatus || 'paid',
            trackingNumber: q.trackingNumber,
            totalAmount: null,
            items: []
        });
        return;
    }

    renderError(
        root,
        'We could not load this order. Open the link from your confirmation email or sign in to My Account to view your orders.'
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrderConfirmation);
} else {
    initOrderConfirmation();
}
