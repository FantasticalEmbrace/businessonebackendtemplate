/**
 * Product variant / matrix editor for admin product modal.
 */
(function () {
    'use strict';

    const QUICK_PRESETS = [
        {
            label: 'Dropper + Pill',
            hint: 'Two forms — customer picks at checkout',
            groups: [{ name: 'Form', values: ['Dropper', 'Pill'] }],
        },
        {
            label: 'Liquid + Pellets',
            hint: 'Newton-style homeopathics',
            groups: [{ name: 'Form', values: ['1oz Liquid', '1oz Pellets'] }],
        },
        {
            label: 'Sizes',
            hint: '1oz, 2oz, 4oz bottles',
            groups: [{ name: 'Size', values: ['1oz', '2oz', '4oz'] }],
        },
        {
            label: 'Form + Size',
            hint: 'Dropper or pill in multiple sizes',
            groups: [
                { name: 'Form', values: ['Dropper', 'Pill'] },
                { name: 'Size', values: ['1oz', '2oz'] },
            ],
        },
    ];

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parseValues(text) {
        return String(text || '')
            .split(/[,;\n]+/)
            .map((v) => v.trim())
            .filter(Boolean);
    }

    function cartesian(groups) {
        if (!groups.length) return [{}];
        const [first, ...rest] = groups;
        const tail = cartesian(rest);
        const combos = [];
        for (const value of first.values) {
            for (const combo of tail) {
                combos.push({ ...combo, [first.name]: value });
            }
        }
        return combos;
    }

    function buildVariantName(attrs, groups) {
        const parts = groups.map((g) => attrs[g.name]).filter(Boolean);
        return parts.length ? parts.join(' — ') : Object.values(attrs).join(' — ');
    }

    function isDeprecatedPlaceholderImageUrl(url) {
        const u = String(url || '').trim();
        if (!u) return true;
        if (u === '/images/products/advanced-blood-pressure-support-id1233-hmherbs-primary.jpg') return true;
        if (u === '/images/products/nature-s-puls-probiotic-mega.jpg') return true;
        return /\/advanced-blood-pressure-support-id\d+-hmherbs-primary\.(jpe?g|webp|png)$/i.test(u);
    }

    function resolveImagePreviewSrc(url) {
        const u = String(url || '').trim();
        if (!u || isDeprecatedPlaceholderImageUrl(u)) return '';
        if (typeof resolveAdminMediaUrl === 'function') return resolveAdminMediaUrl(u);
        return u.startsWith('/') || /^https?:\/\//i.test(u) ? u : u.startsWith('uploads/') ? `/${u}` : u;
    }

    async function uploadVariantImageFile(file) {
        const app = window.adminApp;
        if (!app || !app.authToken) {
            app?.showNotification?.('Please log in to upload images', 'error');
            return null;
        }
        if (!file || !file.type.startsWith('image/')) {
            app.showNotification(`${file?.name || 'File'} is not an image — skipped.`, 'error');
            return null;
        }
        const formData = new FormData();
        formData.append('image', file);
        const response = await fetch(`${app.apiBaseUrl}/admin/products/upload-image`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${app.authToken}` },
            body: formData,
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Upload failed');
        }
        const result = await response.json();
        return result.url || null;
    }

    function updateVariantImagePreview(tr) {
        const urlInput = tr.querySelector('.hm-v-image');
        const previewWrap = tr.querySelector('.hm-v-image-preview-wrap');
        const previewImg = tr.querySelector('.hm-v-image-preview');
        if (!urlInput || !previewWrap || !previewImg) return;

        const src = resolveImagePreviewSrc(urlInput.value);
        if (src) {
            previewImg.src = src;
            previewWrap.style.display = 'flex';
        } else {
            previewImg.removeAttribute('src');
            previewWrap.style.display = 'none';
        }
    }

    function wireVariantImageCell(tr) {
        const urlInput = tr.querySelector('.hm-v-image');
        const fileInput = tr.querySelector('.hm-v-image-file');
        const browseBtn = tr.querySelector('.hm-v-image-browse');
        const clearBtn = tr.querySelector('.hm-v-image-clear');
        if (!urlInput || !fileInput || !browseBtn) return;

        browseBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            fileInput.value = '';
            if (!file) return;

            const originalText = browseBtn.textContent;
            browseBtn.disabled = true;
            browseBtn.textContent = '…';

            try {
                const url = await uploadVariantImageFile(file);
                if (url) {
                    urlInput.value = url;
                    updateVariantImagePreview(tr);
                }
            } catch (err) {
                window.adminApp?.showNotification?.(
                    `Failed to upload ${file.name}: ${err.message || 'Unknown error'}`,
                    'error'
                );
            } finally {
                browseBtn.disabled = false;
                browseBtn.textContent = originalText;
            }
        });

        urlInput.addEventListener('input', () => updateVariantImagePreview(tr));
        urlInput.addEventListener('change', () => updateVariantImagePreview(tr));

        clearBtn?.addEventListener('click', () => {
            urlInput.value = '';
            updateVariantImagePreview(tr);
        });

        previewImgOnError(tr);
        updateVariantImagePreview(tr);
    }

    function previewImgOnError(tr) {
        const previewImg = tr.querySelector('.hm-v-image-preview');
        if (!previewImg || previewImg.dataset.hmErrorBound) return;
        previewImg.dataset.hmErrorBound = '1';
        previewImg.addEventListener('error', () => {
            const previewWrap = tr.querySelector('.hm-v-image-preview-wrap');
            if (previewWrap) previewWrap.style.display = 'none';
        });
    }

    function mountVariantEditor(form, prefix) {
        const section = document.createElement('div');
        section.className = 'hm-variant-editor-section';
        section.style.marginBottom = '2.5rem';
        section.style.paddingBottom = '2rem';
        section.style.borderBottom = '1px solid var(--gray-200)';

        section.innerHTML = `
            <h3 style="font-size:1.1rem;font-weight:600;color:var(--primary-green);margin-bottom:0.35rem;">Product variants</h3>
            <p style="font-size:0.85rem;color:var(--gray-500);margin-bottom:1rem;line-height:1.45;">
                Use variants when a product comes in different forms (dropper vs pill), sizes, or packs.
                Shoppers pick one option on the product page before adding to cart.
            </p>
            <div style="margin-bottom:1.25rem;padding:0.85rem 1rem;background:var(--gray-50);border-radius:8px;border:1px solid var(--gray-200);">
                <div style="font-weight:600;font-size:0.8rem;color:var(--gray-600);margin-bottom:0.5rem;">Quick start</div>
                <div id="${prefix}-variant-presets" style="display:flex;flex-wrap:wrap;gap:0.5rem;"></div>
            </div>
            <div class="hm-variant-groups-wrap" id="${prefix}-variant-groups-wrap">
                <label style="display:block;font-weight:500;margin-bottom:0.5rem;font-size:0.875rem;">Option groups</label>
                <p style="font-size:0.8rem;color:var(--gray-500);margin:0 0 0.75rem;">Example: group <strong>Form</strong> with values <strong>Dropper, Pill</strong></p>
                <div id="${prefix}-variant-groups"></div>
                <button type="button" class="btn btn-secondary btn-sm" id="${prefix}-add-option-group" style="margin-top:0.5rem;">
                    <i class="fas fa-plus"></i> Add option group
                </button>
            </div>
            <div style="margin:1.25rem 0;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
                <button type="button" class="btn btn-primary btn-sm" id="${prefix}-generate-matrix">
                    <i class="fas fa-th"></i> Build variants from groups
                </button>
                <button type="button" class="btn btn-secondary btn-sm" id="${prefix}-add-variant-row">
                    <i class="fas fa-plus"></i> Add variant manually
                </button>
                <span id="${prefix}-variant-count" style="font-size:0.8rem;color:var(--gray-500);margin-left:0.25rem;"></span>
            </div>
            <div style="overflow-x:auto;">
                <table class="hm-variant-table" id="${prefix}-variant-table" style="width:100%;border-collapse:collapse;font-size:0.875rem;">
                    <thead>
                        <tr style="background:var(--gray-50);text-align:left;">
                            <th style="padding:0.5rem;border-bottom:1px solid var(--gray-200);">What shopper sees</th>
                            <th style="padding:0.5rem;border-bottom:1px solid var(--gray-200);">SKU / Barcode</th>
                            <th style="padding:0.5rem;border-bottom:1px solid var(--gray-200);">Price</th>
                            <th style="padding:0.5rem;border-bottom:1px solid var(--gray-200);">Cost</th>
                            <th style="padding:0.5rem;border-bottom:1px solid var(--gray-200);min-width:220px;">Variant photo</th>
                            <th style="padding:0.5rem;border-bottom:1px solid var(--gray-200);">Stock</th>
                            <th style="padding:0.5rem;border-bottom:1px solid var(--gray-200);"></th>
                        </tr>
                    </thead>
                    <tbody id="${prefix}-variant-rows"></tbody>
                </table>
            </div>
            <p style="font-size:0.75rem;color:var(--gray-400);margin-top:0.75rem;">
                Tip: set each variant's price, cost, and stock separately. Upload or paste a photo per variant — shoppers see it when they pick that option. Scan a barcode into SKU / Barcode, use Look up SKU, or leave blank to auto-generate on save (spaces in scanned codes are removed automatically).
            </p>
        `;

        if (!document.getElementById('hm-variant-image-styles')) {
            const variantImageStyles = document.createElement('style');
            variantImageStyles.id = 'hm-variant-image-styles';
            variantImageStyles.textContent = `
                .hm-v-image-cell { display: flex; flex-direction: column; gap: 0.35rem; min-width: 200px; }
                .hm-v-image-preview-wrap {
                    display: none;
                    align-items: center;
                    gap: 0.35rem;
                }
                .hm-v-image-preview {
                    width: 48px;
                    height: 48px;
                    object-fit: cover;
                    border-radius: 6px;
                    border: 1px solid var(--gray-200);
                    background: var(--gray-50);
                }
                .hm-v-image-input-row { display: flex; gap: 0.25rem; align-items: stretch; }
                .hm-v-image-input-row .hm-v-image { flex: 1; min-width: 0; font-size: 0.8rem; }
                .hm-v-image-browse { white-space: nowrap; padding-left: 0.5rem; padding-right: 0.5rem; }
                .hm-v-image-clear {
                    border: none;
                    background: transparent;
                    color: var(--gray-400);
                    cursor: pointer;
                    font-size: 1.1rem;
                    line-height: 1;
                    padding: 0 0.15rem;
                }
                .hm-v-image-clear:hover { color: var(--danger, #dc2626); }
            `;
            document.head.appendChild(variantImageStyles);
        }

        const insertBefore = form.querySelector('.form-actions');
        if (insertBefore) {
            form.insertBefore(section, insertBefore);
        } else {
            form.appendChild(section);
        }

        const groupsEl = section.querySelector(`#${prefix}-variant-groups`);
        const rowsEl = section.querySelector(`#${prefix}-variant-rows`);
        const countEl = section.querySelector(`#${prefix}-variant-count`);
        const presetsEl = section.querySelector(`#${prefix}-variant-presets`);
        const modal = form.closest('.modal') || document.body;

        function normalizeVariantSku(raw) {
            if (window.HMProductSkuField?.normalizeScanValue) {
                return window.HMProductSkuField.normalizeScanValue(raw);
            }
            return String(raw || '').trim().replace(/\s+/g, '');
        }

        function wireVariantSkuField(tr) {
            const skuInput = tr.querySelector('.hm-v-sku');
            if (!skuInput || skuInput.dataset.hmSkuWired === '1') return;
            skuInput.dataset.hmSkuWired = '1';
            if (window.HMProductSkuField?.enhanceVariantSkuInput) {
                window.HMProductSkuField.enhanceVariantSkuInput(skuInput, { form, prefix, modal });
            } else {
                skuInput.placeholder = 'Scan or type SKU';
                skuInput.addEventListener('blur', () => {
                    skuInput.value = normalizeVariantSku(skuInput.value);
                });
            }
        }

        function updateVariantCount() {
            const n = rowsEl.querySelectorAll('tr').length;
            if (countEl) {
                countEl.textContent = n ? `${n} variant${n === 1 ? '' : 's'}` : 'No variants yet';
            }
        }

        function addOptionGroup(name = '', values = '') {
            const row = document.createElement('div');
            row.className = 'hm-variant-group-row';
            row.style.display = 'flex';
            row.style.gap = '0.5rem';
            row.style.marginBottom = '0.5rem';
            row.style.alignItems = 'center';
            row.innerHTML = `
                <input type="text" class="form-input hm-group-name" placeholder="Group name (e.g. Form)" value="${escapeHtml(name)}" style="flex:1;min-width:120px;">
                <input type="text" class="form-input hm-group-values" placeholder="Dropper, Pill" value="${escapeHtml(values)}" style="flex:2;min-width:180px;">
                <button type="button" class="btn btn-danger btn-sm hm-remove-group" title="Remove group">&times;</button>
            `;
            row.querySelector('.hm-remove-group').addEventListener('click', () => row.remove());
            groupsEl.appendChild(row);
        }

        function addVariantRow(data = {}) {
            const tr = document.createElement('tr');
            if (data.id != null && data.id !== '') {
                tr.dataset.variantId = String(data.id);
            }
            if (data.attributesJson) {
                tr.dataset.attributesJson = data.attributesJson;
            }
            tr.innerHTML = `
                <td style="padding:0.35rem;"><input type="text" class="form-input hm-v-name" value="${escapeHtml(data.name || '')}" placeholder="Dropper — 1oz" style="width:100%;min-width:160px;"></td>
                <td style="padding:0.35rem;"><input type="text" class="form-input hm-v-sku" value="${escapeHtml(data.sku || '')}" placeholder="Scan or type SKU" style="width:100%;min-width:100px;"></td>
                <td style="padding:0.35rem;"><input type="number" class="form-input hm-v-price" step="0.01" min="0" value="${data.price != null ? escapeHtml(data.price) : ''}" style="width:90px;"></td>
                <td style="padding:0.35rem;"><input type="number" class="form-input hm-v-cost" step="0.01" min="0" value="${data.cost_price != null && data.cost_price !== '' ? escapeHtml(data.cost_price) : ''}" placeholder="Optional" style="width:90px;"></td>
                <td style="padding:0.35rem;">
                    <div class="hm-v-image-cell">
                        <div class="hm-v-image-preview-wrap">
                            <img class="hm-v-image-preview" alt="" />
                            <button type="button" class="hm-v-image-clear" title="Remove variant photo">&times;</button>
                        </div>
                        <div class="hm-v-image-input-row">
                            <input type="text" class="form-input hm-v-image" value="${escapeHtml(
                                data.image_url && !isDeprecatedPlaceholderImageUrl(data.image_url) ? data.image_url : ''
                            )}" placeholder="URL or upload" />
                            <input type="file" class="hm-v-image-file" accept="image/*" hidden />
                            <button type="button" class="btn btn-secondary btn-sm hm-v-image-browse">Browse</button>
                        </div>
                    </div>
                </td>
                <td style="padding:0.35rem;"><input type="number" class="form-input hm-v-inventory" min="0" value="${data.inventory_quantity != null ? escapeHtml(data.inventory_quantity) : '100'}" style="width:70px;"></td>
                <td style="padding:0.35rem;"><button type="button" class="btn btn-danger btn-sm hm-remove-variant" title="Remove variant">&times;</button></td>
            `;
            tr.querySelector('.hm-remove-variant').addEventListener('click', () => {
                tr.remove();
                updateVariantCount();
            });
            wireVariantImageCell(tr);
            wireVariantSkuField(tr);
            rowsEl.appendChild(tr);
            updateVariantCount();
        }

        function readOptionGroups() {
            return [...groupsEl.querySelectorAll('.hm-variant-group-row')].map((row) => {
                const name = row.querySelector('.hm-group-name').value.trim();
                const values = parseValues(row.querySelector('.hm-group-values').value);
                return name && values.length ? { name, values } : null;
            }).filter(Boolean);
        }

        function generateMatrixFromGroups() {
            const groups = readOptionGroups();
            if (!groups.length) {
                window.adminApp?.showNotification?.('Add an option group first (e.g. Form: Dropper, Pill).', 'error');
                return;
            }
            const basePriceEl = form.querySelector(`#${prefix}-price`);
            const baseCostEl = form.querySelector(`#${prefix}-cost-price`);
            const basePrice = basePriceEl ? parseFloat(basePriceEl.value) : NaN;
            const baseCost = baseCostEl ? parseFloat(baseCostEl.value) : NaN;
            const combos = cartesian(groups);
            rowsEl.innerHTML = '';
            combos.forEach((attrs) => {
                addVariantRow({
                    name: buildVariantName(attrs, groups),
                    price: Number.isFinite(basePrice) ? basePrice : '',
                    cost_price: Number.isFinite(baseCost) ? baseCost : '',
                    inventory_quantity: 100,
                    attributesJson: JSON.stringify(attrs),
                });
            });
        }

        function applyPreset(preset) {
            groupsEl.innerHTML = '';
            preset.groups.forEach((g) => addOptionGroup(g.name, g.values.join(', ')));
            generateMatrixFromGroups();
            window.adminApp?.showNotification?.(`Added ${preset.label} template — set price, cost, and stock for each row, then save.`, 'success');
        }

        QUICK_PRESETS.forEach((preset) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-secondary btn-sm';
            btn.title = preset.hint;
            btn.textContent = preset.label;
            btn.addEventListener('click', () => applyPreset(preset));
            presetsEl.appendChild(btn);
        });

        section.querySelector(`#${prefix}-add-option-group`).addEventListener('click', () => addOptionGroup());
        section.querySelector(`#${prefix}-add-variant-row`).addEventListener('click', () => addVariantRow());
        section.querySelector(`#${prefix}-generate-matrix`).addEventListener('click', generateMatrixFromGroups);

        form._hmVariantEditor = {
            prefix,
            addOptionGroup,
            addVariantRow,
            readOptionGroups,
            clear() {
                groupsEl.innerHTML = '';
                rowsEl.innerHTML = '';
                updateVariantCount();
            },
            load(product) {
                this.clear();
                const groups = product.variant_option_groups || [];
                if (groups.length) {
                    groups.forEach((g) => addOptionGroup(g.name || '', (g.values || []).join(', ')));
                }
                const variants = product.variants || [];
                variants.forEach((v) => {
                    addVariantRow({
                        id: v.id,
                        name: v.name,
                        sku: v.sku,
                        price: v.price,
                        cost_price: v.cost_price,
                        image_url: v.image_url,
                        inventory_quantity: v.inventory_quantity,
                        attributesJson: v.attributes ? JSON.stringify(v.attributes) : '',
                    });
                });
            },
            getPayload() {
                const variant_option_groups = readOptionGroups();
                const variants = [...rowsEl.querySelectorAll('tr')].map((tr, idx) => {
                    const name = tr.querySelector('.hm-v-name').value.trim();
                    if (!name) return null;
                    const idRaw = tr.dataset.variantId;
                    const id = idRaw ? parseInt(idRaw, 10) : undefined;
                    const skuRaw = tr.querySelector('.hm-v-sku').value.trim();
                    const sku = normalizeVariantSku(skuRaw);
                    const price = parseFloat(tr.querySelector('.hm-v-price').value);
                    const costRaw = tr.querySelector('.hm-v-cost').value.trim();
                    const cost_price = costRaw === '' ? null : parseFloat(costRaw);
                    const imageRaw = tr.querySelector('.hm-v-image').value.trim();
                    const image_url = imageRaw && !isDeprecatedPlaceholderImageUrl(imageRaw) ? imageRaw : null;
                    const inventory_quantity = parseInt(tr.querySelector('.hm-v-inventory').value, 10) || 0;
                    let attributes = null;
                    const attrsRaw = tr.dataset.attributesJson || '';
                    if (attrsRaw) {
                        try {
                            attributes = JSON.parse(attrsRaw);
                        } catch {
                            attributes = null;
                        }
                    }
                    if (!attributes && variant_option_groups.length === 1) {
                        const group = variant_option_groups[0];
                        const match = (group.values || []).find((value) =>
                            name.toLowerCase().includes(String(value).toLowerCase())
                        );
                        if (match) {
                            attributes = { [group.name]: match };
                        }
                    }
                    return {
                        ...(Number.isFinite(id) ? { id } : {}),
                        name,
                        sku: sku || undefined,
                        price,
                        cost_price: Number.isFinite(cost_price) ? cost_price : null,
                        image_url,
                        inventory_quantity,
                        sort_order: idx,
                        attributes,
                    };
                }).filter((v) => v && Number.isFinite(v.price));

                return {
                    variant_option_groups: variant_option_groups.length ? variant_option_groups : null,
                    variants,
                };
            },
        };

        updateVariantCount();
        return form._hmVariantEditor;
    }

    function attachVariantPayload(productData, formElement) {
        if (formElement && formElement._hmVariantEditor) {
            const payload = formElement._hmVariantEditor.getPayload();
            productData.variant_option_groups = payload.variant_option_groups;
            productData.variants = payload.variants;
        }
    }

    window.HMProductVariantsEditor = {
        mountVariantEditor,
        attachVariantPayload,
    };
})();
