/**
 * Product SKU field: barcode scanner wedge, manual entry, and manufacturer SKU lookup.
 */
(function () {
    'use strict';

    function normalizeScanValue(raw) {
        return String(raw || '').trim().replace(/\s+/g, '');
    }

    function generateFallbackSku() {
        return `HM-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    }

    function getBrandIdFromForm(form, prefix) {
        const brandEl = form.querySelector(`#${prefix}-brand`);
        if (brandEl && brandEl.value) return brandEl.value;
        return '';
    }

    async function lookupManufacturerSku(form, prefix, nameOverride) {
        const nameEl = form.querySelector(`#${prefix}-name`);
        const name = String(nameOverride || nameEl?.value || '').trim();
        if (!name) {
            window.adminApp?.showNotification?.('Enter a product name first', 'error');
            nameEl?.focus();
            return null;
        }

        const app = window.adminApp;
        const apiBase = app?.apiBaseUrl || '/api';
        const token = localStorage.getItem('adminToken');
        const brandId = getBrandIdFromForm(form, prefix);
        const params = new URLSearchParams({ name });
        if (brandId) params.set('brand_id', brandId);

        const res = await fetch(`${apiBase}/admin/products/suggest-sku?${params}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = data.message || data.error || 'Manufacturer SKU lookup failed';
            throw new Error(msg);
        }
        return data;
    }

    function enhanceProductForm(form, prefix, modal) {
        const skuInput = form.querySelector(`#${prefix}-sku`);
        if (!skuInput || skuInput.dataset.hmSkuEnhanced === '1') return;
        skuInput.dataset.hmSkuEnhanced = '1';

        skuInput.setAttribute('autocomplete', 'off');
        skuInput.setAttribute('spellcheck', 'false');
        skuInput.placeholder = 'Scan barcode or type SKU';

        const label = form.querySelector(`label[for="${prefix}-sku"]`);
        if (label) {
            label.textContent = 'SKU / Barcode';
        }

        skuInput.removeAttribute('required');

        const wrap = document.createElement('div');
        wrap.className = 'hm-sku-field-wrap';
        wrap.style.display = 'flex';
        wrap.style.gap = '0.5rem';
        wrap.style.flexWrap = 'wrap';
        wrap.style.alignItems = 'stretch';
        skuInput.parentNode.insertBefore(wrap, skuInput);
        wrap.appendChild(skuInput);
        skuInput.style.flex = '1';
        skuInput.style.minWidth = '220px';

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '0.35rem';
        btnRow.style.flexWrap = 'wrap';

        const lookupBtn = document.createElement('button');
        lookupBtn.type = 'button';
        lookupBtn.className = 'btn btn-primary btn-sm';
        lookupBtn.innerHTML = '<i class="fas fa-search" aria-hidden="true"></i> Look up SKU';
        lookupBtn.title = 'Search the manufacturer website for this product and fill in the real SKU';

        const fallbackBtn = document.createElement('button');
        fallbackBtn.type = 'button';
        fallbackBtn.className = 'btn btn-secondary btn-sm';
        fallbackBtn.textContent = 'Custom SKU';
        fallbackBtn.title = 'Generate a temporary HM Herbs SKU if no manufacturer code exists';

        btnRow.appendChild(lookupBtn);
        btnRow.appendChild(fallbackBtn);
        wrap.appendChild(btnRow);

        const statusEl = document.createElement('p');
        statusEl.className = 'hm-sku-lookup-status';
        statusEl.style.fontSize = '0.8rem';
        statusEl.style.color = 'var(--gray-500)';
        statusEl.style.marginTop = '0.35rem';
        statusEl.style.marginBottom = '0';
        statusEl.style.display = 'none';

        const hint = document.createElement('p');
        hint.className = 'hm-sku-scan-hint';
        hint.style.fontSize = '0.8rem';
        hint.style.color = 'var(--gray-500)';
        hint.style.marginTop = '0.35rem';
        hint.style.marginBottom = '0';
        hint.style.lineHeight = '1.45';
        hint.textContent =
            'Click Look up SKU after entering the product name and brand — we search the manufacturer site for the real item number. You can also scan a barcode or type a SKU manually.';
        wrap.parentNode.insertBefore(hint, wrap.nextSibling);
        wrap.parentNode.insertBefore(statusEl, hint.nextSibling);

        lookupBtn.addEventListener('click', async () => {
            const originalHtml = lookupBtn.innerHTML;
            lookupBtn.disabled = true;
            lookupBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Searching…';
            statusEl.style.display = 'block';
            statusEl.textContent = 'Searching manufacturer website for this product…';

            try {
                const result = await lookupManufacturerSku(form, prefix);
                if (!result?.sku) {
                    throw new Error('No SKU returned from lookup');
                }
                skuInput.value = normalizeScanValue(result.sku);
                skuInput.dispatchEvent(new Event('input', { bubbles: true }));

                let status = result.message || 'Manufacturer SKU found.';
                if (result.pdpUrl) {
                    status += ` Source: ${result.pdpUrl}`;
                }
                statusEl.textContent = status;
                statusEl.style.color = 'var(--primary-green)';

                let toast = `SKU ${result.sku} found on manufacturer site`;
                if (result.duplicateWarning) {
                    toast = result.duplicateWarning;
                    window.adminApp?.showNotification?.(toast, 'warning');
                } else {
                    window.adminApp?.showNotification?.(toast, 'success');
                }
                skuInput.focus();
            } catch (err) {
                statusEl.textContent = err.message || 'Lookup failed';
                statusEl.style.color = 'var(--danger, #dc2626)';
                window.adminApp?.showNotification?.(err.message || 'Manufacturer SKU lookup failed', 'error');
            } finally {
                lookupBtn.disabled = false;
                lookupBtn.innerHTML = originalHtml;
            }
        });

        fallbackBtn.addEventListener('click', () => {
            skuInput.value = generateFallbackSku();
            skuInput.dispatchEvent(new Event('input', { bubbles: true }));
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--gray-500)';
            statusEl.textContent = 'Temporary custom SKU generated — replace with manufacturer code when available.';
            window.adminApp?.showNotification?.('Generated temporary custom SKU', 'success');
            skuInput.focus();
        });

        skuInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            e.stopPropagation();
            skuInput.value = normalizeScanValue(skuInput.value);
            if (skuInput.value) {
                window.adminApp?.showNotification?.('Barcode / SKU captured', 'success');
            }
            const nameEl = form.querySelector(`#${prefix}-name`);
            if (nameEl && !nameEl.value.trim()) {
                nameEl.focus();
            }
        });

        skuInput.addEventListener('blur', () => {
            skuInput.value = normalizeScanValue(skuInput.value);
        });

        let wedgeBuffer = '';
        let wedgeTimer = null;

        const onModalKeyDown = (e) => {
            if (!modal.isConnected) return;

            const active = document.activeElement;
            const tag = active?.tagName || '';
            const isOtherField =
                active &&
                active !== skuInput &&
                (tag === 'TEXTAREA' ||
                    (tag === 'INPUT' && !['button', 'submit'].includes(active.type)) ||
                    tag === 'SELECT');

            if (isOtherField) {
                wedgeBuffer = '';
                return;
            }

            if (e.key === 'Enter' && wedgeBuffer.length >= 4) {
                e.preventDefault();
                skuInput.value = normalizeScanValue(wedgeBuffer);
                wedgeBuffer = '';
                skuInput.focus();
                window.adminApp?.showNotification?.('Barcode scanned into SKU', 'success');
                return;
            }

            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                wedgeBuffer += e.key;
                clearTimeout(wedgeTimer);
                wedgeTimer = setTimeout(() => {
                    wedgeBuffer = '';
                }, 150);
            }
        };

        modal.addEventListener('keydown', onModalKeyDown, true);

        const observer = new MutationObserver(() => {
            if (!modal.isConnected) {
                modal.removeEventListener('keydown', onModalKeyDown, true);
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        if (prefix === 'add') {
            setTimeout(() => skuInput.focus(), 120);
        }

        form._hmSkuInput = skuInput;
    }

    function enhanceVariantSkuInput(skuInput, { form, prefix, modal }) {
        if (!skuInput || skuInput.dataset.hmSkuEnhanced === '1') return;
        skuInput.dataset.hmSkuEnhanced = '1';

        skuInput.setAttribute('autocomplete', 'off');
        skuInput.setAttribute('spellcheck', 'false');
        skuInput.placeholder = 'Scan or type SKU';

        const wrap = document.createElement('div');
        wrap.className = 'hm-v-sku-wrap';
        wrap.style.display = 'flex';
        wrap.style.flexDirection = 'column';
        wrap.style.gap = '0.25rem';
        wrap.style.minWidth = '140px';

        const inputRow = document.createElement('div');
        inputRow.style.display = 'flex';
        inputRow.style.gap = '0.25rem';
        inputRow.style.alignItems = 'stretch';

        skuInput.parentNode.insertBefore(wrap, skuInput);
        inputRow.appendChild(skuInput);
        skuInput.style.flex = '1';
        skuInput.style.minWidth = '0';

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '0.2rem';
        btnRow.style.flexShrink = '0';

        const lookupBtn = document.createElement('button');
        lookupBtn.type = 'button';
        lookupBtn.className = 'btn btn-primary btn-sm hm-v-sku-lookup';
        lookupBtn.title = 'Look up manufacturer SKU for this variant';
        lookupBtn.innerHTML = '<i class="fas fa-search" aria-hidden="true"></i>';
        lookupBtn.style.padding = '0.25rem 0.4rem';

        const fallbackBtn = document.createElement('button');
        fallbackBtn.type = 'button';
        fallbackBtn.className = 'btn btn-secondary btn-sm hm-v-sku-custom';
        fallbackBtn.title = 'Generate a custom SKU';
        fallbackBtn.innerHTML = '<i class="fas fa-barcode" aria-hidden="true"></i>';
        fallbackBtn.style.padding = '0.25rem 0.4rem';

        btnRow.appendChild(lookupBtn);
        btnRow.appendChild(fallbackBtn);
        inputRow.appendChild(btnRow);
        wrap.appendChild(inputRow);

        const statusEl = document.createElement('span');
        statusEl.className = 'hm-v-sku-status';
        statusEl.style.fontSize = '0.7rem';
        statusEl.style.color = 'var(--gray-500)';
        statusEl.style.display = 'none';
        statusEl.style.lineHeight = '1.3';
        wrap.appendChild(statusEl);

        const getVariantName = () => {
            const tr = skuInput.closest('tr');
            return tr?.querySelector('.hm-v-name')?.value?.trim() || '';
        };

        lookupBtn.addEventListener('click', async () => {
            const tr = skuInput.closest('tr');
            const variantName = getVariantName();
            const productName = form.querySelector(`#${prefix}-name`)?.value?.trim() || '';
            const lookupName = variantName || productName;
            if (!lookupName) {
                window.adminApp?.showNotification?.('Enter a variant name or product name first', 'error');
                tr?.querySelector('.hm-v-name')?.focus();
                return;
            }

            lookupBtn.disabled = true;
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--gray-500)';
            statusEl.textContent = 'Searching…';

            try {
                const result = await lookupManufacturerSku(form, prefix, lookupName);
                if (!result?.sku) throw new Error('No SKU returned from lookup');
                skuInput.value = normalizeScanValue(result.sku);
                statusEl.style.color = 'var(--primary-green)';
                statusEl.textContent = result.duplicateWarning || 'SKU found';
                window.adminApp?.showNotification?.(
                    result.duplicateWarning || `SKU ${result.sku} found`,
                    result.duplicateWarning ? 'warning' : 'success'
                );
            } catch (err) {
                statusEl.style.color = 'var(--danger, #dc2626)';
                statusEl.textContent = err.message || 'Lookup failed';
                window.adminApp?.showNotification?.(err.message || 'SKU lookup failed', 'error');
            } finally {
                lookupBtn.disabled = false;
            }
        });

        fallbackBtn.addEventListener('click', () => {
            const parentSku =
                form.querySelector(`#${prefix}-sku`)?.value?.trim() ||
                'HM';
            const hint = getVariantName()
                .toUpperCase()
                .replace(/[^A-Z0-9]+/g, '')
                .slice(0, 12) || 'V';
            skuInput.value = normalizeScanValue(`${parentSku}-${hint}-${Math.floor(Math.random() * 100)}`);
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--gray-500)';
            statusEl.textContent = 'Custom SKU generated';
            window.adminApp?.showNotification?.('Generated custom variant SKU', 'success');
            skuInput.focus();
        });

        skuInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            e.stopPropagation();
            skuInput.value = normalizeScanValue(skuInput.value);
            if (skuInput.value) {
                window.adminApp?.showNotification?.('Variant barcode / SKU captured', 'success');
            }
        });

        skuInput.addEventListener('blur', () => {
            skuInput.value = normalizeScanValue(skuInput.value);
        });

        if (modal) {
            let wedgeBuffer = '';
            let wedgeTimer = null;

            const onModalKeyDown = (e) => {
                if (!modal.isConnected || document.activeElement !== skuInput) return;

                if (e.key === 'Enter' && wedgeBuffer.length >= 4) {
                    e.preventDefault();
                    skuInput.value = normalizeScanValue(wedgeBuffer);
                    wedgeBuffer = '';
                    window.adminApp?.showNotification?.('Barcode scanned into variant SKU', 'success');
                    return;
                }

                if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    wedgeBuffer += e.key;
                    clearTimeout(wedgeTimer);
                    wedgeTimer = setTimeout(() => {
                        wedgeBuffer = '';
                    }, 150);
                }
            };

            modal.addEventListener('keydown', onModalKeyDown, true);
            const observer = new MutationObserver(() => {
                if (!modal.isConnected) {
                    modal.removeEventListener('keydown', onModalKeyDown, true);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    window.HMProductSkuField = {
        enhanceProductForm,
        enhanceVariantSkuInput,
        normalizeScanValue,
        lookupManufacturerSku,
    };
})();
