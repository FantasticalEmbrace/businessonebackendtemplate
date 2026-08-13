'use strict';

/**
 * MX — On Screen (mx_virtual), Physical (mx_terminal), or external Quick Pay (mx_quick_pay).
 * Quick Pay UI only appears when admin POS deployment is set to Quick Pay.
 */
PosPayment.registerDriver({
    id: 'mxmerchant',
    label: 'MX',
    integrated: true,
    paymentMethod: 'card_terminal',
    _intentId: null,
    _approvedIntent: null,
    _intentAmount: null,
    _pollCancelled: false,

    reset() {
        this._pollCancelled = true;
        this._intentId = null;
        this._intentAmount = null;
        this._approvedIntent = null;
        PosDisplayCheckout.clear();
    },

    clearIntentOnly() {
        this._pollCancelled = true;
        this._intentId = null;
        this._intentAmount = null;
        PosDisplayCheckout.clear();
    },

    useCardApprovedButton() {
        return false;
    },

    checkoutInfo(storeConfig) {
        return storeConfig?.payment?.checkout || {};
    },

    isVirtualTerminal(storeConfig) {
        return this.checkoutInfo(storeConfig).displayMode === 'mx_virtual';
    },

    isMxTerminal(storeConfig) {
        return this.checkoutInfo(storeConfig).displayMode === 'mx_terminal';
    },

    isQuickPay(storeConfig) {
        const checkout = this.checkoutInfo(storeConfig);
        return (
            checkout.displayMode === 'mx_quick_pay' ||
            checkout.mxQuickPay === true ||
            checkout.deploymentMode === 'quick_pay'
        );
    },

    displayCheckoutEnabled(storeConfig) {
        const payment = storeConfig?.payment || {};
        return payment.cardAdapter === 'mxmerchant' && payment.configured;
    },

    _isSplitMode(app) {
        return app?.selectedPayment === 'split';
    },

    _isVirtualMode(app) {
        return this.isVirtualTerminal(app?.storeConfig || this._storeConfig);
    },

    _isQuickPayMode(app) {
        return this.isQuickPay(app?.storeConfig || this._storeConfig);
    },

    _panelCopy(app, amount) {
        const amt = `$${Number(amount || 0).toFixed(2)}`;
        if (this._isQuickPayMode(app)) {
            return {
                label: this._isSplitMode(app) ? 'Card portion' : 'Card total',
                amount: amt,
                steps: `
          <ol class="card-take-steps">
            <li>Open <strong>MX Quick Pay</strong> in your browser.</li>
            <li>Enter this total and charge the card there (not on this register).</li>
            <li>Confirm below, then click <strong>Complete sale</strong> to save products, tax, and inventory.</li>
          </ol>`,
                pending: 'Confirm the charge in Quick Pay, then complete the sale.',
            };
        }
        if (this._isVirtualMode(app)) {
            return {
                label: 'Card total',
                amount: amt,
                steps: `
          <ol class="card-take-steps">
            <li>Enter card in the fields below (sent directly to MX).</li>
            <li>Click <strong>Complete sale</strong> to charge.</li>
          </ol>`,
                pending: 'Enter card details, then click Complete sale.',
            };
        }
        return {
            label: this._isSplitMode(app) ? 'Card portion' : 'Card total',
            amount: amt,
            steps: `
          <ol class="card-take-steps">
            <li>Click <strong>Complete sale</strong> to send the amount to the MX terminal.</li>
            <li>Customer completes payment on the terminal.</li>
          </ol>`,
            pending: 'Click Complete sale to send to the MX terminal.',
        };
    },

    _setStatus(panelEl, message) {
        const statusEl = panelEl?.querySelector('#display-checkout-status');
        if (statusEl) statusEl.textContent = message;
    },

    _showApproved(panelEl, intent) {
        const statusEl = panelEl?.querySelector('#display-checkout-status');
        const waitEl = panelEl?.querySelector('#display-checkout-wait');
        waitEl?.classList.add('hidden');
        if (statusEl) {
            const lastFour = String(intent?.lastFour || '').slice(-4);
            statusEl.innerHTML = lastFour
                ? `Card approved <strong>•••• ${lastFour}</strong>`
                : 'Card approved';
        }
    },

    _readQuickPayForm(panelEl) {
        const root = panelEl || document.getElementById('card-panel');
        const lastFour = String(root?.querySelector('#mx-quickpay-last4')?.value || '')
            .replace(/\D/g, '')
            .slice(-4);
        const authCode = String(root?.querySelector('#mx-quickpay-auth')?.value || '').trim();
        const confirmed = Boolean(root?.querySelector('#mx-quickpay-confirmed')?.checked);
        return { lastFour, authCode, confirmed };
    },

    _confirmQuickPayFromForm(app, panelEl, amount) {
        const form = this._readQuickPayForm(panelEl);
        if (!form.confirmed) {
            return { ok: false, message: 'Check “Charged in MX Quick Pay” after the charge succeeds.' };
        }
        const amt = Math.round(Number(amount) * 100) / 100;
        this._approvedIntent = {
            status: 'approved',
            lastFour: form.lastFour,
            authCode: form.authCode || 'QUICKPAY',
            cardBrand: 'card',
            transactionId: form.authCode || 'mx_quick_pay',
            quickPay: true,
        };
        this._intentAmount = amt;
        this._showApproved(panelEl, this._approvedIntent);
        const statusEl = panelEl?.querySelector('#display-checkout-status');
        if (statusEl) {
            statusEl.textContent = form.lastFour
                ? `Quick Pay confirmed •••• ${form.lastFour} — click Complete sale`
                : 'Quick Pay confirmed — click Complete sale';
        }
        return { ok: true };
    },

    _bindQuickPayForm(panelEl, app) {
        const btn = panelEl?.querySelector('#mx-quickpay-confirm-btn');
        const checkbox = panelEl?.querySelector('#mx-quickpay-confirmed');
        const onConfirm = () => {
            const amountEl = panelEl.querySelector('#card-terminal-amount');
            const text = amountEl?.textContent || '';
            const amount = Number(String(text).replace(/[^0-9.]/g, '')) || PosSplitTender.readFromUi().card;
            const result = this._confirmQuickPayFromForm(app, panelEl, amount);
            if (!result.ok) {
                app?.toast?.(result.message);
            }
        };
        btn?.addEventListener('click', onConfirm);
        checkbox?.addEventListener('change', () => {
            if (checkbox.checked) onConfirm();
            else {
                this._approvedIntent = null;
                this._setStatus(panelEl, this._panelCopy(app, 0).pending);
            }
        });
    },

    _watchForApproval(app, panelEl, intentId) {
        this._pollCancelled = false;
        const started = Date.now();
        const timeoutMs = 300000;
        const tick = async () => {
            if (this._pollCancelled || !this._intentId || this._intentId !== intentId) return;
            if (Date.now() - started > timeoutMs) {
                this._setStatus(panelEl, 'Payment timed out on terminal.');
                panelEl?.querySelector('#display-checkout-wait')?.classList.add('hidden');
                return;
            }
            try {
                const data = await PosDisplayCheckout.fetchStatus(app.config, intentId);
                const intent = data.intent;
                if (this._pollCancelled) return;
                if (intent?.status === 'approved') {
                    this._approvedIntent = intent;
                    this._showApproved(panelEl, intent);
                    return;
                }
                if (['declined', 'cancelled', 'expired'].includes(intent?.status)) {
                    this._setStatus(panelEl, intent.errorMessage || 'Card payment was not approved');
                    panelEl?.querySelector('#display-checkout-wait')?.classList.add('hidden');
                    return;
                }
            } catch {
                /* retry */
            }
            if (!this._pollCancelled) setTimeout(tick, 800);
        };
        tick();
    },

    async _handleIntentResult(app, panelEl, intent) {
        if (!intent) return intent;
        if (intent.status === 'approved') {
            this._approvedIntent = intent;
            this._showApproved(panelEl, intent);
            return intent;
        }
        if (intent.status === 'declined') {
            this._setStatus(panelEl, intent.errorMessage || 'Card was declined.');
            return intent;
        }
        if (intent.status === 'awaiting' || intent.status === 'processing') {
            panelEl?.querySelector('#display-checkout-wait')?.classList.remove('hidden');
            this._setStatus(panelEl, 'Waiting for customer on the MX terminal…');
            this._watchForApproval(app, panelEl, intent.id);
        }
        return intent;
    },

    async _startIntent(app, amount) {
        const amt = Math.round(Number(amount) * 100) / 100;
        const intent = await PosDisplayCheckout.start(app.config, { amount: amt, cart: PosCart.snapshot() });
        this._intentId = intent?.id || null;
        this._intentAmount = amt;
        if (intent?.status === 'approved') {
            this._approvedIntent = intent;
        }
        return intent;
    },

    async _cancelStaleIntent(app) {
        if (!this._intentId || !app?.config) return;
        await PosDisplayCheckout.cancel(app.config);
        this.clearIntentOnly();
        this._approvedIntent = null;
    },

    _cardFields() {
        return {
            number: document.getElementById('pos-ccnumber')?.value || '',
            expiry: document.getElementById('pos-ccexp')?.value || '',
            cvv: document.getElementById('pos-cvv')?.value || '',
            avsZip: document.getElementById('pos-billing-zip')?.value || '',
            avsStreet: document.getElementById('pos-billing-street')?.value || '',
        };
    },

    async mountCardPanel(panelEl, { storeConfig, amount, app }) {
        const resolvedConfig = storeConfig || app?.storeConfig;
        const enabled = this.displayCheckoutEnabled(resolvedConfig);
        const quickPay = enabled && this.isQuickPay(resolvedConfig);
        const virtual = enabled && !quickPay && this.isVirtualTerminal(resolvedConfig);
        const copy = this._panelCopy(app, amount);

        let body = '';
        if (enabled && quickPay) {
            body = `
          <div class="card-take-amount">
            <span class="card-take-label">${copy.label}</span>
            <span id="card-terminal-amount" class="card-take-value">${copy.amount}</span>
          </div>
          ${copy.steps}
          <label class="card-take-note" style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;margin:0.5rem 0;">
            <input type="checkbox" id="mx-quickpay-confirmed" style="margin-top:0.2rem;">
            <span>Charged in MX Quick Pay for this amount</span>
          </label>
          <div class="form-group" style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <input id="mx-quickpay-last4" class="form-input" type="text" inputmode="numeric" maxlength="4" placeholder="Last 4 (optional)" style="max-width:9rem">
            <input id="mx-quickpay-auth" class="form-input" type="text" placeholder="Auth / ref (optional)" style="flex:1;min-width:8rem">
          </div>
          <button type="button" class="btn btn-secondary" id="mx-quickpay-confirm-btn" style="margin:0.35rem 0 0.5rem;">Confirm Quick Pay charge</button>
          <p class="card-take-note" id="display-checkout-status">${copy.pending}</p>`;
        } else if (enabled && virtual) {
            body = `
          <div class="card-take-amount">
            <span class="card-take-label">${copy.label}</span>
            <span id="card-terminal-amount" class="card-take-value">${copy.amount}</span>
          </div>
          ${copy.steps}
          <div class="form-group"><input id="pos-ccnumber" class="form-input" type="text" inputmode="numeric" autocomplete="cc-number" placeholder="Card number"></div>
          <div class="form-group" style="display:flex;gap:0.5rem">
            <input id="pos-ccexp" class="form-input" type="text" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" style="max-width:6rem">
            <input id="pos-cvv" class="form-input" type="text" inputmode="numeric" autocomplete="cc-csc" placeholder="CVV" style="max-width:5rem">
          </div>
          <div class="form-group"><input id="pos-billing-zip" class="form-input" type="text" inputmode="numeric" placeholder="Billing ZIP"></div>
          <p class="card-take-note" id="display-checkout-status">${copy.pending}</p>`;
        } else if (enabled) {
            body = `
          <div class="card-take-amount">
            <span class="card-take-label">${copy.label}</span>
            <span id="card-terminal-amount" class="card-take-value">${copy.amount}</span>
          </div>
          ${copy.steps}
          <p class="card-take-note" id="display-checkout-status">${copy.pending}</p>
          <p class="card-take-note payment-driver-warn hidden" id="display-checkout-wait">Waiting for the MX terminal…</p>`;
        }

        panelEl.innerHTML = body;
        panelEl.classList.toggle('hidden', !enabled);
        this._app = app;
        this._storeConfig = resolvedConfig;
        this._pollCancelled = true;
        this._approvedIntent = null;

        if (!enabled) return;

        if (quickPay) {
            this._bindQuickPayForm(panelEl, app);
            return;
        }

        if (!app?.config) return;

        if (!virtual) {
            const rounded = Math.round(Number(amount) * 100) / 100;
            if (this._intentId && this._intentAmount !== rounded) {
                await this._cancelStaleIntent(app);
            }
            this._setStatus(panelEl, copy.pending);
        }
    },

    async updateCardAmount(amount) {
        const el = document.getElementById('card-terminal-amount');
        if (el) el.textContent = `$${Number(amount || 0).toFixed(2)}`;
        if (!this.displayCheckoutEnabled(this._storeConfig) || !this._app?.config) return;
        if (this.isQuickPay(this._storeConfig)) {
            this._approvedIntent = null;
            const panel = document.getElementById('card-panel');
            const box = panel?.querySelector('#mx-quickpay-confirmed');
            if (box) box.checked = false;
            this._setStatus(panel, this._panelCopy(this._app, amount).pending);
            return;
        }
        const rounded = Math.round(Number(amount) * 100) / 100;
        if (this._intentId && this._intentAmount !== rounded) {
            await this._cancelStaleIntent(this._app);
        }
        const panel = document.getElementById('card-panel');
        if (panel && !this.isVirtualTerminal(this._storeConfig)) {
            this._setStatus(panel, 'Click Complete sale to send to the MX terminal.');
        }
    },

    async beforeCompleteSale({ app, amount }) {
        if (!this.displayCheckoutEnabled(app?.storeConfig || this._storeConfig)) {
            return { ok: false, message: 'MX is not configured on this register.' };
        }

        const cardAmt = Math.round(Number(amount ?? PosSplitTender.readFromUi().card) * 100) / 100;
        if (cardAmt <= 0.005) return { ok: true };

        if (this._isQuickPayMode(app)) {
            const panel = document.getElementById('card-panel');
            if (this._approvedIntent && this._intentAmount === cardAmt) {
                return { ok: true };
            }
            return this._confirmQuickPayFromForm(app, panel, cardAmt);
        }

        if (this._approvedIntent && this._intentAmount === cardAmt) {
            return { ok: true };
        }

        const panel = document.getElementById('card-panel');
        const waitEl = document.getElementById('display-checkout-wait');

        if (this._intentId && this._intentAmount !== cardAmt) {
            await this._cancelStaleIntent(app);
        }

        if (this._isVirtualMode(app)) {
            return this._beforeCompleteSaleVirtual({ app, amount: cardAmt, panel });
        }

        try {
            if (!this._intentId) {
                waitEl?.classList.remove('hidden');
                this._setStatus(panel, 'Sending amount to MX terminal…');
                const intent = await this._startIntent(app, cardAmt);
                await this._handleIntentResult(app, panel, intent);
            }

            if (this._approvedIntent) return { ok: true };

            const intentId = this._intentId || PosDisplayCheckout.activeIntentId;
            if (!intentId) {
                return { ok: false, message: 'Could not start MX terminal checkout.' };
            }

            waitEl?.classList.remove('hidden');
            this._setStatus(panel, 'Waiting for customer on the MX terminal…');
            const intent = await PosDisplayCheckout.waitForApproval(app.config, intentId);
            this._approvedIntent = intent;
            this._showApproved(panel, intent);
            return { ok: true };
        } catch (e) {
            return { ok: false, message: e.message || 'MX card payment was not approved' };
        } finally {
            waitEl?.classList.add('hidden');
        }
    },

    async _beforeCompleteSaleVirtual({ app, amount, panel }) {
        if (typeof window.HmMxCheckout === 'undefined') {
            return { ok: false, message: 'MX checkout helper not loaded' };
        }

        try {
            const cfg = await PosApi.request(app.config, '/payments/mx-client-config', {
                headers: { ...PosEmployee.authHeaders() },
            });
            if (!cfg.enabled || !cfg.sessionToken) {
                return { ok: false, message: cfg.error || 'MX virtual terminal is not configured' };
            }

            if (!this._intentId || this._intentAmount !== amount) {
                await this._cancelStaleIntent(app);
                await this._startIntent(app, amount);
            }

            this._setStatus(panel, 'Processing card with MX…');
            const card = this._cardFields();
            const result = await window.HmMxCheckout.chargeCard({
                apiBaseUrl: cfg.apiBaseUrl,
                sessionToken: cfg.sessionToken,
                merchantId: cfg.merchantId,
                amount,
                cardAccount: card,
                clientReference: String(this._intentId || '').slice(0, 17),
                posData: cfg.posDataDefaults,
            });

            const intentId = this._intentId || PosDisplayCheckout.activeIntentId;
            if (!intentId) {
                return { ok: false, message: 'Could not start card checkout.' };
            }

            const intent = await PosDisplayCheckout.payWithMxPaymentId(app.config, intentId, result.paymentId);
            this._approvedIntent = intent;
            this._showApproved(panel, intent);
            return { ok: true };
        } catch (e) {
            return { ok: false, message: e.message || 'MX card payment was not approved' };
        }
    },

    buildPaymentPayload() {
        const intent = this._approvedIntent || {};
        const lastFour = String(intent.lastFour || '').slice(-4);
        const quickPay = Boolean(intent.quickPay);
        return {
            paymentMethod: 'card_terminal',
            terminalLastFour: lastFour,
            terminalAuthCode: intent.authCode || (quickPay ? 'QUICKPAY' : ''),
            terminalCardBrand: intent.cardBrand || 'card',
            terminalApprovedConfirmed: true,
            terminalTransactionId: intent.transactionId || (quickPay ? 'mx_quick_pay' : ''),
            terminalReference: quickPay ? 'mx_quick_pay' : intent.transactionId || '',
            note: quickPay ? 'Charged in MX Quick Pay (external)' : undefined,
            label: lastFour
                ? quickPay
                    ? `Quick Pay •••• ${lastFour}`
                    : `Card •••• ${lastFour}`
                : quickPay
                  ? 'Card (MX Quick Pay)'
                  : 'Card (MX)',
        };
    },
});
