/**
 * HM Herbs admin — in-panel platform billing (principal merchant only).
 * Public merchants continue to use businessonecomprehensive.com/billing-portal.html.
 */
(function () {
    'use strict';

    let adminApp = null;
    let dashboard = null;
    let selectedSku = '';
    let clientConfig = null;
    let hostedMount = null;
    let paymentToken = null;

    function $(id) {
        return document.getElementById(id);
    }

    function money(n) {
        return `$${Number(n || 0).toFixed(2)}`;
    }

    function setMsg(text, tone) {
        const el = $('pos-license-billing-msg');
        if (!el) return;
        el.textContent = text || '';
        el.style.color =
            tone === 'ok' ? 'var(--success, #15803d)' : tone === 'err' ? 'var(--error, #b91c1c)' : '';
    }

    function destroyHostedMount() {
        hostedMount?.destroy?.();
        hostedMount = null;
        paymentToken = null;
    }

    function cardPayloadFromForm() {
        const useHosted = clientConfig?.hostedFields?.required || clientConfig?.hostedFields?.enabled;
        if (useHosted) {
            const token = paymentToken || hostedMount?.getToken?.();
            if (!token) return null;
            return {
                paymentToken: token,
                cardholderName: $('principal-billing-card-name')?.value?.trim(),
                billingEmail: $('principal-billing-card-email')?.value?.trim(),
                postalCode: $('principal-billing-card-zip')?.value?.trim()
            };
        }

        const cardNumber = $('principal-billing-card-number')?.value?.replace(/\s+/g, '') || '';
        if (!cardNumber) return null;
        return {
            cardNumber,
            ccExpMonth: $('principal-billing-card-exp-month')?.value?.trim(),
            ccExpYear: $('principal-billing-card-exp-year')?.value?.trim(),
            cvv: $('principal-billing-card-cvv')?.value?.trim(),
            cardholderName: $('principal-billing-card-name')?.value?.trim(),
            postalCode: $('principal-billing-card-zip')?.value?.trim(),
            billingEmail: $('principal-billing-card-email')?.value?.trim()
        };
    }

    function shipToFromForm() {
        return {
            name: $('principal-ship-name')?.value?.trim(),
            street1: $('principal-ship-street')?.value?.trim(),
            city: $('principal-ship-city')?.value?.trim(),
            state: $('principal-ship-state')?.value?.trim(),
            postalCode: $('principal-ship-zip')?.value?.trim()
        };
    }

    function validateShipTo(shipTo) {
        if (!shipTo.name || !shipTo.street1 || !shipTo.city || !shipTo.state || !shipTo.postalCode) {
            return 'Complete all ship-to fields for modem orders.';
        }
        return '';
    }

    function renderCardForm(hasVault) {
        const mount = $('pos-license-collect-mount');
        const placeholder = $('pos-license-collect-placeholder');
        if (!mount) return;

        destroyHostedMount();

        const vaultNote = hasVault
            ? `<p style="margin:0 0 0.5rem;font-size:0.88rem;color:var(--gray-600);">
                    Card on file. Enter new card details below only if you want to replace it.
                </p>`
            : '';

        if (clientConfig?.hostedFields?.enabled) {
            mount.innerHTML =
                vaultNote +
                `
            <div class="form-group" style="margin:0;">
                <label for="principal-billing-card-name">Name on card</label>
                <input class="form-input" id="principal-billing-card-name" autocomplete="cc-name">
            </div>
            <div id="principal-hosted-card-mount"></div>
            <p style="margin:0.35rem 0 0;font-size:0.85rem;color:var(--gray-600);" id="principal-hosted-card-hint">
                Card number, expiration, and CVV are entered in the secure frame below.
            </p>
            <div style="display:grid;grid-template-columns:1fr 8rem;gap:0.5rem;margin-top:0.65rem;">
                <div class="form-group" style="margin:0;">
                    <label for="principal-billing-card-email">Billing email</label>
                    <input class="form-input" id="principal-billing-card-email" type="email" autocomplete="email">
                </div>
                <div class="form-group" style="margin:0;">
                    <label for="principal-billing-card-zip">Billing ZIP</label>
                    <input class="form-input" id="principal-billing-card-zip" inputmode="numeric" autocomplete="postal-code">
                </div>
            </div>`;

            const hostedEl = $('principal-hosted-card-mount');
            if (hostedEl && window.BusinessOneProchargeHosted) {
                hostedMount = window.BusinessOneProchargeHosted.mount({
                    mountEl: hostedEl,
                    config: clientConfig,
                    mode: 'card',
                    onToken(token) {
                        paymentToken = token;
                    },
                    onError(err) {
                        setMsg(err?.message || 'Secure payment fields could not load.', 'err');
                    }
                });
            }
        } else {
            mount.innerHTML =
                vaultNote +
                `
            <div class="form-group" style="margin:0;">
                <label for="principal-billing-card-number">Card number</label>
                <input class="form-input" id="principal-billing-card-number" inputmode="numeric" autocomplete="cc-number" placeholder="4111…">
            </div>
            <div style="display:grid;grid-template-columns:5rem 5rem 5rem;gap:0.5rem;">
                <div class="form-group" style="margin:0;">
                    <label for="principal-billing-card-exp-month">MM</label>
                    <input class="form-input" id="principal-billing-card-exp-month" inputmode="numeric" maxlength="2" autocomplete="cc-exp-month" placeholder="12">
                </div>
                <div class="form-group" style="margin:0;">
                    <label for="principal-billing-card-exp-year">YY</label>
                    <input class="form-input" id="principal-billing-card-exp-year" inputmode="numeric" maxlength="4" autocomplete="cc-exp-year" placeholder="28">
                </div>
                <div class="form-group" style="margin:0;">
                    <label for="principal-billing-card-cvv">CVV</label>
                    <input class="form-input" id="principal-billing-card-cvv" inputmode="numeric" maxlength="4" autocomplete="cc-csc">
                </div>
            </div>
            <div class="form-group" style="margin:0;">
                <label for="principal-billing-card-name">Name on card</label>
                <input class="form-input" id="principal-billing-card-name" autocomplete="cc-name">
            </div>
            <div style="display:grid;grid-template-columns:1fr 8rem;gap:0.5rem;">
                <div class="form-group" style="margin:0;">
                    <label for="principal-billing-card-email">Billing email</label>
                    <input class="form-input" id="principal-billing-card-email" type="email" autocomplete="email">
                </div>
                <div class="form-group" style="margin:0;">
                    <label for="principal-billing-card-zip">Billing ZIP</label>
                    <input class="form-input" id="principal-billing-card-zip" inputmode="numeric" autocomplete="postal-code">
                </div>
            </div>`;
        }

        if (placeholder) {
            placeholder.textContent = hasVault
                ? ''
                : 'Add a card so monthly billing and modem orders can run automatically.';
        }

        const emailEl = $('principal-billing-card-email');
        const licenseEmail = dashboard?.account?.billingEmail?.trim();
        if (emailEl && licenseEmail && !emailEl.value) emailEl.value = licenseEmail;

        const nameEl = $('principal-billing-card-name');
        const business = dashboard?.account?.businessName?.trim();
        if (nameEl && business && !nameEl.value) nameEl.value = business;

        const shipName = $('principal-ship-name');
        if (shipName && business && !shipName.value) shipName.value = business;
    }

    function prefillFromDashboard(data) {
        dashboard = data;
        prefillCardContactFromDashboard();
    }

    function prefillCardContactFromDashboard() {
        const emailEl = $('principal-billing-card-email');
        const licenseEmail = dashboard?.account?.billingEmail?.trim();
        if (emailEl && licenseEmail) emailEl.value = licenseEmail;

        const nameEl = $('principal-billing-card-name');
        const business = dashboard?.account?.businessName?.trim();
        if (nameEl && business) nameEl.value = business;
    }

    function renderModemGate(data) {
        const banner = $('principal-modem-gate-banner');
        const statementSection = $('principal-monthly-statement-section');
        const modem = data.modemBilling || {};

        if (!banner) return;

        if (!modem.required || modem.waived) {
            banner.style.display = 'none';
            if (statementSection) statementSection.style.opacity = '';
            return;
        }

        if (modem.ordered) {
            const when = modem.order?.orderedAt
                ? new Date(modem.order.orderedAt).toLocaleDateString()
                : 'recently';
            banner.style.display = '';
            banner.style.background = '#ecfdf5';
            banner.style.color = '#166534';
            banner.style.border = '1px solid #bbf7d0';
            banner.innerHTML = `<strong>Modem ordered.</strong> Monthly platform billing can run after your WTI failover modem order (${modem.order?.sku || 'modem'} · ${when}).`;
            if (statementSection) statementSection.style.opacity = '';
            return;
        }

        banner.style.display = '';
        banner.style.background = '#eff6ff';
        banner.style.color = '#1e40af';
        banner.style.border = '1px solid #bfdbfe';
        banner.innerHTML =
            '<strong>Order your WTI modem first.</strong> Monthly platform fees will not charge until a failover modem is ordered below. Modem data usage is metered automatically after setup.';
        if (statementSection) statementSection.style.opacity = '0.72';
    }

    function renderStatement(data) {
        const linesEl = $('principal-billing-statement-lines');
        const totalEl = $('principal-billing-statement-total');
        const statusEl = $('pos-license-billing-status');
        const warnEl = $('principal-billing-config-warn');

        const account = data.account || {};
        const statement = data.statement || {};

        if (statusEl) {
            const dry = data.billingDryRun ? ' · billing dry-run on' : '';
            const sandbox = data.sandbox ? ' · sandbox' : '';
            statusEl.innerHTML = account.hasBillingVault
                ? `<strong>Payment method:</strong> on file (ProCharge)${dry}${sandbox}`
                : `<strong>Payment method:</strong> not saved yet${dry}${sandbox}`;
        }

        if (warnEl) {
            if (!data.configured) {
                warnEl.style.display = '';
                warnEl.textContent = clientConfig?.hostedFields?.enabled
                    ? 'ProCharge API credentials are not on the server yet. Secure card fields are ready; charges will run after PROCHARGE_* keys are set.'
                    : 'ProCharge is not configured on the server yet. You can still review pricing; charges will not run until PROCHARGE_* keys are set.';
            } else {
                warnEl.style.display = 'none';
            }
        }

        if (linesEl) {
            const lines = statement.lines || [];
            linesEl.innerHTML = lines.length
                ? lines
                      .map(
                          (l) =>
                              `<div style="display:flex;justify-content:space-between;gap:1rem;padding:0.2rem 0;"><span>${l.label}</span><span>${money(l.amount)}</span></div>`
                      )
                      .join('')
                : '<span style="color:var(--gray-600);">No active subscriptions.</span>';
        }
        if (totalEl) {
            totalEl.textContent = `Estimated monthly total: ${money(statement.subtotal)}`;
        }
    }

    function renderBuildBalance(data) {
        const section = $('principal-build-balance-section');
        const summaryHint = $('principal-build-balance-summary-hint');
        const desc = $('principal-build-balance-desc');
        const amount = $('principal-build-balance-amount');
        const paid = $('principal-build-balance-paid');
        const actions = $('principal-build-balance-actions');
        const fullBtn = $('principal-build-pay-full-btn');
        const instBtn = $('principal-build-pay-installment-btn');
        const monthsSel = $('principal-build-installment-months');
        if (!section) return;

        const bb = data.buildBalance || {};
        const remaining = Number(bb.remaining) || 0;

        if (remaining <= 0) {
            section.style.display = bb.paidOffAt ? '' : 'none';
            if (summaryHint) summaryHint.textContent = bb.paidOffAt ? ' · paid' : '';
            if (bb.paidOffAt) {
                section.open = false;
                if (desc) desc.textContent = bb.label || '';
                if (amount) amount.textContent = '';
                if (paid) {
                    paid.style.display = '';
                    paid.textContent =
                        bb.payMode === 'installment'
                            ? `Balance converted to monthly installments (started ${bb.paidOffAt}).`
                            : `Build balance paid in full on ${bb.paidOffAt}.`;
                }
                if (actions) actions.style.display = 'none';
                if (fullBtn) fullBtn.style.display = 'none';
                if (instBtn) instBtn.style.display = 'none';
                if (monthsSel) monthsSel.closest('.form-group').style.display = 'none';
            }
            return;
        }

        section.style.display = '';
        section.open = false;
        if (summaryHint) {
            summaryHint.textContent = ` · ${money(remaining)} remaining (optional)`;
        }
        if (desc) {
            desc.textContent =
                bb.label ||
                'Optional: pay the remaining website build balance when you are ready. You already paid 50% at signup.';
        }
        if (amount) {
            amount.textContent = `Remaining: ${money(remaining)} (of ${money(bb.fullAmount)} total · ${money(bb.paidAmount)} already paid)`;
        }
        if (paid) paid.style.display = 'none';
        if (actions) actions.style.display = '';
        if (fullBtn) fullBtn.style.display = '';
        if (instBtn) instBtn.style.display = '';
        if (monthsSel) monthsSel.closest('.form-group').style.display = '';
    }

    async function confirmBuildBalancePayment(mode) {
        const bb = dashboard?.buildBalance || {};
        const remaining = Number(bb.remaining) || 0;
        const months = Math.max(1, Number($('principal-build-installment-months')?.value) || 6);
        const monthlyApprox = remaining / months;

        const title =
            mode === 'installment' ? 'Start installment plan?' : 'Pay build balance in full?';
        const message =
            mode === 'installment'
                ? `You are about to convert ${money(remaining)} into ${months} monthly payments of about ${money(monthlyApprox)} each.\n\nThis will charge your card on file. Continue?`
                : `You are about to charge ${money(remaining)} to your card on file for the website build balance.\n\nThis cannot be undone from this screen. Continue?`;

        if (adminApp?.showAdminConfirm) {
            return adminApp.showAdminConfirm({
                title,
                message,
                confirmLabel: mode === 'installment' ? 'Start plan' : 'Charge now',
                cancelLabel: 'Cancel',
                danger: true
            });
        }
        return window.confirm(message);
    }

    function updateHardwareTotal() {
        const totalEl = $('principal-hardware-total');
        if (!totalEl || !dashboard?.hardware?.length) return;
        const item = dashboard.hardware.find((h) => h.sku === selectedSku);
        if (!item) {
            totalEl.textContent = '';
            return;
        }
        totalEl.textContent = `Order total: ${money(item.total)} (${money(item.subtotal)} + ${money(item.taxAmount)} tax)`;
    }

    function renderHardware(data) {
        const mount = $('principal-hardware-options');
        if (!mount) return;
        const items = data.hardware || [];
        if (!items.length) {
            mount.innerHTML = '<span style="color:var(--gray-600);">No modems in catalog.</span>';
            return;
        }
        if (!selectedSku) selectedSku = items[0].sku;
        mount.innerHTML = items
            .map(
                (item) => `
            <label style="display:flex;gap:0.5rem;align-items:flex-start;padding:0.5rem 0.65rem;border:1px solid var(--gray-200);border-radius:8px;cursor:pointer;">
                <input type="radio" name="principal-modem-sku" value="${item.sku}" ${item.sku === selectedSku ? 'checked' : ''} style="margin-top:0.25rem;">
                <span>
                    <strong>${item.name}</strong> — ${money(item.total)} total<br>
                    <span style="font-size:0.85rem;color:var(--gray-600);">${item.description || ''}</span>
                </span>
            </label>`
            )
            .join('');

        mount.querySelectorAll('input[name="principal-modem-sku"]').forEach((input) => {
            input.addEventListener('change', () => {
                selectedSku = input.value;
                updateHardwareTotal();
            });
        });
        updateHardwareTotal();
    }

    async function apiBilling(path, options) {
        if (!adminApp?.apiRequest) throw new Error('Admin session not ready');
        return adminApp.apiRequest(`/platform/billing${path}`, options);
    }

    async function loadDashboard() {
        setMsg('Loading billing…', '');
        try {
            clientConfig = await apiBilling('/client-config');
        } catch {
            clientConfig = null;
        }
        const data = await apiBilling('/principal');
        dashboard = data;
        renderModemGate(data);
        renderStatement(data);
        renderCardForm(Boolean(data.account?.hasBillingVault));
        renderBuildBalance(data);
        renderHardware(data);
        setMsg('', '');
        return data;
    }

    async function savePaymentMethod() {
        const authorize = $('pos-license-billing-authorize');
        if (!authorize?.checked) {
            setMsg('Check the authorization box first.', 'err');
            return;
        }
        const card = cardPayloadFromForm();
        if (!card) {
            setMsg(
                clientConfig?.hostedFields?.enabled
                    ? 'Complete the secure card fields above to save a payment method.'
                    : 'Enter card details to save a payment method.',
                'err'
            );
            return;
        }
        if (!clientConfig?.paymentReady && !dashboard?.configured) {
            setMsg(
                clientConfig?.message ||
                    'Payment processing is not live on the server yet. ProCharge credentials are still being configured.',
                'warn'
            );
            return;
        }
        const btn = $('pos-license-billing-save-btn');
        if (btn) btn.disabled = true;
        setMsg('Saving payment method…', '');
        try {
            await apiBilling('/setup', {
                method: 'POST',
                body: JSON.stringify({
                    authorized: true,
                    paymentMethodType: 'card',
                    payment_token: card.paymentToken,
                    cardNumber: card.cardNumber,
                    ccExpMonth: card.ccExpMonth,
                    ccExpYear: card.ccExpYear,
                    cvv: card.cvv,
                    cardholderName: card.cardholderName,
                    postalCode: card.postalCode,
                    billingEmail: card.billingEmail,
                    businessName: dashboard?.account?.businessName?.trim()
                })
            });
            setMsg('Payment method saved.', 'ok');
            hostedMount?.reload?.();
            paymentToken = null;
            await loadDashboard();
            if (adminApp?.loadPosLicense) await adminApp.loadPosLicense();
        } catch (err) {
            setMsg(err.message || 'Save failed', 'err');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function payBuildBalance(mode) {
        const bb = dashboard?.buildBalance || {};
        const remaining = Number(bb.remaining) || 0;
        if (remaining <= 0) return;

        const needsCard = !dashboard?.account?.hasBillingVault;
        const card = needsCard ? cardPayloadFromForm() : null;
        if (needsCard && !card) {
            setMsg('Save a card on file or complete the secure card fields above first.', 'err');
            return;
        }

        const confirmed = await confirmBuildBalancePayment(mode);
        if (!confirmed) return;

        const label = mode === 'installment' ? 'Starting installment plan…' : 'Charging build balance…';
        setMsg(label, '');
        try {
            const body = {
                mode,
                installmentMonths: $('principal-build-installment-months')?.value
            };
            if (card) body.card = card;
            const data = await apiBilling('/principal/build-balance', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            dashboard = data;
            const r = data.result || {};
            if (r.dryRun) {
                setMsg(r.message || 'Dry run — no charge processed.', 'ok');
            } else if (r.type === 'installment') {
                setMsg(
                    `Installment plan started: ${money(r.schedule?.monthlyAmount)}/mo for ${r.schedule?.months} months.`,
                    'ok'
                );
            } else {
                setMsg(`Build balance paid: ${money(r.total)}.`, 'ok');
            }
            renderStatement(data);
            renderBuildBalance(data);
            if (adminApp?.loadPosLicense) await adminApp.loadPosLicense();
        } catch (err) {
            setMsg(err.message || 'Payment failed', 'err');
        }
    }

    async function orderModem() {
        if (!selectedSku) {
            setMsg('Select a modem.', 'err');
            return;
        }
        const shipTo = shipToFromForm();
        const shipErr = validateShipTo(shipTo);
        if (shipErr) {
            setMsg(shipErr, 'err');
            return;
        }

        const needsCard = !dashboard?.account?.hasBillingVault;
        const card = needsCard ? cardPayloadFromForm() : null;
        if (needsCard && !card) {
            setMsg('Save a card on file or complete the secure card fields above first.', 'err');
            return;
        }

        const btn = $('principal-hardware-order-btn');
        if (btn) btn.disabled = true;
        setMsg('Placing modem order…', '');
        try {
            const body = { sku: selectedSku, quantity: 1, shipTo };
            if (card) body.card = card;
            const data = await apiBilling('/hardware/purchase', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            if (data.dryRun) {
                setMsg(data.message || 'Dry run — modem order not charged.', 'ok');
            } else {
                setMsg(`Modem order placed. Charged ${money(data.total)}.`, 'ok');
            }
            await loadDashboard();
        } catch (err) {
            setMsg(err.message || 'Order failed', 'err');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function wireEvents() {
        const saveBtn = $('pos-license-billing-save-btn');
        const authorize = $('pos-license-billing-authorize');
        if (saveBtn) {
            saveBtn.textContent = 'Save payment method';
            saveBtn.onclick = () => savePaymentMethod();
        }
        if (authorize) {
            authorize.closest('label')?.style.removeProperty('display');
            authorize.addEventListener('change', () => {
                if (saveBtn) saveBtn.disabled = !authorize.checked;
            });
        }

        $('principal-build-pay-full-btn')?.addEventListener('click', () => payBuildBalance('full'));
        $('principal-build-pay-installment-btn')?.addEventListener('click', () =>
            payBuildBalance('installment')
        );
        $('principal-hardware-order-btn')?.addEventListener('click', () => orderModem());
    }

    async function init(opts) {
        const card = $('pos-license-billing-card');
        if (!card || card.style.display === 'none') return;

        adminApp = opts?.adminApp || window.adminApp || null;
        wireEvents();

        const saveBtn = $('pos-license-billing-save-btn');
        const authorize = $('pos-license-billing-authorize');
        if (saveBtn) saveBtn.disabled = !authorize?.checked;

        try {
            await loadDashboard();
        } catch (err) {
            setMsg(err.message || 'Failed to load billing', 'err');
            renderCardForm(Boolean(opts?.hasVault));
        }
    }

    window.adminPosBilling = { init, reload: loadDashboard };
})();
