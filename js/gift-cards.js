/**
 * Gift Cards purchase page
 */
class GiftCardsPage {
    constructor() {
        this.catalog = { products: [] };
        this.activeType = 'digital';
        this.selectedAmount = null;
        this.selectedVariant = null;
        this.activeProduct = null;
        this.cart = [];
        this.init();
    }

    getApiBase() {
        if (typeof window.hmHerbsGetApiBaseUrl === 'function') {
            return window.hmHerbsGetApiBaseUrl();
        }
        if (typeof window.hmHerbsStorefrontApiBase === 'function') {
            const origin = window.hmHerbsStorefrontApiBase();
            if (origin) return origin;
        }
        if (window.location.protocol === 'file:') return 'http://127.0.0.1:3001';
        const h = window.location.hostname;
        if ((h === 'localhost' || h === '127.0.0.1') && window.location.port && window.location.port !== '3001') {
            return 'http://127.0.0.1:3001';
        }
        return window.location.origin || '';
    }

    async init() {
        this.loadCartFromStorage();
        this.setupTabs();
        this.setupCartUi();
        this.setupPersonalizeToggle();
        this.setupRecipientPreview();
        this.renderCardPreviewFallback();
        await this.loadCatalog();
        this.updateCartDisplay();
    }

    renderCardPreviewFallback(cardType = this.activeType) {
        const preview = document.getElementById('gift-card-preview');
        if (!preview) return;
        if (window.HmGiftCard?.markup) {
            this.updateCardPreview();
            return;
        }
        const type = cardType === 'physical' ? 'physical' : 'digital';
        const typeLabel = type === 'physical' ? 'Physical' : 'Digital';
        const logoHtml =
            '<img class="hm-gift-card__logo" src="images/HM%20Herb%20Logo.png" alt="" width="120" height="36" loading="lazy" data-skip-error-handling>';
        preview.innerHTML = `
            <div class="hm-gift-card hm-gift-card--${type}" role="img" aria-label="${typeLabel} gift card amount not selected">
                <div class="hm-gift-card__pattern" aria-hidden="true"></div>
                <div class="hm-gift-card__shine" aria-hidden="true"></div>
                <div class="hm-gift-card__inner">
                    <div class="hm-gift-card__header">
                        ${logoHtml}
                        <span class="hm-gift-card__badge">${typeLabel}</span>
                    </div>
                    <div class="hm-gift-card__amount-wrap">
                        <span class="hm-gift-card__amount-label">Gift card value</span>
                        <span class="hm-gift-card__amount">Select amount</span>
                    </div>
                    <div class="hm-gift-card__footer">
                        <span class="hm-gift-card__brand">H&amp;M Herbs &amp; Vitamins</span>
                        <span class="hm-gift-card__tagline">Premium natural health since 1995</span>
                    </div>
                </div>
            </div>`;
    }

    async loadCatalog() {
        const loading = document.getElementById('gift-cards-loading');
        const panel = document.getElementById('gift-card-panel');
        const errEl = document.getElementById('gift-cards-error');

        try {
            if (loading) loading.style.display = 'block';
            if (panel) panel.hidden = true;
            if (errEl) errEl.hidden = true;

            const res = await fetch(`${this.getApiBase()}/api/gift-cards/catalog`);
            if (!res.ok) throw new Error('Failed to load gift cards');
            this.catalog = await res.json();
            if (!this.catalog.products?.length) throw new Error('Gift cards are not available yet');

            this.selectType(this.activeType);
            if (loading) loading.style.display = 'none';
            if (panel) panel.hidden = false;
        } catch (err) {
            if (loading) loading.style.display = 'none';
            if (errEl) {
                errEl.hidden = false;
                errEl.textContent = err.message || 'Could not load gift cards. Please try again later.';
            }
        }
    }

    setupTabs() {
        document.querySelectorAll('[data-gift-type]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.selectType(btn.getAttribute('data-gift-type'));
            });
        });
    }

    setupPersonalizeToggle() {
        const checkbox = document.getElementById('include-personalized-email');
        const fields = document.getElementById('personalized-email-fields');
        if (!checkbox || !fields) return;
        checkbox.addEventListener('change', () => {
            fields.hidden = !checkbox.checked;
        });
    }

    setupRecipientPreview() {
        const nameInput = document.getElementById('recipient-name');
        if (nameInput) {
            nameInput.addEventListener('input', () => this.updateCardPreview());
        }
    }

    updateCardPreview() {
        const preview = document.getElementById('gift-card-preview');
        if (!preview) return;
        if (!window.HmGiftCard?.markup) {
            this.renderCardPreviewFallback();
            if (!this._previewRetryScheduled) {
                this._previewRetryScheduled = true;
                window.setTimeout(() => {
                    this._previewRetryScheduled = false;
                    this.updateCardPreview();
                }, 100);
            }
            return;
        }
        const recipientName = document.getElementById('recipient-name')?.value.trim() || '';
        preview.innerHTML = window.HmGiftCard.markup({
            amount: this.selectedAmount,
            cardType: this.activeType,
            recipientName
        });
        const status = document.getElementById('gift-card-preview-status');
        if (status) {
            const typeLabel = this.activeType === 'physical' ? 'Physical' : 'Digital';
            const amountText = this.selectedAmount ? `$${Number(this.selectedAmount).toFixed(0)}` : 'amount not selected';
            status.textContent = `${typeLabel} gift card preview updated: ${amountText}`;
        }
    }

    selectType(type) {
        this.activeType = type;
        this.selectedAmount = null;
        this.selectedVariant = null;

        document.querySelectorAll('[data-gift-type]').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-gift-type') === type);
        });

        this.activeProduct = (this.catalog.products || []).find((p) => p.cardType === type) || null;
        if (!this.activeProduct) return;

        const title = document.getElementById('gift-panel-title');
        const desc = document.getElementById('gift-panel-desc');
        const intro = document.getElementById('recipient-info-intro');
        const emailLabel = document.getElementById('recipient-email-label');
        const emailHelp = document.getElementById('recipient-email-help');
        const contactFields = document.getElementById('recipient-contact-fields');
        const reqMarks = document.querySelectorAll('.recipient-req');
        const nameInput = document.getElementById('recipient-name');
        const emailInput = document.getElementById('recipient-email');
        const phoneInput = document.getElementById('recipient-phone');
        const isDigital = type === 'digital';

        if (title) title.textContent = this.activeProduct.name;
        if (desc) {
            desc.textContent = isDigital
                ? 'Delivered instantly by email. We create an account for the recipient so they can track their balance.'
                : 'Mailed to your shipping address at checkout. Add recipient details if you want them to track their balance online.';
        }
        if (intro) {
            intro.textContent = isDigital
                ? 'Digital gift cards are emailed to the recipient. We ask for their name, email, phone, and mailing address so we can set up their account and help them keep track of their gift card balance.'
                : 'Recipient details are optional for physical cards. Add an email if you want the recipient to track their balance online after the card arrives.';
        }
        if (emailHelp) {
            emailHelp.textContent = isDigital
                ? 'The gift card code and delivery email will be sent here.'
                : 'Optional — creates an account so the recipient can track their balance online.';
        }
        if (contactFields) contactFields.style.display = isDigital ? 'block' : 'none';
        reqMarks.forEach((el) => {
            el.style.display = isDigital ? 'inline' : 'none';
        });
        if (nameInput) nameInput.required = isDigital;
        if (emailInput) emailInput.required = isDigital;
        if (phoneInput) phoneInput.required = isDigital;
        ['recipient-address-1', 'recipient-city', 'recipient-state', 'recipient-zip'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.required = isDigital;
        });

        this.renderAmounts();
        this.updateCardPreview();
    }

    renderAmounts() {
        const grid = document.getElementById('amount-grid');
        if (!grid || !this.activeProduct) return;
        grid.innerHTML = '';

        (this.activeProduct.variants || []).forEach((v) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'amount-btn';
            btn.textContent = `$${Number(v.price).toFixed(0)}`;
            btn.setAttribute('data-variant-id', v.id);
            btn.setAttribute('data-amount', v.price);
            if (this.selectedVariant === v.id) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                this.selectedVariant = v.id;
                this.selectedAmount = Number(v.price);
                grid.querySelectorAll('.amount-btn').forEach((b) => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.updateCardPreview();
            });
            grid.appendChild(btn);
        });
    }

    setupCartUi() {
        const form = document.getElementById('gift-card-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addToCart();
            });
        }

        const checkoutBtn = document.getElementById('checkout-btn');
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', () => this.proceedToCheckout());
        }
    }

    isValidUsPhone(value) {
        const t = String(value || '').trim();
        const P = window.HMHERBS_PHONE_US;
        return P ? P.isValidDisplay(t, false) : /^\(\d{3}\) \d{3}-\d{4}$/.test(t);
    }

    collectRecipientMeta() {
        const includePersonalizedEmail = Boolean(document.getElementById('include-personalized-email')?.checked);
        return {
            cardType: this.activeType,
            recipientName: document.getElementById('recipient-name')?.value.trim() || '',
            recipientEmail: document.getElementById('recipient-email')?.value.trim().toLowerCase() || '',
            recipientPhone: document.getElementById('recipient-phone')?.value.trim() || '',
            recipientAddress: {
                line1: document.getElementById('recipient-address-1')?.value.trim() || '',
                line2: document.getElementById('recipient-address-2')?.value.trim() || '',
                city: document.getElementById('recipient-city')?.value.trim() || '',
                state: document.getElementById('recipient-state')?.value.trim() || '',
                postalCode: document.getElementById('recipient-zip')?.value.trim() || '',
                country: 'United States'
            },
            senderName: document.getElementById('sender-name')?.value.trim() || '',
            greetingOccasion: document.getElementById('greeting-occasion')?.value || 'custom',
            personalMessage: document.getElementById('personal-message')?.value.trim() || '',
            includePersonalizedEmail
        };
    }

    validateRecipientMeta(meta) {
        if (this.activeType !== 'digital') {
            if (meta.recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(meta.recipientEmail)) {
                this.notify('Please enter a valid recipient email', 'error');
                return false;
            }
            return true;
        }

        if (!meta.recipientName) {
            this.notify('Recipient name is required for digital gift cards', 'error');
            return false;
        }
        if (!meta.recipientEmail) {
            this.notify('Recipient email is required for digital gift cards', 'error');
            return false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(meta.recipientEmail)) {
            this.notify('Please enter a valid recipient email', 'error');
            return false;
        }
        if (!meta.recipientPhone) {
            this.notify('Recipient phone is required so we can set up their account', 'error');
            return false;
        }
        if (!this.isValidUsPhone(meta.recipientPhone)) {
            this.notify('Recipient phone must be formatted as (555) 123-4567', 'error');
            return false;
        }
        const addr = meta.recipientAddress || {};
        if (!addr.line1 || !addr.city || !addr.state || !addr.postalCode) {
            this.notify('Recipient mailing address is required so they can track their gift card balance', 'error');
            return false;
        }
        if (!/^\d{5}(-\d{4})?$/.test(addr.postalCode)) {
            this.notify('Please enter a valid recipient ZIP code', 'error');
            return false;
        }
        return true;
    }

    addToCart() {
        if (!this.activeProduct || !this.selectedVariant || !this.selectedAmount) {
            this.notify('Please select a gift card amount', 'error');
            return;
        }

        const giftCard = this.collectRecipientMeta();
        if (!this.validateRecipientMeta(giftCard)) return;

        const variant = (this.activeProduct.variants || []).find((v) => v.id === this.selectedVariant);
        const lineName = `${this.activeProduct.name} — $${this.selectedAmount.toFixed(0)}`;

        this.cart.push({
            id: this.activeProduct.id,
            cartLineId: `gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            variant_id: this.selectedVariant,
            name: lineName,
            price: this.selectedAmount,
            quantity: 1,
            image: '',
            inStock: true,
            giftCard
        });

        this.saveCartToStorage();
        this.updateCartDisplay();
        this.notify(`${lineName} added to cart`, 'success');

        document.getElementById('gift-card-form')?.reset();
        document.getElementById('personalized-email-fields')?.setAttribute('hidden', '');
        this.selectedAmount = null;
        this.selectedVariant = null;
        this.renderAmounts();
        this.selectType(this.activeType);
    }

    loadCartFromStorage() {
        try {
            const raw = localStorage.getItem('hmherbs_cart');
            this.cart = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(this.cart)) this.cart = [];
        } catch {
            this.cart = [];
        }
    }

    saveCartToStorage() {
        localStorage.setItem('hmherbs_cart', JSON.stringify(this.cart));
        if (window.hmHerbsApp && Array.isArray(window.hmHerbsApp.cart)) {
            window.hmHerbsApp.cart = this.cart.slice();
        }
    }

    updateCartDisplay() {
        const countEl = document.getElementById('cart-count');
        const totalEl = document.getElementById('cart-total');
        const itemsEl = document.getElementById('cart-items');
        const emptyEl = document.getElementById('cart-empty');
        const total = this.cart.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
        const count = this.cart.reduce((s, i) => s + (i.quantity || 1), 0);

        if (countEl) countEl.textContent = String(count);
        if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;

        if (!itemsEl) return;

        if (this.cart.length === 0) {
            itemsEl.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';
        itemsEl.innerHTML = this.cart
            .map((item, idx) => {
                const thumb =
                    item.giftCard && window.HmGiftCard?.markup
                        ? `<div class="checkout-gift-card-thumb">${window.HmGiftCard.markup({
                              amount: item.price,
                              cardType: item.giftCard.cardType || 'digital',
                              compact: true
                          })}</div>`
                        : '';
                return `
            <div class="cart-item${item.giftCard ? ' cart-item--gift-card' : ''}">
                ${thumb}
                <div class="cart-item-info">
                    <div class="cart-item-name">${this.escapeHtml(item.name)}</div>
                    ${item.giftCard?.recipientEmail ? `<div class="cart-item-meta">To: ${this.escapeHtml(item.giftCard.recipientEmail)}</div>` : ''}
                    ${item.giftCard?.includePersonalizedEmail ? `<div class="cart-item-meta">Personalized email greeting</div>` : ''}
                    <div class="cart-item-price">$${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</div>
                </div>
                <button type="button" class="cart-item-remove" data-idx="${idx}" aria-label="Remove">×</button>
            </div>`;
            })
            .join('');

        itemsEl.querySelectorAll('.cart-item-remove').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.getAttribute('data-idx'));
                this.cart.splice(idx, 1);
                this.saveCartToStorage();
                this.updateCartDisplay();
            });
        });
    }

    proceedToCheckout() {
        if (!this.cart.length) {
            this.notify('Your cart is empty', 'error');
            return;
        }
        sessionStorage.setItem('checkout_cart', JSON.stringify(this.cart));
        localStorage.setItem('hmherbs_cart', JSON.stringify(this.cart));
        window.location.href = 'checkout.html';
    }

    notify(msg, type) {
        if (window.HMNotify?.show) window.HMNotify.show(msg, type);
        else alert(msg);
    }

    escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.giftCardsPage = new GiftCardsPage();
});
