// HM Herbs Admin Panel - Customer Groups module.
/* global AdminApp */
(function () {
    'use strict';
    if (typeof AdminApp === 'undefined') {
        console.error('admin-customer-groups.js: AdminApp not found');
        return;
    }

    let promotionOptionsCache = null;

    const esc = (s) => {
        if (s === null || s === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(s);
        return div.innerHTML;
    };

    const HM_MODAL_CLOSE_BTN =
        '<button type="button" class="modal-close" onclick="this.closest(\'.modal\').remove()" aria-label="Close">' +
        '<svg class="cart-close-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' +
        '<path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg></button>';

    function openModal(html) {
        const root = document.getElementById('adminModalRoot');
        if (!root) return null;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.cssText =
            'display:flex;position:fixed;z-index:10000;inset:0;background:rgba(0,0,0,0.6);align-items:flex-start;justify-content:center;padding:2rem 1rem;overflow-y:auto;';
        modal.innerHTML = `<div class="modal-content" style="background:#fff;border-radius:8px;max-width:720px;width:100%;position:relative;box-shadow:0 25px 50px -12px rgba(0,0,0,0.3);">${html}</div>`;
        root.appendChild(modal);
        return modal;
    }

    async function loadPromotionOptions(app) {
        if (promotionOptionsCache) return promotionOptionsCache;
        try {
            const res = await app.apiRequest('/admin/promotions');
            promotionOptionsCache = (res?.promotions || []).filter((p) => p.is_active);
        } catch {
            promotionOptionsCache = [];
        }
        return promotionOptionsCache;
    }

    function discountFieldsHtml(prefix, data = {}) {
        const type = data.type || data.discount_type || 'none';
        const value = data.value != null ? data.value : data.discount_value != null ? data.discount_value : '';
        const label = data.label || data.discount_label || '';
        const appliesWeb = data.applies_web !== false && data.applies_web !== 0 && data.discount_applies_web !== 0;
        const appliesPos = data.applies_pos !== false && data.applies_pos !== 0 && data.discount_applies_pos !== 0;
        return `
            <div class="form-group" style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--gray-200);">
                <h4 style="margin:0 0 0.75rem 0;font-size:1rem;">Standing discount</h4>
                <p class="form-help" style="margin:0 0 0.75rem 0;">Automatically applied for members of this group at checkout and on the register (after promo codes on web).</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                    <div class="form-group" style="margin:0;">
                        <label for="${prefix}-discount-type">Discount type</label>
                        <select class="form-input" id="${prefix}-discount-type" name="discount_type">
                            <option value="none"${type === 'none' ? ' selected' : ''}>None</option>
                            <option value="percent"${type === 'percent' ? ' selected' : ''}>Percent off</option>
                            <option value="fixed"${type === 'fixed' ? ' selected' : ''}>Fixed amount off</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label for="${prefix}-discount-value">Value</label>
                        <input class="form-input" id="${prefix}-discount-value" name="discount_value" type="number" min="0" step="0.01" value="${esc(value)}" placeholder="${type === 'percent' ? '10' : '5.00'}">
                    </div>
                </div>
                <div class="form-group" style="margin:0.75rem 0 0;">
                    <label for="${prefix}-discount-label">Receipt / checkout label <span class="form-optional-hint">(optional)</span></label>
                    <input class="form-input" id="${prefix}-discount-label" name="discount_label" maxlength="100" value="${esc(label)}" placeholder="e.g. Wholesale 10%">
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-top:0.5rem;">
                    <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                        <input type="checkbox" id="${prefix}-discount-web" name="discount_applies_web"${appliesWeb ? ' checked' : ''}> Website checkout
                    </label>
                    <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                        <input type="checkbox" id="${prefix}-discount-pos" name="discount_applies_pos"${appliesPos ? ' checked' : ''}> In-store POS
                    </label>
                </div>
            </div>`;
    }

    function linkedPromotionsHtml(prefix, promotions, linked = []) {
        const linkedMap = new Map(
            (linked || []).map((item) => [Number(item.promotionId ?? item.promotion_id), Boolean(item.autoApply ?? item.auto_apply)])
        );
        if (!promotions.length) {
            return `
                <div class="form-group" style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--gray-200);">
                    <h4 style="margin:0 0 0.35rem 0;font-size:1rem;">Linked checkout promotions</h4>
                    <p class="form-help" style="margin:0;">No active checkout promotions yet. Create them under <strong>Marketing → Checkout promotions</strong>.</p>
                </div>`;
        }
        return `
            <div class="form-group" style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--gray-200);">
                <h4 style="margin:0 0 0.35rem 0;font-size:1rem;">Linked checkout promotions</h4>
                <p class="form-help" style="margin:0 0 0.75rem 0;">Attach premade promo codes from Marketing. Check <strong>Auto-apply</strong> to use without the customer entering the code (web only; best eligible promo wins).</p>
                <div style="display:grid;gap:0.5rem;max-height:220px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:8px;padding:0.75rem;">
                    ${promotions
                        .map((p) => {
                            const pid = Number(p.id);
                            const checked = linkedMap.has(pid);
                            const autoApply = linkedMap.get(pid);
                            return `
                            <div style="display:grid;gap:0.35rem;padding-bottom:0.5rem;border-bottom:1px solid var(--gray-100);">
                                <label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;">
                                    <input type="checkbox" class="${prefix}-promo-link" data-promotion-id="${pid}"${checked ? ' checked' : ''}>
                                    <span><strong>${esc(p.code)}</strong>${p.description ? `<br><span style="font-size:0.85rem;color:var(--gray-600);">${esc(p.description)}</span>` : ''}</span>
                                </label>
                                <label style="display:flex;align-items:center;gap:0.5rem;margin-left:1.5rem;font-size:0.88rem;color:var(--gray-700);cursor:pointer;">
                                    <input type="checkbox" class="${prefix}-promo-auto" data-promotion-id="${pid}"${checked && autoApply ? ' checked' : ''}${checked ? '' : ' disabled'}> Auto-apply at checkout
                                </label>
                            </div>`;
                        })
                        .join('')}
                </div>
            </div>`;
    }

    function wirePromotionLinkHandlers(modal, prefix) {
        modal.querySelectorAll(`.${prefix}-promo-link`).forEach((cb) => {
            cb.addEventListener('change', () => {
                const pid = cb.getAttribute('data-promotion-id');
                const auto = modal.querySelector(`.${prefix}-promo-auto[data-promotion-id="${pid}"]`);
                if (auto) {
                    auto.disabled = !cb.checked;
                    if (!cb.checked) auto.checked = false;
                }
            });
        });
    }

    function readDiscountFromForm(form, prefix) {
        const type = form.querySelector(`#${prefix}-discount-type`)?.value || 'none';
        const valueRaw = form.querySelector(`#${prefix}-discount-value`)?.value;
        const value = valueRaw === '' || valueRaw == null ? null : Number(valueRaw);
        return {
            type,
            value,
            label: form.querySelector(`#${prefix}-discount-label`)?.value?.trim() || null,
            applies_web: form.querySelector(`#${prefix}-discount-web`)?.checked !== false,
            applies_pos: form.querySelector(`#${prefix}-discount-pos`)?.checked !== false
        };
    }

    function readLinkedPromotionsFromForm(modal, prefix) {
        const linked = [];
        modal.querySelectorAll(`.${prefix}-promo-link:checked`).forEach((cb) => {
            const promotionId = Number(cb.getAttribute('data-promotion-id'));
            const autoEl = modal.querySelector(`.${prefix}-promo-auto[data-promotion-id="${promotionId}"]`);
            linked.push({
                promotion_id: promotionId,
                auto_apply: Boolean(autoEl?.checked)
            });
        });
        return linked;
    }

    AdminApp.prototype.canManageCustomerGroups = function () {
        const role = this.currentUser?.role;
        return this.isFullAdmin || role === 'manager';
    };

    AdminApp.prototype.loadCustomerGroups = async function () {
        const container = document.getElementById('customerGroupsTable');
        if (!container) return;

        const addBtn = document.getElementById('customerGroupsAddBtn');
        if (addBtn) {
            addBtn.style.display = this.canManageCustomerGroups() ? '' : 'none';
        }

        if (!this.authToken) {
            container.innerHTML =
                '<p style="text-align:center;padding:2rem;color:var(--gray-500);">Please log in to view customer groups.</p>';
            return;
        }

        container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading customer groups...</div>';

        try {
            const groups = await this.apiRequest('/admin/customer-groups');
            if (!groups) {
                container.innerHTML =
                    '<p style="text-align:center;padding:2rem;color:var(--gray-500);">Please log in to view customer groups.</p>';
                return;
            }

            if (!groups.length) {
                container.innerHTML = `
                    <div style="text-align:center;padding:3rem;color:var(--gray-500);">
                        <i class="fas fa-user-friends" style="font-size:3rem;opacity:0.3;display:block;margin-bottom:1rem;"></i>
                        <p>No customer groups yet.</p>
                        ${this.canManageCustomerGroups() ? '<p style="font-size:0.9rem;">Click <strong>Add Group</strong> to create your first group.</p>' : ''}
                    </div>`;
                return;
            }

            const canEdit = this.canManageCustomerGroups();
            container.innerHTML = `
                <div class="table-container">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Members</th>
                                <th>Discounts</th>
                                <th>Channels</th>
                                <th>Status</th>
                                ${canEdit ? '<th>Actions</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${groups
                                .map((g) => {
                                    const channels = [
                                        g.discount_applies_web ? 'Web' : null,
                                        g.discount_applies_pos ? 'POS' : null
                                    ]
                                        .filter(Boolean)
                                        .join(', ') || '—';
                                    const discountBits = [
                                        g.discount_summary || null,
                                        g.linked_promotion_count
                                            ? `${g.linked_promotion_count} promo${g.linked_promotion_count === 1 ? '' : 's'}`
                                            : null
                                    ]
                                        .filter(Boolean)
                                        .join(' · ') || '—';
                                    return `
                                <tr>
                                    <td><strong>${esc(g.name)}</strong>${g.description ? `<br><small style="color:var(--gray-500);">${esc(g.description)}</small>` : ''}</td>
                                    <td>${Number(g.member_count) || 0}</td>
                                    <td style="font-size:0.88rem;">${esc(discountBits)}</td>
                                    <td style="font-size:0.88rem;">${esc(channels)}</td>
                                    <td>
                                        <span class="badge ${g.is_active ? 'badge-success' : 'badge-danger'}">
                                            ${g.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    ${canEdit ? `
                                    <td>
                                        <button type="button" class="btn btn-sm btn-secondary" onclick="adminApp.editCustomerGroup(${g.id})" title="Edit">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button type="button" class="btn btn-sm btn-danger" style="margin-left:0.5rem;" onclick="adminApp.deleteCustomerGroup(${g.id})" title="Delete">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>` : ''}
                                </tr>`;
                                })
                                .join('')}
                        </tbody>
                    </table>
                </div>`;
        } catch (err) {
            container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--error);">Failed to load groups: ${esc(err.message)}</div>`;
        }
    };

    AdminApp.prototype.showAddCustomerGroupModal = async function () {
        if (!this.canManageCustomerGroups()) {
            this.showToast('Manager access required to create customer groups.', 'error');
            return;
        }
        const promotions = await loadPromotionOptions(this);
        const modal = openModal(`
            <div style="padding:1.5rem;position:relative;">
                ${HM_MODAL_CLOSE_BTN}
                <h3 style="margin-top:0;color:var(--primary-green);">Add Customer Group</h3>
                <form id="addCustomerGroupForm">
                    <div class="form-group">
                        <label for="cg-add-name">Name *</label>
                        <input class="form-input" id="cg-add-name" name="name" required placeholder="e.g. Wholesale, VIP, Staff">
                    </div>
                    <div class="form-group">
                        <label for="cg-add-description">Description</label>
                        <textarea class="form-input" id="cg-add-description" name="description" rows="2" placeholder="Optional notes about this group"></textarea>
                    </div>
                    ${discountFieldsHtml('cg-add', {})}
                    ${linkedPromotionsHtml('cg-add', promotions, [])}
                    <div class="form-group" style="margin-top:0.75rem;">
                        <label><input type="checkbox" name="is_active" checked> Active</label>
                    </div>
                    <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1rem;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Create Group</button>
                    </div>
                </form>
            </div>
        `);

        wirePromotionLinkHandlers(modal, 'cg-add');

        modal.querySelector('#addCustomerGroupForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            try {
                await this.apiRequest('/admin/customer-groups', {
                    method: 'POST',
                    body: JSON.stringify({
                        name: fd.get('name'),
                        description: fd.get('description') || null,
                        is_active: fd.get('is_active') === 'on',
                        discount: readDiscountFromForm(e.target, 'cg-add'),
                        linked_promotions: readLinkedPromotionsFromForm(modal, 'cg-add')
                    })
                });
                modal.remove();
                this.showToast('Customer group created', 'success');
                this.loadCustomerGroups();
            } catch (err) {
                this.showToast(err.message || 'Failed to create group', 'error');
            }
        });
    };

    AdminApp.prototype.editCustomerGroup = async function (id) {
        if (!this.canManageCustomerGroups()) {
            this.showToast('Manager access required to edit customer groups.', 'error');
            return;
        }
        const [group, promotions] = await Promise.all([
            this.apiRequest(`/admin/customer-groups/${id}`),
            loadPromotionOptions(this)
        ]);
        if (!group) return;

        const modal = openModal(`
            <div style="padding:1.5rem;position:relative;">
                ${HM_MODAL_CLOSE_BTN}
                <h3 style="margin-top:0;color:var(--primary-green);">Edit Customer Group</h3>
                <form id="editCustomerGroupForm">
                    <div class="form-group">
                        <label for="cg-edit-name">Name *</label>
                        <input class="form-input" id="cg-edit-name" name="name" required value="${esc(group.name)}">
                    </div>
                    <div class="form-group">
                        <label for="cg-edit-description">Description</label>
                        <textarea class="form-input" id="cg-edit-description" name="description" rows="2">${esc(group.description || '')}</textarea>
                    </div>
                    ${discountFieldsHtml('cg-edit', group.discount || {})}
                    ${linkedPromotionsHtml('cg-edit', promotions, group.linked_promotions || [])}
                    <div class="form-group" style="margin-top:0.75rem;">
                        <label><input type="checkbox" name="is_active" ${group.is_active ? 'checked' : ''}> Active</label>
                    </div>
                    ${group.members && group.members.length ? `
                        <div class="form-group">
                            <label>Members (${group.members.length})</label>
                            <div style="max-height:120px;overflow-y:auto;font-size:0.85rem;color:var(--gray-600);border:1px solid var(--gray-200);border-radius:6px;padding:0.5rem 0.75rem;">
                                ${group.members.slice(0, 20).map((m) => esc(`${m.first_name || ''} ${m.last_name || ''}`.trim() || m.email)).join('<br>')}
                                ${group.members.length > 20 ? `<br><em>+${group.members.length - 20} more</em>` : ''}
                            </div>
                            <small style="color:var(--gray-500);">Assign members from each customer’s profile.</small>
                        </div>
                    ` : ''}
                    <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1rem;">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        `);

        wirePromotionLinkHandlers(modal, 'cg-edit');

        modal.querySelector('#editCustomerGroupForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            try {
                await this.apiRequest(`/admin/customer-groups/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        name: fd.get('name'),
                        description: fd.get('description') || null,
                        is_active: fd.get('is_active') === 'on',
                        discount: readDiscountFromForm(e.target, 'cg-edit'),
                        linked_promotions: readLinkedPromotionsFromForm(modal, 'cg-edit')
                    })
                });
                modal.remove();
                promotionOptionsCache = null;
                this.showToast('Customer group updated', 'success');
                this.loadCustomerGroups();
            } catch (err) {
                this.showToast(err.message || 'Failed to update group', 'error');
            }
        });
    };

    AdminApp.prototype.deleteCustomerGroup = async function (id) {
        if (!this.canManageCustomerGroups()) {
            this.showToast('Manager access required to delete customer groups.', 'error');
            return;
        }
        let name = 'this group';
        try {
            const g = await this.apiRequest(`/admin/customer-groups/${id}`);
            if (g?.name) name = g.name;
        } catch {
            /* use default label */
        }
        const ok = await this.showAdminConfirm({
            title: `Delete group “${name}”?`,
            message: 'Customers in this group will be unassigned. This cannot be undone.',
            confirmLabel: 'Delete group',
            cancelLabel: 'Cancel',
            danger: true
        });
        if (!ok) return;

        try {
            await this.apiRequest(`/admin/customer-groups/${id}`, { method: 'DELETE' });
            this.showToast('Customer group deleted', 'success');
            this.loadCustomerGroups();
        } catch (err) {
            this.showToast(err.message || 'Failed to delete group', 'error');
        }
    };

    window.showAddCustomerGroup = function () {
        window.adminApp?.showAddCustomerGroupModal();
    };
})();
