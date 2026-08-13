'use strict';

(function () {
    const CODE39_PATTERNS = {
        '*': 'nwwnnwnwn',
        '0': 'nnnwwnwnn',
        '1': 'wnnnnwnnw',
        '2': 'nnwnnwnnw',
        '3': 'wnwnnwnnn',
        '4': 'nnnnwwnnw',
        '5': 'wnnnwwnnn',
        '6': 'nnwnwwnnn',
        '7': 'nnnnnwwnw',
        '8': 'wnnnnwwnn',
        '9': 'nnwnnwwnn',
        A: 'wnnnnnnww',
        B: 'nnwnnnnww',
        C: 'wnwnnnnwn',
        D: 'nnnnwnnww',
        E: 'wnnnwnnwn',
        F: 'nnwnwnnwn',
        G: 'nnnnnnwww',
        H: 'wnnnnnwwn',
        I: 'nnwnnnwwn',
        J: 'wnwnnnwwn',
        K: 'nnnnwnwnw',
        L: 'wnnnwnwnn',
        M: 'nnwnwnwnn',
        N: 'nnnnnnnww',
        O: 'wnnnnnwnw',
        P: 'nnwnnnwnw',
        Q: 'wnwnnnwnn',
        R: 'nnnnwnwnn',
        S: 'wnnnwnwnn',
        T: 'nnwnwnwnn',
        U: 'wnnnnnnnw',
        V: 'nnwnnnnnw',
        W: 'wnwnnnnnn',
        X: 'nnnnwnnnw',
        Y: 'wnnnwnnnn',
        Z: 'nnwnwnnnn',
        '-': 'nnnnwnnwn'
    };

    const AdminVendors = {
        vendors: [],
        orders: [],
        detailOrder: null,
        _editVendor: null,
        _bound: false,
        _linesReady: false,

        init() {
            if (!this._bound) {
                this.bindEvents();
                this._bound = true;
            }
            void this.refresh();
        },

        bindEvents() {
            document.getElementById('vendors-add-btn')?.addEventListener('click', () => this.openVendorModal());
            document.getElementById('vendors-edit-close-btn')?.addEventListener('click', () => this.closeVendorModal());
            document.getElementById('vendors-edit-cancel-btn')?.addEventListener('click', () => this.closeVendorModal());
            document.getElementById('vendors-edit-form')?.addEventListener('submit', (e) => {
                e.preventDefault();
                void this.saveVendor();
            });
            document.getElementById('vendors-edit-catalog-auth')?.addEventListener('change', () => this.syncAuthFields());

            document.getElementById('vendors-edit-modal')?.addEventListener('click', (e) => {
                if (e.target.id === 'vendors-edit-modal') this.closeVendorModal();
            });

            document.getElementById('vendors-add-line-btn')?.addEventListener('click', () => this.addLineRow());
            document.getElementById('vendors-import-csv-btn')?.addEventListener('click', () => void this.importCsv());
            document.getElementById('vendors-save-draft-btn')?.addEventListener('click', () => void this.saveOrder('draft'));
            document.getElementById('vendors-save-open-btn')?.addEventListener('click', () => void this.saveOrder('open'));
            document.getElementById('vendors-refresh-orders-btn')?.addEventListener('click', () => void this.loadOrders());
            document.getElementById('vendors-status-filter')?.addEventListener('change', () => void this.loadOrders());

            document.getElementById('vendors-po-detail-close-btn')?.addEventListener('click', () => this.hidePoDetail());
            document.getElementById('vendors-po-detail-modal')?.addEventListener('click', (e) => {
                if (e.target.id === 'vendors-po-detail-modal') this.hidePoDetail();
            });
            document.getElementById('vendors-po-detail-open-btn')?.addEventListener('click', () => void this.openCurrentOrder());
            document.getElementById('vendors-po-detail-print-btn')?.addEventListener('click', () => this.printSlipBarcode());
        },

        app() {
            return window.adminApp;
        },

        toast(msg, type = 'info') {
            if (this.app()?.showToast) {
                this.app().showToast(msg, type);
            }
        },

        escape(value) {
            return this.app()?.escapeHtml
                ? this.app().escapeHtml(value)
                : String(value ?? '')
                      .replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;');
        },

        async apiVendors(path, options = {}) {
            return this.app().apiRequest('/admin/vendors' + path, options);
        },

        async apiReceiving(path, options = {}) {
            return this.app().apiRequest('/admin/vendor-receiving' + path, options);
        },

        showModal(el) {
            if (!el) return;
            el.classList.remove('hidden');
            el.style.display = 'flex';
        },

        hideModal(el) {
            if (!el) return;
            el.classList.add('hidden');
            el.style.display = 'none';
        },

        async refresh() {
            if (!this._linesReady) {
                this.addLineRow();
                this._linesReady = true;
            }
            await Promise.all([this.loadVendorDirectory(), this.loadReceivingVendors(), this.loadOrders()]);
        },

        paymentTermsLabel(value) {
            const map = {
                net_15: 'Net 15',
                net_30: 'Net 30',
                net_45: 'Net 45',
                net_60: 'Net 60',
                cod: 'COD',
                prepaid: 'Prepaid'
            };
            return map[String(value || '')] || String(value || '—');
        },

        syncAuthFields() {
            const auth = document.getElementById('vendors-edit-catalog-auth')?.value || 'none';
            document.getElementById('vendors-auth-basic-fields')?.classList.toggle('hidden', auth !== 'basic');
            document.getElementById('vendors-auth-token-field')?.classList.toggle('hidden', auth !== 'bearer');
            document.getElementById('vendors-auth-api-key-field')?.classList.toggle('hidden', auth !== 'api_key');
            const tokenLabel = document.getElementById('vendors-edit-auth-token-label');
            if (tokenLabel) tokenLabel.textContent = auth === 'bearer' ? 'Bearer token' : 'Token';
        },

        parseStoredCredentials(vendor) {
            const raw = vendor?.catalog_auth_credentials;
            if (!raw) return null;
            if (typeof raw === 'object') return raw;
            try {
                return JSON.parse(raw);
            } catch {
                return null;
            }
        },

        readAuthCredentials(authType, existing = null) {
            if (authType === 'basic') {
                const username = document.getElementById('vendors-edit-auth-username')?.value?.trim();
                const password = document.getElementById('vendors-edit-auth-password')?.value || '';
                if (!username && !password) return existing && authType === (existing._authType || authType) ? existing : null;
                return {
                    username: username || existing?.username || '',
                    password: password || existing?.password || ''
                };
            }
            if (authType === 'bearer') {
                const token = document.getElementById('vendors-edit-auth-token')?.value?.trim();
                if (!token) return existing?.token ? { token: existing.token } : null;
                return { token };
            }
            if (authType === 'api_key') {
                const api_key = document.getElementById('vendors-edit-auth-api-key')?.value?.trim();
                const header_name =
                    document.getElementById('vendors-edit-auth-header-name')?.value?.trim() ||
                    existing?.header_name ||
                    'X-API-Key';
                if (!api_key) {
                    return existing?.api_key ? { api_key: existing.api_key, header_name } : null;
                }
                return { api_key, header_name };
            }
            return null;
        },

        fillAuthCredentials(vendor) {
            const creds = this.parseStoredCredentials(vendor) || {};
            document.getElementById('vendors-edit-auth-username').value = creds.username || '';
            document.getElementById('vendors-edit-auth-password').value = '';
            document.getElementById('vendors-edit-auth-token').value = '';
            document.getElementById('vendors-edit-auth-api-key').value = '';
            document.getElementById('vendors-edit-auth-header-name').value = creds.header_name || 'X-API-Key';
        },

        collectVendorPayload() {
            const authType = document.getElementById('vendors-edit-catalog-auth')?.value || 'none';
            const existingCreds = this.parseStoredCredentials(this._editVendor);
            const payload = {
                name: document.getElementById('vendors-edit-name')?.value?.trim(),
                company_name: document.getElementById('vendors-edit-company')?.value?.trim() || null,
                account_number: document.getElementById('vendors-edit-account-number')?.value?.trim() || null,
                status: document.getElementById('vendors-edit-status')?.value || 'pending',
                contact_person: document.getElementById('vendors-edit-contact')?.value?.trim() || null,
                email: document.getElementById('vendors-edit-email')?.value?.trim() || null,
                phone: document.getElementById('vendors-edit-phone')?.value?.trim() || null,
                fax: document.getElementById('vendors-edit-fax')?.value?.trim() || null,
                website: document.getElementById('vendors-edit-website')?.value?.trim() || null,
                address_line1: document.getElementById('vendors-edit-address1')?.value?.trim() || null,
                address_line2: document.getElementById('vendors-edit-address2')?.value?.trim() || null,
                city: document.getElementById('vendors-edit-city')?.value?.trim() || null,
                state: document.getElementById('vendors-edit-state')?.value?.trim() || null,
                postal_code: document.getElementById('vendors-edit-postal')?.value?.trim() || null,
                country: document.getElementById('vendors-edit-country')?.value?.trim() || 'United States',
                tax_id: document.getElementById('vendors-edit-tax-id')?.value?.trim() || null,
                business_license: document.getElementById('vendors-edit-business-license')?.value?.trim() || null,
                payment_terms: document.getElementById('vendors-edit-payment-terms')?.value || 'net_30',
                currency: document.getElementById('vendors-edit-currency')?.value || 'USD',
                catalog_url: document.getElementById('vendors-edit-catalog-url')?.value?.trim() || null,
                catalog_format: document.getElementById('vendors-edit-catalog-format')?.value || 'csv',
                catalog_auth_type: authType,
                sync_frequency: document.getElementById('vendors-edit-sync-frequency')?.value || 'daily',
                auto_sync_enabled: Boolean(document.getElementById('vendors-edit-auto-sync')?.checked),
                pos_ordering_enabled: Boolean(document.getElementById('vendors-edit-pos-ordering')?.checked),
                notes: document.getElementById('vendors-edit-notes')?.value?.trim() || null
            };
            if (authType === 'none') {
                payload.catalog_auth_credentials = null;
            } else {
                const creds = this.readAuthCredentials(authType, existingCreds);
                if (creds) payload.catalog_auth_credentials = creds;
            }
            return payload;
        },

        async loadVendorDirectory() {
            const container = document.getElementById('vendors-directory-table');
            if (!container) return;
            if (!this.app()?.authToken) {
                container.innerHTML = '<p style="color:var(--gray-500);">Please log in to view vendors.</p>';
                return;
            }
            container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading vendors...</div>';
            try {
                const data = await this.apiVendors('?limit=200');
                const rows = data?.vendors || [];
                this.vendors = rows;
                if (!rows.length) {
                    container.innerHTML = '<p style="color:var(--gray-500);">No vendors yet. Click Add vendor to create one.</p>';
                    return;
                }
                const canDelete = this.app()?.isFullAdmin;
                container.innerHTML = `
                    <div class="table-container">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Company</th>
                                    <th>Account #</th>
                                    <th>Contact</th>
                                    <th>Terms</th>
                                    <th>Status</th>
                                    <th>Catalog</th>
                                    <th>POS</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows
                                    .map(
                                        (v) => `<tr>
                                    <td>${this.escape(v.name)}</td>
                                    <td>${this.escape(v.company_name || '—')}</td>
                                    <td>${this.escape(v.account_number || '—')}</td>
                                    <td>${this.escape(v.contact_person || v.email || '—')}</td>
                                    <td>${this.escape(this.paymentTermsLabel(v.payment_terms))}</td>
                                    <td>${this.statusBadge(v.status || 'pending')}</td>
                                    <td>${v.catalog_url ? '<span class="badge badge-success">Linked</span>' : '<span class="badge badge-info">None</span>'}</td>
                                    <td>${v.pos_ordering_enabled !== 0 && v.pos_ordering_enabled !== false ? '<span class="badge badge-success">Enabled</span>' : '<span class="badge badge-info">Off</span>'}</td>
                                    <td>
                                        <button type="button" class="btn btn-sm btn-secondary vendors-edit-btn" data-vendor-id="${v.id}"><i class="fas fa-edit"></i></button>
                                        ${
                                            canDelete
                                                ? `<button type="button" class="btn btn-sm btn-danger vendors-delete-btn" data-vendor-id="${v.id}" style="margin-left:0.35rem;"><i class="fas fa-trash"></i></button>`
                                                : ''
                                        }
                                    </td>
                                </tr>`
                                    )
                                    .join('')}
                            </tbody>
                        </table>
                    </div>`;
                container.querySelectorAll('.vendors-edit-btn').forEach((btn) => {
                    btn.addEventListener('click', () => void this.editVendor(Number(btn.dataset.vendorId)));
                });
                container.querySelectorAll('.vendors-delete-btn').forEach((btn) => {
                    btn.addEventListener('click', () => void this.deleteVendor(Number(btn.dataset.vendorId)));
                });
            } catch (err) {
                container.innerHTML = `<p style="color:var(--error);">${this.escape(err.message || 'Failed to load vendors')}</p>`;
            }
        },

        statusBadge(status) {
            const s = String(status || 'pending').toLowerCase();
            const cls =
                s === 'active'
                    ? 'badge-success'
                    : s === 'inactive' || s === 'deleted'
                      ? 'badge-danger'
                      : 'badge-info';
            return `<span class="badge ${cls}">${this.escape(s)}</span>`;
        },

        poStatusBadge(status) {
            const s = String(status || 'draft');
            return `<span class="vendors-po-badge vendors-po-badge-${this.escape(s)}">${this.escape(s)}</span>`;
        },

        async loadReceivingVendors() {
            try {
                const data = await this.apiReceiving('/vendors');
                const list = data?.vendors || this.vendors || [];
                this.populateVendorSelects(list);
            } catch {
                this.populateVendorSelects(this.vendors || []);
            }
        },

        populateVendorSelects(list) {
            const options =
                '<option value="">Select vendor…</option>' +
                list.map((v) => `<option value="${v.id}">${this.escape(v.name)}</option>`).join('');
            const empty = '<option value="">No vendors — add one above</option>';
            const poSelect = document.getElementById('vendors-po-vendor');
            const html = list.length ? options : empty;
            if (poSelect) poSelect.innerHTML = html;
        },

        openVendorModal(vendor = null) {
            this._editVendor = vendor;
            const modal = document.getElementById('vendors-edit-modal');
            const title = document.getElementById('vendors-edit-title');
            if (title) title.textContent = vendor ? 'Edit vendor' : 'Add vendor';
            document.getElementById('vendors-edit-id').value = vendor?.id || '';
            document.getElementById('vendors-edit-name').value = vendor?.name || '';
            document.getElementById('vendors-edit-company').value = vendor?.company_name || '';
            document.getElementById('vendors-edit-account-number').value = vendor?.account_number || '';
            document.getElementById('vendors-edit-status').value = vendor?.status || 'active';
            document.getElementById('vendors-edit-contact').value = vendor?.contact_person || '';
            document.getElementById('vendors-edit-email').value = vendor?.email || '';
            document.getElementById('vendors-edit-phone').value = vendor?.phone || '';
            document.getElementById('vendors-edit-fax').value = vendor?.fax || '';
            document.getElementById('vendors-edit-website').value = vendor?.website || '';
            document.getElementById('vendors-edit-address1').value = vendor?.address_line1 || '';
            document.getElementById('vendors-edit-address2').value = vendor?.address_line2 || '';
            document.getElementById('vendors-edit-city').value = vendor?.city || '';
            document.getElementById('vendors-edit-state').value = vendor?.state || '';
            document.getElementById('vendors-edit-postal').value = vendor?.postal_code || '';
            document.getElementById('vendors-edit-country').value = vendor?.country || 'United States';
            document.getElementById('vendors-edit-tax-id').value = vendor?.tax_id || '';
            document.getElementById('vendors-edit-business-license').value = vendor?.business_license || '';
            document.getElementById('vendors-edit-payment-terms').value = vendor?.payment_terms || 'net_30';
            document.getElementById('vendors-edit-currency').value = vendor?.currency || 'USD';
            document.getElementById('vendors-edit-catalog-url').value = vendor?.catalog_url || '';
            document.getElementById('vendors-edit-catalog-format').value = vendor?.catalog_format || 'csv';
            document.getElementById('vendors-edit-catalog-auth').value = vendor?.catalog_auth_type || 'none';
            document.getElementById('vendors-edit-sync-frequency').value = vendor?.sync_frequency || 'daily';
            document.getElementById('vendors-edit-auto-sync').checked = Boolean(vendor?.auto_sync_enabled);
            document.getElementById('vendors-edit-pos-ordering').checked =
                vendor == null ? true : vendor.pos_ordering_enabled !== 0 && vendor.pos_ordering_enabled !== false;
            document.getElementById('vendors-edit-notes').value = vendor?.notes || '';
            document.getElementById('vendors-edit-auth-username').value = '';
            document.getElementById('vendors-edit-auth-password').value = '';
            document.getElementById('vendors-edit-auth-token').value = '';
            document.getElementById('vendors-edit-auth-api-key').value = '';
            document.getElementById('vendors-edit-auth-header-name').value = 'X-API-Key';
            if (vendor) this.fillAuthCredentials(vendor);
            this.syncAuthFields();
            this.showModal(modal);
        },

        closeVendorModal() {
            this._editVendor = null;
            this.hideModal(document.getElementById('vendors-edit-modal'));
        },

        async editVendor(vendorId) {
            try {
                const data = await this.apiVendors(`/${vendorId}`);
                if (data?.vendor) this.openVendorModal(data.vendor);
            } catch (err) {
                this.toast(err.message || 'Could not load vendor', 'error');
            }
        },

        async saveVendor() {
            const id = document.getElementById('vendors-edit-id')?.value?.trim();
            const payload = this.collectVendorPayload();
            if (!payload.name) {
                this.toast('Vendor name is required', 'warning');
                return;
            }
            try {
                if (id) {
                    await this.apiVendors(`/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
                    this.toast('Vendor updated', 'success');
                } else {
                    await this.apiVendors('', { method: 'POST', body: JSON.stringify(payload) });
                    this.toast('Vendor created', 'success');
                }
                this.closeVendorModal();
                await this.refresh();
            } catch (err) {
                this.toast(err.message || 'Could not save vendor', 'error');
            }
        },

        async deleteVendor(vendorId) {
            if (!confirm('Delete this vendor? This cannot be undone.')) return;
            try {
                await this.apiVendors(`/${vendorId}`, { method: 'DELETE' });
                this.toast('Vendor deleted', 'success');
                await this.refresh();
            } catch (err) {
                this.toast(err.message || 'Could not delete vendor', 'error');
            }
        },

        async loadOrders() {
            const container = document.getElementById('vendors-orders-table');
            if (!container) return;
            container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading purchase orders...</div>';
            try {
                const status = document.getElementById('vendors-status-filter')?.value || '';
                const qs = status ? `?status=${encodeURIComponent(status)}` : '';
                const data = await this.apiReceiving(`/orders${qs}`);
                this.orders = data?.orders || [];
                this.renderOrders();
            } catch (err) {
                container.innerHTML = `<p style="color:var(--error);">${this.escape(err.message || 'Failed to load orders')}</p>`;
            }
        },

        renderOrders() {
            const container = document.getElementById('vendors-orders-table');
            if (!container) return;
            if (!this.orders.length) {
                container.innerHTML = '<p style="color:var(--gray-500);">No purchase orders yet.</p>';
                return;
            }
            container.innerHTML = `
                <div class="table-container">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>PO #</th>
                                <th>Vendor</th>
                                <th>Status</th>
                                <th>Progress</th>
                                <th>Slip code</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.orders
                                .map((o) => {
                                    const progress = `${o.qtyReceived || 0} / ${o.qtyOrdered || 0}`;
                                    return `<tr>
                                <td><button type="button" class="btn btn-sm btn-secondary vendors-view-po-btn" data-order-id="${o.id}">${this.escape(o.poNumber)}</button></td>
                                <td>${this.escape(o.vendorName || '—')}</td>
                                <td>${this.poStatusBadge(o.status)}</td>
                                <td>${progress}</td>
                                <td><code>${this.escape(o.slipBarcode || '')}</code></td>
                                <td>
                                    ${
                                        o.status === 'draft' || o.status === 'submitted'
                                            ? `<button type="button" class="btn btn-sm btn-secondary vendors-open-po-btn" data-order-id="${o.id}">Open for receiving</button>`
                                            : ''
                                    }
                                    <button type="button" class="btn btn-sm btn-secondary vendors-view-po-btn" data-order-id="${o.id}">View</button>
                                </td>
                            </tr>`;
                                })
                                .join('')}
                        </tbody>
                    </table>
                </div>`;
            container.querySelectorAll('.vendors-view-po-btn').forEach((btn) => {
                btn.addEventListener('click', () => void this.viewOrder(Number(btn.dataset.orderId)));
            });
            container.querySelectorAll('.vendors-open-po-btn').forEach((btn) => {
                btn.addEventListener('click', () => void this.openOrder(Number(btn.dataset.orderId)));
            });
        },

        addLineRow(line = {}) {
            const body = document.getElementById('vendors-lines-body');
            if (!body) return;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input class="form-input" type="text" data-field="sku" value="${this.escape(line.sku || line.productSku || '')}" placeholder="Store SKU"></td>
                <td><input class="form-input" type="text" data-field="vendorSku" value="${this.escape(line.vendorSku || '')}" placeholder="Vendor code"></td>
                <td><input class="form-input" type="text" data-field="description" value="${this.escape(line.description || '')}" placeholder="Product name"></td>
                <td><input class="form-input" type="number" min="0" step="1" data-field="qtyOrdered" value="${this.escape(line.qtyOrdered ?? '')}" placeholder="0"></td>
                <td><input class="form-input" type="number" min="0" step="0.01" data-field="unitCost" value="${this.escape(line.unitCost ?? '')}" placeholder="0.00"></td>
                <td><button type="button" class="btn btn-sm btn-danger" data-remove-line>Remove</button></td>`;
            tr.querySelector('[data-remove-line]')?.addEventListener('click', () => tr.remove());
            body.appendChild(tr);
        },

        collectLines() {
            const rows = document.querySelectorAll('#vendors-lines-body tr');
            const lines = [];
            rows.forEach((row) => {
                const sku = row.querySelector('[data-field="sku"]')?.value?.trim();
                const vendorSku = row.querySelector('[data-field="vendorSku"]')?.value?.trim();
                const description = row.querySelector('[data-field="description"]')?.value?.trim();
                const qtyOrdered = Number(row.querySelector('[data-field="qtyOrdered"]')?.value);
                const unitCostRaw = row.querySelector('[data-field="unitCost"]')?.value;
                const unitCost = unitCostRaw === '' ? null : Number(unitCostRaw);
                if (!sku && !vendorSku) return;
                if (!Number.isFinite(qtyOrdered) || qtyOrdered <= 0) return;
                lines.push({ sku, vendorSku, description, qtyOrdered, unitCost });
            });
            return lines;
        },

        collectFormPayload(status) {
            return {
                vendorId: Number(document.getElementById('vendors-po-vendor')?.value),
                poNumber: document.getElementById('vendors-po-number')?.value?.trim(),
                vendorReference: document.getElementById('vendors-po-vendor-ref')?.value?.trim(),
                expectedAt: document.getElementById('vendors-po-expected')?.value || null,
                notes: document.getElementById('vendors-po-notes')?.value?.trim(),
                lines: this.collectLines(),
                status
            };
        },

        setFormMessage(text, ok = true) {
            const el = document.getElementById('vendors-form-message');
            if (!el) return;
            el.textContent = text;
            el.style.color = ok ? 'var(--success)' : 'var(--error)';
        },

        async saveOrder(status) {
            const payload = this.collectFormPayload(status);
            if (!payload.vendorId) {
                this.setFormMessage('Select a vendor.', false);
                return;
            }
            if (!payload.poNumber) {
                this.setFormMessage('Enter a PO / order number.', false);
                return;
            }
            if (!payload.lines.length) {
                this.setFormMessage('Add at least one line item with a SKU and quantity.', false);
                return;
            }
            try {
                const data = await this.apiReceiving('/orders', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                this.toast(status === 'open' ? 'Order saved and opened for POS receiving' : 'Draft saved', 'success');
                this.setFormMessage(`Saved ${data.order.poNumber}. Slip code: ${data.order.slipBarcode}`, true);
                document.getElementById('vendors-po-number').value = '';
                document.getElementById('vendors-po-vendor-ref').value = '';
                document.getElementById('vendors-po-expected').value = '';
                document.getElementById('vendors-po-notes').value = '';
                document.getElementById('vendors-lines-body').innerHTML = '';
                this._linesReady = false;
                this.addLineRow();
                this._linesReady = true;
                await this.loadOrders();
                void this.viewOrder(data.order.id);
            } catch (err) {
                this.setFormMessage(err.message || 'Could not save order', false);
            }
        },

        async importCsv() {
            const vendorId = Number(document.getElementById('vendors-po-vendor')?.value);
            if (!vendorId) {
                this.toast('Select a vendor first', 'warning');
                return;
            }
            const csv = document.getElementById('vendors-csv-input')?.value || '';
            if (!csv.trim()) {
                this.toast('Paste CSV text first', 'warning');
                return;
            }
            try {
                const data = await this.apiReceiving('/orders/import-csv', {
                    method: 'POST',
                    body: JSON.stringify({ vendorId, csv })
                });
                document.getElementById('vendors-lines-body').innerHTML = '';
                (data.lines || []).forEach((line) => this.addLineRow(line));
                if (!(data.lines || []).length) this.addLineRow();
                this.toast(`Imported ${(data.lines || []).length} lines`, 'success');
            } catch (err) {
                this.toast(err.message || 'CSV import failed', 'error');
            }
        },

        async viewOrder(orderId) {
            const data = await this.apiReceiving(`/orders/${orderId}`);
            this.detailOrder = data.order;
            this.renderPoDetail();
        },

        renderPoDetail() {
            const order = this.detailOrder;
            if (!order) return;
            const title = document.getElementById('vendors-po-detail-title');
            const openBtn = document.getElementById('vendors-po-detail-open-btn');
            const body = document.getElementById('vendors-po-detail-body');
            if (title) title.textContent = `PO ${order.poNumber}`;
            if (openBtn) {
                openBtn.classList.toggle('hidden', order.status !== 'draft' && order.status !== 'submitted');
            }
            const linesHtml = (order.lines || [])
                .map(
                    (l) => `<div class="vendors-po-detail-line">
                        <span>${this.escape(l.description)}${l.productSku ? ` <small>(${this.escape(l.productSku)})</small>` : ''}</span>
                        <strong>${l.qtyReceived || 0} / ${l.qtyOrdered || 0}</strong>
                    </div>`
                )
                .join('');
            const barcodeSvg = this.code39Svg(order.slipBarcode || '');
            if (body) {
                body.innerHTML = `
                    <p><strong>Vendor:</strong> ${this.escape(order.vendorName || '—')}</p>
                    ${order.vendorReference ? `<p><strong>Reference:</strong> ${this.escape(order.vendorReference)}</p>` : ''}
                    <p>${this.poStatusBadge(order.status)}</p>
                    <div class="vendors-slip-barcode-wrap">
                        ${barcodeSvg}
                        <p class="vendors-slip-code">${this.escape(order.slipBarcode || '')}</p>
                        <p class="form-help">Print this on the packing slip. Staff scan it in POS receiving, then scan each product.</p>
                    </div>
                    <h4 style="margin:1rem 0 0.5rem;">Line items</h4>
                    <div>${linesHtml || '<p style="color:var(--gray-500);">No lines</p>'}</div>`;
            }
            this.showModal(document.getElementById('vendors-po-detail-modal'));
        },

        hidePoDetail() {
            this.hideModal(document.getElementById('vendors-po-detail-modal'));
            this.detailOrder = null;
        },

        async openOrder(orderId) {
            try {
                await this.apiReceiving(`/orders/${orderId}/open`, { method: 'POST' });
                this.toast('Order opened for POS receiving', 'success');
                await this.loadOrders();
                if (this.detailOrder?.id === orderId) await this.viewOrder(orderId);
            } catch (err) {
                this.toast(err.message || 'Could not open order', 'error');
            }
        },

        async openCurrentOrder() {
            if (!this.detailOrder?.id) return;
            await this.openOrder(this.detailOrder.id);
        },

        printSlipBarcode() {
            const order = this.detailOrder;
            if (!order) return;
            const svg = this.code39Svg(order.slipBarcode || '');
            const win = window.open('', '_blank', 'width=420,height=520');
            if (!win) {
                this.toast('Allow pop-ups to print the slip barcode', 'warning');
                return;
            }
            win.document.write(`<!DOCTYPE html><html><head><title>Slip ${this.escape(order.poNumber)}</title>
<style>
body{font-family:system-ui,sans-serif;padding:24px;text-align:center}
h1{font-size:1.1rem;margin:0 0 8px}
.meta{color:#64748b;font-size:0.9rem;margin:0 0 16px}
svg{display:block;margin:0 auto 12px;max-width:100%}
.code{font-family:monospace;font-size:1.1rem;font-weight:700;letter-spacing:0.08em}
.hint{font-size:0.85rem;color:#64748b;margin-top:16px}
@media print{button{display:none}}
</style></head><body>
<h1>Vendor order slip</h1>
<p class="meta">${this.escape(order.vendorName || '')} · PO ${this.escape(order.poNumber)}</p>
${svg}
<p class="code">${this.escape(order.slipBarcode || '')}</p>
<p class="hint">Scan in POS receiving, then scan each product.</p>
<button onclick="window.print()">Print</button>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`);
            win.document.close();
        },

        code39Svg(text) {
            const patterns = CODE39_PATTERNS;
            const chars = `*${String(text).toUpperCase().replace(/[^A-Z0-9\-]/g, '')}*`;
            let x = 0;
            const narrow = 2;
            const wide = 5;
            const height = 56;
            let rects = '';
            for (const ch of chars) {
                const pattern = patterns[ch];
                if (!pattern) return '';
                for (let i = 0; i < pattern.length; i += 1) {
                    const width = pattern[i] === 'w' ? wide : narrow;
                    if (i % 2 === 0) {
                        rects += `<rect x="${x}" y="0" width="${width}" height="${height}" fill="#000"/>`;
                    }
                    x += width;
                }
                x += narrow;
            }
            if (x <= 0) return '';
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${height}" viewBox="0 0 ${x} ${height}" role="img" aria-label="Slip barcode">${rects}</svg>`;
        }
    };

    window.AdminVendors = AdminVendors;
})();
