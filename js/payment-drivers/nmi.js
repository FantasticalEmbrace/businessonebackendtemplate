'use strict';

/**
 * NMI — card checkout via semi-integrated terminal or register Collect.js fallback.
 */
PosPayment.registerDriver({
    id: 'nmi',
    label: 'NMI',
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
        const checkout = this.checkoutInfo(storeConfig);
        return checkout.displayMode === 'collect_js' || checkout.virtualTerminal === true;
    },

    displayCheckoutEnabled(storeConfig) {
        const payment = storeConfig?.payment || {};
        return payment.cardAdapter === 'nmi' && payment.configured && payment.serverCharge;
    },

    _isSplitMode(app) {
        return app?.selectedPayment === 'split';
    },

    _isVirtualMode(app) {
        return this.isVirtualTerminal(app?.storeConfig || this._storeConfig);
    },

    _hasGiftCardApplied() {
        return (window.PosSplitTender?.readFromUi()?.giftCard?.amount || 0) > 0.005;
    },

    _panelCopy(app, amount) {
        const amt = `$${Number(amount || 0).toFixed(2)}`;
        if (this._isVirtualMode(app)) {
            return {
                label: 'Card total',
                amount: amt,
                steps: `
          <ol class="card-take-steps">
            <li>Enter card in the secure fields below.</li>
            <li>Click <strong>Complete sale</strong> to run the sandbox charge.</li>
          </ol>`,
                pending: 'Enter card details, then click Complete sale.'
            };
        }
        if (this._isSplitMode(app)) {
            return {
                label: 'Card portion',
                amount: amt,
                steps: `
          <ol class="card-take-steps">
            <li>Enter <strong>all</strong> payment amounts until Remaining is $0.00.</li>
            <li>Click <strong>Complete sale</strong> — only the card portion goes to the terminal.</li>
            <li>Customer <strong>swipes, taps, or inserts</strong> their card.</li>
          </ol>`,
                pending: 'Set all payment amounts, then click Complete sale.'
            };
        }
        if (this._hasGiftCardApplied()) {
            return {
                label: 'Card portion',
                amount: amt,
                steps: `
          <ol class="card-take-steps">
            <li>Click <strong>Complete sale</strong> — the remaining balance goes to the card terminal.</li>
            <li>Customer <strong>swipes, taps, or inserts</strong> their card.</li>
          </ol>`,
                pending: 'Click Complete sale to send the remaining balance to the terminal.'
            };
        }
        return {
            label: 'Card total',
            amount: amt,
            steps: `
          <ol class="card-take-steps">
            <li>Click <strong>Complete sale</strong> to send the total to the card terminal.</li>
            <li>Customer <strong>swipes, taps, or inserts</strong> their card.</li>
          </ol>`,
            pending: 'Click Complete sale to send to the terminal.'
        };
    },

    async _recoverFromDuplicate(app, panel) {
        const intentId = this._intentId || PosDisplayCheckout.activeIntentId;
        if (!intentId || !app?.config) return null;
        try {
            const data = await PosDisplayCheckout.fetchStatus(app.config, intentId);
            if (data.intent?.status === 'approved') {
                this._approvedIntent = data.intent;
                this._showApproved(panel, data.intent);
                return data.intent;
            }
        } catch {
            /* ignore */
        }
        return null;
    },

    _tendersBalanced(app) {
        const config = app?.storeConfig || this._storeConfig;
        if (!config || !window.PosSplitTender) return false;
        return PosSplitTender.validate(config).ok;
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
                : 'Card approved on terminal';
        }
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
                /* retry on transient errors */
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
            this._setStatus(panelEl, intent.errorMessage || 'Card was declined on the terminal.');
            return intent;
        }
        if (intent.status === 'awaiting' || intent.status === 'processing') {
            panelEl?.querySelector('#display-checkout-wait')?.classList.remove('hidden');
            this._setStatus(panelEl, 'Waiting for customer on the card terminal…');
            this._watchForApproval(app, panelEl, intent.id);
        }
        return intent;
    },

    async _startIntent(app, amount) {
        const amt = Math.round(Number(amount) * 100) / 100;
        const intent = await PosDisplayCheckout.start(app.config, {
            amount: amt,
            cart: PosCart.snapshot()
        });
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

    _refreshPanelStatus(panelEl, app, amount) {
        if (!panelEl || !app) return;
        const rounded = Math.round(Number(amount) * 100) / 100;
        if (this._approvedIntent && this._intentAmount === rounded) {
            this._showApproved(panelEl, this._approvedIntent);
            return;
        }
        if (this._isSplitMode(app) && !this._tendersBalanced(app)) {
            this._setStatus(
                panelEl,
                'Enter gift card, cash, check, or other amounts until Remaining is $0.00, then click Complete sale.'
            );
            panelEl.querySelector('#display-checkout-wait')?.classList.add('hidden');
            return;
        }
        const copy = this._panelCopy(app, amount);
        if (this._isSplitMode(app)) {
            this._setStatus(
                panelEl,
                `Click Complete sale to send $${rounded.toFixed(2)} to the card terminal.`
            );
        } else {
            this._setStatus(panelEl, copy.pending);
        }
        panelEl.querySelector('#display-checkout-wait')?.classList.add('hidden');
    },

    async mountCardPanel(panelEl, { storeConfig, amount, app }) {
        const resolvedConfig = storeConfig || app?.storeConfig;
        const enabled = this.displayCheckoutEnabled(resolvedConfig);
        const virtual = enabled && this.isVirtualTerminal(resolvedConfig);

        const copy = this._panelCopy(app, amount);
        panelEl.innerHTML = enabled
            ? virtual
                ? `
          <div class="card-take-amount">
            <span class="card-take-label">${copy.label}</span>
            <span id="card-terminal-amount" class="card-take-value">${copy.amount}</span>
          </div>
          ${copy.steps}
          <div id="pos-ccnumber" class="nmi-field-host form-input" style="margin-bottom:0.5rem;min-height:48px;"></div>
          <div id="pos-ccexp" class="nmi-field-host form-input" style="margin-bottom:0.5rem;min-height:48px;"></div>
          <div id="pos-cvv" class="nmi-field-host form-input" style="margin-bottom:0.5rem;min-height:48px;"></div>
          <p class="card-take-note" id="display-checkout-status">${copy.pending}</p>`
                : `
          <div class="card-take-amount">
            <span class="card-take-label">${copy.label}</span>
            <span id="card-terminal-amount" class="card-take-value">${copy.amount}</span>
          </div>
          ${copy.steps}
          <p class="card-take-note" id="display-checkout-status">${copy.pending}</p>
          <p class="card-take-note payment-driver-warn hidden" id="display-checkout-wait">Waiting for the terminal…</p>`
            : '';
        panelEl.classList.remove('hidden');
        this._app = app;
        this._storeConfig = resolvedConfig;
        this._pollCancelled = true;

        if (!enabled || !app?.config) return;

        if (virtual) {
            try {
                await PosNmiCollect.ensureReady(app.config);
                this._setStatus(panelEl, copy.pending);
            } catch (e) {
                this._setStatus(panelEl, e.message || 'Virtual terminal is not ready');
            }
            return;
        }

        const rounded = Math.round(Number(amount) * 100) / 100;
        if (this._intentId && this._intentAmount !== rounded) {
            await this._cancelStaleIntent(app);
        }
        this._refreshPanelStatus(panelEl, app, amount);
    },

    async updateCardAmount(amount) {
        const el = document.getElementById('card-terminal-amount');
        if (el) el.textContent = `$${Number(amount || 0).toFixed(2)}`;
        if (!this.displayCheckoutEnabled(this._storeConfig) || !this._app?.config) {
            return;
        }
        const rounded = Math.round(Number(amount) * 100) / 100;
        if (this._intentId && this._intentAmount !== rounded) {
            await this._cancelStaleIntent(this._app);
        }
        const panel = document.getElementById('card-panel');
        this._refreshPanelStatus(panel, this._app, amount);
    },

    async beforeCompleteSale({ app, amount }) {
        if (!this.displayCheckoutEnabled(app?.storeConfig || this._storeConfig)) {
            return {
                ok: false,
                message: 'Card terminal is not available on this register yet.'
            };
        }

        const cardAmt =
            Math.round(Number(amount ?? PosSplitTender.readFromUi().card) * 100) / 100;
        if (cardAmt <= 0.005) {
            return { ok: true };
        }

        if (this._isVirtualMode(app)) {
            return this._beforeCompleteSaleVirtual({ app, amount: cardAmt });
        }

        if (this._approvedIntent && this._intentAmount === cardAmt) {
            return { ok: true };
        }

        const panel = document.getElementById('card-panel');
        const waitEl = document.getElementById('display-checkout-wait');

        if (this._intentId && this._intentAmount !== cardAmt) {
            await this._cancelStaleIntent(app);
        }

        try {
            if (!this._intentId) {
                waitEl?.classList.remove('hidden');
                this._setStatus(panel, 'Sending card amount to terminal…');
                const intent = await this._startIntent(app, cardAmt);
                await this._handleIntentResult(app, panel, intent);
            }

            if (this._approvedIntent) {
                return { ok: true };
            }

            const intentId = this._intentId || PosDisplayCheckout.activeIntentId;
            if (!intentId) {
                return {
                    ok: false,
                    message: 'Could not send the card amount to the terminal.'
                };
            }

            waitEl?.classList.remove('hidden');
            this._setStatus(panel, 'Waiting for customer on the card terminal…');
            const intent = await PosDisplayCheckout.waitForApproval(app.config, intentId);
            this._approvedIntent = intent;
            this._showApproved(panel, intent);
            return { ok: true };
        } catch (e) {
            const msg = String(e.message || 'Card payment was not approved');
            if (/duplicate transaction/i.test(msg)) {
                const recovered = await this._recoverFromDuplicate(app, panel);
                if (recovered) return { ok: true };
                return {
                    ok: false,
                    message:
                        'This card amount was just sent to the terminal. Wait a moment, cancel payment, and try again.'
                };
            }
            return { ok: false, message: msg };
        } finally {
            waitEl?.classList.add('hidden');
        }
    },

    async _beforeCompleteSaleVirtual({ app, amount }) {
        const panel = document.getElementById('card-panel');
        if (this._approvedIntent && this._intentAmount === amount) {
            return { ok: true };
        }

        try {
            await PosNmiCollect.ensureReady(app.config);
            this._setStatus(panel, 'Tokenizing card…');
            if (!this._intentId || this._intentAmount !== amount) {
                await this._cancelStaleIntent(app);
                const intent = await this._startIntent(app, amount);
                if (intent?.status === 'approved') {
                    this._approvedIntent = intent;
                    this._showApproved(panel, intent);
                    return { ok: true };
                }
            }

            const token = await PosNmiCollect.tokenize();
            this._setStatus(panel, 'Processing sandbox charge…');
            const intentId = this._intentId || PosDisplayCheckout.activeIntentId;
            if (!intentId) {
                return { ok: false, message: 'Could not start card checkout.' };
            }
            const intent = await PosDisplayCheckout.payWithToken(app.config, intentId, token);
            this._approvedIntent = intent;
            this._showApproved(panel, intent);
            return { ok: true };
        } catch (e) {
            return { ok: false, message: e.message || 'Card payment was not approved' };
        }
    },

    buildPaymentPayload() {
        const intent = this._approvedIntent || {};
        const lastFour = String(intent.lastFour || '').slice(-4);
        const label = lastFour ? `Card •••• ${lastFour}` : 'Card (NMI)';
        return {
            paymentMethod: 'card_terminal',
            terminalLastFour: lastFour,
            terminalAuthCode: intent.authCode || '',
            terminalCardBrand: intent.cardBrand || 'card',
            terminalApprovedConfirmed: true,
            terminalTransactionId: intent.transactionId || '',
            label
        };
    }
});
