/**
 * Admin order fulfillment — Shippo labels, boxes, learn-as-you-go weights.
 */
(function () {
    'use strict';

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function apiRequest(app, path, options = {}) {
        const res = await fetch(`${app.apiBaseUrl}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
                ...(options.headers || {}),
            },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    }

    const OZ_PER_LB = 16;

    function parseWeightInputs(ozInput, lbInput) {
        const oz = ozInput ? parseFloat(ozInput.value) : NaN;
        const lb = lbInput ? parseFloat(lbInput.value) : NaN;
        let total = 0;
        let hasValue = false;
        if (Number.isFinite(oz) && oz > 0) {
            total += oz;
            hasValue = true;
        }
        if (Number.isFinite(lb) && lb > 0) {
            total += lb * OZ_PER_LB;
            hasValue = true;
        }
        return hasValue ? total : null;
    }

    function formatPackageWeightHint(ctx) {
        const pkg = Number(ctx?.estimatedPackageWeightOz);
        if (Number.isFinite(pkg) && pkg > 0) {
            const lb = pkg / OZ_PER_LB;
            const lbPart = lb >= 1 ? ` (${lb.toFixed(2)} lb)` : '';
            return `Auto-calculated: ${pkg} oz total${lbPart} — products + box. Override only if your scale differs.`;
        }
        const content = Number(ctx?.estimatedContentOz);
        if (Number.isFinite(content) && content > 0) {
            return `Products total ${content} oz — add box weight or enter scale weight.`;
        }
        return 'Enter product weights above, or weigh the sealed package on a scale.';
    }

    function weightFieldPairHtml(attrs = '') {
        return `
            <div style="display:flex;align-items:center;gap:0.35rem;flex-shrink:0;" ${attrs}>
                <input type="number" class="form-input hm-weight-lb" style="width:72px;" min="0" step="0.1" placeholder="lb" aria-label="Weight in pounds">
                <span style="font-size:0.8rem;color:var(--gray-500);">lb</span>
                <input type="number" class="form-input hm-weight-oz" style="width:72px;" min="0" step="0.1" placeholder="oz" aria-label="Weight in ounces">
                <span style="font-size:0.8rem;color:var(--gray-500);">oz</span>
            </div>`;
    }

    function collectItemWeights(root) {
        return [...root.querySelectorAll('[data-weight-product-id]')]
            .map((row) => {
                const weightOz = parseWeightInputs(
                    row.querySelector('.hm-weight-oz'),
                    row.querySelector('.hm-weight-lb')
                );
                return {
                    product_id: Number(row.dataset.weightProductId),
                    variant_id: row.dataset.weightVariantId ? Number(row.dataset.weightVariantId) : null,
                    weight_oz: weightOz,
                };
            })
            .filter((w) => Number.isFinite(w.weight_oz) && w.weight_oz > 0);
    }

    function readPackageWeightOz(container) {
        const total = parseWeightInputs(
            container.querySelector('#hm-ship-weight-oz'),
            container.querySelector('#hm-ship-weight-lb')
        );
        return total != null ? total : undefined;
    }

    async function mount(orderId, container, app, modal) {
        container.innerHTML = '<p style="color:var(--gray-500);">Loading shipping tools…</p>';
        try {
            const ctx = await apiRequest(app, `/shipping/orders/${orderId}/fulfillment`);
            render(container, orderId, ctx, app, modal);
            if (modal && typeof app.refreshOrderProgressPanel === 'function') {
                await app.refreshOrderProgressPanel(orderId, modal);
            }
        } catch (e) {
            container.innerHTML = `<p style="color:var(--error,#dc2626);">${esc(e.message)}</p>`;
        }
    }

    function render(container, orderId, ctx, app, modal) {
        const { order, lines, boxes, missingWeights, hasLabel } = ctx;

        if (hasLabel && order.label_url) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        const missingHtml = missingWeights.length
            ? `<div id="hm-ship-missing-weights" style="margin-bottom:1rem;padding:0.75rem;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">
                <strong>New items — enter product weight (lb or oz):</strong>
                <div style="margin-top:0.5rem;display:grid;gap:0.5rem;">
                ${missingWeights.map((l) => `
                    <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.9rem;flex-wrap:wrap;">
                        <span style="flex:1;min-width:140px;">${esc(l.product_name)} × ${l.quantity}</span>
                        ${weightFieldPairHtml(
                            `data-weight-product-id="${l.product_id}"${l.variant_id ? ` data-weight-variant-id="${l.variant_id}"` : ''}`
                        )}
                    </label>`).join('')}
                </div>
                <div style="margin-top:0.75rem;">
                    <button type="button" class="btn btn-secondary btn-sm" id="hm-ship-save-weights-btn"><i class="fas fa-save"></i> Save product weights</button>
                </div>
               </div>`
            : '';

        const boxOptions = (boxes || [])
            .map(
                (b) =>
                    `<option value="${b.id}" ${b.id === ctx.suggestedBoxId ? 'selected' : ''}>${esc(b.name)} (${b.length}×${b.width}×${b.height} in, box ${b.empty_weight_oz}oz)</option>`
            )
            .join('');

        container.innerHTML = `
            <h4 style="margin:0 0 0.75rem;color:var(--gray-800);">Create shipping label</h4>
            ${missingHtml}
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:1rem;">
                <div class="form-group">
                    <label>Predefined box</label>
                    <select class="form-input" id="hm-ship-box">${boxOptions}</select>
                </div>
                <div class="form-group">
                    <label>Package weight <span style="font-weight:400;color:var(--gray-500);">(optional scale override)</span></label>
                    <div style="display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap;">
                        <input type="number" class="form-input" id="hm-ship-weight-lb" style="width:88px;" min="0" step="0.1" placeholder="lb" aria-label="Package weight in pounds">
                        <span style="font-size:0.85rem;color:var(--gray-500);">lb</span>
                        <input type="number" class="form-input" id="hm-ship-weight-oz" style="width:88px;" min="0" step="0.1" placeholder="oz" aria-label="Package weight in ounces">
                        <span style="font-size:0.85rem;color:var(--gray-500);">oz</span>
                    </div>
                    <div style="font-size:0.8rem;color:var(--gray-500);margin-top:0.35rem;">${esc(formatPackageWeightHint(ctx))}</div>
                </div>
            </div>
            <div id="hm-ship-rates" style="margin-bottom:1rem;"></div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                <button type="button" class="btn btn-secondary btn-sm" id="hm-ship-quote-btn"><i class="fas fa-search-dollar"></i> Get carrier rates</button>
                <button type="button" class="btn btn-primary btn-sm" id="hm-ship-label-btn"><i class="fas fa-shipping-fast"></i> Create shipping label</button>
            </div>
            <p style="font-size:0.8rem;color:var(--gray-500);margin-top:0.75rem;">When product weights are in the catalog, package weight is calculated automatically. Use the scale fields only if the real weight differs.</p>
        `;

        if (ctx.estimatedPackageWeightOz) {
            const ozEl = container.querySelector('#hm-ship-weight-oz');
            if (ozEl) ozEl.value = String(ctx.estimatedPackageWeightOz);
        }

        const ratesEl = container.querySelector('#hm-ship-rates');
        let selectedRateId = null;

        container.querySelector('#hm-ship-save-weights-btn')?.addEventListener('click', async () => {
            const itemWeights = collectItemWeights(container);
            const btn = container.querySelector('#hm-ship-save-weights-btn');
            if (!itemWeights.length) {
                app.showNotification('Enter at least one product weight (lb or oz)', 'error');
                return;
            }
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
            }
            try {
                const result = await apiRequest(app, `/shipping/orders/${orderId}/weights`, {
                    method: 'POST',
                    body: JSON.stringify({ itemWeights }),
                });
                app.showNotification(
                    result.saved ? `Saved ${result.saved} product weight${result.saved === 1 ? '' : 's'} to catalog` : 'Product weights saved',
                    'success'
                );
                await mount(orderId, container, app, modal);
            } catch (e) {
                app.showNotification(e.message, 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-save"></i> Save product weights';
                }
            }
        });

        container.querySelector('#hm-ship-quote-btn')?.addEventListener('click', async () => {
            const boxId = container.querySelector('#hm-ship-box')?.value;
            const packageWeightOz = readPackageWeightOz(container);
            const itemWeights = collectItemWeights(container);
            try {
                const quote = await apiRequest(app, `/shipping/orders/${orderId}/rates`, {
                    method: 'POST',
                    body: JSON.stringify({ boxId, packageWeightOz, itemWeights }),
                });
                if (!quote.rates?.length) {
                    ratesEl.innerHTML = `<p style="color:var(--gray-500);">No carrier rates returned. If you need UPS or FedEx, connect those accounts in the <a href="https://goshippo.com/settings/carriers" target="_blank" rel="noopener">Shippo dashboard</a> and confirm ship-from phone is set.</p>`;
                    return;
                }
                const providers = new Set(quote.rates.map((r) => String(r.provider || '').toLowerCase()));
                const missingExpress = ['ups', 'fedex'].filter((c) => !providers.has(c));
                const missingNote = missingExpress.length
                    ? `<p style="font-size:0.82rem;color:#b45309;margin:0 0 0.5rem;">No ${missingExpress.map((c) => c.toUpperCase()).join(' or ')} rates — connect that carrier in Shippo if you plan to ship with them.</p>`
                    : '';
                ratesEl.innerHTML = `
                    ${missingNote}
                    <label style="font-weight:600;display:block;margin-bottom:0.35rem;">Select carrier rate</label>
                    ${quote.rates.map((r, i) => `
                        <label style="display:flex;gap:0.5rem;padding:0.5rem;border:1px solid var(--gray-200);border-radius:6px;margin-bottom:0.35rem;cursor:pointer;">
                            <input type="radio" name="hm_ship_rate" value="${esc(r.shippo_rate_id)}" ${i === 0 ? 'checked' : ''}>
                            <span>${esc(r.label)} — $${Number(r.amount).toFixed(2)}</span>
                        </label>`).join('')}`;
                selectedRateId = quote.rates[0].shippo_rate_id;
                ratesEl.querySelectorAll('input[name="hm_ship_rate"]').forEach((radio) => {
                    radio.addEventListener('change', () => {
                        if (radio.checked) selectedRateId = radio.value;
                    });
                });
            } catch (e) {
                app.showNotification(e.message, 'error');
            }
        });

        container.querySelector('#hm-ship-label-btn')?.addEventListener('click', async () => {
            const boxId = container.querySelector('#hm-ship-box')?.value;
            const packageWeightOz = readPackageWeightOz(container);
            const itemWeights = collectItemWeights(container);
            const btn = container.querySelector('#hm-ship-label-btn');
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Creating label…';
            }
            try {
                await apiRequest(app, `/shipping/orders/${orderId}/label`, {
                    method: 'POST',
                    body: JSON.stringify({
                        rateId: selectedRateId,
                        boxId,
                        packageWeightOz,
                        itemWeights,
                    }),
                });
                app.showNotification('Shipping label created — tracking updates automatically', 'success');
                await mount(orderId, container, app, modal);
                if (typeof app.loadOrders === 'function') await app.loadOrders();
            } catch (e) {
                app.showNotification(e.message, 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-shipping-fast"></i> Create shipping label';
                }
            }
        });
    }

    window.HMShippingFulfillment = { mount };
})();
