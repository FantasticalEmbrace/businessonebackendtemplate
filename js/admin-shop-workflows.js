'use strict';

/**
 * Admin — customer shop workflow builder (processes + product/SKU links per vertical).
 */
(function () {
    if (typeof AdminApp === 'undefined') return;

    const VERTICALS = [
        { key: 'auto', label: 'Auto service' },
        { key: 'body', label: 'Body shop' },
        { key: 'tire', label: 'Tire shop' },
        { key: 'upholstery', label: 'Upholstery' }
    ];

    const PROCESS_TYPES = ['waiting', 'inspection', 'decision', 'work', 'complete', 'payment'];

    AdminApp.prototype.initShopCustomerWorkflows = function () {
        const root = document.getElementById('shop-customer-workflows-root');
        if (!root || root.dataset.bound === '1') return;
        root.dataset.bound = '1';
        this._shopWfVertical = 'auto';
        this._shopWfConfig = null;
        this._shopWfProducts = [];

        root.querySelectorAll('[data-shop-wf-vertical]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._shopWfVertical = btn.getAttribute('data-shop-wf-vertical') || 'auto';
                root.querySelectorAll('[data-shop-wf-vertical]').forEach((b) => {
                    b.classList.toggle('btn-primary', b === btn);
                    b.classList.toggle('btn-secondary', b !== btn);
                });
                this.renderShopCustomerWorkflowEditor();
            });
        });

        document.getElementById('shop-wf-add-process')?.addEventListener('click', () => this.addShopWorkflowProcess());
        document.getElementById('shop-wf-save')?.addEventListener('click', () => this.saveShopCustomerWorkflows());
        document.getElementById('shop-wf-reset-vertical')?.addEventListener('click', () => this.resetShopWorkflowVertical());

        const payToggle = document.getElementById('shop-wf-payment-link-enabled');
        payToggle?.addEventListener('change', () => {
            if (!this._shopWfConfig) return;
            this._shopWfConfig.paymentLinkEnabled = payToggle.checked;
            const v = this._shopWfVertical;
            if (this._shopWfConfig.verticals?.[v]) {
                this._shopWfConfig.verticals[v].paymentLinkEnabled = payToggle.checked;
            }
        });

        this.loadShopCustomerWorkflows();
    };

    AdminApp.prototype.loadShopCustomerWorkflows = async function () {
        const msg = document.getElementById('shop-wf-msg');
        try {
            const [configRes, productsRes] = await Promise.all([
                this.apiRequest('/admin/shop/customer-workflows'),
                this.apiRequest('/admin/products?limit=500&fields=id,sku,name').catch(() => ({ products: [] }))
            ]);
            this._shopWfConfig =
                configRes && typeof configRes === 'object' && configRes.verticals
                    ? configRes
                    : { paymentLinkEnabled: true, verticals: {} };
            this._shopWfProducts = productsRes?.products || productsRes?.items || [];
            if (this.demoMode && typeof window !== 'undefined') {
                try {
                    const local = localStorage.getItem('pos_demo_customer_workflows');
                    if (local) {
                        const parsed = JSON.parse(local);
                        this._shopWfConfig = parsed;
                    }
                } catch {
                    /* use API defaults */
                }
            }
            this.renderShopCustomerWorkflowEditor();
            if (msg) msg.textContent = '';
        } catch (e) {
            if (msg) msg.textContent = e.message || 'Could not load workflows.';
        }
    };

    AdminApp.prototype.renderShopCustomerWorkflowEditor = function () {
        const list = document.getElementById('shop-wf-process-list');
        const payToggle = document.getElementById('shop-wf-payment-link-enabled');
        if (!list || !this._shopWfConfig) return;
        const v = this._shopWfVertical;
        const vertical = this._shopWfConfig.verticals?.[v] || { processes: [], paymentLinkEnabled: true };
        const payEnabled =
            vertical.paymentLinkEnabled != null ? vertical.paymentLinkEnabled : this._shopWfConfig.paymentLinkEnabled !== false;
        if (payToggle) payToggle.checked = payEnabled;

        const processes = (vertical.processes || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        if (!processes.length) {
            list.innerHTML = '<p class="form-help">No processes yet — add one or reset to defaults.</p>';
            return;
        }
        list.innerHTML = processes
            .map((p, idx) => this.shopWorkflowProcessRowHtml(p, idx, v))
            .join('');
        list.querySelectorAll('[data-wf-remove]').forEach((btn) => {
            btn.addEventListener('click', () => this.removeShopWorkflowProcess(Number(btn.getAttribute('data-wf-remove'))));
        });
        list.querySelectorAll('[data-wf-move-up]').forEach((btn) => {
            btn.addEventListener('click', () => this.moveShopWorkflowProcess(Number(btn.getAttribute('data-wf-move-up')), -1));
        });
        list.querySelectorAll('[data-wf-move-down]').forEach((btn) => {
            btn.addEventListener('click', () => this.moveShopWorkflowProcess(Number(btn.getAttribute('data-wf-move-down')), 1));
        });
        list.querySelectorAll('[data-wf-field]').forEach((el) => {
            el.addEventListener('change', () => this.syncShopWorkflowField(el));
            el.addEventListener('input', () => this.syncShopWorkflowField(el));
        });
    };

    AdminApp.prototype.shopWorkflowProcessRowHtml = function (p, idx, vertical) {
        const typeOpts = PROCESS_TYPES.map(
            (t) => `<option value="${t}"${p.type === t ? ' selected' : ''}>${t}</option>`
        ).join('');
        const productOpts = this._shopWfProducts
            .slice(0, 200)
            .map(
                (prod) =>
                    `<option value="${this.escapeHtml(String(prod.id))}"${(p.productIds || []).includes(String(prod.id)) ? ' selected' : ''}>${this.escapeHtml(prod.sku || '')} — ${this.escapeHtml(prod.name || '')}</option>`
            )
            .join('');
        return `
      <div class="shop-wf-process-card" data-wf-index="${idx}" style="border:1px solid var(--gray-200);border-radius:10px;padding:0.85rem;margin-bottom:0.65rem;background:#fafbfc;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;margin-bottom:0.65rem;">
          <strong style="font-size:0.92rem;">Step ${idx + 1}</strong>
          <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
            <button type="button" class="btn btn-ghost btn-sm" data-wf-move-up="${idx}" title="Move up">↑</button>
            <button type="button" class="btn btn-ghost btn-sm" data-wf-move-down="${idx}" title="Move down">↓</button>
            <button type="button" class="btn btn-ghost btn-sm" data-wf-remove="${idx}" title="Remove">Remove</button>
          </div>
        </div>
        <div style="display:grid;gap:0.55rem;">
          <div class="form-group" style="margin:0;">
            <label>Label</label>
            <input class="form-input" data-wf-field="label" data-wf-index="${idx}" value="${this.escapeHtml(p.label || '')}">
          </div>
          <div class="form-group" style="margin:0;">
            <label>Description (shown to customer)</label>
            <textarea class="form-input" rows="2" data-wf-field="description" data-wf-index="${idx}">${this.escapeHtml(p.description || '')}</textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.55rem;">
            <div class="form-group" style="margin:0;">
              <label>Type</label>
              <select class="form-input" data-wf-field="type" data-wf-index="${idx}">${typeOpts}</select>
            </div>
            <div class="form-group" style="margin:0;">
              <label>Icon key</label>
              <input class="form-input" data-wf-field="icon" data-wf-index="${idx}" value="${this.escapeHtml(p.icon || 'circle')}" placeholder="clock, wrench, credit-card">
            </div>
          </div>
          <div class="form-group" style="margin:0;">
            <label>Linked SKUs (comma-separated — step shows when these are on the job)</label>
            <input class="form-input" data-wf-field="skus" data-wf-index="${idx}" value="${this.escapeHtml((p.skus || []).join(', '))}" placeholder="MOUNT-BAL, ALIGN-4">
          </div>
          <div class="form-group" style="margin:0;">
            <label>Linked products</label>
            <select class="form-input" multiple size="3" data-wf-field="productIds" data-wf-index="${idx}" style="min-height:4.5rem;">
              ${productOpts || '<option disabled>No products loaded</option>'}
            </select>
            <p class="form-help" style="margin:0.25rem 0 0;">Hold Ctrl/Cmd to select multiple catalog items.</p>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:1rem;">
            <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;">
              <input type="checkbox" data-wf-field="customerCanAct" data-wf-index="${idx}"${p.customerCanAct ? ' checked' : ''}> Customer can act on this step
            </label>
            <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;">
              <input type="checkbox" data-wf-field="optional" data-wf-index="${idx}"${p.optional ? ' checked' : ''}> Optional (hide if SKUs not on job)
            </label>
          </div>
        </div>
      </div>`;
    };

    AdminApp.prototype.syncShopWorkflowField = function (el) {
        const idx = Number(el.getAttribute('data-wf-index'));
        const field = el.getAttribute('data-wf-field');
        const v = this._shopWfVertical;
        const processes = this._shopWfConfig.verticals[v]?.processes;
        if (!processes || !processes[idx]) return;
        const p = processes[idx];
        if (field === 'skus') {
            p.skus = String(el.value || '')
                .split(/[,;]+/)
                .map((s) => s.trim())
                .filter(Boolean);
        } else if (field === 'productIds') {
            p.productIds = Array.from(el.selectedOptions).map((o) => o.value);
        } else if (field === 'customerCanAct' || field === 'optional') {
            p[field] = el.checked;
        } else {
            p[field] = el.value;
        }
    };

    AdminApp.prototype.addShopWorkflowProcess = function () {
        const v = this._shopWfVertical;
        if (!this._shopWfConfig.verticals[v]) {
            this._shopWfConfig.verticals[v] = { processes: [], paymentLinkEnabled: true };
        }
        const processes = this._shopWfConfig.verticals[v].processes;
        const n = processes.length;
        processes.push({
            id: `custom_${Date.now()}`,
            key: `custom_${Date.now()}`,
            type: 'work',
            label: 'New process',
            description: '',
            sortOrder: n,
            icon: 'circle',
            productIds: [],
            skus: [],
            customerCanAct: false,
            optional: false
        });
        this.renderShopCustomerWorkflowEditor();
    };

    AdminApp.prototype.removeShopWorkflowProcess = function (idx) {
        const v = this._shopWfVertical;
        const processes = this._shopWfConfig.verticals[v]?.processes;
        if (!processes) return;
        processes.splice(idx, 1);
        processes.forEach((p, i) => {
            p.sortOrder = i;
        });
        this.renderShopCustomerWorkflowEditor();
    };

    AdminApp.prototype.moveShopWorkflowProcess = function (idx, dir) {
        const v = this._shopWfVertical;
        const processes = this._shopWfConfig.verticals[v]?.processes;
        if (!processes) return;
        const next = idx + dir;
        if (next < 0 || next >= processes.length) return;
        const tmp = processes[idx];
        processes[idx] = processes[next];
        processes[next] = tmp;
        processes.forEach((p, i) => {
            p.sortOrder = i;
        });
        this.renderShopCustomerWorkflowEditor();
    };

    AdminApp.prototype.resetShopWorkflowVertical = async function () {
        const v = this._shopWfVertical;
        try {
            const defaults = await this.apiRequest('/admin/shop/customer-workflows/defaults');
            if (defaults?.verticals?.[v]) {
                this._shopWfConfig.verticals[v] = JSON.parse(JSON.stringify(defaults.verticals[v]));
                this.renderShopCustomerWorkflowEditor();
                this.showToast?.(`Reset ${v} workflow to defaults`, 'success');
            }
        } catch (e) {
            this.showToast?.(e.message || 'Could not reset', 'error');
        }
    };

    AdminApp.prototype.saveShopCustomerWorkflows = async function () {
        const msg = document.getElementById('shop-wf-msg');
        try {
            const saved = await this.apiRequest('/admin/shop/customer-workflows', {
                method: 'PUT',
                body: JSON.stringify(this._shopWfConfig)
            });
            this._shopWfConfig = saved;
            if (this.demoMode) {
                try {
                    localStorage.setItem('pos_demo_customer_workflows', JSON.stringify(saved));
                    sessionStorage.setItem('pos_demo_customer_workflows', JSON.stringify(saved));
                } catch {
                    /* ignore */
                }
            }
            if (msg) msg.textContent = 'Customer workflows saved.';
            this.showToast?.('Customer workflows saved', 'success');
        } catch (e) {
            if (msg) msg.textContent = e.message || 'Save failed.';
            this.showToast?.(e.message || 'Save failed', 'error');
        }
    };

    const origShowSection = AdminApp.prototype.showSection;
    AdminApp.prototype.showSection = function (section) {
        const result = origShowSection.apply(this, arguments);
        if (section === 'pos') {
            setTimeout(() => this.initShopCustomerWorkflows(), 0);
        }
        return result;
    };
})();
