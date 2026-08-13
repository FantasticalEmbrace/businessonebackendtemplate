/**
 * Account Page Manager
 * Handles user profile, orders, and addresses management
 */

/** Normalize API/mysql date values for <input type="date"> (YYYY-MM-DD). */
function hmHerbsToDateInputValue(raw) {
    if (raw == null || raw === '') return '';
    if (typeof raw === 'string') {
        const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
    }
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function hmHerbsAccountApiBase() {
    if (typeof window !== 'undefined' && typeof window.hmHerbsStorefrontApiBase === 'function') {
        const origin = window.hmHerbsStorefrontApiBase();
        return origin ? `${origin}/api` : '/api';
    }
    const explicit = String(
        typeof window !== 'undefined' && window.HMHERBS_API_ORIGIN ? window.HMHERBS_API_ORIGIN : ''
    )
        .trim()
        .replace(/\/+$/, '');
    if (explicit) return `${explicit}/api`;
    if (typeof window === 'undefined') return '/api';
    if (window.location.protocol === 'file:') {
        return 'http://localhost:3001/api';
    }
    const h = window.location.hostname;
    const isLoopback = h === 'localhost' || h === '127.0.0.1';
    if (isLoopback && window.location.port && String(window.location.port) !== '3001') {
        return 'http://localhost:3001/api';
    }
    return '/api';
}

function hmHerbsPhoneDisplayFromStored(raw) {
    const P = typeof window !== 'undefined' && window.HMHERBS_PHONE_US;
    if (!P) return raw == null ? '' : String(raw);
    const d = P.digitsOnly(raw);
    if (!d) return '';
    return P.formatDigitsToDisplay(d);
}

class AccountManager {
    constructor() {
        this.apiBaseUrl = hmHerbsAccountApiBase();
        this.init();
    }

    init() {
        // Check authentication
        if (!window.customerAuth || !window.customerAuth.isAuthenticated()) {
            window.location.href = 'index.html';
            return;
        }

        this.setupEventListeners();
        this.loadUserProfile();
        this.handleHashNavigation();
        window.addEventListener('hashchange', () => this.handleHashNavigation());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                const ordersSection = document.getElementById('orders');
                if (ordersSection?.classList.contains('active')) {
                    this.loadOrders();
                }
            }
        });
    }

    setupEventListeners() {
        // Navigation links
        const navLinks = document.querySelectorAll('.account-nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.getAttribute('data-section');
                this.showSection(section);
            });
        });

        // Profile form
        const profileForm = document.getElementById('profile-form');
        if (profileForm) {
            profileForm.addEventListener('submit', (e) => this.handleProfileUpdate(e));
        }

        // Change password button
        const changePasswordBtn = document.getElementById('change-password-btn');
        if (changePasswordBtn) {
            changePasswordBtn.addEventListener('click', () => this.showChangePasswordModal());
        }

        // Add address button
        const addAddressBtn = document.getElementById('add-address-btn');
        if (addAddressBtn) {
            addAddressBtn.addEventListener('click', () => this.showAddAddressModal());
        }

        const newWishlistBtn = document.getElementById('new-wishlist-btn');
        if (newWishlistBtn && !newWishlistBtn._hmNewWishlistClickBound) {
            newWishlistBtn._hmNewWishlistClickBound = true;
            newWishlistBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.hmHerbsShowNewWishlistModal();
            });
        }
    }

    handleHashNavigation() {
        const hash = window.location.hash.replace('#', '');
        if (hash && ['profile', 'orders', 'addresses', 'loyalty', 'gift-cards', 'wishlists'].includes(hash)) {
            this.showSection(hash);
        }
    }

    showSection(sectionId) {
        // Hide all sections
        document.querySelectorAll('.account-section').forEach(section => {
            section.classList.remove('active');
        });

        // Show selected section
        const section = document.getElementById(sectionId);
        if (section) {
            section.classList.add('active');
        }

        // Update nav links
        document.querySelectorAll('.account-nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('data-section') === sectionId) {
                link.classList.add('active');
            }
        });

        // Update URL
        window.history.replaceState(null, '', `#${sectionId}`);

        // Load section data
        if (sectionId === 'orders') {
            this.loadOrders();
        } else if (sectionId === 'addresses') {
            this.loadAddresses();
        } else if (sectionId === 'loyalty') {
            this.loadLoyalty();
        } else if (sectionId === 'gift-cards') {
            this.loadGiftCards();
            this.bindGiftCardLookup();
        } else if (sectionId === 'wishlists') {
            this.loadWishlists();
        }
    }

    async loadUserProfile() {
        try {
            const user = window.customerAuth.getCurrentUser();
            if (user) {
                // Update welcome message
                const welcomeMsg = document.getElementById('account-welcome-message');
                if (welcomeMsg) {
                    welcomeMsg.textContent = `Welcome back, ${user.firstName}!`;
                }

                // Populate profile form (guarded — markup may not exist yet)
                this._setFieldValue('profile-first-name', user.firstName || '');
                this._setFieldValue('profile-last-name', user.lastName || '');
                this._setFieldValue('profile-email', user.email || '');
                this._setFieldValue('profile-phone', user.phone || '');
            }

            // Load full profile from API
            const response = await this.apiRequest('/user/profile');
            if (response && response.user) {
                const profileForm = document.getElementById('profile-form');
                if (profileForm) {
                    const u = response.user;
                    const apiFirst = String(u.firstName ?? u.first_name ?? '').trim();
                    const apiLast = String(u.lastName ?? u.last_name ?? '').trim();
                    const mem = window.customerAuth.getCurrentUser();
                    const memFirst = mem ? String(mem.firstName ?? mem.first_name ?? '').trim() : '';
                    const memLast = mem ? String(mem.lastName ?? mem.last_name ?? '').trim() : '';
                    // Prefer API; fall back to session so a cached old script or empty DB columns
                    // cannot wipe fields while the header still shows the signed-in name.
                    this._setFieldValue('profile-first-name', apiFirst || memFirst);
                    this._setFieldValue('profile-last-name', apiLast || memLast);
                    this._setFieldValue('profile-email', u.email || mem?.email || '');
                    this._setFieldValue('profile-phone', u.phone != null ? String(u.phone) : (mem?.phone || ''));
                    const apiDob = hmHerbsToDateInputValue(u.dateOfBirth ?? u.date_of_birth);
                    this._setFieldValue('profile-date-of-birth', apiDob);
                }
            }
        } catch (error) {
            console.error('Error loading user profile:', error);
        }
    }

    _setFieldValue(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        let v = value;
        if (id === 'profile-phone') {
            v = hmHerbsPhoneDisplayFromStored(value);
        }
        el.value = v;
    }

    async handleProfileUpdate(e) {
        e.preventDefault();
        const form = e.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        if (!submitBtn) return;
        const originalText = submitBtn.textContent;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        try {
            const phoneRaw = (document.getElementById('profile-phone')?.value || '').trim();
            if (
                phoneRaw &&
                !(window.HMHERBS_PHONE_US && window.HMHERBS_PHONE_US.isValidDisplay(phoneRaw, false))
            ) {
                this.showNotification('Phone must be formatted as (555) 123-4567 or left blank.', 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                return;
            }

            const dobRaw = (document.getElementById('profile-date-of-birth')?.value || '').trim();
            const formData = {
                firstName: (document.getElementById('profile-first-name')?.value || '').trim(),
                lastName: (document.getElementById('profile-last-name')?.value || '').trim(),
                email: (document.getElementById('profile-email')?.value || '').trim(),
                phone: (document.getElementById('profile-phone')?.value || '').trim() || undefined,
                // Always send so the server can clear DOB when the field is emptied (null serializes; undefined does not).
                dateOfBirth: dobRaw || null,
            };

            await this.apiRequest('/user/profile', {
                method: 'PUT',
                body: formData,
            });

            this.showNotification('Profile updated successfully!', 'success');
            window.customerAuth.user = {
                ...window.customerAuth.user,
                ...formData,
                dateOfBirth: dobRaw || null,
            };
            window.customerAuth.setStoredUser(window.customerAuth.user);
            window.customerAuth.updateUI();
        } catch (error) {
            this.showNotification(error.message || 'Failed to update profile', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }

    async loadOrders() {
        const container = document.getElementById('orders-container');
        if (!container) return;

        container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading orders...</p></div>';

        try {
            const response = await this.apiRequest('/user/orders');
            if (response.orders && response.orders.length > 0) {
                container.innerHTML = response.orders.map(order => this.renderOrder(order)).join('');
            } else {
                container.innerHTML = '<div class="empty-state"><i class="fas fa-shopping-bag"></i><p>No orders yet</p></div>';
            }
            this._ensureOrderClickHandlers();
        } catch (error) {
            console.error('Error loading orders:', error);
            container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error loading orders</p></div>';
        }
    }

    _formatOrderStatus(status) {
        const labels = {
            pending: 'Order placed',
            processing: 'Processing',
            label_created: 'Shipping label created',
            shipped: 'Shipped',
            in_transit: 'In transit',
            delivered: 'Delivered',
            cancelled: 'Cancelled',
            refunded: 'Refunded',
        };
        const key = String(status || '').toLowerCase();
        return labels[key] || key.replace(/_/g, ' ');
    }

    _formatSalesChannel(channel) {
        const labels = {
            online: 'Online',
            in_store: 'In-store',
            mobile: 'Mobile',
            phone: 'Phone',
            other: 'Other'
        };
        const key = String(channel || 'online').toLowerCase();
        return labels[key] || key;
    }

    renderOrder(order) {
        const statusClass = order.status || 'pending';
        const statusLabel = this._formatOrderStatus(statusClass);
        const channelLabel = this._formatSalesChannel(order.sales_channel);
        const date = new Date(order.created_at).toLocaleDateString();
        const number = order.order_number || `#${order.id}`;
        return `
            <div class="order-card" data-order-id="${order.id}">
                <div class="order-header">
                    <div>
                        <div class="order-number">Order ${this._esc(number)}</div>
                        <div class="order-date">${date} · ${this._esc(channelLabel)}</div>
                    </div>
                    <span class="order-status ${this._esc(statusClass)}">${this._esc(statusLabel)}</span>
                </div>
                <div class="order-details">
                    <p><strong>Total:</strong> $${parseFloat(order.total || 0).toFixed(2)}</p>
                    <p><strong>Items:</strong> ${order.item_count || 0}</p>
                </div>
                <div style="text-align:right;margin-top:0.5rem;">
                    <button class="btn btn-secondary btn-sm" data-act="order-detail" data-id="${order.id}">View Details</button>
                </div>
                <div class="order-detail-panel" id="order-detail-${order.id}" style="display:none;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--gray-200,#e5e7eb);"></div>
            </div>
        `;
    }

    _ensureOrderClickHandlers() {
        const container = document.getElementById('orders-container');
        if (!container || container._wired) return;
        container._wired = true;
        container.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-act="order-detail"]');
            if (!btn) return;
            const id = Number(btn.dataset.id);
            const panel = document.getElementById(`order-detail-${id}`);
            if (!panel) return;
            if (panel.style.display !== 'none' && panel.dataset.loaded === '1') {
                panel.style.display = 'none';
                btn.textContent = 'View Details';
                return;
            }
            btn.textContent = 'Loading...';
            btn.disabled = true;
            try {
                const res = await this.apiRequest(`/user/orders/${id}`);
                panel.innerHTML = this._renderOrderDetail(res);
                panel.style.display = 'block';
                panel.dataset.loaded = '1';
                btn.textContent = 'Hide Details';
            } catch (err) {
                panel.innerHTML = `<p style="color:var(--error,#dc2626);">${this._esc(err.message || 'Failed to load order')}</p>`;
                panel.style.display = 'block';
                btn.textContent = 'View Details';
            } finally {
                btn.disabled = false;
            }
        });
    }

    _renderOrderDetail({ order, items, shipping_address, billing_address, payment_tenders }) {
        const esc = (s) => this._esc(s);
        const fmt = (v) => `$${parseFloat(v || 0).toFixed(2)}`;
        const tenderLabels = {
            loyalty_cash: 'Store credit',
            loyalty_points: 'Points',
            gift_card: 'Gift card',
            cash: 'Cash',
            card_terminal: 'Card',
            credit_card: 'Card',
            debit_card: 'Card',
            split: 'Split payment',
            check: 'Check'
        };
        const paymentMethod = String(order.payment_method || '').toLowerCase();
        const fallbackTender =
            !payment_tenders?.length && paymentMethod
                ? [{ tender_type: paymentMethod, amount: order.total_amount }]
                : [];
        const tendersToShow = (payment_tenders || []).length ? payment_tenders : fallbackTender;
        const tendersHtml = tendersToShow.length
            ? `<div style="margin:0 0 1rem;padding:0.75rem 1rem;background:var(--gray-50,#f9fafb);border-radius:8px;">
                <div style="font-weight:600;margin-bottom:0.35rem;">Payment</div>
                ${tendersToShow.map((t) => {
                    const label = tenderLabels[t.tender_type] || t.tender_type;
                    const extra = t.tender_type === 'loyalty_points' && t.loyalty_points
                        ? ` (${t.loyalty_points} pts)`
                        : '';
                    return `<div style="font-size:0.9rem;">${esc(label)}: ${fmt(t.amount)}${extra}</div>`;
                }).join('')}
               </div>`
            : '';
        const itemsHtml = (items || []).map(it => `
            <tr>
                <td style="padding:0.4rem;">${esc(it.product_name)}</td>
                <td style="padding:0.4rem;text-align:center;">${it.quantity}</td>
                <td style="padding:0.4rem;text-align:right;">${fmt(it.unit_price)}</td>
                <td style="padding:0.4rem;text-align:right;">${fmt(it.total_price)}</td>
            </tr>
        `).join('');
        const addrHtml = (a, label) => a ? `
            <div>
                <div style="font-weight:600;margin-bottom:0.25rem;">${label}</div>
                <div style="font-size:0.9rem;color:var(--gray-700,#374151);">
                    ${esc(a.first_name)} ${esc(a.last_name)}<br>
                    ${esc(a.address_line_1)}<br>
                    ${a.address_line_2 ? esc(a.address_line_2) + '<br>' : ''}
                    ${esc(a.city)}, ${esc(a.state)} ${esc(a.postal_code)}<br>
                    ${esc(a.country)}
                </div>
            </div>` : '';
        const statusLabel = this._formatOrderStatus(order.status);
        const st = String(order.status || '').toLowerCase();
        const progressBlock = ['cancelled', 'refunded'].includes(st)
            ? `<div style="margin-bottom:1rem;padding:0.75rem 1rem;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
                <div style="font-weight:600;">${esc(statusLabel)}</div>
               </div>`
            : (window.HMOrderProgress
                ? window.HMOrderProgress.render(order, esc)
                : '');

        return `
            ${progressBlock}
            ${tendersHtml}
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:1rem;">
                ${addrHtml(shipping_address, 'Ship To')}
                ${addrHtml(billing_address, 'Bill To')}
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                <thead>
                    <tr style="background:var(--gray-50,#f9fafb);">
                        <th style="padding:0.4rem;text-align:left;">Item</th>
                        <th style="padding:0.4rem;">Qty</th>
                        <th style="padding:0.4rem;text-align:right;">Price</th>
                        <th style="padding:0.4rem;text-align:right;">Total</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml || '<tr><td colspan="4" style="padding:1rem;text-align:center;color:var(--gray-500,#6b7280);">No items</td></tr>'}</tbody>
                <tfoot>
                    <tr><td colspan="3" style="padding:0.4rem;text-align:right;">Subtotal</td><td style="padding:0.4rem;text-align:right;">${fmt(order.subtotal)}</td></tr>
                    ${order.tax > 0 ? `<tr><td colspan="3" style="padding:0.4rem;text-align:right;">Tax</td><td style="padding:0.4rem;text-align:right;">${fmt(order.tax)}</td></tr>` : ''}
                    ${order.shipping_cost > 0 ? `<tr><td colspan="3" style="padding:0.4rem;text-align:right;">Shipping</td><td style="padding:0.4rem;text-align:right;">${fmt(order.shipping_cost)}</td></tr>` : ''}
                    ${order.discount > 0 ? `<tr><td colspan="3" style="padding:0.4rem;text-align:right;">Discount</td><td style="padding:0.4rem;text-align:right;">−${fmt(order.discount)}</td></tr>` : ''}
                    <tr style="font-weight:700;"><td colspan="3" style="padding:0.4rem;text-align:right;">Total</td><td style="padding:0.4rem;text-align:right;color:var(--primary-green,#0a7e3e);">${fmt(order.total)}</td></tr>
                </tfoot>
            </table>
        `;
    }

    renderAddress(address) {
        const defaultClass = address.is_default ? 'default' : '';
        const esc = (s) => this._esc(s);
        return `
            <div class="address-card ${defaultClass}">
                <h4 style="margin:0 0 0.25rem;">
                    ${address.type === 'shipping' ? 'Shipping' : 'Billing'} Address
                    ${address.is_default ? '<span class="order-status completed" style="margin-left:0.5rem;">Default</span>' : ''}
                </h4>
                <p style="margin:0.25rem 0;"><strong>${esc(address.first_name)} ${esc(address.last_name)}</strong></p>
                ${address.company ? `<p style="margin:0.15rem 0;color:var(--gray-600,#4b5563);">${esc(address.company)}</p>` : ''}
                <p style="margin:0.15rem 0;">${esc(address.address_line_1)}</p>
                ${address.address_line_2 ? `<p style="margin:0.15rem 0;">${esc(address.address_line_2)}</p>` : ''}
                <p style="margin:0.15rem 0;">${esc(address.city)}, ${esc(address.state)} ${esc(address.postal_code)}</p>
                <p style="margin:0.15rem 0;">${esc(address.country)}</p>
                <div class="address-actions">
                    <button class="btn btn-secondary btn-sm" data-act="edit-address" data-id="${address.id}">Edit</button>
                    ${!address.is_default ? `<button class="btn btn-secondary btn-sm" data-act="default-address" data-id="${address.id}">Set Default</button>` : ''}
                    <button class="btn btn-secondary btn-sm" data-act="delete-address" data-id="${address.id}">Delete</button>
                </div>
            </div>
        `;
    }

    // Wire delegated click handlers on the addresses container (called once)
    _ensureAddressClickHandlers() {
        const container = document.getElementById('addresses-container');
        if (!container || container._wired) return;
        container._wired = true;
        container.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            const id = Number(btn.dataset.id);
            if (btn.dataset.act === 'edit-address') {
                this.editAddress(id);
            } else if (btn.dataset.act === 'delete-address') {
                this.deleteAddress(id);
            } else if (btn.dataset.act === 'default-address') {
                try {
                    await this.apiRequest(`/user/addresses/${id}/default`, { method: 'POST' });
                    this.showNotification('Default address updated', 'success');
                    this.loadAddresses();
                } catch (err) {
                    this.showNotification(err.message || 'Failed to update default', 'error');
                }
            }
        });
    }

    async loadAddresses() {
        const container = document.getElementById('addresses-container');
        if (!container) return;

        container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading addresses...</p></div>';

        try {
            const response = await this.apiRequest('/user/addresses');
            if (response.addresses && response.addresses.length > 0) {
                container.innerHTML = response.addresses.map(address => this.renderAddress(address)).join('');
            } else {
                container.innerHTML = '<div class="empty-state"><i class="fas fa-map-marker-alt"></i><p>No saved addresses</p></div>';
            }
            this._addresses = response.addresses || [];
            this._ensureAddressClickHandlers();
        } catch (error) {
            console.error('Error loading addresses:', error);
            container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error loading addresses</p></div>';
        }
    }

    showAddAddressModal() {
        this._openAddressModal(null);
    }

    editAddress(id) {
        const addr = (this._addresses || []).find(a => a.id === id);
        if (!addr) return this.showNotification('Address not found — refresh the page', 'error');
        this._openAddressModal(addr);
    }

    async deleteAddress(id) {
        const ok = await this._confirmDialog({
            title: 'Delete address?',
            message: 'This address will be removed from your account.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!ok) return;
        try {
            await this.apiRequest(`/user/addresses/${id}`, { method: 'DELETE' });
            this.showNotification('Address deleted', 'success');
            this.loadAddresses();
        } catch (err) {
            this.showNotification(err.message || 'Failed to delete address', 'error');
        }
    }

    _openAddressModal(existing) {
        const isEdit = !!existing;
        const a = existing || {};
        const esc = (s) => this._esc(s);
        const html = `
            <h3>${isEdit ? 'Edit Address' : 'Add New Address'}</h3>
            <form id="address-form">
                <div class="form-group">
                    <label for="addr-type">Address Type</label>
                    <select id="addr-type" class="form-input" required>
                        <option value="shipping" ${(a.type || 'shipping') === 'shipping' ? 'selected' : ''}>Shipping</option>
                        <option value="billing" ${a.type === 'billing' ? 'selected' : ''}>Billing</option>
                    </select>
                </div>
                <div class="acct-form-row">
                    <div class="form-group">
                        <label for="addr-first-name">First Name</label>
                        <input type="text" id="addr-first-name" class="form-input" value="${esc(a.first_name || '')}" required>
                    </div>
                    <div class="form-group">
                        <label for="addr-last-name">Last Name</label>
                        <input type="text" id="addr-last-name" class="form-input" value="${esc(a.last_name || '')}" required>
                    </div>
                </div>
                <div class="form-group">
                    <label for="addr-company">Company (optional)</label>
                    <input type="text" id="addr-company" class="form-input" value="${esc(a.company || '')}">
                </div>
                <div class="form-group">
                    <label for="addr-line1">Address Line 1</label>
                    <input type="text" id="addr-line1" class="form-input" value="${esc(a.address_line_1 || '')}" required>
                </div>
                <div class="form-group">
                    <label for="addr-line2">Address Line 2 (optional)</label>
                    <input type="text" id="addr-line2" class="form-input" value="${esc(a.address_line_2 || '')}">
                </div>
                <div class="acct-form-row">
                    <div class="form-group">
                        <label for="addr-city">City</label>
                        <input type="text" id="addr-city" class="form-input" value="${esc(a.city || '')}" required>
                    </div>
                    <div class="form-group">
                        <label for="addr-state">State / Region</label>
                        <input type="text" id="addr-state" class="form-input" value="${esc(a.state || '')}" required>
                    </div>
                </div>
                <div class="acct-form-row">
                    <div class="form-group">
                        <label for="addr-postal">Postal Code</label>
                        <input type="text" id="addr-postal" class="form-input" value="${esc(a.postal_code || '')}" required>
                    </div>
                    <div class="form-group">
                        <label for="addr-country">Country</label>
                        <input type="text" id="addr-country" class="form-input" value="${esc(a.country || 'United States')}" required>
                    </div>
                </div>
                <div class="form-group" style="display:flex;align-items:center;gap:0.5rem;">
                    <input type="checkbox" id="addr-default" ${a.is_default ? 'checked' : ''}>
                    <label for="addr-default" style="margin:0;font-weight:500;">Make this my default ${a.type === 'billing' ? 'billing' : 'shipping'} address</label>
                </div>
                <div class="acct-modal-actions">
                    <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Save Address'}</button>
                </div>
            </form>
        `;
        const modal = this._openModal(html);
        if (window.HMHERBS_ADDRESS_AUTOCOMPLETE) {
            window.HMHERBS_ADDRESS_AUTOCOMPLETE.attach({
                root: modal,
                line1: '#addr-line1',
                line2: '#addr-line2',
                city: '#addr-city',
                state: '#addr-state',
                zip: '#addr-postal',
            });
        }
        modal.querySelector('#address-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';
            const payload = {
                type: document.getElementById('addr-type').value,
                first_name: document.getElementById('addr-first-name').value.trim(),
                last_name: document.getElementById('addr-last-name').value.trim(),
                company: document.getElementById('addr-company').value.trim() || null,
                address_line_1: document.getElementById('addr-line1').value.trim(),
                address_line_2: document.getElementById('addr-line2').value.trim() || null,
                city: document.getElementById('addr-city').value.trim(),
                state: document.getElementById('addr-state').value.trim(),
                postal_code: document.getElementById('addr-postal').value.trim(),
                country: document.getElementById('addr-country').value.trim(),
                is_default: document.getElementById('addr-default').checked,
            };
            try {
                if (isEdit) {
                    await this.apiRequest(`/user/addresses/${a.id}`, { method: 'PUT', body: payload });
                } else {
                    await this.apiRequest('/user/addresses', { method: 'POST', body: payload });
                }
                this._closeModal();
                this.showNotification(isEdit ? 'Address updated' : 'Address added', 'success');
                this.loadAddresses();
            } catch (err) {
                this.showNotification(err.message || 'Failed to save address', 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = isEdit ? 'Save Changes' : 'Save Address';
            }
        });
    }

    showChangePasswordModal() {
        const html = `
            <h3>Change Password</h3>
            <form id="password-form">
                <div class="form-group">
                    <label for="cp-current">Current Password</label>
                    <input type="password" id="cp-current" class="form-input" required autocomplete="current-password">
                </div>
                <div class="form-group">
                    <label for="cp-new">New Password</label>
                    <input type="password" id="cp-new" class="form-input" required minlength="8" autocomplete="new-password">
                    <small class="form-help">At least 8 characters with letters and numbers.</small>
                </div>
                <div class="form-group">
                    <label for="cp-confirm">Confirm New Password</label>
                    <input type="password" id="cp-confirm" class="form-input" required minlength="8" autocomplete="off">
                </div>
                <div class="acct-modal-actions">
                    <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary">Update Password</button>
                </div>
            </form>
        `;
        const modal = this._openModal(html);
        modal.querySelector('#password-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const cur = document.getElementById('cp-current').value;
            const nw = document.getElementById('cp-new').value;
            const cnf = document.getElementById('cp-confirm').value;
            if (nw !== cnf) return this.showNotification('New passwords do not match', 'error');
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';
            try {
                await this.apiRequest('/user/password', {
                    method: 'PUT',
                    body: { current_password: cur, new_password: nw },
                });
                this._closeModal();
                this.showNotification('Password updated', 'success');
            } catch (err) {
                this.showNotification(err.message || 'Failed to update password', 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Update Password';
            }
        });
    }

    // ----------------------- Generic modal helpers -----------------------
    _openModal(innerHTML, options = {}) {
        this._closeModal(true);
        // Single viewport-fixed overlay + centered card (same pattern as .auth-modal).
        const backdrop = document.createElement('div');
        backdrop.className = 'acct-modal-backdrop is-open';
        backdrop.setAttribute('role', 'presentation');

        const panel = document.createElement('div');
        panel.className = 'acct-modal';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.innerHTML = `
                <button type="button" class="acct-modal-close" aria-label="Close"><svg class="cart-close-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg></button>
                ${innerHTML}`;

        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);
        window.HMPasswordToggle?.scan(panel);

        const onBackdropClick = (e) => {
            if (e.target === backdrop) this._closeModal();
        };
        const onPanelClick = (e) => {
            if (e.target.closest('.acct-modal-close')) this._closeModal();
            if (e.target.closest('[data-act="cancel"]')) this._closeModal();
        };
        backdrop.addEventListener('click', onBackdropClick);
        panel.addEventListener('click', onPanelClick);

        this._modalKeyHandler = (e) => {
            if (e.key === 'Escape') this._closeModal();
        };
        document.addEventListener('keydown', this._modalKeyHandler);
        document.body.classList.add('auth-modal-open');

        this._acctModalOverlay = {
            backdrop,
            panel,
            onBackdropClick,
            onPanelClick,
            onDismiss: options.onDismiss,
        };

        setTimeout(() => {
            const field = panel.querySelector(
                'input:not([type="hidden"]), select, textarea'
            );
            if (field) {
                try {
                    field.focus({ preventScroll: true });
                } catch {
                    try {
                        field.focus();
                    } catch {
                        /* ignore */
                    }
                }
            }
        }, 30);
        return panel;
    }

    _closeModal(skipDismiss = false) {
        if (this._modalKeyHandler) {
            document.removeEventListener('keydown', this._modalKeyHandler);
            this._modalKeyHandler = null;
        }
        const o = this._acctModalOverlay;
        const onDismiss = o && o.onDismiss;
        if (o) {
            o.backdrop.removeEventListener('click', o.onBackdropClick);
            o.panel.removeEventListener('click', o.onPanelClick);
            o.backdrop.remove();
            this._acctModalOverlay = null;
        }
        document.body.classList.remove('auth-modal-open');
        if (!skipDismiss && typeof onDismiss === 'function') onDismiss();
    }

    /**
     * Site-styled confirmation (replaces window.confirm).
     * @returns {Promise<boolean>}
     */
    _confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false }) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (val) => {
                if (settled) return;
                settled = true;
                this._closeModal(true);
                resolve(val);
            };
            const confirmBtnClass = destructive ? 'btn btn-danger' : 'btn btn-primary';
            const html = `
                <h3>${this._esc(title)}</h3>
                <p class="acct-confirm-message">${this._esc(message)}</p>
                <div class="acct-modal-actions">
                    <button type="button" class="btn btn-secondary" data-act="cancel">${this._esc(cancelLabel)}</button>
                    <button type="button" class="${confirmBtnClass}" data-act="confirm">${this._esc(confirmLabel)}</button>
                </div>`;
            const panel = this._openModal(html, { onDismiss: () => finish(false) });
            const confirmBtn = panel.querySelector('[data-act="confirm"]');
            if (confirmBtn) {
                confirmBtn.addEventListener('click', () => finish(true), { once: true });
            }
            setTimeout(() => {
                if (confirmBtn) {
                    try {
                        confirmBtn.focus({ preventScroll: true });
                    } catch {
                        try {
                            confirmBtn.focus();
                        } catch {
                            /* ignore */
                        }
                    }
                }
            }, 40);
        });
    }

    // ----------------------- Wishlists -----------------------

    async loadWishlists() {
        const sidebar = document.getElementById('wishlist-sidebar');
        if (!sidebar) return;
        sidebar.innerHTML = '<div style="text-align:center;padding:1rem 0;color:var(--gray-500,#6b7280);font-size:0.9rem;"><i class="fas fa-spinner fa-spin"></i> Loading lists...</div>';
        try {
            const response = await this.apiRequest('/user/wishlists');
            this._wishlistCollections = response.collections || [];
            this._renderWishlistSidebar();
            // Auto-select default (or first) list
            const target = this._wishlistCollections.find(c => c.is_default) || this._wishlistCollections[0];
            if (target) this.openWishlist(target.id);
            else this._renderWishlistDetailEmpty();
        } catch (err) {
            console.error('Error loading wishlists:', err);
            sidebar.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Could not load lists</p></div>';
        }
    }

    _renderWishlistSidebar() {
        const sidebar = document.getElementById('wishlist-sidebar');
        if (!sidebar) return;
        const esc = (s) => this._esc(s);
        const collections = this._wishlistCollections || [];
        if (collections.length === 0) {
            sidebar.innerHTML = '<div style="padding:1rem;color:var(--gray-500,#6b7280);font-size:0.9rem;">No lists yet — create one above.</div>';
            return;
        }
        sidebar.innerHTML = collections.map(c => `
            <button class="wishlist-list-btn ${c.id === this._activeWishlistId ? 'active' : ''}" data-wl-id="${c.id}">
                <span style="display:flex;align-items:center;gap:0.45rem;min-width:0;">
                    <i class="fas ${c.is_default ? 'fa-heart' : 'fa-list'}" aria-hidden="true"></i>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.name)}</span>
                </span>
                <span class="badge">${c.item_count || 0}</span>
            </button>
        `).join('');
        sidebar.querySelectorAll('.wishlist-list-btn').forEach(btn => {
            btn.addEventListener('click', () => this.openWishlist(Number(btn.dataset.wlId)));
        });
    }

    _renderWishlistDetailEmpty() {
        const detail = document.getElementById('wishlist-detail');
        if (!detail) return;
        detail.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-heart"></i>
                <p>No lists yet. Create one to get started.</p>
            </div>`;
    }

    async openWishlist(id) {
        this._activeWishlistId = id;
        this._renderWishlistSidebar();
        const detail = document.getElementById('wishlist-detail');
        if (!detail) return;
        detail.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading list...</p></div>';
        try {
            const response = await this.apiRequest(`/user/wishlists/${id}/items`);
            const wl = (this._wishlistCollections || []).find(c => c.id === id) || response.wishlist;
            this._renderWishlistDetail(wl, response.items || []);
        } catch (err) {
            console.error(err);
            detail.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Could not load list</p></div>';
        }
    }

    _renderWishlistDetail(wl, items) {
        const detail = document.getElementById('wishlist-detail');
        if (!detail) return;
        const esc = (s) => this._esc(s);
        const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v) || 0);
        const headerActions = `
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" data-act="rename">Rename</button>
                ${wl.is_default ? '' : '<button class="btn btn-secondary btn-sm" data-act="make-default">Make Default</button>'}
                ${wl.is_default ? '' : '<button class="btn btn-secondary btn-sm" data-act="delete-list">Delete List</button>'}
            </div>`;
        const itemsHtml = items.length === 0
            ? `<div class="empty-state" style="padding:2rem;">
                   <i class="fas fa-heart"></i>
                   <p>This list is empty.</p>
                   <p style="font-size:0.85rem;color:var(--gray-500,#6b7280);">Browse the shop and tap the heart icon on a product to add it here.</p>
                   <a href="products.html" class="btn btn-primary" style="margin-top:0.75rem;display:inline-block;">Browse Products</a>
               </div>`
            : `<div class="wl-grid">${items.map(it => `
                <div class="wl-item" data-item-id="${it.id}">
                    <a href="product.html?slug=${encodeURIComponent(it.product_slug || '')}">
                        <img src="${esc(it.image_url || '/images/placeholder-product.jpg')}" alt="${esc(it.product_name)}" loading="lazy">
                    </a>
                    <div class="wl-name">
                        <a href="product.html?slug=${encodeURIComponent(it.product_slug || '')}" style="color:inherit;text-decoration:none;">${esc(it.product_name)}</a>
                    </div>
                    <div class="wl-price">${fmt(it.price)}</div>
                    ${it.notes ? `<div style="font-size:0.85rem;color:var(--gray-600,#4b5563);font-style:italic;">"${esc(it.notes)}"</div>` : ''}
                    <div class="wl-actions">
                        <button type="button" class="btn btn-primary" data-act="add-to-cart" data-pid="${it.product_id}" data-product-slug="${esc(it.product_slug || '')}">Add to Cart</button>
                        <button class="btn btn-secondary" data-act="move-item" data-id="${it.id}" title="Move to another list"><i class="fas fa-exchange-alt"></i></button>
                        <button class="btn btn-secondary" data-act="remove-item" data-id="${it.id}" title="Remove"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `).join('')}</div>`;

        detail.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
                <div>
                    <h3 style="margin:0 0 0.25rem;color:var(--primary-green,#0a7e3e);font-family:var(--font-display,serif);">
                        ${esc(wl.name)}
                        ${wl.is_default ? '<span class="order-status completed" style="margin-left:0.5rem;font-size:0.7em;">Default</span>' : ''}
                    </h3>
                    ${wl.description ? `<p style="margin:0;color:var(--gray-600,#4b5563);font-size:0.9rem;">${esc(wl.description)}</p>` : ''}
                </div>
                ${headerActions}
            </div>
            ${itemsHtml}`;

        // Header actions
        detail.querySelectorAll('button[data-act]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const act = btn.dataset.act;
                if (act === 'rename') return this._renameWishlistPrompt(wl);
                if (act === 'make-default') return this._setWishlistDefault(wl.id);
                if (act === 'delete-list') return this._deleteWishlist(wl.id);
                if (act === 'remove-item') return this._removeWishlistItem(wl.id, Number(btn.dataset.id));
                if (act === 'move-item') return this._moveWishlistItemPrompt(wl.id, Number(btn.dataset.id));
                if (act === 'add-to-cart') {
                    void this._addProductToCart(Number(btn.dataset.pid), (btn.dataset.productSlug || '').trim());
                    return;
                }
            });
        });
    }

    showCreateWishlistModal() {
        try {
            this._showCreateWishlistModalInner();
        } catch (err) {
            console.error('showCreateWishlistModal:', err);
            this.showNotification('Could not open new list dialog. Please refresh the page.', 'error');
        }
    }

    _showCreateWishlistModalInner() {
        const html = `
            <h3>New List</h3>
            <form id="wishlist-create-form">
                <div class="form-group">
                    <label for="wl-name">List Name</label>
                    <input type="text" id="wl-name" class="form-input" placeholder="e.g. Birthday Ideas, Reorder Soon" required maxlength="120">
                </div>
                <div class="form-group">
                    <label for="wl-desc">Description (optional)</label>
                    <input type="text" id="wl-desc" class="form-input" maxlength="500">
                </div>
                <div class="acct-modal-actions">
                    <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary">Create</button>
                </div>
            </form>`;
        const modal = this._openModal(html);
        if (!modal) {
            this.showNotification('Could not open dialog. Please refresh the page.', 'error');
            return;
        }
        const createForm = modal.querySelector('#wishlist-create-form');
        if (!createForm) {
            this.showNotification('Could not open the new list form. Please refresh the page.', 'error');
            this._closeModal();
            return;
        }
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nameEl = document.getElementById('wl-name');
            const descEl = document.getElementById('wl-desc');
            const name = (nameEl && nameEl.value ? nameEl.value : '').trim();
            const description = (descEl && descEl.value ? descEl.value : '').trim();
            if (!name) return;
            try {
                const res = await this.apiRequest('/user/wishlists', { method: 'POST', body: { name, description } });
                this._closeModal();
                this.showNotification('List created', 'success');
                await this.loadWishlists();
                const cid = res.collection && (res.collection.id ?? res.collection.ID);
                if (cid != null) this.openWishlist(Number(cid));
            } catch (err) {
                this.showNotification(err.message || 'Failed to create list', 'error');
            }
        });
    }

    _renameWishlistPrompt(wl) {
        const html = `
            <h3>Rename List</h3>
            <form id="wishlist-rename-form">
                <div class="form-group">
                    <label for="wl-rename">List Name</label>
                    <input type="text" id="wl-rename" class="form-input" value="${this._esc(wl.name)}" required maxlength="120">
                </div>
                <div class="form-group">
                    <label for="wl-rename-desc">Description</label>
                    <input type="text" id="wl-rename-desc" class="form-input" value="${this._esc(wl.description || '')}" maxlength="500">
                </div>
                <div class="acct-modal-actions">
                    <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>`;
        const modal = this._openModal(html);
        modal.querySelector('#wishlist-rename-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('wl-rename').value.trim();
            const description = document.getElementById('wl-rename-desc').value.trim();
            try {
                await this.apiRequest(`/user/wishlists/${wl.id}`, { method: 'PUT', body: { name, description } });
                this._closeModal();
                this.showNotification('List updated', 'success');
                await this.loadWishlists();
                this.openWishlist(wl.id);
            } catch (err) {
                this.showNotification(err.message || 'Failed to rename list', 'error');
            }
        });
    }

    async _setWishlistDefault(id) {
        try {
            await this.apiRequest(`/user/wishlists/${id}`, { method: 'PUT', body: { is_default: true } });
            this.showNotification('Default list updated', 'success');
            await this.loadWishlists();
            this.openWishlist(id);
        } catch (err) {
            this.showNotification(err.message || 'Failed', 'error');
        }
    }

    async _deleteWishlist(id) {
        const ok = await this._confirmDialog({
            title: 'Delete this list?',
            message: 'Items in this list will be removed. This cannot be undone.',
            confirmLabel: 'Delete list',
            destructive: true,
        });
        if (!ok) return;
        try {
            await this.apiRequest(`/user/wishlists/${id}`, { method: 'DELETE' });
            this.showNotification('List deleted', 'success');
            this._activeWishlistId = null;
            await this.loadWishlists();
        } catch (err) {
            this.showNotification(err.message || 'Failed to delete list', 'error');
        }
    }

    async _removeWishlistItem(wlId, itemId) {
        const ok = await this._confirmDialog({
            title: 'Remove from list?',
            message: 'This product will be removed from the list.',
            confirmLabel: 'Remove',
            destructive: true,
        });
        if (!ok) return;
        try {
            await this.apiRequest(`/user/wishlists/${wlId}/items/${itemId}`, { method: 'DELETE' });
            this.openWishlist(wlId);
            await this.loadWishlists(); // refresh counts in sidebar
        } catch (err) {
            this.showNotification(err.message || 'Failed to remove item', 'error');
        }
    }

    _moveWishlistItemPrompt(fromWlId, itemId) {
        const others = (this._wishlistCollections || []).filter(c => c.id !== fromWlId);
        if (others.length === 0) {
            return this.showNotification('No other lists yet — create one first.', 'info');
        }
        const optionsHtml = others.map(c => `<option value="${c.id}">${this._esc(c.name)}${c.is_default ? ' (default)' : ''}</option>`).join('');
        const html = `
            <h3>Move / Copy Item</h3>
            <form id="wl-move-form">
                <div class="form-group">
                    <label for="wl-move-target">Destination List</label>
                    <select id="wl-move-target" class="form-input">${optionsHtml}</select>
                </div>
                <div class="form-group">
                    <label for="wl-move-mode">Action</label>
                    <select id="wl-move-mode" class="form-input">
                        <option value="move">Move (remove from current list)</option>
                        <option value="copy">Copy (keep in both lists)</option>
                    </select>
                </div>
                <div class="acct-modal-actions">
                    <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary">Apply</button>
                </div>
            </form>`;
        const modal = this._openModal(html);
        modal.querySelector('#wl-move-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const target_collection_id = Number(document.getElementById('wl-move-target').value);
            const mode = document.getElementById('wl-move-mode').value;
            try {
                await this.apiRequest(`/user/wishlists/${fromWlId}/items/${itemId}/move`, {
                    method: 'POST',
                    body: { target_collection_id, mode },
                });
                this._closeModal();
                this.showNotification(mode === 'copy' ? 'Item copied' : 'Item moved', 'success');
                this.openWishlist(fromWlId);
                await this.loadWishlists();
            } catch (err) {
                this.showNotification(err.message || 'Failed', 'error');
            }
        });
    }

    async _fetchPublicProductForCart(slugOrId) {
        const key = String(slugOrId || '').trim();
        if (!key) return null;
        const url = `${String(this.apiBaseUrl || '').replace(/\/$/, '')}/products/${encodeURIComponent(key)}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        return res.json();
    }

    /** Shape expected by HMHerbsApp.addProductToCart */
    _apiProductToCartPayload(prod) {
        if (!prod || prod.id == null) return null;
        const imgs = prod.images || [];
        const primary = imgs.find((i) => Number(i.is_primary) === 1) || imgs[0];
        let imageUrl = (primary && primary.image_url) || prod.image_url || '';
        const origin = String(this.apiBaseUrl || '').replace(/\/api\/?$/i, '');
        if (imageUrl && !/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith('data:') && origin && imageUrl.startsWith('/')) {
            imageUrl = origin + imageUrl;
        }
        let inv = prod.inventory_quantity;
        if (inv === undefined && Array.isArray(prod.variants)) {
            inv = prod.variants.reduce((s, v) => s + (Number(v.inventory_quantity) || 0), 0);
        }
        return {
            id: prod.id,
            name: prod.name,
            price: Number(prod.price) || 0,
            image: imageUrl,
            inventory_quantity: inv,
            inStock: inv === undefined ? true : Number(inv) > 0,
        };
    }

    async _addProductToCart(productId, productSlug) {
        const slug = String(productSlug || '').trim();
        const app = window.hmHerbsApp;

        if (app && typeof app.addToCart === 'function' && Array.isArray(app.products) && app.products.length) {
            const hit = app.products.find((p) => String(p.id) === String(productId));
            if (hit) {
                app.addToCart(productId, 1);
                return;
            }
        }

        if (app && typeof app.addProductToCart === 'function') {
            const key = slug || String(productId);
            try {
                const prod = await this._fetchPublicProductForCart(key);
                const payload = this._apiProductToCartPayload(prod);
                if (payload) {
                    app.addProductToCart(payload, 1);
                    return;
                }
            } catch (e) {
                console.error('Wishlist add to cart:', e);
            }
        }

        if (window.cartManager && typeof window.cartManager.addToCart === 'function') {
            window.cartManager.addToCart(productId, 1);
            this.showNotification('Added to cart', 'success');
            return;
        }

        if (window.app && typeof window.app.addToCart === 'function') {
            window.app.addToCart(productId, 1);
            return;
        }

        if (slug) {
            window.location.href = `product.html?slug=${encodeURIComponent(slug)}`;
        } else if (productId) {
            window.location.href = `product.html?id=${encodeURIComponent(String(productId))}`;
        } else {
            this.showNotification('Could not add this item to the cart.', 'error');
        }
    }

    async apiRequest(endpoint, options = {}) {
        const token = window.customerAuth.getToken();
        const url = `${this.apiBaseUrl}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
        };

        const config = { ...defaultOptions, ...options };
        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }

        try {
            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error('API request error:', error);
            throw error;
        }
    }

    showNotification(message, type = 'info') {
        if (window.customerAuth && typeof window.customerAuth.showNotification === 'function') {
            window.customerAuth.showNotification(message, type);
        } else {
            alert(message);
        }
    }

    // -----------------------------------------------------------------
    // Loyalty / Rewards
    // -----------------------------------------------------------------
    async loadLoyalty() {
        const container = document.getElementById('loyalty-history-container');
        const cardInfo = document.getElementById('loyalty-card-info');
        try {
            const response = await this.apiRequest('/user/loyalty');
            const loyalty = response.loyalty || {};
            const settings = response.settings || {};
            const fmt = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);
            const fmtMoney = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);

            document.getElementById('loyalty-cash-balance').textContent = fmtMoney(loyalty.cash_balance);
            document.getElementById('loyalty-points-balance').textContent = fmt(loyalty.points_balance);
            const enrollLabels = { cash: 'Cash-back store credit', points: 'Points', both: 'Cash-back + points' };
            document.getElementById('loyalty-enrollment').textContent =
                enrollLabels[loyalty.loyalty_enrollment] || enrollLabels.cash;
            document.getElementById('loyalty-member-since').textContent =
                loyalty.member_since ? new Date(loyalty.member_since).toLocaleDateString() : '—';

            if (cardInfo) {
                const parts = [];
                if (settings.cashEnabled !== false && settings.cashbackPercent > 0) {
                    parts.push(`Earn <strong>${settings.cashbackPercent}%</strong> back as store credit on eligible purchases`);
                }
                if (settings.pointsEnabled !== false) {
                    parts.push(`Earn <strong>${settings.pointsPerDollar || 1}</strong> point(s) per dollar spent`);
                }
                cardInfo.innerHTML = parts.length
                    ? parts.join(' · ')
                    : '<em>Rewards program details will appear here.</em>';
            }

            if (container) {
                if (response.transactions && response.transactions.length > 0) {
                    container.innerHTML = response.transactions.map(t => {
                        const isCash = t.reward_type === 'cash';
                        const change = isCash ? Number(t.cash_change) : Number(t.points_change);
                        const sign = change >= 0 ? '+' : '';
                        const color = change >= 0 ? 'var(--success, #16a34a)' : 'var(--error, #dc2626)';
                        const changeLabel = isCash ? `${sign}${fmtMoney(change)}` : `${sign}${fmt(change)} pts`;
                        const typeLabel = isCash ? 'Store credit' : 'Points';
                        return `
                            <div class="order-card" style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 1rem;">
                                <div>
                                    <div style="font-weight:600;text-transform:capitalize;">${t.transaction_type.replace('_',' ')} <span style="font-weight:500;color:var(--gray-500,#6b7280);">(${typeLabel})</span></div>
                                    <div style="font-size:0.85rem;color:var(--gray-500,#6b7280);">${new Date(t.created_at).toLocaleString()}${t.description ? ' — ' + this._esc(t.description) : ''}</div>
                                </div>
                                <div style="font-weight:700;color:${color};">${changeLabel}</div>
                            </div>`;
                    }).join('');
                } else {
                    container.innerHTML = '<div class="empty-state"><i class="fas fa-star"></i><p>No loyalty activity yet</p></div>';
                }
            }
        } catch (error) {
            console.error('Error loading loyalty:', error);
            if (container) container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Could not load rewards</p></div>';
        }
    }

    // -----------------------------------------------------------------
    // Gift cards
    // -----------------------------------------------------------------
    async loadGiftCards() {
        const container = document.getElementById('gift-cards-container');
        if (!container) return;

        container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading gift cards...</p></div>';

        try {
            const response = await this.apiRequest('/user/gift-cards');
            if (response.gift_cards && response.gift_cards.length > 0) {
                container.innerHTML = response.gift_cards.map(g => this.renderGiftCard(g)).join('');
            } else {
                container.innerHTML = '<div class="empty-state"><i class="fas fa-gift"></i><p>No gift cards yet</p></div>';
            }
        } catch (error) {
            console.error('Error loading gift cards:', error);
            container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Could not load gift cards</p></div>';
        }
    }

    renderGiftCard(g) {
        const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: g.currency || 'USD' }).format(Number(v) || 0);
        const cardType = g.card_type === 'physical' ? 'physical' : 'digital';
        const cardHtml =
            window.HmGiftCard?.markup({
                amount: Number(g.current_balance),
                cardType,
                code: g.code
            }) ||
            `<div class="address-card">${this._esc(g.code)}</div>`;
        return `
            <div class="gift-cards-container">
                ${cardHtml}
                <div class="gift-card-account-meta">
                    <div class="gift-card-account-balance">
                        <span class="gift-card-account-label">Balance</span>
                        <span class="gift-card-account-value">${fmt(g.current_balance)}</span>
                    </div>
                    <div class="gift-card-account-status">
                        <span class="gift-card-account-label">Status</span>
                        <span class="gift-card-account-value">${this._esc(g.status)}</span>
                    </div>
                </div>
                ${g.personal_message ? `<p class="gift-card-account-message">&ldquo;${this._esc(g.personal_message)}&rdquo;</p>` : ''}
            </div>`;
    }

    bindGiftCardLookup() {
        const form = document.getElementById('gift-card-balance-form');
        if (!form || form._bound) return;
        form._bound = true;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('gc-code-input').value.trim();
            const pin  = document.getElementById('gc-pin-input').value.trim();
            const result = document.getElementById('gc-balance-result');
            result.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
            try {
                const res = await fetch(`${this.apiBaseUrl}/gift-cards/check-balance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, pin: pin || undefined }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Lookup failed');
                const g = data.gift_card;
                const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: g.currency || 'USD' }).format(Number(v) || 0);
                result.innerHTML = `
                    <div style="padding:1rem;background:#dcfce7;border:1px solid #16a34a;border-radius:8px;">
                        <div><strong>Status:</strong> <span style="text-transform:capitalize;">${this._esc(g.status)}</span></div>
                        <div><strong>Balance:</strong> ${fmt(g.current_balance)} of ${fmt(g.initial_balance)}</div>
                    </div>`;
            } catch (err) {
                result.innerHTML = `<div style="padding:1rem;background:#fee2e2;border:1px solid #dc2626;border-radius:8px;color:#991b1b;">${this._esc(err.message)}</div>`;
            }
        });
    }

    _esc(s) {
        if (s === null || s === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(s);
        return div.innerHTML;
    }
}

/** Inline `onclick` on account.html and external callers use this (defined before boot). */
window.hmHerbsShowNewWishlistModal = function () {
    try {
        const m = window.accountManager;
        if (m && typeof m.showCreateWishlistModal === 'function') {
            m.showCreateWishlistModal();
        }
    } catch (e) {
        console.error(e);
    }
};

// Boot after customer-auth.js has defined window.customerAuth (same defer batch can be
// subtle across browsers). Avoid redirecting to index while auth is still initializing.
function bootAccountManager() {
    if (!window.customerAuth) {
        if ((bootAccountManager._n = (bootAccountManager._n || 0) + 1) > 200) {
            window.location.href = 'index.html';
            return;
        }
        setTimeout(bootAccountManager, 0);
        return;
    }
    window.accountManager = new AccountManager();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootAccountManager);
} else {
    bootAccountManager();
}

