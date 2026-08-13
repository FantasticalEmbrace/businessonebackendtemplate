// Checkout Page JavaScript

/**
 * Base origin for Express API (orders, payments, promos). Matches script.js featured-products
 * behavior: static HTML on localhost (Live Server, etc.) talks to the API on port 3001.
 * Override with: window.HMHERBS_API_ORIGIN = 'https://api.example.com' (no trailing slash).
 * @returns {string} '' means same-origin (e.g. production or API served from current host).
 */
function hmHerbsApiOrigin() {
    if (typeof window !== 'undefined' && typeof window.hmHerbsStorefrontApiBase === 'function') {
        return window.hmHerbsStorefrontApiBase();
    }
    const explicit = String(
        typeof window !== 'undefined' && window.HMHERBS_API_ORIGIN ? window.HMHERBS_API_ORIGIN : ''
    )
        .trim()
        .replace(/\/+$/, '');
    if (explicit) return explicit;
    if (typeof window === 'undefined' || !window.location) return '';
    if (window.location.protocol === 'file:') return 'http://localhost:3001';
    const h = window.location.hostname;
    const isLoopback = h === 'localhost' || h === '127.0.0.1';
    if (isLoopback && window.location.port && window.location.port !== '3001') {
        return 'http://localhost:3001';
    }
    return '';
}

class CheckoutManager {
    constructor() {
        this.cart = [];
        /** @type {null | Record<string, unknown>} */
        this.promoPreview = null;
        this.promoDiscountAmount = 0;
        this.subtotal = 0;
        this.shipping = 0;
        this.tax = 0;
        this.total = 0;
        this.shippingOptions = [];
        this.selectedShippingMethod = null;
        this.selectedShippingAmount = 0;
        this.taxStatus = {
            checked: false,
            loggedIn: false,
            taxExempt: false,
            verified: false,
            taxExemptIdPresent: false
        };
        this.storeTaxRate = 0.08;
        /** NMI Collect.js: when true, card PAN/expiry/CVV are tokenized; legacy inputs hidden */
        this.nmiEnabled = false;
        this.nmiScriptReady = false;
        this.nmiSandbox = false;
        /** @type {null | ReturnType<typeof setTimeout>} */
        this._nmiRejectionGuardTimer = null;
        /** When true, swallow Collect.js-related unhandled rejections (401/token) even after teardown. */
        this._nmiCollectErrorGuardActive = false;
        /** Prevents duplicate Collect.js onload / configure (avoids guard listener gaps). */
        this._nmiCollectOnloadHandled = false;
        this._boundNmiRejectionGuard = this.onNmiUnhandledRejectionDuringInit.bind(this);
        this.giftCardBalanceChecked = false;
        this.giftCardLastBalance = null;
        this.accountGiftCards = [];
        this.selectedAccountGiftCardId = null;
        this.giftCardManualMode = false;
        this.nmiPreflightRejected = false;
        /** When true, card-only Collect.js (no Apple Pay / Google Pay until configured in NMI portal). */
        this.nmiDisableWallets = true;
        this.savedCards = [];
        this.selectedSavedCardId = null;
        this.loyaltyProfile = null;
        this.loyaltySettings = null;
        this._checkoutInFlight = false;
        /** @type {null | (() => void)} */
        this._nmiConsoleNoiseFilterRestore = null;
        this.init();
    }

    getApiOrigin() {
        return hmHerbsApiOrigin();
    }

    setCheckoutBusy(busy) {
        this._checkoutInFlight = !!busy;
        const btn = document.getElementById('submit-order-btn');
        if (btn) btn.disabled = !!busy;
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.classList.toggle('active', !!busy);
    }

    safeImageUrl(url) {
        const raw = String(url || '').trim();
        if (!raw) return this.createPlaceholderImage();
        if (/^\s*(javascript|data):/i.test(raw)) return this.createPlaceholderImage();
        if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//') || raw.startsWith('/')) {
            return raw;
        }
        return this.createPlaceholderImage();
    }

    applyPaymentProcessorLabels(cfg = {}) {
        const processor = String(cfg.processor || 'epi').toLowerCase();
        const label = String(cfg.processorLabel || (processor === 'nmi' ? 'NMI' : processor === 'mxmerchant' ? 'MX' : 'EPI'));
        this.activePaymentProcessor = processor;
        this.activePaymentProcessorLabel = label;
        const suffix = ` (via ${label})`;
        const labels = {
            credit_card: `Credit Card${suffix}`,
            debit_card: `Debit Card${suffix}`
        };
        const select = document.getElementById('payment-method');
        if (!select) return;
        for (const opt of select.options) {
            if (labels[opt.value]) opt.textContent = labels[opt.value];
        }
    }

    /** Redirect to thank-you page after checkout. */
    redirectToOrderConfirmation({ orderId, orderNumber, email, paymentStatus, trackingNumber }) {
        const params = new URLSearchParams();
        if (orderId != null && orderId !== '') params.set('order', String(orderId));
        if (email) params.set('email', String(email).trim());
        if (orderNumber) params.set('orderNumber', String(orderNumber));
        if (trackingNumber) params.set('tracking', String(trackingNumber));
        if (paymentStatus) params.set('payment', String(paymentStatus));
        window.location.href = `order-confirmation.html?${params.toString()}`;
    }

    init() {
        this.loadCart();
        this.setupEventListeners();
        this.setupFormValidation();
        this.loadTaxExemptStatus();
        void this.loadStoreTaxRate();
        void this.initPaymentProcessorIfConfigured();
        void this.loadSavedCards();
        this.schedulePrefillLoggedInCustomer();
        this.bindCheckoutRewardsUi();
        void this.loadCheckoutRewards();
    }

    /** Wait for customer-auth.js, then prefill once profile hydrates (debounced). */
    schedulePrefillLoggedInCustomer() {
        const run = (userFromEvent) => {
            void this.prefillLoggedInCustomer(userFromEvent);
        };
        run();
        setTimeout(() => run(), 400);
        if (!this._boundProfilePrefill) {
            let debounceTimer;
            this._boundProfilePrefill = (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => run(e?.detail?.user), 200);
            };
            window.addEventListener('hmherbs:customer-profile-updated', this._boundProfilePrefill);
        }
        if (!this._boundGiftCardAuthRefresh) {
            this._boundGiftCardAuthRefresh = () => {
                if (document.getElementById('payment-method')?.value === 'gift_card') {
                    void this.prepareGiftCardPaymentUi();
                }
            };
            window.addEventListener('hmherbs:customer-profile-updated', this._boundGiftCardAuthRefresh);
            window.addEventListener('hmherbs:customer-signed-in', this._boundGiftCardAuthRefresh);
            window.addEventListener('hmherbs:customer-signed-out', this._boundGiftCardAuthRefresh);
        }
        if (!this._boundCheckoutRewardsRefresh) {
            this._boundCheckoutRewardsRefresh = () => void this.loadCheckoutRewards();
            window.addEventListener('hmherbs:customer-profile-updated', this._boundCheckoutRewardsRefresh);
            window.addEventListener('hmherbs:customer-signed-in', this._boundCheckoutRewardsRefresh);
            window.addEventListener('hmherbs:customer-signed-out', this._boundCheckoutRewardsRefresh);
        }
    }

    _getCustomerToken() {
        try {
            const auth = window.customerAuth;
            if (auth && typeof auth.getToken === 'function') {
                const t = auth.getToken();
                if (t && String(t).trim()) return String(t).trim();
            }
        } catch (_) {
            /* ignore */
        }
        try {
            return localStorage.getItem('hmherbs_customer_token');
        } catch (_) {
            return null;
        }
    }

    _checkoutCustomerFields() {
        return {
            fnEl: document.getElementById('first-name'),
            lnEl: document.getElementById('last-name'),
            emEl: document.getElementById('email'),
            phEl: document.getElementById('phone'),
        };
    }

    /** True when any customer field on checkout is still empty (fill per-field, not all-or-nothing). */
    _anyCheckoutCustomerFieldEmpty(fields) {
        const { fnEl, lnEl, emEl, phEl } = fields;
        if (!fnEl || !lnEl || !emEl) return false;
        const empty = (el) => !String(el.value || '').trim();
        return empty(fnEl) || empty(lnEl) || empty(emEl) || (phEl && empty(phEl));
    }

    _readStashedCheckoutCustomer() {
        try {
            const raw = sessionStorage.getItem('hmherbs_checkout_customer_snapshot');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
            return parsed;
        } catch (_) {
            return null;
        }
    }

    _readStoredCustomerUser() {
        try {
            const raw = localStorage.getItem('hmherbs_customer_user');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
            return parsed;
        } catch (_) {
            return null;
        }
    }

    _shippingAddressNeedsPrefill() {
        const line1 = document.getElementById('shipping-address-1');
        if (!line1) return false;
        return !String(line1.value || '').trim();
    }

    _setInputIfEmpty(el, value) {
        if (!el || value == null) return;
        const v = String(value).trim();
        if (v && !String(el.value || '').trim()) el.value = v;
    }

    _setSelectCountryIfEmpty(selectEl, country) {
        if (!selectEl || !country) return;
        if (String(selectEl.value || '').trim()) return;
        const c = String(country).trim();
        for (let i = 0; i < selectEl.options.length; i++) {
            const opt = selectEl.options[i];
            if (opt.value === c || opt.text === c) {
                selectEl.value = opt.value;
                return;
            }
        }
        if (c) selectEl.value = c;
    }

    _applyCheckoutCustomerFields(u, fields) {
        if (!u || typeof u !== 'object') return;
        const { fnEl, lnEl, emEl, phEl } = fields;
        if (!fnEl || !lnEl || !emEl) return;
        const first = String(u.firstName ?? u.first_name ?? '').trim();
        const last = String(u.lastName ?? u.last_name ?? '').trim();
        const email = String(u.email ?? '').trim();
        const phoneRaw = u.phone != null ? String(u.phone).trim() : '';
        if (first && !String(fnEl.value || '').trim()) fnEl.value = first;
        if (last && !String(lnEl.value || '').trim()) lnEl.value = last;
        if (email && !String(emEl.value || '').trim()) emEl.value = email;
        if (phEl && phoneRaw && !String(phEl.value || '').trim()) {
            const P = window.HMHERBS_PHONE_US;
            if (P && typeof P.formatDigitsToDisplay === 'function') {
                phEl.value = P.formatDigitsToDisplay(P.digitsOnly(phoneRaw));
                phEl.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                phEl.value = phoneRaw;
            }
        }
    }

    _pickDefaultShippingAddress(addresses) {
        if (!Array.isArray(addresses) || addresses.length === 0) return null;
        const shipping = addresses.filter((a) => (a.type || 'shipping') === 'shipping');
        const pool = shipping.length ? shipping : addresses;
        return pool.find((a) => a.is_default) || pool[0];
    }

    _applyCheckoutShippingFields(addr, profileUser) {
        if (!addr || typeof addr !== 'object') return;
        if (!this._shippingAddressNeedsPrefill()) return;

        this._setInputIfEmpty(document.getElementById('shipping-address-1'), addr.address_line_1);
        this._setInputIfEmpty(document.getElementById('shipping-address-2'), addr.address_line_2);
        this._setInputIfEmpty(document.getElementById('shipping-city'), addr.city);
        this._setInputIfEmpty(document.getElementById('shipping-state'), addr.state);
        this._setInputIfEmpty(document.getElementById('shipping-zip'), addr.postal_code);
        this._setSelectCountryIfEmpty(
            document.getElementById('shipping-country'),
            addr.country || 'United States'
        );

        const fields = this._checkoutCustomerFields();
        if (this._anyCheckoutCustomerFieldEmpty(fields)) {
            const nameSource = {
                firstName: addr.first_name,
                lastName: addr.last_name,
                email: profileUser?.email,
                phone: profileUser?.phone,
            };
            this._applyCheckoutCustomerFields(nameSource, fields);
        }
    }

    async _waitForCustomerAuth(maxMs = 8000) {
        const start = Date.now();
        while (Date.now() - start < maxMs) {
            if (window.customerAuth) return window.customerAuth;
            await new Promise((r) => setTimeout(r, 25));
        }
        return window.customerAuth || null;
    }

    _storefrontApiBase() {
        const origin = this.getApiOrigin();
        return origin ? `${origin}/api` : '/api';
    }

    /**
     * Pre-fill checkout from the signed-in account (profile + saved addresses).
     * @param {object} [userFromEvent] — optional user from hmherbs:customer-profile-updated
     */
    async prefillLoggedInCustomer(userFromEvent) {
        if (this._checkoutPrefillDone) return;
        const fields = this._checkoutCustomerFields();
        if (!fields.fnEl || !fields.lnEl || !fields.emEl) return;

        const token = this._getCustomerToken();
        if (!token) return;

        const sources = [
            userFromEvent,
            this._readStashedCheckoutCustomer(),
            this._readStoredCustomerUser(),
        ];
        for (const src of sources) {
            if (src && typeof src === 'object') {
                this._applyCheckoutCustomerFields(src, fields);
            }
        }

        const auth = await this._waitForCustomerAuth();

        if (auth && typeof auth.getCurrentUser === 'function') {
            try {
                const sessionUser = auth.getCurrentUser();
                if (sessionUser) this._applyCheckoutCustomerFields(sessionUser, fields);
            } catch (_) {
                /* ignore */
            }
        }

        let profileUser =
            userFromEvent && typeof userFromEvent === 'object' ? userFromEvent : null;

        const stillNeedCustomer = this._anyCheckoutCustomerFieldEmpty(fields);
        const stillNeedAddress = this._shippingAddressNeedsPrefill();

        if (!stillNeedCustomer && !stillNeedAddress) {
            this._checkoutPrefillDone = true;
            return;
        }

        try {
            if (stillNeedCustomer && auth && typeof auth.ensureProfileForCheckout === 'function') {
                const hydrated = await auth.ensureProfileForCheckout();
                if (hydrated) {
                    profileUser = hydrated;
                    this._applyCheckoutCustomerFields(hydrated, fields);
                }
            }

            const needCustomerAfterHydrate = this._anyCheckoutCustomerFieldEmpty(fields);
            const needAddressAfterHydrate = this._shippingAddressNeedsPrefill();

            if (needCustomerAfterHydrate) {
                const headers = {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                };
                const profileRes = await fetch(`${this._storefrontApiBase()}/user/profile`, { headers });
                if (profileRes.ok) {
                    const data = await profileRes.json().catch(() => ({}));
                    const u = data && (data.user || data);
                    if (u && typeof u === 'object') {
                        profileUser = u;
                        this._applyCheckoutCustomerFields(u, fields);
                        if (auth && typeof auth.stashCheckoutCustomerSnapshot === 'function') {
                            auth.stashCheckoutCustomerSnapshot();
                        }
                    }
                } else if (typeof console !== 'undefined' && console.warn) {
                    console.warn(
                        '[checkout] Could not load profile for prefill:',
                        profileRes.status,
                        profileRes.statusText
                    );
                }
            }

            if (needAddressAfterHydrate && this._shippingAddressNeedsPrefill()) {
                let addresses = [];
                if (auth && typeof auth.fetchUserAddressesForCheckout === 'function') {
                    const addrData = await auth.fetchUserAddressesForCheckout();
                    addresses = addrData.addresses || [];
                } else {
                    const headers = {
                        Authorization: `Bearer ${token}`,
                        Accept: 'application/json',
                    };
                    const addressRes = await fetch(`${this._storefrontApiBase()}/user/addresses`, {
                        headers,
                    });
                    if (addressRes.ok) {
                        const addrData = await addressRes.json().catch(() => ({}));
                        addresses = Array.isArray(addrData.addresses) ? addrData.addresses : [];
                    }
                }
                const shippingAddr = this._pickDefaultShippingAddress(addresses);
                if (shippingAddr) {
                    this._applyCheckoutShippingFields(shippingAddr, profileUser);
                }
            }
        } catch (err) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[checkout] Prefill failed:', err);
            }
        }

        if (
            !this._anyCheckoutCustomerFieldEmpty(fields) &&
            !this._shippingAddressNeedsPrefill()
        ) {
            this._checkoutPrefillDone = true;
        }
    }

    getNmiPaymentAmountString() {
        const due = typeof this.getCheckoutAmountDue === 'function' ? this.getCheckoutAmountDue() : null;
        const amount =
            due != null && Number.isFinite(due) && due >= 0
                ? due
                : Number(this.total);
        return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : '0.00';
    }

    /** Country/currency/price for Collect.js card tokenization only (no wallet buttons). */
    applyNmiCollectScriptDataAttributes(scriptEl) {
        if (!scriptEl) return;
        scriptEl.setAttribute('data-country', 'US');
        scriptEl.setAttribute('data-currency', 'USD');
        scriptEl.setAttribute('data-price', this.getNmiPaymentAmountString());
        // Do not set data-field-apple-pay-selector / google-pay-selector — that enables wallet SDK init.
    }

    refreshNmiCollectConfiguration() {
        if (!this.nmiScriptReady || typeof window.CollectJS === 'undefined') return;
        try {
            const maybePromise = window.CollectJS.configure(this.buildNmiCollectConfigureOptions());
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.catch(() => {});
            }
        } catch {
            /* non-fatal */
        }
    }

    /** Suppress Collect.js Apple Pay / Google Pay console noise when wallet buttons are hidden. */
    installNmiWalletNoiseConsoleFilter() {
        if (this._nmiConsoleNoiseFilterRestore) return;
        const origError = console.error;
        const origWarn = console.warn;
        const isWalletNoise = (args) => {
            const text = args
                .map((a) => {
                    if (typeof a === 'string') return a;
                    if (a && typeof a.message === 'string') return a.message;
                    try {
                        return String(a);
                    } catch {
                        return '';
                    }
                })
                .join(' ');
            return /PaymentRequestAbstraction|ApplePayRequest|ApplePayField|GooglePayField|InnerGooglePayField|Could not create PaymentRequest|Failed to create an Apple Pay button|must allow .* to use Apple Pay|DEVELOPER_ERROR in isReadyToPay|Google Pay APIs should be called in secure context/i.test(
                text
            );
        };
        const wrap = (orig) => (...args) => {
            if (isWalletNoise(args)) return;
            orig.apply(console, args);
        };
        console.error = wrap(origError);
        console.warn = wrap(origWarn);
        this._nmiConsoleNoiseFilterRestore = () => {
            console.error = origError;
            console.warn = origWarn;
            this._nmiConsoleNoiseFilterRestore = null;
        };
    }

    /** Collect.js field CSS — borderless inside .nmi-field-host (outer border matches .form-input). */
    getNmiCollectFieldCss() {
        return {
            border: 'none',
            'border-width': '0',
            'border-style': 'none',
            'border-radius': '0',
            outline: 'none',
            'box-shadow': 'none',
            margin: '0',
            padding: '12px 16px',
            'font-size': '16px',
            'line-height': '24px',
            height: '48px',
            width: '100%',
            'background-color': 'transparent',
            color: '#374151',
            'font-family': 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        };
    }

    buildNmiCollectConfigureOptions() {
        const fieldCss = this.getNmiCollectFieldCss();
        const opts = {
            variant: 'inline',
            styleSniffer: false,
            customCss: fieldCss,
            focusCss: { ...fieldCss, outline: 'none', 'box-shadow': 'none' },
            invalidCss: { color: '#dc2626' },
            callback: (response) => {
                void this.onNmiInlineCallback(response);
            },
            fields: {
                ccnumber: { selector: '#ccnumber', placeholder: 'Card number' },
                ccexp: { selector: '#ccexp', placeholder: 'MM / YY' },
                cvv: { selector: '#cvv', placeholder: 'CVV' }
            },
            country: 'US',
            currency: 'USD',
            price: this.getNmiPaymentAmountString()
        };
        return opts;
    }

    async loadSavedCards() {
        const token = localStorage.getItem('hmherbs_customer_token');
        const block = document.getElementById('saved-cards-block');
        const select = document.getElementById('saved-card-select');
        if (!token || !block || !select) return;
        try {
            const apiOrigin = this.getApiOrigin();
            const res = await fetch(`${apiOrigin}/api/payments/saved-cards`, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
            });
            if (!res.ok) return;
            const data = await res.json();
            this.savedCards = Array.isArray(data.cards) ? data.cards : [];
            if (!this.savedCards.length) {
                block.style.display = 'none';
                return;
            }
            block.style.display = 'block';
            select.innerHTML =
                '<option value="">Use a new card</option>' +
                this.savedCards
                    .map(
                        (c) =>
                            `<option value="${c.id}">${(c.brand || 'Card').toUpperCase()} •••• ${c.last4}</option>`
                    )
                    .join('');
            select.addEventListener('change', () => {
                this.selectedSavedCardId = select.value ? Number(select.value) : null;
                const collect = document.getElementById('nmi-collect-fields');
                if (collect) collect.style.opacity = this.selectedSavedCardId ? '0.35' : '1';
            });
        } catch (e) {
            console.warn('Saved cards unavailable', e);
        }
    }

    async payOrderWithSavedCard(orderId, email) {
        const customerToken = localStorage.getItem('hmherbs_customer_token');
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (customerToken) headers.Authorization = `Bearer ${customerToken}`;
        const apiOrigin = this.getApiOrigin();
        const payRes = await fetch(`${apiOrigin}/api/payments/process-payment`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                orderId,
                savedCardId: this.selectedSavedCardId,
                customerEmail: email
            })
        });
        const payJson = await payRes.json().catch(() => ({}));
        if (!payRes.ok) throw new Error(payJson.error || payJson.message || 'Payment failed');
        return payJson;
    }

    async initPaymentProcessorIfConfigured() {
        const apiOrigin = this.getApiOrigin();
        let cfg = {
            enabled: false,
            processor: 'epi',
            tokenizationKey: '',
            collectJsUrl: 'https://secure.nmi.com/token/Collect.js',
            sandbox: false,
            disableWallets: true
        };
        try {
            const r = await fetch(`${apiOrigin}/api/payments/nmi-client-config`);
            cfg = await r.json();
        } catch (e) {
            console.warn('Payment client config unavailable', e);
        }
        this.applyPaymentProcessorLabels(cfg);
        if (String(cfg.processor || '').toLowerCase() === 'mxmerchant') {
            return this.initMxIfConfigured();
        }
        return this.initNmiIfConfigured(cfg);
    }

    async initMxIfConfigured() {
        const apiOrigin = this.getApiOrigin();
        this.mxEnabled = false;
        this.mxConfig = null;
        try {
            const r = await fetch(`${apiOrigin}/api/payments/mx-client-config`);
            const cfg = await r.json();
            if (!cfg.enabled || !cfg.sessionToken) {
                console.info('Checkout: MX is not configured yet.');
                return;
            }
            this.mxEnabled = true;
            this.mxConfig = cfg;
            document.body.classList.add('checkout-mx-active');
            const legacy = document.getElementById('legacy-card-fields');
            if (legacy) legacy.style.display = 'block';
            const nmiBlock = document.getElementById('nmi-collect-fields');
            if (nmiBlock) nmiBlock.style.display = 'none';
            const hint = document.getElementById('nmi-test-card-hint');
            if (hint && cfg.sandbox) {
                hint.style.display = 'block';
                hint.innerHTML =
                    'Sandbox: use test card <strong>4242 4242 4242 4242</strong>, any future expiry, any CVV.';
            }
        } catch (e) {
            console.warn('MX client config unavailable', e);
        }
    }

    async refreshMxSessionToken() {
        const apiOrigin = this.getApiOrigin();
        const r = await fetch(`${apiOrigin}/api/payments/mx-client-config`);
        const cfg = await r.json();
        if (!cfg.enabled || !cfg.sessionToken) {
            throw new Error(cfg.error || 'MX is not configured');
        }
        this.mxConfig = cfg;
        return cfg;
    }

    collectMxCardFields() {
        const cardExpiry = document.getElementById('card-expiry')?.value || '';
        const billingZip =
            document.getElementById('billing-zip')?.value ||
            document.getElementById('shipping-zip')?.value ||
            '';
        const billingStreet =
            document.getElementById('billing-address-1')?.value ||
            document.getElementById('shipping-address-1')?.value ||
            '';
        return {
            number: document.getElementById('card-number')?.value || '',
            expiry: cardExpiry,
            cvv: document.getElementById('card-cvv')?.value || '',
            avsZip: billingZip,
            avsStreet: billingStreet,
        };
    }

    async submitMxCardPayment() {
        if (typeof window.HmMxCheckout === 'undefined') {
            this.showNotification('MX checkout helper failed to load. Please refresh the page.', 'error');
            return;
        }
        this.setCheckoutBusy(true);
        try {
            const cfg = await this.refreshMxSessionToken();
            const formData = this.collectFormData();
            formData.awaitingMxPayment = true;
            const customerToken = localStorage.getItem('hmherbs_customer_token');
            const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
            if (customerToken) headers.Authorization = `Bearer ${customerToken}`;
            const apiOrigin = this.getApiOrigin();
            const orderRes = await fetch(`${apiOrigin}/api/orders`, {
                method: 'POST',
                headers,
                body: JSON.stringify(formData),
            });
            const orderJson = await orderRes.json().catch(() => ({}));
            if (!orderRes.ok) throw new Error(orderJson.error || 'Order failed');

            const amountDue = Number(orderJson.cardAmountDue ?? this.getCheckoutAmountDue() ?? this.total);
            const email =
                formData.customerInfo?.email || document.getElementById('email')?.value?.trim() || '';
            const mxResult = await window.HmMxCheckout.chargeCard({
                apiBaseUrl: cfg.apiBaseUrl,
                sessionToken: cfg.sessionToken,
                merchantId: cfg.merchantId,
                amount: amountDue,
                cardAccount: this.collectMxCardFields(),
                clientReference: String(orderJson.orderNumber || orderJson.orderId || '').slice(0, 17),
                posData: cfg.posDataDefaults,
            });

            const payRes = await fetch(`${apiOrigin}/api/payments/process-mx-payment`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    orderId: orderJson.orderId,
                    mxPaymentId: mxResult.paymentId,
                    customerEmail: email,
                }),
            });
            const payJson = await payRes.json().catch(() => ({}));
            if (!payRes.ok) throw new Error(payJson.error || payJson.message || 'Payment failed');

            sessionStorage.removeItem('checkout_cart');
            localStorage.removeItem('hmherbs_cart');
            this.redirectToOrderConfirmation({
                orderId: orderJson.orderId,
                orderNumber: payJson.orderNumber || orderJson.orderNumber,
                email,
                paymentStatus: 'paid',
                trackingNumber: payJson.trackingNumber || null,
            });
        } catch (e) {
            this.showNotification(e.message || 'Payment failed', 'error');
        } finally {
            this.setCheckoutBusy(false);
        }
    }

    async initNmiIfConfigured(prefetchedCfg) {
        const apiOrigin = this.getApiOrigin();
        let cfg = prefetchedCfg || {
            enabled: false,
            tokenizationKey: '',
            collectJsUrl: 'https://secure.nmi.com/token/Collect.js',
            sandbox: false,
            disableWallets: true
        };
        try {
            if (!prefetchedCfg) {
                const r = await fetch(`${apiOrigin}/api/payments/nmi-client-config`);
                cfg = await r.json();
            }
        } catch (e) {
            console.warn('NMI client config unavailable', e);
        }
        if (!prefetchedCfg) {
            this.applyPaymentProcessorLabels(cfg);
        }
        const overrideKey = String(window.HMHERBS_NMI_PUBLIC_TOKENIZATION_KEY || '').trim();
        const serverPreflightRejected = Boolean(cfg.preflightRejected);
        this.nmiPreflightRejected = serverPreflightRejected && !overrideKey;
        if (this.nmiPreflightRejected) {
            console.info(
                'Checkout: NMI Collect.js is disabled (tokenization key missing or rejected). Gift card and manual card fields still work. Set NMI_PUBLIC_TOKENIZATION_KEY in backend/.env to enable hosted card fields — see backend/.env.example.'
            );
        }
        if ((!cfg.enabled || !cfg.tokenizationKey) && overrideKey) {
            cfg = {
                enabled: true,
                tokenizationKey: overrideKey,
                collectJsUrl: cfg.collectJsUrl || 'https://secure.nmi.com/token/Collect.js',
                sandbox: cfg.sandbox !== false,
                disableWallets: cfg.disableWallets !== false
            };
            this.nmiPreflightRejected = false;
        }
        if (!cfg.enabled || !cfg.tokenizationKey) {
            return;
        }
        if (document.getElementById('hmherbs-nmi-collect-script')) {
            if (typeof window.CollectJS !== 'undefined' && this.verifyNmiHostedFieldsMounted()) {
                this.nmiEnabled = true;
                this.nmiScriptReady = true;
                document.body.classList.add('checkout-nmi-active');
                const nmiBlock = document.getElementById('nmi-collect-fields');
                if (nmiBlock) nmiBlock.style.display = 'block';
            }
            return;
        }
        try {
            this.nmiEnabled = true;
            this.nmiSandbox = Boolean(cfg.sandbox);
            this.nmiDisableWallets = cfg.disableWallets !== false;
            document.body.classList.add('checkout-nmi-active');
            const nmiBlock = document.getElementById('nmi-collect-fields');
            if (nmiBlock) nmiBlock.style.display = 'block';
            const hint = document.getElementById('nmi-test-card-hint');
            if (hint && this.nmiSandbox) hint.style.display = 'block';

            ['card-number', 'card-expiry', 'card-cvv'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.removeAttribute('required');
            });

            const url = cfg.collectJsUrl || 'https://secure.nmi.com/token/Collect.js';
            const s = document.createElement('script');
            s.id = 'hmherbs-nmi-collect-script';
            s.src = url;
            s.async = true;
            // NMI docs: only tokenization-key on the script tag; field mapping via configure().
            s.setAttribute('data-tokenization-key', cfg.tokenizationKey);
            s.setAttribute('data-style-sniffer', 'false');
            this.applyNmiCollectScriptDataAttributes(s);
            if (this.nmiDisableWallets) {
                this.installNmiWalletNoiseConsoleFilter();
            }
            this.startNmiCollectRejectionGuard();
            s.onload = () => this.onNmiScriptReady();
            s.onerror = () => {
                console.warn('Collect.js failed to load');
                this.teardownNmiCollect(
                    'Secure card fields could not load (network or browser policy). You can still use manual card entry if shown.'
                );
                this.removeNmiRejectionGuard();
                this._nmiConsoleNoiseFilterRestore?.();
            };
            document.head.appendChild(s);
        } catch (e) {
            console.warn('NMI Collect.js setup failed', e);
        }
    }

    removeNmiRejectionGuard() {
        this._nmiCollectErrorGuardActive = false;
        window.removeEventListener('unhandledrejection', this._boundNmiRejectionGuard, true);
        if (this._nmiRejectionGuardTimer) {
            clearTimeout(this._nmiRejectionGuardTimer);
            this._nmiRejectionGuardTimer = null;
        }
    }

    /** One listener + timer; safe to call again (resets timer). */
    startNmiCollectRejectionGuard() {
        this.removeNmiRejectionGuard();
        this._nmiCollectErrorGuardActive = true;
        window.addEventListener('unhandledrejection', this._boundNmiRejectionGuard, true);
        this._nmiRejectionGuardTimer = setTimeout(() => this.removeNmiRejectionGuard(), 20000);
    }

    _nmiUnhandledRejectionMessage(ev) {
        const r = ev && ev.reason;
        if (r == null) return '';
        if (typeof r === 'string') return r;
        if (typeof r.message === 'string') return r.message;
        try {
            return String(r);
        } catch {
            return '';
        }
    }

    /**
     * Collect.js sometimes rejects inner promises that are not chained to `configure()`'s return value.
     * Capture those briefly so we can tear down NMI UI without flooding "Uncaught (in promise)".
     */
    onNmiUnhandledRejectionDuringInit(ev) {
        if (!this._nmiCollectErrorGuardActive) return;
        const msg = this._nmiUnhandledRejectionMessage(ev);
        if (!msg) return;
        const isWalletSetupNoise =
            /PaymentRequestAbstraction|ApplePayRequest|ApplePayField|GooglePayField|Apple Pay|Google Pay/i.test(
                msg
            );
        if (isWalletSetupNoise) {
            ev.preventDefault();
            return;
        }
        const looksLikeCollectTokenFailure =
            msg.includes("reading 'token'") ||
            msg.includes('reading "token"') ||
            msg.includes('401') ||
            msg.includes('Unauthorized') ||
            msg.includes('Giving up on retrieving token') ||
            (msg.includes('token') && msg.includes('undefined'));
        if (!looksLikeCollectTokenFailure) return;
        ev.preventDefault();
        console.warn('Collect.js async error (handled):', msg);
        if (this.nmiEnabled) {
            this.teardownNmiCollect(
                'Card tokenization failed (invalid NMI key is the usual cause). Fix NMI_PUBLIC_TOKENIZATION_KEY in backend/.env, restart the API server, then reload.'
            );
        }
    }

    /**
     * Revert Collect.js UI and restore legacy card fields after load/configure failure.
     * @param {string} [userMessage] — optional toast (warning)
     */
    teardownNmiCollect(userMessage) {
        const wasActive = this.nmiEnabled;
        // Do not remove the unhandledrejection guard here: Collect.js may emit many
        // follow-up rejections after the first failure; the guard timer clears it.
        this._nmiConsoleNoiseFilterRestore?.();
        this.nmiEnabled = false;
        this.nmiScriptReady = false;
        document.body.classList.remove('checkout-nmi-active');
        const nmiBlock = document.getElementById('nmi-collect-fields');
        if (nmiBlock) nmiBlock.style.display = 'none';
        const hint = document.getElementById('nmi-test-card-hint');
        if (hint) hint.style.display = 'none';
        ['card-number', 'card-expiry', 'card-cvv'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.setAttribute('required', 'required');
        });
        if (userMessage && wasActive) {
            this.showNotification(userMessage, 'warning');
        }
    }

    verifyNmiHostedFieldsMounted() {
        return ['ccnumber', 'ccexp', 'cvv'].every((id) => {
            const host = document.getElementById(id);
            return host && (host.querySelector('iframe') || host.querySelector('.CollectJSValid, .CollectJSInvalid'));
        });
    }

    onNmiScriptReady() {
        if (this._nmiCollectOnloadHandled) return;
        this._nmiCollectOnloadHandled = true;

        if (typeof window.CollectJS === 'undefined') {
            console.warn('CollectJS global missing after script load');
            this.teardownNmiCollect(
                'Payment tokenization did not initialize. Check NMI_PUBLIC_TOKENIZATION_KEY in backend/.env.'
            );
            this.removeNmiRejectionGuard();
            return;
        }
        try {
            const configureOpts = this.buildNmiCollectConfigureOptions();
            const maybePromise = window.CollectJS.configure(configureOpts);
            const onConfigured = () => {
                this.nmiScriptReady = true;
                window.setTimeout(() => {
                    if (!this.verifyNmiHostedFieldsMounted()) {
                        this.teardownNmiCollect(
                            'Secure card fields could not load. The payment tokenization key on the server may be invalid — check NMI_PUBLIC_TOKENIZATION_KEY in backend/.env (sandbox key + NMI_SANDBOX=1), restart the API, and reload.'
                        );
                        this.removeNmiRejectionGuard();
                    }
                }, 1200);
            };
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise
                    .then(onConfigured)
                    .catch((err) => {
                        console.warn('CollectJS initialization failed', err);
                        console.warn(
                            'If you see POST .../token/api/create 401: set NMI_PUBLIC_TOKENIZATION_KEY to the Collect.js public tokenization key from your NMI portal (sandbox vs production must match NMI_SANDBOX).'
                        );
                        this.teardownNmiCollect(
                            'Card tokenization failed to start (often an invalid NMI key). Check the browser console and backend/.env.'
                        );
                    });
                return;
            }
            onConfigured();
        } catch (e) {
            console.error('CollectJS.configure failed', e);
            this.teardownNmiCollect(
                e.message ||
                    'CollectJS.configure failed. Verify NMI_PUBLIC_TOKENIZATION_KEY and restart the backend.'
            );
        }
    }

    async onNmiInlineCallback(response) {
        if (this._checkoutInFlight) return;
        const loadingOverlay = document.getElementById('loading-overlay');
        if (!response?.token) {
            const msg =
                (response && (response.error || response.message)) ||
                'Could not tokenize card. Check the details and try again.';
            this.showNotification(typeof msg === 'string' ? msg : 'Card tokenization failed', 'error');
            return;
        }
        this.setCheckoutBusy(true);
        try {
            const customerToken = localStorage.getItem('hmherbs_customer_token');
            const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
            if (customerToken) headers.Authorization = `Bearer ${customerToken}`;
            const apiOrigin = this.getApiOrigin();

            const formData = this.collectFormData();
            formData.awaitingNmiPayment = true;

            const orderRes = await fetch(`${apiOrigin}/api/orders`, {
                method: 'POST',
                headers,
                body: JSON.stringify(formData)
            });
            let orderJson = {};
            try {
                orderJson = await orderRes.json();
            } catch {
                orderJson = {};
            }
            if (!orderRes.ok) {
                throw new Error(orderJson.error || orderJson.message || 'Order could not be created');
            }
            const orderId = orderJson.orderId;
            const email =
                formData.customerInfo?.email || document.getElementById('email')?.value?.trim() || '';

            const payRes = await fetch(`${apiOrigin}/api/payments/process-payment`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    orderId,
                    payment_token: response.token,
                    customerEmail: email,
                    saveCard: document.getElementById('save-card-checkbox')?.checked !== false,
                    setAsDefault: true
                })
            });
            let payJson = {};
            try {
                payJson = await payRes.json();
            } catch {
                payJson = {};
            }
            if (!payRes.ok) {
                throw new Error(payJson.error || payJson.message || 'Payment was not successful');
            }

            sessionStorage.removeItem('checkout_cart');
            localStorage.removeItem('hmherbs_cart');
            this.redirectToOrderConfirmation({
                orderId,
                orderNumber: payJson.orderNumber || orderJson.orderNumber,
                email,
                paymentStatus: 'paid',
                trackingNumber: payJson.trackingNumber || null
            });
        } catch (err) {
            console.error('NMI checkout error:', err);
            this.showNotification(err.message || 'Payment failed', 'error');
        } finally {
            this.setCheckoutBusy(false);
        }
    }

    /**
     * Server-priced totals (trigger/reward promos, tax, shipping). Uses /api/promotions/preview.
     * @param {Array} cartItems
     * @param {string} promoCode
     */
    async calculateTotal(cartItems, promoCode) {
        const items = Array.isArray(cartItems) ? cartItems : [];
        const code = String(promoCode || '').trim();
        const emailEl = document.getElementById('email');
        const email = emailEl ? emailEl.value.trim() : '';
        const token = localStorage.getItem('hmherbs_customer_token');
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const apiOrigin = this.getApiOrigin();
        try {
            const response = await fetch(`${apiOrigin}/api/promotions/preview`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    promoCode: code,
                    cartItems: items,
                    email,
                    shippingMethod: this.selectedShippingMethod,
                    shippingAmount: this.selectedShippingAmount,
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || data.message || 'Could not calculate total');
            }
            return data.totals;
        } catch (err) {
            console.warn('Promo preview unavailable, using client estimate:', err.message);
            const subtotal = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1), 0);
            const tax = Math.round(subtotal * (this.storeTaxRate || 0.08) * 100) / 100;
            const shipping = this.selectedShippingAmount || (subtotal >= 50 ? 0 : 9.99);
            return {
                subtotal,
                discount: 0,
                tax,
                shipping,
                total: subtotal + tax + shipping,
            };
        }
    }

    getShippingAddressForQuote() {
        return {
            postalCode: document.getElementById('shipping-zip')?.value?.trim() || '',
            state: document.getElementById('shipping-state')?.value?.trim() || '',
            country: document.getElementById('shipping-country')?.value || 'United States',
        };
    }

    async fetchShippingOptions() {
        if (!this.cart.length) {
            this.shippingOptions = [];
            this.renderShippingOptions();
            return;
        }
        const addr = this.getShippingAddressForQuote();
        const cartItems = this.cart.map((it) => ({
            product_id: it.id ?? it.product_id,
            variant_id: it.variant_id ?? it.variantId ?? null,
            name: it.name,
            price: it.price ?? 0,
            quantity: it.quantity ?? 1,
        }));
        const merchandiseSubtotal = cartItems.reduce(
            (s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1),
            0
        );
        try {
            const apiOrigin = this.getApiOrigin();
            const res = await fetch(`${apiOrigin}/api/shipping/options`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cartItems,
                    postalCode: addr.postalCode,
                    state: addr.state,
                    country: addr.country,
                    merchandiseSubtotal,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Shipping options unavailable');
            this.shippingOptions = Array.isArray(data.options) ? data.options : [];
            const current = this.selectedShippingMethod;
            const stillValid = this.shippingOptions.some((o) => o.method === current);
            if (!stillValid && this.shippingOptions.length) {
                const pick = this.shippingOptions[0];
                this.selectedShippingMethod = pick.method;
                this.selectedShippingAmount = Number(pick.amount) || 0;
            }
            this.renderShippingOptions(data);
            await this.refreshCheckoutTotals();
        } catch (e) {
            console.warn('Shipping options:', e);
            this.shippingOptions = [];
            this.selectedShippingMethod = merchandiseSubtotal >= 50 ? 'free_standard' : 'first_class';
            this.selectedShippingAmount = merchandiseSubtotal >= 50 ? 0 : 9.99;
            this.renderShippingOptions();
        }
    }

    renderShippingOptions(meta = {}) {
        const wrap = document.getElementById('checkout-shipping-methods');
        const list = document.getElementById('checkout-shipping-options');
        const note = document.getElementById('checkout-shipping-note');
        if (!wrap || !list) return;

        if (!this.cart.length || !this.shippingOptions.length) {
            wrap.style.display = 'none';
            return;
        }

        wrap.style.display = 'block';
        list.innerHTML = this.shippingOptions
            .map((opt) => {
                const checked = opt.method === this.selectedShippingMethod ? 'checked' : '';
                const priceLabel = Number(opt.amount) === 0 ? 'FREE' : `$${Number(opt.amount).toFixed(2)}`;
                return `
                    <label class="checkout-shipping-option" style="display:flex;gap:0.75rem;align-items:flex-start;padding:0.75rem;border:1px solid var(--gray-200);border-radius:8px;margin-bottom:0.5rem;cursor:pointer;">
                        <input type="radio" name="checkout_shipping_method" value="${opt.method}" data-amount="${opt.amount}" ${checked} style="margin-top:0.2rem;">
                        <span style="flex:1;">
                            <strong>${opt.label}</strong>
                            <span style="float:right;font-weight:600;">${priceLabel}</span>
                            ${opt.description ? `<div style="font-size:0.85rem;color:var(--gray-500);margin-top:0.2rem;">${opt.description}</div>` : ''}
                        </span>
                    </label>`;
            })
            .join('');

        list.querySelectorAll('input[type="radio"]').forEach((radio) => {
            radio.addEventListener('change', async () => {
                if (!radio.checked) return;
                this.selectedShippingMethod = radio.value;
                this.selectedShippingAmount = parseFloat(radio.dataset.amount) || 0;
                await this.refreshCheckoutTotals();
            });
        });

        if (note) {
            let text = 'Free standard shipping on orders $50+. First class $9.99 under $50.';
            if (meta.weightsKnown === false) {
                text += ' Carrier rates appear once product weights are on file.';
            }
            note.textContent = text;
        }
    }

    async loadStoreTaxRate() {
        try {
            const origin = this.getApiOrigin();
            const response = await fetch(`${origin}/api/store-info`);
            if (!response.ok) return;
            const data = await response.json();
            const rate = Number(data.taxRate);
            if (Number.isFinite(rate) && rate >= 0) this.storeTaxRate = rate;
        } catch (error) {
            console.warn('Unable to load store tax rate:', error);
        }
    }

    async loadTaxExemptStatus() {
        const token = localStorage.getItem('hmherbs_customer_token');
        if (!token) {
            this.taxStatus = { checked: true, loggedIn: false, taxExempt: false, verified: false, taxExemptIdPresent: false };
            const pcodeEarly = document.getElementById('checkout-promo-code')?.value?.trim();
            if (pcodeEarly) await this.fetchPromoPreview(pcodeEarly);
            else this.calculateTotals();
            this.updateTaxStatusNote();
            return;
        }

        try {
            const response = await fetch(`${this.getApiOrigin()}/api/user/tax-status`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!response.ok) {
                this.taxStatus = { checked: true, loggedIn: true, taxExempt: false, verified: false, taxExemptIdPresent: false };
                const pcodeEarly2 = document.getElementById('checkout-promo-code')?.value?.trim();
                if (pcodeEarly2) await this.fetchPromoPreview(pcodeEarly2);
                else this.calculateTotals();
                this.updateTaxStatusNote();
                return;
            }

            const data = await response.json();
            this.taxStatus = {
                checked: true,
                loggedIn: true,
                taxExempt: Boolean(data.taxExempt),
                verified: Boolean(data.verified),
                taxExemptIdPresent: Boolean(data.taxExemptIdPresent)
            };
        } catch (error) {
            console.warn('Unable to load tax exemption status:', error);
            this.taxStatus = { checked: true, loggedIn: true, taxExempt: false, verified: false, taxExemptIdPresent: false };
        }

        const pcode = document.getElementById('checkout-promo-code')?.value?.trim();
        if (pcode) {
            await this.fetchPromoPreview(pcode);
        } else {
            this.calculateTotals();
        }
        this.updateTaxStatusNote();
    }

    persistCartAndSyncApp() {
        try {
            sessionStorage.setItem('checkout_cart', JSON.stringify(this.cart));
            localStorage.setItem('hmherbs_cart', JSON.stringify(this.cart));
        } catch (e) {
            console.warn('Could not persist cart', e);
        }
        if (window.hmHerbsApp) {
            try {
                window.hmHerbsApp.loadCartFromStorage();
                window.hmHerbsApp.updateCartDisplay();
            } catch (e) {
                console.warn('Could not sync main cart UI', e);
            }
        }
    }

    /** Recompute totals; re-run server pricing when cart has items (promo code, group discounts, employee discount). */
    async refreshCheckoutTotals() {
        const pcode = document.getElementById('checkout-promo-code')?.value?.trim() || '';
        if (this.cart.length > 0) {
            await this.fetchPromoPreview(pcode);
            return;
        }
        this.promoPreview = null;
        this.promoDiscountAmount = 0;
        const drow = document.getElementById('checkout-promo-discount-row');
        const dval = document.getElementById('checkout-promo-discount-value');
        if (drow) drow.style.display = 'none';
        if (dval) dval.textContent = '-$0.00';
        const fb = document.getElementById('checkout-promo-feedback');
        if (fb) {
            fb.textContent = '';
            fb.style.color = 'var(--gray-600)';
        }
        this.calculateTotals();
    }

    getMaxQtyForLine(item) {
        const inv = item.inventory_quantity ?? item.inventory ?? item.inventoryQuantity;
        const n = Number(inv);
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
        return null;
    }

    clampLineQty(rawQty, maxAllowed) {
        let q = Math.floor(Number(rawQty));
        if (!Number.isFinite(q) || q < 1) q = 1;
        if (maxAllowed != null && q > maxAllowed) q = maxAllowed;
        return q;
    }

    async setLineQuantity(index, rawQty) {
        if (index < 0 || index >= this.cart.length) return;
        const item = this.cart[index];
        const maxQ = this.getMaxQtyForLine(item);
        const parsed = Math.floor(Number(String(rawQty).trim()));
        const wanted = Number.isFinite(parsed) ? parsed : 1;
        const next = this.clampLineQty(wanted, maxQ);
        if (maxQ != null && wanted > maxQ) {
            this.showNotification(`Only ${maxQ} available in stock for this item.`, 'warning');
        }
        item.quantity = next;
        this.persistCartAndSyncApp();
        this.renderOrderSummary();
        await this.refreshCheckoutTotals();
    }

    async adjustLineQuantity(index, delta) {
        if (index < 0 || index >= this.cart.length) return;
        const item = this.cart[index];
        const cur = Math.max(1, Math.floor(Number(item.quantity)) || 1);
        const maxQ = this.getMaxQtyForLine(item);
        if (delta < 0 && cur <= 1) return;
        if (delta > 0 && maxQ != null && cur >= maxQ) {
            this.showNotification(`Maximum ${maxQ} in stock.`, 'warning');
            return;
        }
        await this.setLineQuantity(index, cur + delta);
    }

    async fetchPromoPreview(codeRaw) {
        const fb = document.getElementById('checkout-promo-feedback');
        const code = String(codeRaw || '').trim();
        if (fb) {
            fb.style.color = 'var(--gray-600)';
            fb.textContent = '';
        }

        if (this.cart.length === 0) {
            this.promoPreview = null;
            this.calculateTotals();
            return;
        }

        const cartItems = this.cart.map((it) => ({
            id: it.id ?? it.product_id,
            product_id: it.id ?? it.product_id,
            variant_id: it.variant_id ?? it.variantId ?? null,
            quantity: it.quantity ?? 1,
            price: it.price ?? 0,
            giftCard: it.giftCard || null
        }));

        const emailEl = document.getElementById('email');
        const email = emailEl ? emailEl.value.trim() : '';

        try {
            const token = localStorage.getItem('hmherbs_customer_token');
            const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
            if (token) headers.Authorization = `Bearer ${token}`;

            const apiOrigin = this.getApiOrigin();

            const response = await fetch(`${apiOrigin}/api/promotions/preview`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    promoCode: code,
                    cartItems,
                    email,
                    shippingMethod: this.selectedShippingMethod,
                    shippingAmount: this.selectedShippingAmount,
                })
            });
            let data = {};
            try {
                data = await response.json();
            } catch {
                data = {};
            }

            if (!response.ok) {
                const msg = data.error || data.message || response.statusText || 'Could not apply code';
                throw new Error(msg);
            }

            if (!data.totals) {
                throw new Error('Invalid promo response');
            }

            this.promoPreview = data;
            if (fb) {
                fb.style.color = 'var(--gray-700)';
                const parts = [];
                if (data.promoCode) parts.push(`Promo: ${data.promoCode}`);
                if (data.groupAutoPromotionApplied && data.groupAutoPromotionCode) {
                    parts.push(`Group promo: ${data.groupAutoPromotionCode}`);
                }
                if (data.groupDiscountApplied && data.groupDiscountLabel) {
                    parts.push(data.groupDiscountLabel);
                } else if (data.groupDiscountApplied && data.groupDiscountAmount > 0) {
                    parts.push(`Group discount −$${Number(data.groupDiscountAmount).toFixed(2)}`);
                }
                if (data.availableGroupPromotions?.length && !data.promoApplied) {
                    const codes = data.availableGroupPromotions.map((p) => p.code).join(', ');
                    parts.push(`Your group codes: ${codes}`);
                }
                fb.textContent = parts.length ? parts.join(' · ') : code ? `Applied: ${data.promoCode || code}` : '';
            }

            this.calculateTotals();
        } catch (err) {
            this.promoPreview = null;
            const msg =
                err && err.message ? err.message : 'Promo unavailable. Confirm the code or try again.';
            if (fb && code) {
                fb.style.color = 'var(--error, #dc2626)';
                fb.textContent = msg;
            }
            this.calculateTotals();
            if (code) {
                this.showNotification(msg, 'error');
            }
        }
    }

    loadCart() {
        try {
            const cartData = sessionStorage.getItem('checkout_cart');
            if (cartData) {
                this.cart = JSON.parse(cartData);
                if (this.cart.length > 0) {
                    this.renderOrderSummary();
                    void this.fetchShippingOptions();
                    this.calculateTotals();
                } else {
                    this.showEmptyCart();
                }
            } else {
                // Try loading from localStorage as fallback
                const localCart = localStorage.getItem('hmherbs_cart');
                if (localCart) {
                    this.cart = JSON.parse(localCart);
                    if (this.cart.length > 0) {
                        sessionStorage.setItem('checkout_cart', localCart);
                        this.renderOrderSummary();
                        void this.fetchShippingOptions();
                        this.calculateTotals();
                    } else {
                        this.showEmptyCart();
                    }
                } else {
                    this.showEmptyCart();
                }
            }
        } catch (error) {
            console.error('Error loading cart:', error);
            this.showEmptyCart();
        }
    }

    showEmptyCart() {
        const container = document.getElementById('order-items-container');
        const totalsContainer = document.getElementById('order-totals-container');
        if (container) {
            container.innerHTML = `
                <div class="empty-cart-message">
                    <span class="cart-empty-icon" aria-hidden="true">&#128722;</span>
                    <p>Your cart is empty</p>
                    <a href="products.html" class="btn btn-primary" style="margin-top: var(--space-4); display: inline-block;">Continue Shopping</a>
                </div>
            `;
        }
        if (totalsContainer) {
            totalsContainer.style.display = 'none';
        }
    }

    renderOrderSummary() {
        const container = document.getElementById('order-items-container');
        const totalsContainer = document.getElementById('order-totals-container');
        
        if (!container || this.cart.length === 0) {
            this.showEmptyCart();
            return;
        }

        // Clear container
        container.innerHTML = '';

        this.cart.forEach((item, index) => {
            const qty = Math.max(1, Math.floor(Number(item.quantity)) || 1);
            item.quantity = qty;
            const itemTotal = (item.price || 0) * qty;
            const maxQ = this.getMaxQtyForLine(item);
            const maxAttr = maxQ != null ? `max="${maxQ}"` : '';
            const decDisabled = qty <= 1 ? 'disabled' : '';
            const incDisabled = maxQ != null && qty >= maxQ ? 'disabled' : '';
            const safeName = this.escapeHtml(item.name);
            const giftMeta = item.giftCard
                ? `<div class="order-item-gift-meta">${item.giftCard.recipientEmail ? `To: ${this.escapeHtml(item.giftCard.recipientEmail)}` : 'Physical gift card'}${item.giftCard.cardType === 'digital' ? ' · Digital' : ' · Physical'}${item.giftCard.includePersonalizedEmail ? ' · Personalized email' : ''}</div>`
                : '';
            const giftThumb =
                item.giftCard && window.HmGiftCard?.markup
                    ? `<div class="checkout-gift-card-thumb">${window.HmGiftCard.markup({
                          amount: item.price,
                          cardType: item.giftCard.cardType || 'digital',
                          compact: true
                      })}</div>`
                    : `<img src="${this.escapeHtml(this.safeImageUrl(item.image))}" alt="${safeName}" class="order-item-image" onerror="this.src='${this.createPlaceholderImage()}'">`;
            const itemDiv = document.createElement('div');
            itemDiv.className = 'order-item';
            itemDiv.innerHTML = `
                ${giftThumb}
                <div class="order-item-details">
                    <div class="order-item-name">${safeName}</div>
                    ${giftMeta}
                    <div class="checkout-line-qty" role="group" aria-label="Quantity for ${safeName}">
                        <button type="button" class="checkout-qty-btn" data-checkout-qty="dec" data-index="${index}" aria-label="Decrease quantity" ${decDisabled}>−</button>
                        <input type="number" class="checkout-qty-input" min="1" ${maxAttr} value="${qty}" inputmode="numeric" data-index="${index}" aria-label="Quantity">
                        <button type="button" class="checkout-qty-btn" data-checkout-qty="inc" data-index="${index}" aria-label="Increase quantity" ${incDisabled}>+</button>
                    </div>
                    <div class="order-item-price">$${itemTotal.toFixed(2)}</div>
                    <button type="button" class="order-item-remove remove-item" data-index="${index}" aria-label="Remove ${safeName} from cart">
                        <svg class="cart-item-delete-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"/></svg> Delete
                    </button>
                </div>
            `;

            const removeBtn = itemDiv.querySelector('.order-item-remove');
            if (removeBtn) {
                removeBtn.addEventListener('click', () => {
                    void this.removeItem(index);
                });
            }

            container.appendChild(itemDiv);
        });

        if (totalsContainer) {
            totalsContainer.style.display = 'block';
        }
        void this.fetchShippingOptions();
    }

    async removeItem(index) {
        if (index >= 0 && index < this.cart.length) {
            const removedItem = this.cart[index];
            this.cart.splice(index, 1);
            this.persistCartAndSyncApp();

            if (this.cart.length > 0) {
                this.renderOrderSummary();
                await this.refreshCheckoutTotals();
            } else {
                this.promoPreview = null;
                this.showEmptyCart();
                await this.refreshCheckoutTotals();
            }

            this.showNotification(`Removed ${removedItem.name} from cart`, 'success');
        }
    }

    calculateTotals() {
        const drow = document.getElementById('checkout-promo-discount-row');
        const dval = document.getElementById('checkout-promo-discount-value');

        const usePromoTotals =
            this.promoPreview && this.promoPreview.totals != null && this.cart.length > 0;

        if (usePromoTotals) {
            const t = this.promoPreview.totals;
            this.subtotal = Number(t.merchandiseSubtotal) || 0;
            this.shipping = Number(t.shippingAfter) || 0;
            this.tax = Number(t.taxAmount) || 0;
            this.total = Number(t.totalAmount) || 0;
            this.promoDiscountAmount = Number(t.totalDiscountAmount) || 0;
        } else {
            this.promoDiscountAmount = 0;

            // Calculate subtotal (display until a promo preview is accepted)
            this.subtotal = this.cart.reduce((sum, item) => {
                return sum + ((item.price || 0) * (item.quantity || 1));
            }, 0);

            // Calculate shipping (free over $50, otherwise $9.99 first class)
            if (this.selectedShippingMethod && Number.isFinite(this.selectedShippingAmount)) {
                this.shipping = this.selectedShippingAmount;
            } else {
                this.shipping = this.subtotal >= 50 ? 0 : 9.99;
            }

            // Calculate tax — server verifies on submit
            const rate = Number(this.storeTaxRate);
            const taxRate = Number.isFinite(rate) && rate >= 0 ? rate : 0.08;
            this.tax = this.taxStatus.verified ? 0 : Math.round(this.subtotal * taxRate * 100) / 100;

            // Calculate total
            this.total =
                Math.round((this.subtotal + this.shipping + this.tax) * 100 + Number.EPSILON) / 100;
        }

        if (drow && dval) {
            if (this.promoDiscountAmount > 0.005) {
                drow.style.display = 'flex';
                dval.textContent = `-$${this.promoDiscountAmount.toFixed(2)}`;
            } else {
                drow.style.display = 'none';
            }
        }

        const subtotalEl = document.getElementById('subtotal');
        const shippingEl = document.getElementById('shipping');
        const taxEl = document.getElementById('tax');
        const totalEl = document.getElementById('total');

        if (subtotalEl) subtotalEl.textContent = `$${this.subtotal.toFixed(2)}`;
        if (shippingEl) shippingEl.textContent = this.shipping === 0 ? 'FREE' : `$${this.shipping.toFixed(2)}`;
        if (taxEl) taxEl.textContent = `$${this.tax.toFixed(2)}`;
        if (totalEl) totalEl.textContent = `$${this.total.toFixed(2)}`;
        this.updateCheckoutRewardsSummary();
        this.updateTaxStatusNote();
        this.refreshNmiCollectConfiguration();
    }

    updateTaxStatusNote() {
        const noteEl = document.getElementById('tax-status-note');
        if (!noteEl) return;

        let text = '';
        let styles = '';
        if (!this.taxStatus.checked) {
            text = 'Checking tax exemption status...';
            styles = 'background:#f3f4f6;color:#374151;border:1px solid #d1d5db;';
        } else if (!this.taxStatus.loggedIn) {
            text = 'Tax exemption requires signing in to a verified tax-exempt account.';
            styles = 'background:#eff6ff;color:#1e3a8a;border:1px solid #bfdbfe;';
        } else if (this.taxStatus.verified) {
            text = 'Tax-exempt status verified. Sales tax is removed from this order.';
            styles = 'background:#ecfdf5;color:#166534;border:1px solid #86efac;';
        } else if (this.taxStatus.taxExempt && !this.taxStatus.taxExemptIdPresent) {
            text = 'Tax-exempt flag is set, but no tax exemption ID is on file. Tax still applies.';
            styles = 'background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;';
        } else if (this.taxStatus.taxExempt && this.taxStatus.taxExemptIdPresent && !this.taxStatus.verified) {
            text = 'Tax exemption ID could not be verified for this account. Tax still applies.';
            styles = 'background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;';
        } else {
            text = 'This account is not marked tax-exempt. Tax applies to this order.';
            styles = 'background:#f9fafb;color:#374151;border:1px solid #e5e7eb;';
        }

        noteEl.textContent = text;
        noteEl.style.cssText = `display:block;margin-top:0.75rem;padding:0.65rem 0.75rem;border-radius:8px;font-size:0.9rem;line-height:1.35;${styles}`;
    }

    setupEventListeners() {
        const shippingZip = document.getElementById('shipping-zip');
        const shippingState = document.getElementById('shipping-state');
        const debouncedShippingRefresh = () => {
            clearTimeout(this._shippingOptionsTimer);
            this._shippingOptionsTimer = setTimeout(() => void this.fetchShippingOptions(), 400);
        };
        if (shippingZip) shippingZip.addEventListener('input', debouncedShippingRefresh);
        if (shippingState) shippingState.addEventListener('change', debouncedShippingRefresh);

        // Same as shipping checkbox
        const sameAsShipping = document.getElementById('same-as-shipping');
        const billingFields = document.getElementById('billing-address-fields');
        
        if (sameAsShipping && billingFields) {
            sameAsShipping.addEventListener('change', (e) => {
                if (e.target.checked) {
                    billingFields.style.display = 'none';
                    // Clear billing fields
                    const billingAddress1 = document.getElementById('billing-address-1');
                    const billingAddress2 = document.getElementById('billing-address-2');
                    const billingCity = document.getElementById('billing-city');
                    const billingState = document.getElementById('billing-state');
                    const billingZip = document.getElementById('billing-zip');
                    const billingCountry = document.getElementById('billing-country');
                    
                    if (billingAddress1) billingAddress1.value = '';
                    if (billingAddress2) billingAddress2.value = '';
                    if (billingCity) billingCity.value = '';
                    if (billingState) billingState.value = '';
                    if (billingZip) billingZip.value = '';
                    if (billingCountry) billingCountry.value = 'United States';
                } else {
                    billingFields.style.display = 'block';
                }
            });
        }

        // Payment method change - show/hide EPI payment fields and bank account fields
        const paymentMethod = document.getElementById('payment-method');
        const epiPaymentFields = document.getElementById('epi-payment-fields');
        const bankAccountFields = document.getElementById('bank-account-fields');
        const giftCardFields = document.getElementById('gift-card-fields');
        const giftCardCheckBtn = document.getElementById('gift-card-check-balance');
        
        if (paymentMethod) {
            // Also check on page load in case a value is already selected
            const checkPaymentMethod = () => {
                const selectedMethod = paymentMethod.value;
                
                // Hide all payment fields first
                if (epiPaymentFields) {
                    epiPaymentFields.style.display = 'none';
                }
                if (bankAccountFields) {
                    bankAccountFields.style.display = 'none';
                }
                if (giftCardFields) {
                    giftCardFields.style.display = 'none';
                }
                this.clearGiftCardBalanceResult();
                
                // Remove required attributes from all payment fields
                const allPaymentFields = [
                    'card-number', 'card-expiry', 'card-cvv', 'cardholder-name',
                    'account-holder-name', 'account-type', 'routing-number', 
                    'account-number', 'confirm-account-number', 'gift-card-code'
                ];
                allPaymentFields.forEach(fieldId => {
                    const field = document.getElementById(fieldId);
                    if (field) field.removeAttribute('required');
                });
                
                if (selectedMethod === 'credit_card' || selectedMethod === 'debit_card') {
                    // Show EPI / NMI Collect.js or MX keyed fields
                    if (epiPaymentFields) {
                        epiPaymentFields.style.display = 'block';
                        epiPaymentFields.style.visibility = 'visible';
                        epiPaymentFields.style.opacity = '1';
                    }
                    if (this.activePaymentProcessor === 'mxmerchant' || (!this.nmiEnabled && !this.mxEnabled)) {
                        const legacy = document.getElementById('legacy-card-fields');
                        const nmiBlock = document.getElementById('nmi-collect-fields');
                        if (legacy) legacy.style.display = 'block';
                        if (nmiBlock) nmiBlock.style.display = 'none';
                    }
                    this.updateNmiCardPaymentNotice();
                    const cardNumber = document.getElementById('card-number');
                    const cardExpiry = document.getElementById('card-expiry');
                    const cardCvv = document.getElementById('card-cvv');
                    const cardholderName = document.getElementById('cardholder-name');

                    if (this.nmiEnabled) {
                        [cardNumber, cardExpiry, cardCvv].forEach((el) => {
                            if (el) el.removeAttribute('required');
                        });
                    } else {
                        if (cardNumber) {
                            cardNumber.setAttribute('required', 'required');
                            cardNumber.removeAttribute('disabled');
                            cardNumber.removeAttribute('readonly');
                        }
                        if (cardExpiry) {
                            cardExpiry.setAttribute('required', 'required');
                            cardExpiry.removeAttribute('disabled');
                            cardExpiry.removeAttribute('readonly');
                        }
                        if (cardCvv) {
                            cardCvv.setAttribute('required', 'required');
                            cardCvv.removeAttribute('disabled');
                            cardCvv.removeAttribute('readonly');
                        }
                    }
                    if (cardholderName) {
                        cardholderName.setAttribute('required', 'required');
                        cardholderName.removeAttribute('disabled');
                        cardholderName.removeAttribute('readonly');
                    }
                } else if (selectedMethod === 'gift_card') {
                    if (giftCardFields) {
                        giftCardFields.style.display = 'block';
                        giftCardFields.style.visibility = 'visible';
                        giftCardFields.style.opacity = '1';
                    }
                    void this.prepareGiftCardPaymentUi();
                }
            };
            
            paymentMethod.addEventListener('change', checkPaymentMethod);
            
            // Check on initial load
            setTimeout(checkPaymentMethod, 100);

            if (giftCardCheckBtn) {
                giftCardCheckBtn.addEventListener('click', () => this.checkGiftCardBalance());
            }
            const giftCardAccountSelect = document.getElementById('gift-card-account-select');
            if (giftCardAccountSelect) {
                giftCardAccountSelect.addEventListener('change', () => this.onAccountGiftCardSelected());
            }
            const giftCardShowManual = document.getElementById('gift-card-show-manual');
            if (giftCardShowManual) {
                giftCardShowManual.addEventListener('click', () => this.setGiftCardManualMode(true));
            }
            const giftCardCodeInput = document.getElementById('gift-card-code');
            const giftCardPinInput = document.getElementById('gift-card-pin');
            [giftCardCodeInput, giftCardPinInput].forEach((el) => {
                if (!el) return;
                el.addEventListener('input', () => {
                    this.selectedAccountGiftCardId = null;
                    this.giftCardBalanceChecked = false;
                    this.clearGiftCardBalanceResult();
                });
            });
        } else {
            console.error('Payment method not found');
        }

        // Card number formatting
        const cardNumber = document.getElementById('card-number');
        if (cardNumber) {
            cardNumber.addEventListener('input', (e) => {
                let value = e.target.value.replace(/\s/g, '');
                let formattedValue = value.match(/.{1,4}/g)?.join(' ') || value;
                if (formattedValue.length <= 19) {
                    e.target.value = formattedValue;
                }
            });
        }

        // Expiry date formatting
        const cardExpiry = document.getElementById('card-expiry');
        if (cardExpiry) {
            cardExpiry.addEventListener('input', (e) => {
                let value = e.target.value.replace(/\D/g, '');
                if (value.length >= 2) {
                    value = value.substring(0, 2) + '/' + value.substring(2, 4);
                }
                e.target.value = value;
            });
        }

        // CVV - numbers only
        const cardCvv = document.getElementById('card-cvv');
        if (cardCvv) {
            cardCvv.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '');
            });
        }

        // Routing number - numbers only, max 9 digits
        const routingNumber = document.getElementById('routing-number');
        if (routingNumber) {
            routingNumber.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '').substring(0, 9);
            });
        }

        // Account number - numbers only
        const accountNumber = document.getElementById('account-number');
        if (accountNumber) {
            accountNumber.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '');
            });
        }

        // Confirm account number - numbers only, and validate match
        const confirmAccountNumber = document.getElementById('confirm-account-number');
        if (confirmAccountNumber) {
            confirmAccountNumber.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '');
                // Validate match
                const accountNum = document.getElementById('account-number')?.value || '';
                const confirmNum = e.target.value;
                const formGroup = e.target.closest('.form-group');
                const errorMessage = formGroup?.querySelector('.error-message');
                
                if (confirmNum && accountNum && confirmNum !== accountNum) {
                    if (formGroup) formGroup.classList.add('error');
                    if (errorMessage) errorMessage.textContent = 'Account numbers do not match';
                } else if (confirmNum && accountNum && confirmNum === accountNum) {
                    if (formGroup) formGroup.classList.remove('error');
                }
            });
        }

        // Form submission
        const form = document.getElementById('checkout-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleSubmit();
            });
        }

        const applyPromoBtn = document.getElementById('checkout-apply-promo');
        const promoInput = document.getElementById('checkout-promo-code');
        if (applyPromoBtn && promoInput) {
            applyPromoBtn.addEventListener('click', () => {
                const v = promoInput.value.trim();
                this.fetchPromoPreview(v);
            });
            promoInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = promoInput.value.trim();
                    this.fetchPromoPreview(v);
                }
            });
        }

        const emailEl = document.getElementById('email');
        if (emailEl) {
            emailEl.addEventListener('blur', () => {
                const c = document.getElementById('checkout-promo-code')?.value?.trim();
                if (c) this.fetchPromoPreview(c);
            });
        }

        const orderWrap = document.getElementById('order-items-container');
        if (orderWrap) {
            orderWrap.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-checkout-qty]');
                if (!btn) return;
                const idx = Number(btn.getAttribute('data-index'));
                if (!Number.isFinite(idx)) return;
                const act = btn.getAttribute('data-checkout-qty');
                if (act === 'dec') void this.adjustLineQuantity(idx, -1);
                else if (act === 'inc') void this.adjustLineQuantity(idx, 1);
            });
            orderWrap.addEventListener('change', (e) => {
                const inp = e.target.closest('.checkout-qty-input');
                if (!inp) return;
                const idx = Number(inp.getAttribute('data-index'));
                if (!Number.isFinite(idx)) return;
                void this.setLineQuantity(idx, inp.value);
            });
        }
    }

    setupFormValidation() {
        const form = document.getElementById('checkout-form');
        if (!form) return;

        const inputs = form.querySelectorAll('input[required], select[required]');
        inputs.forEach(input => {
            if (input.type === 'checkbox') {
                input.addEventListener('change', () => this.validateField(input));
            } else {
                input.addEventListener('blur', () => this.validateField(input));
                input.addEventListener('input', () => {
                    if (input.classList.contains('error')) {
                        this.validateField(input);
                    }
                });
            }
        });
    }

    validateField(field) {
        const formGroup = field.closest('.form-group');
        const errorMessage = formGroup?.querySelector('.error-message');

        if (
            this.nmiEnabled &&
            (field.id === 'card-number' || field.id === 'card-expiry' || field.id === 'card-cvv')
        ) {
            if (formGroup) formGroup.classList.remove('error');
            return true;
        }

        let isValid = true;
        let errorText = '';

        // Remove previous error state
        if (formGroup) {
            formGroup.classList.remove('error');
        }

        // Required fields (checkbox vs text/select)
        if (field.hasAttribute('required')) {
            if (field.type === 'checkbox') {
                if (!field.checked) {
                    isValid = false;
                    errorText = 'Please accept the Terms & Conditions to place your order';
                }
            } else if (!field.value.trim()) {
                isValid = false;
                errorText = 'This field is required';
            }
        }

        // Email validation
        if (field.type === 'email' && field.value) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(field.value)) {
                isValid = false;
                errorText = 'Please enter a valid email address';
            }
        }

        // Phone: US display format (555) 555-0100
        if (field.type === 'tel') {
            const t = field.value.trim();
            if (!t) {
                if (field.hasAttribute('required')) {
                    // handled by required branch above
                }
            } else {
                const P = window.HMHERBS_PHONE_US;
                const ok = P ? P.isValidDisplay(t, false) : /^\(\d{3}\) \d{3}-\d{4}$/.test(t);
                if (!ok) {
                    isValid = false;
                    errorText = 'Phone must be formatted as (555) 123-4567';
                }
            }
        }

        // ZIP code validation
        if (field.id.includes('zip') && field.value) {
            const zipRegex = /^\d{5}(-\d{4})?$/;
            if (!zipRegex.test(field.value)) {
                isValid = false;
                errorText = 'Please enter a valid ZIP code';
            }
        }

        // Routing number validation (9 digits)
        if (field.id === 'routing-number' && field.value) {
            const routingRegex = /^\d{9}$/;
            if (!routingRegex.test(field.value)) {
                isValid = false;
                errorText = 'Please enter a valid routing number (9 digits)';
            }
        }

        // Account number validation (at least 4 digits)
        if (field.id === 'account-number' && field.value) {
            const accountRegex = /^\d{4,}$/;
            if (!accountRegex.test(field.value)) {
                isValid = false;
                errorText = 'Please enter a valid account number (minimum 4 digits)';
            }
        }

        // Confirm account number validation
        if (field.id === 'confirm-account-number' && field.value) {
            const accountNumber = document.getElementById('account-number')?.value || '';
            if (field.value !== accountNumber) {
                isValid = false;
                errorText = 'Account numbers do not match';
            }
        }

        // Update error state
        if (!isValid) {
            if (formGroup) {
                formGroup.classList.add('error');
            }
            if (errorMessage) {
                errorMessage.textContent = errorText;
            }
        }

        return isValid;
    }

    validateForm() {
        const form = document.getElementById('checkout-form');
        if (!form) return false;

        const requiredFields = form.querySelectorAll('input[required], select[required]');
        let isValid = true;

        requiredFields.forEach(field => {
            // Skip billing fields if "same as shipping" is checked
            if (field.id.includes('billing') && document.getElementById('same-as-shipping')?.checked) {
                return;
            }

            if (!this.validateField(field)) {
                isValid = false;
            }
        });

        return isValid;
    }

    async handleSubmit() {
        if (this._checkoutInFlight) return;
        // Validate form
        if (!this.validateForm()) {
            this.showNotification('Please fix the errors in the form', 'error');
            return;
        }

        const ageConfirm = document.getElementById('checkout-age-confirm');
        if (ageConfirm && !ageConfirm.checked) {
            this.showNotification('You must confirm you are at least 21 years of age to place this order.', 'error');
            ageConfirm.focus();
            return;
        }

        // Check if cart is empty
        if (this.cart.length === 0) {
            this.showNotification('Your cart is empty', 'error');
            return;
        }

        const paymentMethod = document.getElementById('payment-method')?.value || '';
        if (paymentMethod === 'credit_card' || paymentMethod === 'debit_card') {
            const savedId = document.getElementById('saved-card-select')?.value;
            if (savedId) {
                this.selectedSavedCardId = Number(savedId);
                this.setCheckoutBusy(true);
                try {
                    const formData = this.collectFormData();
                    formData.awaitingNmiPayment = true;
                    const customerToken = localStorage.getItem('hmherbs_customer_token');
                    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
                    if (customerToken) headers.Authorization = `Bearer ${customerToken}`;
                    const apiOrigin = this.getApiOrigin();
                    const orderRes = await fetch(`${apiOrigin}/api/orders`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(formData)
                    });
                    const orderJson = await orderRes.json().catch(() => ({}));
                    if (!orderRes.ok) throw new Error(orderJson.error || 'Order failed');
                    const email =
                        formData.customerInfo?.email || document.getElementById('email')?.value?.trim() || '';
                    const payJson = await this.payOrderWithSavedCard(orderJson.orderId, email);
                    sessionStorage.removeItem('checkout_cart');
                    localStorage.removeItem('hmherbs_cart');
                    this.redirectToOrderConfirmation({
                        orderId: orderJson.orderId,
                        orderNumber: payJson.orderNumber || orderJson.orderNumber,
                        email,
                        paymentStatus: 'paid',
                        trackingNumber: payJson.trackingNumber || null
                    });
                } catch (e) {
                    this.showNotification(e.message || 'Payment failed', 'error');
                } finally {
                    this.setCheckoutBusy(false);
                }
                return;
            }
            if (this.activePaymentProcessor === 'mxmerchant') {
                if (!this.mxEnabled) {
                    this.showNotification(
                        'MX card payments are not configured. Add credentials in Admin → Developer tools.',
                        'error'
                    );
                    return;
                }
            } else if (!this.nmiEnabled || !this.nmiScriptReady || typeof window.CollectJS === 'undefined') {
                this.showNotification(
                    'Card payments must go through NMI secure fields, but they are not ready. Please wait a moment and try again.',
                    'error'
                );
                return;
            }
        }
        if (paymentMethod === 'gift_card' && !this.getCheckoutStoreTenders().length) {
            const accountId = this.selectedAccountGiftCardId;
            if (!accountId) {
                const code = document.getElementById('gift-card-code')?.value?.trim() || '';
                if (!code) {
                    this.showNotification('Select a gift card on your account or enter a gift card code', 'error');
                    return;
                }
                if (!this.giftCardBalanceChecked) {
                    await this.checkGiftCardBalance();
                    if (!this.giftCardBalanceChecked) return;
                }
            }
            const balance = Number(this.giftCardLastBalance);
            if (!Number.isFinite(balance) || balance <= 0) {
                this.showNotification('Gift card has no usable balance.', 'error');
                return;
            }
            if (balance < this.total) {
                this.showNotification(
                    `Gift card balance ($${balance.toFixed(2)}) is less than the order total. Use Rewards & gift cards with a credit/debit card for the remainder, or enter a partial amount there.`,
                    'warning'
                );
                return;
            }
        }

        const storeTenders = this.getCheckoutStoreTenders();
        const amountDue = this.getCheckoutAmountDue();
        if (storeTenders.length && amountDue > 0.005) {
            const pm = document.getElementById('payment-method')?.value || '';
            if (pm !== 'credit_card' && pm !== 'debit_card') {
                this.showNotification('Select credit or debit card to pay the remaining balance.', 'error');
                return;
            }
        }
        if (storeTenders.length && amountDue <= 0.005) {
            // Pay fully with store credit / points / gift cards — skip NMI
        } else if (paymentMethod === 'credit_card' || paymentMethod === 'debit_card') {
            if (this.activePaymentProcessor === 'mxmerchant') {
                void this.submitMxCardPayment();
                return;
            }
            try {
                window.CollectJS.startPaymentRequest();
            } catch (e) {
                console.error(e);
                this.showNotification(e.message || 'Could not start payment', 'error');
            }
            return;
        }

        this.setCheckoutBusy(true);

        // Collect form data
        const formData = this.collectFormData();

        try {
            const customerToken = localStorage.getItem('hmherbs_customer_token');
            const headers = {
                'Content-Type': 'application/json',
            };
            if (customerToken) {
                headers['Authorization'] = `Bearer ${customerToken}`;
            }

            const apiOrigin = this.getApiOrigin();
            const response = await fetch(`${apiOrigin}/api/orders`, {
                method: 'POST',
                headers,
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                const result = await response.json();
                sessionStorage.removeItem('checkout_cart');
                localStorage.removeItem('hmherbs_cart');
                const email =
                    formData.customerInfo?.email || document.getElementById('email')?.value?.trim() || '';
                this.redirectToOrderConfirmation({
                    orderId: result.orderId,
                    orderNumber: result.orderNumber,
                    email,
                    paymentStatus: result.paymentStatus || 'pending',
                    trackingNumber: result.trackingNumber || null
                });
            } else {
                const error = await response.json();
                throw new Error(error.error || error.message || 'Failed to place order');
            }
        } catch (error) {
            console.error('Error submitting order:', error);
            this.showNotification(error.message || 'Failed to place order. Please try again.', 'error');
        } finally {
            this.setCheckoutBusy(false);
        }
    }

    updateNmiCardPaymentNotice() {
        const host = document.getElementById('epi-payment-fields');
        if (!host) return;
        let notice = document.getElementById('nmi-config-notice');
        const showNotice = this.nmiPreflightRejected && !this.nmiEnabled;
        if (!showNotice) {
            if (notice) notice.style.display = 'none';
            return;
        }
        if (!notice) {
            notice = document.createElement('p');
            notice.id = 'nmi-config-notice';
            notice.className = 'form-help';
            notice.style.cssText =
                'margin:0 0 var(--space-3); padding:var(--space-3); border-radius:var(--radius-md); background:#fffbeb; border:1px solid #fcd34d; color:#92400e;';
            host.insertBefore(notice, host.firstChild);
        }
        notice.style.display = 'block';
        notice.textContent =
            'Secure hosted card fields are not configured. You can still enter card details in the fields below, or choose Gift card only. To enable NMI Collect.js, add NMI_PUBLIC_TOKENIZATION_KEY to backend/.env (Collect.js public key, not the Direct Post security key) and restart the API.';
    }

    ensureGiftCardBalanceResultPlacement() {
        const resultEl = document.getElementById('gift-card-balance-result');
        const host = document.getElementById('gift-card-fields');
        if (resultEl && host && resultEl.parentElement !== host) {
            host.appendChild(resultEl);
        }
    }

    clearGiftCardBalanceResult() {
        const el = document.getElementById('gift-card-balance-result');
        if (!el) return;
        el.style.display = 'none';
        el.textContent = '';
        el.classList.remove('is-error');
    }

    formatGiftCardMoney(amount, currency = 'USD') {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'USD'
        }).format(Number(amount) || 0);
    }

    isGiftCardCheckoutEligible(card) {
        if (!card || String(card.status).toLowerCase() !== 'active') return false;
        const balance = Number(card.current_balance);
        if (!Number.isFinite(balance) || balance <= 0) return false;
        if (card.expires_at && new Date(card.expires_at) < new Date()) return false;
        return true;
    }

    setGiftCardManualMode(manual) {
        this.giftCardManualMode = Boolean(manual);
        const manualSection = document.getElementById('gift-card-manual-section');
        const showManualBtn = document.getElementById('gift-card-show-manual');
        const codeEl = document.getElementById('gift-card-code');
        if (manualSection) {
            manualSection.style.display = this.giftCardManualMode ? 'block' : 'none';
        }
        if (showManualBtn) {
            showManualBtn.style.display =
                !this.giftCardManualMode && this.accountGiftCards.length > 0 ? 'inline-block' : 'none';
        }
        if (this.giftCardManualMode) {
            this.selectedAccountGiftCardId = null;
            const select = document.getElementById('gift-card-account-select');
            if (select) select.value = '';
            if (codeEl) codeEl.setAttribute('required', 'required');
        } else if (codeEl) {
            codeEl.removeAttribute('required');
        }
        this.giftCardBalanceChecked = false;
        this.clearGiftCardBalanceResult();
    }

    syncGiftCardRequiredFields() {
        const codeEl = document.getElementById('gift-card-code');
        const select = document.getElementById('gift-card-account-select');
        const useAccount = Boolean(this.selectedAccountGiftCardId);
        if (codeEl) {
            if (useAccount) codeEl.removeAttribute('required');
            else if (this.giftCardManualMode || !this.accountGiftCards.length) {
                codeEl.setAttribute('required', 'required');
            } else {
                codeEl.removeAttribute('required');
            }
        }
        if (select && this.accountGiftCards.length > 0 && !this.giftCardManualMode) {
            select.setAttribute('required', 'required');
        } else if (select) {
            select.removeAttribute('required');
        }
    }

    renderAccountGiftCardOptions() {
        const select = document.getElementById('gift-card-account-select');
        const accountSection = document.getElementById('gift-card-account-section');
        if (!select || !accountSection) return;

        const eligible = this.accountGiftCards.filter((c) => this.isGiftCardCheckoutEligible(c));
        select.innerHTML = '<option value="">Select a gift card on your account</option>';
        eligible.forEach((card) => {
            const opt = document.createElement('option');
            opt.value = String(card.id);
            const label = card.code
                ? `${card.code} — ${this.formatGiftCardMoney(card.current_balance, card.currency)} available`
                : `Gift card — ${this.formatGiftCardMoney(card.current_balance, card.currency)}`;
            opt.textContent = label;
            select.appendChild(opt);
        });

        const hasCards = eligible.length > 0;
        accountSection.style.display = hasCards ? 'block' : 'none';
        const showManualBtn = document.getElementById('gift-card-show-manual');
        if (showManualBtn) {
            showManualBtn.style.display = hasCards && !this.giftCardManualMode ? 'inline-block' : 'none';
        }

        if (hasCards && !this.giftCardManualMode) {
            this.setGiftCardManualMode(false);
        } else {
            this.setGiftCardManualMode(true);
        }
        this.syncGiftCardRequiredFields();
    }

    bindCheckoutRewardsUi() {
        const ids = [
            'checkout-loyalty-cash',
            'checkout-loyalty-points',
            'checkout-giftcard-select',
            'checkout-giftcard-amount'
        ];
        ids.forEach((id) => {
            document.getElementById(id)?.addEventListener('input', () => this.updateCheckoutRewardsSummary());
            document.getElementById(id)?.addEventListener('change', () => this.updateCheckoutRewardsSummary());
        });
        document.getElementById('checkout-loyalty-cash-max')?.addEventListener('click', () => this.applyMaxCheckoutLoyaltyCash());
        document.getElementById('checkout-loyalty-max')?.addEventListener('click', () => this.applyMaxCheckoutLoyaltyPoints());
        document.getElementById('checkout-giftcard-max')?.addEventListener('click', () => this.applyMaxCheckoutGiftCard());
        document.getElementById('checkout-giftcard-select')?.addEventListener('change', () => this.onCheckoutGiftCardSelected());
    }

    async loadCheckoutRewards() {
        const panel = document.getElementById('checkout-rewards-panel');
        const token = this._getCustomerToken();
        if (!token || !panel) {
            if (panel) panel.style.display = 'none';
            this.loyaltyProfile = null;
            return;
        }
        try {
            const apiOrigin = this.getApiOrigin();
            const [loyaltyRes, gcRes] = await Promise.all([
                fetch(`${apiOrigin}/api/user/loyalty`, { headers: { Authorization: `Bearer ${token}` } }),
                fetch(`${apiOrigin}/api/user/gift-cards`, { headers: { Authorization: `Bearer ${token}` } })
            ]);
            const loyaltyData = loyaltyRes.ok ? await loyaltyRes.json().catch(() => ({})) : {};
            const gcData = gcRes.ok ? await gcRes.json().catch(() => ({})) : {};
            this.loyaltyProfile = loyaltyData.loyalty || null;
            this.loyaltySettings = loyaltyData.settings || {};
            this.accountGiftCards = (Array.isArray(gcData.gift_cards) ? gcData.gift_cards : []).filter(
                (g) => g.status === 'active' && Number(g.current_balance) > 0
            );
            this.renderCheckoutRewardsUi();
            panel.style.display = 'block';
            this.updateCheckoutRewardsSummary();
        } catch (err) {
            console.error('loadCheckoutRewards', err);
            if (panel) panel.style.display = 'none';
        }
    }

    renderCheckoutRewardsUi() {
        const loyalty = this.loyaltyProfile || {};
        const settings = this.loyaltySettings || {};
        const enrollment = String(loyalty.loyalty_enrollment || 'cash').toLowerCase();
        const canUseCash = settings.cashEnabled !== false && (enrollment === 'cash' || enrollment === 'both');
        const canUsePoints = settings.pointsEnabled !== false && (enrollment === 'points' || enrollment === 'both');
        const cashGroup = document.getElementById('checkout-store-credit-group');
        const ptsGroup = document.getElementById('checkout-points-group');
        const gcGroup = document.getElementById('checkout-gc-account-group');
        const cashAvail = document.getElementById('checkout-loyalty-cash-available');
        const cashBal = Number(loyalty.cash_balance) || 0;
        const ptsBal = Number(loyalty.points_balance) || 0;
        const dollarPerPoint = Number(settings.dollarPerPoint) || 0.01;

        if (cashGroup) {
            cashGroup.style.display = canUseCash && cashBal > 0 ? 'block' : 'none';
        }
        if (ptsGroup) {
            ptsGroup.style.display = canUsePoints && ptsBal > 0 ? 'block' : 'none';
        }
        if (cashAvail) cashAvail.textContent = cashBal > 0 ? `$${cashBal.toFixed(2)} available` : '';

        const select = document.getElementById('checkout-giftcard-select');
        if (select) {
            const prev = select.value;
            select.innerHTML = '<option value="">Select a gift card (optional)</option>';
            this.accountGiftCards.forEach((gc) => {
                const opt = document.createElement('option');
                opt.value = String(gc.id);
                const masked = gc.code && gc.code.length > 4 ? `••••${gc.code.slice(-4)}` : 'Gift card';
                opt.textContent = `${masked} — $${Number(gc.current_balance).toFixed(2)}`;
                opt.dataset.balance = String(gc.current_balance);
                select.appendChild(opt);
            });
            if (prev && this.accountGiftCards.some((g) => String(g.id) === prev)) select.value = prev;
        }
        if (gcGroup) {
            gcGroup.style.display = this.accountGiftCards.length > 0 ? 'block' : 'none';
        }

        const pts = Number(document.getElementById('checkout-loyalty-points')?.value) || 0;
        const worthEl = document.getElementById('checkout-loyalty-worth');
        if (worthEl) {
            worthEl.textContent = pts > 0
                ? `= $${(pts * dollarPerPoint).toFixed(2)}`
                : (ptsBal > 0 ? `${ptsBal} pts available` : '');
        }
    }

    getCheckoutStoreTenders() {
        const tenders = [];
        const cash = Number(document.getElementById('checkout-loyalty-cash')?.value) || 0;
        const pts = Math.floor(Number(document.getElementById('checkout-loyalty-points')?.value) || 0);
        const gcSelect = document.getElementById('checkout-giftcard-select');
        const gcAmt = Number(document.getElementById('checkout-giftcard-amount')?.value) || 0;
        const dollarPerPoint = Number(this.loyaltySettings?.dollarPerPoint) || 0.01;

        if (cash > 0) tenders.push({ type: 'loyalty_cash', amount: Math.round(cash * 100) / 100 });
        if (pts > 0) {
            tenders.push({
                type: 'loyalty_points',
                points: pts,
                amount: Math.round(pts * dollarPerPoint * 100) / 100
            });
        }
        if (gcSelect?.value && gcAmt > 0) {
            tenders.push({
                type: 'gift_card',
                amount: Math.round(gcAmt * 100) / 100,
                giftCardId: Number(gcSelect.value)
            });
        } else if (this.giftCardBalanceChecked && this.giftCardManualMode) {
            const code = document.getElementById('gift-card-code')?.value?.trim();
            const pin = document.getElementById('gift-card-pin')?.value?.trim();
            const manualAmt = Number(document.getElementById('checkout-giftcard-amount')?.value) || 0;
            if (code && manualAmt > 0) {
                tenders.push({
                    type: 'gift_card',
                    amount: Math.round(manualAmt * 100) / 100,
                    code,
                    pin: pin || null
                });
            }
        }
        return tenders;
    }

    getRewardsAppliedTotal() {
        return this.getCheckoutStoreTenders().reduce((s, t) => s + (Number(t.amount) || 0), 0);
    }

    getCheckoutAmountDue() {
        return Math.max(0, Math.round((this.total - this.getRewardsAppliedTotal()) * 100) / 100);
    }

    updateCheckoutRewardsSummary() {
        const applied = this.getRewardsAppliedTotal();
        const due = this.getCheckoutAmountDue();
        const row = document.getElementById('checkout-rewards-applied-row');
        const val = document.getElementById('checkout-rewards-applied-value');
        const dueRow = document.getElementById('checkout-card-due-row');
        const dueVal = document.getElementById('checkout-card-due-value');
        const totalLabel = document.getElementById('checkout-total-label');
        if (row && val) {
            row.style.display = applied > 0.005 ? 'flex' : 'none';
            val.textContent = `−$${applied.toFixed(2)}`;
        }
        if (dueRow && dueVal) {
            dueRow.style.display = applied > 0.005 && due > 0.005 ? 'flex' : 'none';
            dueVal.textContent = `$${due.toFixed(2)}`;
        }
        if (totalLabel) {
            totalLabel.textContent = applied > 0.005 && due > 0.005 ? 'Order total' : 'Total';
        }
        const pts = Number(document.getElementById('checkout-loyalty-points')?.value) || 0;
        const worthEl = document.getElementById('checkout-loyalty-worth');
        const dollarPerPoint = Number(this.loyaltySettings?.dollarPerPoint) || 0.01;
        if (worthEl && pts > 0) worthEl.textContent = `= $${(pts * dollarPerPoint).toFixed(2)}`;
        this.refreshNmiCollectConfiguration();
    }

    checkoutTenderRoom(field) {
        const due = this.getCheckoutAmountDue();
        const tenders = this.getCheckoutStoreTenders();
        const current = {
            loyalty_cash: tenders.find((t) => t.type === 'loyalty_cash')?.amount || 0,
            loyalty_points: tenders.find((t) => t.type === 'loyalty_points')?.amount || 0,
            gift_card: tenders.find((t) => t.type === 'gift_card')?.amount || 0
        };
        return Math.round((due + (current[field] || 0)) * 100) / 100;
    }

    applyMaxCheckoutLoyaltyCash() {
        const bal = Number(this.loyaltyProfile?.cash_balance) || 0;
        const room = this.checkoutTenderRoom('loyalty_cash');
        const el = document.getElementById('checkout-loyalty-cash');
        if (el) el.value = Math.min(bal, room).toFixed(2);
        this.updateCheckoutRewardsSummary();
    }

    applyMaxCheckoutLoyaltyPoints() {
        const bal = Number(this.loyaltyProfile?.points_balance) || 0;
        const dollarPerPoint = Number(this.loyaltySettings?.dollarPerPoint) || 0.01;
        const room = this.checkoutTenderRoom('loyalty_points');
        const maxPts = Math.min(bal, Math.floor(room / dollarPerPoint));
        const el = document.getElementById('checkout-loyalty-points');
        if (el) el.value = String(maxPts);
        this.updateCheckoutRewardsSummary();
    }

    applyMaxCheckoutGiftCard() {
        const select = document.getElementById('checkout-giftcard-select');
        if (!select?.value) {
            this.showNotification('Select a gift card first', 'error');
            return;
        }
        const balance = Number(select.selectedOptions[0]?.dataset.balance) || 0;
        const room = this.checkoutTenderRoom('gift_card');
        const el = document.getElementById('checkout-giftcard-amount');
        if (el) el.value = Math.min(balance, room).toFixed(2);
        this.updateCheckoutRewardsSummary();
    }

    onCheckoutGiftCardSelected() {
        const select = document.getElementById('checkout-giftcard-select');
        const amountEl = document.getElementById('checkout-giftcard-amount');
        if (!select?.value) {
            if (amountEl) amountEl.value = '';
            this.updateCheckoutRewardsSummary();
            return;
        }
        const balance = Number(select.selectedOptions[0]?.dataset.balance) || 0;
        const room = this.checkoutTenderRoom('gift_card');
        if (amountEl) amountEl.value = Math.min(balance, room).toFixed(2);
        this.updateCheckoutRewardsSummary();
    }

    async loadAccountGiftCards() {
        const token = this._getCustomerToken();
        if (!token) {
            this.accountGiftCards = [];
            return [];
        }
        try {
            const apiOrigin = this.getApiOrigin();
            const res = await fetch(`${apiOrigin}/api/user/gift-cards`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                this.accountGiftCards = [];
                return [];
            }
            const data = await res.json().catch(() => ({}));
            this.accountGiftCards = Array.isArray(data.gift_cards) ? data.gift_cards : [];
            return this.accountGiftCards;
        } catch (err) {
            console.error('loadAccountGiftCards', err);
            this.accountGiftCards = [];
            return [];
        }
    }

    async prepareGiftCardPaymentUi() {
        this.ensureGiftCardBalanceResultPlacement();
        this.selectedAccountGiftCardId = null;
        this.giftCardBalanceChecked = false;
        this.clearGiftCardBalanceResult();
        await this.loadAccountGiftCards();
        this.renderAccountGiftCardOptions();
    }

    onAccountGiftCardSelected() {
        this.ensureGiftCardBalanceResultPlacement();
        const select = document.getElementById('gift-card-account-select');
        const id = select?.value ? Number(select.value) : null;
        this.selectedAccountGiftCardId = Number.isFinite(id) && id > 0 ? id : null;
        this.giftCardManualMode = false;
        const manualSection = document.getElementById('gift-card-manual-section');
        if (manualSection) manualSection.style.display = 'none';

        if (!this.selectedAccountGiftCardId) {
            this.giftCardBalanceChecked = false;
            this.giftCardLastBalance = null;
            this.clearGiftCardBalanceResult();
            this.syncGiftCardRequiredFields();
            return;
        }

        const card = this.accountGiftCards.find((c) => Number(c.id) === this.selectedAccountGiftCardId);
        if (!card || !this.isGiftCardCheckoutEligible(card)) {
            this.showNotification('This gift card cannot be used for checkout', 'error');
            this.selectedAccountGiftCardId = null;
            if (select) select.value = '';
            return;
        }

        const balance = Number(card.current_balance);
        this.giftCardLastBalance = balance;
        this.giftCardBalanceChecked = true;
        const resultEl = document.getElementById('gift-card-balance-result');
        if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.classList.remove('is-error');
            const covers = balance >= this.total;
            resultEl.textContent = covers
                ? `Using ${card.code}: ${this.formatGiftCardMoney(balance, card.currency)} available — covers this order.`
                : `${card.code} has ${this.formatGiftCardMoney(balance, card.currency)} available — not enough for order total (${this.formatGiftCardMoney(this.total)}).`;
        }
        this.syncGiftCardRequiredFields();
    }

    async checkGiftCardBalance() {
        this.ensureGiftCardBalanceResultPlacement();
        const code = document.getElementById('gift-card-code')?.value?.trim() || '';
        const pin = document.getElementById('gift-card-pin')?.value?.trim() || '';
        const resultEl = document.getElementById('gift-card-balance-result');
        if (!code) {
            this.showNotification('Enter your gift card code first', 'error');
            return false;
        }
        try {
            const apiOrigin = this.getApiOrigin();
            const res = await fetch(`${apiOrigin}/api/gift-cards/check-balance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, pin: pin || null })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                this.giftCardBalanceChecked = false;
                this.giftCardLastBalance = null;
                if (resultEl) {
                    resultEl.style.display = 'block';
                    resultEl.classList.add('is-error');
                    resultEl.textContent = data.error || 'Gift card not found or invalid PIN';
                }
                return false;
            }
            const balance = Number(data.gift_card?.current_balance);
            this.giftCardBalanceChecked = true;
            this.giftCardLastBalance = balance;
            if (resultEl) {
                resultEl.style.display = 'block';
                resultEl.classList.remove('is-error');
                const covers = balance >= this.total;
                resultEl.textContent = covers
                    ? `Available balance: $${balance.toFixed(2)} — covers this order.`
                    : `Available balance: $${balance.toFixed(2)} — not enough for order total ($${this.total.toFixed(2)}). Use a card instead.`;
            }
            return true;
        } catch (err) {
            console.error(err);
            this.showNotification('Could not check gift card balance', 'error');
            return false;
        }
    }

    collectFormData() {
        const sameAsShipping = document.getElementById('same-as-shipping')?.checked;
        
        const customerInfo = {
            first_name: document.getElementById('first-name')?.value || '',
            last_name: document.getElementById('last-name')?.value || '',
            email: document.getElementById('email')?.value || '',
            phone: document.getElementById('phone')?.value || ''
        };

        const shippingAddress = {
            address_line_1: document.getElementById('shipping-address-1')?.value || '',
            address_line_2: document.getElementById('shipping-address-2')?.value || '',
            city: document.getElementById('shipping-city')?.value || '',
            state: document.getElementById('shipping-state')?.value || '',
            postal_code: document.getElementById('shipping-zip')?.value || '',
            country: document.getElementById('shipping-country')?.value || 'United States'
        };

        let billingAddress = shippingAddress;
        if (!sameAsShipping) {
            billingAddress = {
                address_line_1: document.getElementById('billing-address-1')?.value || '',
                address_line_2: document.getElementById('billing-address-2')?.value || '',
                city: document.getElementById('billing-city')?.value || '',
                state: document.getElementById('billing-state')?.value || '',
                postal_code: document.getElementById('billing-zip')?.value || '',
                country: document.getElementById('billing-country')?.value || 'United States'
            };
        }

        const cartItems = this.cart.map((item) => ({
            product_id: item.id,
            variant_id: item.variant_id ?? item.variantId ?? null,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            giftCard: item.giftCard || null
        }));

        const paymentMethod = document.getElementById('payment-method')?.value || '';
        
        // Collect EPI payment data if credit/debit card is selected
        let paymentData = null;
        if (paymentMethod === 'credit_card' || paymentMethod === 'debit_card') {
            const processor = this.activePaymentProcessor || 'epi';
            if (this.nmiEnabled) {
                paymentData = { processor };
            } else {
                const cardNumber = document.getElementById('card-number')?.value.replace(/\s/g, '') || '';
                const cardExpiry = document.getElementById('card-expiry')?.value || '';
                const [expMonth, expYear] = cardExpiry.split('/');
                const cardCvv = document.getElementById('card-cvv')?.value || '';
                const cardholderName = document.getElementById('cardholder-name')?.value || '';

                paymentData = {
                    card_number: cardNumber,
                    exp_month: expMonth,
                    exp_year: expYear ? '20' + expYear : '', // Convert YY to YYYY
                    cvv: cardCvv,
                    cardholder_name: cardholderName,
                    processor: this.activePaymentProcessor || 'epi'
                };
            }
        }

        let giftCard = null;
        const storeTenders = this.getCheckoutStoreTenders();
        const amountDue = this.getCheckoutAmountDue();

        if (paymentMethod === 'gift_card' && !storeTenders.length) {
            const balance = Number(this.giftCardLastBalance) || this.total;
            const gcAmount = Math.min(balance, this.total);
            if (this.selectedAccountGiftCardId) {
                giftCard = { id: this.selectedAccountGiftCardId, amount: gcAmount };
            } else {
                giftCard = {
                    code: document.getElementById('gift-card-code')?.value?.trim() || '',
                    pin: document.getElementById('gift-card-pin')?.value?.trim() || '',
                    amount: gcAmount
                };
            }
        }

        const needsCard = amountDue > 0.005;
        const effectiveMethod = storeTenders.length && needsCard
            ? (paymentMethod === 'debit_card' ? 'debit_card' : 'credit_card')
            : (storeTenders.length && !needsCard ? 'gift_card' : paymentMethod);

        if ((effectiveMethod === 'credit_card' || effectiveMethod === 'debit_card') && !paymentData && this.nmiEnabled) {
            paymentData = { processor: this.activePaymentProcessor || 'epi' };
        }

        return {
            customerInfo,
            shippingAddress,
            billingAddress,
            paymentMethod: effectiveMethod,
            paymentData: paymentData,
            giftCard,
            paymentTenders: storeTenders.length ? storeTenders : undefined,
            orderNotes: document.getElementById('order-notes')?.value || '',
            cartItems,
            promoCode: document.getElementById('checkout-promo-code')?.value?.trim() || '',
            shippingMethod: this.selectedShippingMethod,
            shippingAmount: this.selectedShippingAmount,
            subtotal: this.subtotal,
            tax: this.tax,
            shipping: this.shipping,
            total: this.total,
            awaitingNmiPayment: needsCard && (effectiveMethod === 'credit_card' || effectiveMethod === 'debit_card')
        };
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${
                type === 'success'
                    ? '#047857'
                    : type === 'error'
                      ? '#ef4444'
                      : type === 'warning'
                        ? '#f59e0b'
                        : '#3b82f6'
            };
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 0.5rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            z-index: 10000;
            max-width: 400px;
            animation: slideIn 0.3s ease-out;
        `;

        notification.textContent = message;
        document.body.appendChild(notification);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    createPlaceholderImage() {
        // Create an SVG placeholder image as data URI
        const svgContent = `
            <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#4a7c59;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#5a8c69;stop-opacity:1" />
                    </linearGradient>
                </defs>
                <rect width="200" height="200" fill="url(#grad)"/>
                <circle cx="100" cy="75" r="20" fill="rgba(255,255,255,0.3)"/>
                <rect x="80" y="100" width="40" height="30" rx="3" fill="rgba(255,255,255,0.2)"/>
                <text x="100" y="145" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="white" text-anchor="middle">Product</text>
                <text x="100" y="160" font-family="Arial, sans-serif" font-size="10" fill="rgba(255,255,255,0.9)" text-anchor="middle">Image</text>
            </svg>
        `.trim();
        return `data:image/svg+xml;base64,${btoa(svgContent)}`;
    }
}

function bootCheckoutManager() {
    if (window.checkoutManager) return;
    window.checkoutManager = new CheckoutManager();
}

function whenCustomerAuthReady(cb, maxMs = 8000) {
    const start = Date.now();
    const tick = () => {
        if (window.customerAuth) {
            cb();
            return;
        }
        if (Date.now() - start < maxMs) {
            setTimeout(tick, 25);
            return;
        }
        cb();
    };
    tick();
}

function startCheckoutPage() {
    whenCustomerAuthReady(bootCheckoutManager);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCheckoutPage);
} else {
    startCheckoutPage();
}

/**
 * Standalone helper: server-priced totals for cart + promo (same rules as checkout).
 * @param {Array} cartItems
 * @param {string} promoCode
 * @param {{ apiOrigin?: string, email?: string, token?: string }} [opts]
 */
async function calculateTotal(cartItems, promoCode, opts = {}) {
    const apiOrigin = opts.apiOrigin ?? hmHerbsApiOrigin();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const token = opts.token ?? localStorage.getItem('hmherbs_customer_token');
    if (token) headers.Authorization = `Bearer ${token}`;
    const email = opts.email ?? '';
    const response = await fetch(`${apiOrigin}/api/promotions/preview`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            promoCode: String(promoCode || '').trim(),
            cartItems: Array.isArray(cartItems) ? cartItems : [],
            email
        })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || data.message || 'Could not calculate total');
    }
    return data.totals;
}

window.calculateTotal = calculateTotal;

