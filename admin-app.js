// Business One merchant admin

const HM_CLOSE_ICON_SVG = '<svg class="cart-close-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>';

class AdminApp {
    constructor() {
        // Dynamic API base URL configuration
        this.apiBaseUrl = this.getApiBaseUrl();
        this.authToken = localStorage.getItem('adminToken');
        this.currentUser = null;
        this.allowedSections = null;
        this.defaultSection = 'dashboard';
        this.canManageStoreHours = false;
        this.canManageStoreHoursDelegation = false;
        this.eventListeners = []; // Track event listeners for cleanup
        this.timeouts = []; // Track timeouts for cleanup
        this.allProducts = []; // Store all products for search/filtering
        this.allBrands = []; // Store all brands for filtering
        this.allCategories = []; // Store all categories for filtering
        this.allCategoriesForFilter = []; // Store all categories for category section filtering
        this.selectedProductIds = new Set();
        this.holidaySchedule = [];
        this.productsPagination = {
            currentPage: 1,
            itemsPerPage: 50,
            totalPages: 1,
            totalProducts: 0,
            useServerPagination: true // Use server pagination when no filters active
        };
        this._productsLoadRequestId = 0;
        this._serverProductsSearch = '';
        this._promoPickerProducts = { scope: new Map(), buy: new Map(), get: new Map(), trigger: new Map() };
        this._promoRewardRuleSeq = 0;
        this._promoPickerCategories = new Map();
        this._promoCategoriesCache = null;
        this._promoProductPickersReady = false;
        this._promoProdSearchTimers = {};
        /** @type {HTMLElement | null} Element to restore focus when closing the checkout promo editor modal */
        this._promoEditorReturnFocus = null;
        this.categoriesPagination = {
            currentPage: 1,
            itemsPerPage: 50,
            totalPages: 1,
            totalCategories: 0
        };
        this.categoriesViewTab = 'shop';
        this._categoriesTabsReady = false;
        this._edsaBookingsById = new Map();

        this.init();
    }

    getApiBaseUrl() {
        // Check if we're using file:// protocol (opened directly)
        if (window.location.protocol === 'file:') {
            console.warn('âš ï¸ Admin panel opened via file:// protocol. Please use a web server.');
            console.warn('ðŸ’¡ Start the backend server: cd backend && npm start');
            console.warn('ðŸ’¡ Then access: http://localhost:3001/admin.html');
            // Still return the API URL for when server is running
            return 'http://localhost:3001/api';
        }

        // Check if we're in development (localhost)
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            // If served from backend server, use relative path
            if (window.location.port === '3001') {
                return '/api';
            }
            return 'http://localhost:3001/api';
        }

        // For production, use the same origin with /api path
        return `${window.location.origin}/api`;
    }

    async init() {
        // Ensure login screen is visible and dashboard is hidden initially
        const loginScreen = document.getElementById('loginScreen');
        const adminDashboard = document.getElementById('adminDashboard');
        if (loginScreen) loginScreen.style.display = 'flex';
        if (adminDashboard) adminDashboard.style.display = 'none';

        const initParams = new URLSearchParams(window.location.search);
        if (initParams.get('fresh_login') === '1') {
            localStorage.removeItem('adminToken');
            this.authToken = null;
            initParams.delete('fresh_login');
            const qs = initParams.toString();
            window.history.replaceState({}, document.title, qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
        }

        const handoffOk = await this.tryPosHandoffFromUrl();
        if (handoffOk) {
            try {
                await this.loadDashboard();
            } catch (error) {
                console.error('Failed to load dashboard after POS handoff:', error);
                this.logout();
            }
            this.setupEventListeners();
            void this.setupGoogleSignIn();
            return;
        }

        this.setupEventListeners();

        // Check if user is already logged in
        if (this.authToken) {
            try {
                const sessionOk = await this.loadSession();
                if (!sessionOk) {
                    this.logout();
                    return;
                }
                await this.loadDashboard();
            } catch (error) {
                // If dashboard load fails (e.g., invalid/expired token), logout silently
                // Don't log errors for authentication failures - they're expected
                if (error.message === 'Authentication required' ||
                    error.message.includes('Invalid admin token') ||
                    error.message.includes('403')) {
                    this.logout();
                } else {
                    // Only log unexpected errors
                    console.error('Failed to load dashboard:', error);
                    this.logout();
                }
            }
        }

        void this.setupGoogleSignIn();
    }

    async tryPosHandoffFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('pos_handoff');
        if (!code) return false;
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/auth/pos-handoff`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'POS admin handoff failed');
            }
            this.authToken = data.token;
            localStorage.setItem('adminToken', this.authToken);
            window.history.replaceState({}, document.title, window.location.pathname);
            this.showToast('Signed in from POS register', 'success');
            return true;
        } catch (error) {
            console.warn('POS admin handoff:', error.message);
            window.history.replaceState({}, document.title, window.location.pathname);
            const loginError = document.getElementById('loginError');
            if (loginError) {
                loginError.textContent = error.message || 'POS sign-in link expired. Use your password.';
                loginError.style.display = 'block';
            }
            return false;
        }
    }

    // Helper function to escape HTML to prevent XSS
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    formatAdminMoney(amount) {
        const value = Number(amount) || 0;
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
    }

    formatAdminDateTime(value) {
        if (!value) return '-';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
    }

    _orderStatusBadgeClass(status) {
        const s = String(status || '').toLowerCase();
        if (s === 'delivered' || s === 'completed') return 'badge-success';
        if (s === 'pending' || s === 'cancelled' || s === 'refunded') return 'badge-warning';
        return 'badge-info';
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

    _formatFulfillmentStatus(status) {
        const labels = {
            unfulfilled: 'Awaiting fulfillment',
            partial: 'Label created - awaiting carrier scan',
            fulfilled: 'Fulfilled',
        };
        const key = String(status || '').toLowerCase();
        return labels[key] || key;
    }

    _formatPaymentMethod(order) {
        let method = String(order?.payment_method || '').trim().toLowerCase();
        if (!method && order?.notes) {
            const match = String(order.notes).match(/Payment method:\s*([a-z_]+)/i);
            if (match) method = match[1].toLowerCase();
        }
        const labels = {
            gift_card: 'Gift card',
            card: 'Credit card',
            credit_card: 'Credit card',
            bank_account: 'Bank account',
            nmi: 'Credit card',
        };
        return labels[method] || (method ? method.replace(/_/g, ' ') : '-');
    }

    _formatSalesChannel(order) {
        const channel = String(order?.sales_channel || 'online').trim().toLowerCase();
        const labels = {
            online: 'Online',
            in_store: 'In-store',
            mobile: 'Mobile',
            phone: 'Phone',
            other: 'Other'
        };
        return labels[channel] || channel.replace(/_/g, ' ');
    }

    _salesChannelBadgeClass(order) {
        const channel = String(order?.sales_channel || 'online').trim().toLowerCase();
        return channel === 'in_store' ? 'badge-info' : 'badge-secondary';
    }

    _renderOrderProgress(order) {
        const hasLabel = !!(order.label_url || order.label_created_at);
        const trackingLink = window.HMTrackingLink
            ? window.HMTrackingLink.renderTrackingLink(order, (s) => this.escapeHtml(s), {
                empty: '<span style="color:var(--gray-500);">-</span>',
            })
            : (order.tracking_url && order.tracking_number
                ? `<a href="${this.escapeHtml(order.tracking_url)}" target="_blank" rel="noopener" style="color:var(--primary-green);font-weight:600;">${this.escapeHtml(order.tracking_number)}</a>`
                : '<span style="color:var(--gray-500);">-</span>');

        const gridCells = [
            `<div><div style="font-size:0.75rem;color:var(--gray-500);text-transform:uppercase;">Status</div><div style="font-weight:600;">${this.escapeHtml(this._formatOrderStatus(order.status))}</div></div>`,
        ];
        if (hasLabel) {
            gridCells.push(
                `<div><div style="font-size:0.75rem;color:var(--gray-500);text-transform:uppercase;">Carrier</div><div>${this.escapeHtml(order.shipping_carrier || '-')}</div></div>`,
                `<div><div style="font-size:0.75rem;color:var(--gray-500);text-transform:uppercase;">Service</div><div>${this.escapeHtml(order.shipping_service || '-')}</div></div>`
            );
        } else {
            gridCells.push(
                `<div><div style="font-size:0.75rem;color:var(--gray-500);text-transform:uppercase;">Fulfillment</div><div>${this.escapeHtml(this._formatFulfillmentStatus(order.fulfillment_status))}</div></div>`
            );
        }
        gridCells.push(
            `<div><div style="font-size:0.75rem;color:var(--gray-500);text-transform:uppercase;">Payment</div><div>${this.escapeHtml(order.payment_status || '-')}${order.payment_method || (order.notes && /Payment method:/i.test(order.notes)) ? ` \u00B7 ${this.escapeHtml(this._formatPaymentMethod(order))}` : ''}</div></div>`,
            `<div><div style="font-size:0.75rem;color:var(--gray-500);text-transform:uppercase;">Tracking</div><div>${trackingLink}</div></div>`
        );

        const steps = [
            { key: 'placed', label: 'Order placed', done: true, at: order.created_at },
            { key: 'label', label: 'Shipping label created', done: !!order.label_created_at || !!order.label_url, at: order.label_created_at },
            { key: 'shipped', label: 'Shipped', done: ['shipped', 'in_transit', 'delivered'].includes(String(order.status || '').toLowerCase()), at: order.shipped_at },
            { key: 'delivered', label: 'Delivered', done: String(order.status || '').toLowerCase() === 'delivered', at: order.delivered_at },
        ];
        const st = String(order.status || '').toLowerCase();
        const detailForStep = (step) => {
            const detail = String(order.tracking_status_detail || '').trim();
            if (!detail || !step.done) return '';
            if (step.key === 'label' && st === 'label_created') return detail;
            if (step.key === 'shipped' && (st === 'shipped' || st === 'in_transit')) return detail;
            if (step.key === 'delivered' && st === 'delivered') return detail;
            return '';
        };
        const timeline = steps.map((step) => {
            const stepDetail = detailForStep(step);
            return `
            <div style="display:flex;gap:0.75rem;align-items:flex-start;margin-bottom:0.5rem;">
                <span style="width:10px;height:10px;border-radius:50%;margin-top:0.35rem;flex-shrink:0;background:${step.done ? 'var(--primary-green)' : 'var(--gray-300)'};"></span>
                <div>
                    <div style="font-weight:${step.done ? '600' : '400'};color:${step.done ? 'var(--gray-800)' : 'var(--gray-500)'};">${this.escapeHtml(step.label)}</div>
                    ${step.at ? `<div style="font-size:0.8rem;color:var(--gray-500);">${this.formatAdminDateTime(step.at)}</div>` : ''}
                    ${stepDetail ? `<div style="font-size:0.8rem;color:var(--gray-600);margin-top:0.15rem;">${this.escapeHtml(stepDetail)}</div>` : ''}
                </div>
            </div>`;
        }).join('');

        const printLabel = hasLabel && order.label_url
            ? `<div style="margin-top:0.75rem;"><a class="btn btn-primary btn-sm" href="${this.escapeHtml(order.label_url)}" target="_blank" rel="noopener"><i class="fas fa-print"></i> Print label</a></div>`
            : '';

        return `
            <div style="padding:1rem;background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1rem;">
                    ${gridCells.join('')}
                </div>
                <div style="border-top:1px solid var(--gray-200);padding-top:0.75rem;">${timeline}</div>
                ${printLabel}
                <p style="font-size:0.8rem;color:var(--gray-500);margin:0.75rem 0 0;">Status and tracking update automatically from Shippo when labels are created and carriers scan packages.</p>
            </div>`;
    }

    _mountAdminModal(html) {
        const root = document.getElementById('adminModalRoot');
        if (!root) return null;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.cssText =
            'display:flex;position:fixed;z-index:10000;inset:0;background:rgba(0,0,0,0.6);align-items:flex-start;justify-content:center;padding:2rem 1rem;overflow-y:auto;';
        modal.innerHTML = `
            <div class="modal-content" style="background:#fff;border-radius:var(--radius-lg, 8px);max-width:980px;width:100%;position:relative;max-height:calc(100vh - 4rem);overflow-y:auto;box-shadow:0 25px 50px -12px rgba(0,0,0,0.3);">
                ${html}
            </div>`;

        const onEscape = (e) => {
            if (e.key !== 'Escape') return;
            if (!modal.isConnected) {
                document.removeEventListener('keydown', onEscape, true);
                return;
            }
            e.preventDefault();
            modal.remove();
            document.removeEventListener('keydown', onEscape, true);
        };
        document.addEventListener('keydown', onEscape, true);

        const mo = new MutationObserver(() => {
            if (!modal.isConnected) {
                document.removeEventListener('keydown', onEscape, true);
                mo.disconnect();
            }
        });
        mo.observe(root, { childList: true });

        root.appendChild(modal);
        return modal;
    }

    _formatAddressBlock(prefix, order) {
        const lines = [
            [order[`${prefix}_first_name`], order[`${prefix}_last_name`]].filter(Boolean).join(' '),
            order[`${prefix}_company`],
            order[`${prefix}_address_line_1`],
            order[`${prefix}_address_line_2`],
            [order[`${prefix}_city`], order[`${prefix}_state`], order[`${prefix}_postal_code`]].filter(Boolean).join(', '),
            order[`${prefix}_country`],
        ].filter((line) => line && String(line).trim());
        return lines.length
            ? lines.map((line) => `<div>${this.escapeHtml(line)}</div>`).join('')
            : '<div style="color:var(--gray-500);">-</div>';
    }

    async refreshOrderProgressPanel(orderId, modal) {
        if (!modal) return;
        try {
            const data = await this.apiRequest(`/admin/orders/${orderId}`);
            if (!data?.order) return;
            const panel = modal.querySelector('#order-progress-panel');
            if (panel) {
                panel.innerHTML = `
                    <h4 style="margin:1rem 0 0.75rem;color:var(--gray-800);">Order progress</h4>
                    ${this._renderOrderProgress(data.order)}`;
            }
            const badges = modal.querySelector('.modal-content > div:first-child .badge');
            // refresh header badges
            const headerBadges = modal.querySelectorAll('.modal-content > div:first-child span.badge');
            if (headerBadges.length >= 1) {
                headerBadges[0].textContent = this._formatOrderStatus(data.order.status);
                headerBadges[0].className = `badge ${this._orderStatusBadgeClass(data.order.status)}`;
            }
            if (headerBadges.length >= 3 && data.order.fulfillment_status) {
                headerBadges[2].textContent = this._formatFulfillmentStatus(data.order.fulfillment_status);
            }
        } catch (_) {
            /* non-fatal */
        }
    }

    async showOrderDetail(orderId) {
        if (!this.authToken) {
            this.showNotification('Please log in to view orders.', 'error');
            return;
        }

        try {
            const data = await this.apiRequest(`/admin/orders/${orderId}`);
            if (!data || !data.order) {
                this.showNotification('Order not found', 'error');
                return;
            }

            const order = data.order;
            const items = data.items || [];
            const customerName = [order.shipping_first_name, order.shipping_last_name].filter(Boolean).join(' ')
                || [order.account_first_name, order.account_last_name].filter(Boolean).join(' ')
                || '-';
            const closeBtn =
                `<button type="button" class="modal-close" onclick="this.closest('.modal').remove()" aria-label="Close">${HM_CLOSE_ICON_SVG}</button>`;

            const itemsHtml = items.length
                ? `<div class="table-container"><table class="table">
                    <thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
                    <tbody>
                    ${items.map((item) => `
                        <tr>
                            <td>${this.escapeHtml(item.product_name || '')}${item.variant_name ? `<div style="font-size:0.8rem;color:var(--gray-500);">${this.escapeHtml(item.variant_name)}</div>` : ''}</td>
                            <td><code>${this.escapeHtml(item.product_sku || '')}</code></td>
                            <td>${item.quantity || 0}</td>
                            <td>${this.formatAdminMoney(item.price)}</td>
                            <td>${this.formatAdminMoney(item.total)}</td>
                        </tr>`).join('')}
                    </tbody></table></div>`
                : '<p style="color:var(--gray-500);">No line items.</p>';

            const modal = this._mountAdminModal(`
                <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:1.5rem;border-bottom:1px solid var(--gray-200);gap:1rem;">
                    <div>
                        <h3 style="margin:0 0 0.35rem;color:var(--primary-green);">Order <code>${this.escapeHtml(order.order_number)}</code></h3>
                        <div style="font-size:0.85rem;color:var(--gray-500);">${this.formatAdminDateTime(order.created_at)}</div>
                        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem;">
                            <span class="badge ${this._orderStatusBadgeClass(order.status)}">${this.escapeHtml(this._formatOrderStatus(order.status))}</span>
                            <span class="badge ${this._salesChannelBadgeClass(order)}">${this.escapeHtml(this._formatSalesChannel(order))}</span>
                            <span class="badge ${order.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}">${this.escapeHtml(order.payment_status)}</span>
                            ${order.fulfillment_status ? `<span class="badge badge-info">${this.escapeHtml(this._formatFulfillmentStatus(order.fulfillment_status))}</span>` : ''}
                        </div>
                    </div>
                    ${closeBtn}
                </div>

                <div style="padding:1.5rem;display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
                    <div>
                        <h4 style="margin:0 0 0.75rem;color:var(--gray-800);">Customer</h4>
                        <div style="font-size:0.95rem;line-height:1.5;">
                            <div><strong>${this.escapeHtml(customerName)}</strong></div>
                            <div>${this.escapeHtml(order.email || order.account_email || '')}</div>
                            ${order.customer_number ? `<div style="color:var(--gray-500);margin-top:0.25rem;"><code>${this.escapeHtml(order.customer_number)}</code></div>` : ''}
                            ${order.user_id ? `<button type="button" class="btn btn-sm btn-secondary" id="orderViewCustomerBtn" style="margin-top:0.75rem;"><i class="fas fa-user"></i> View customer</button>` : ''}
                        </div>
                    </div>
                    <div>
                        <h4 style="margin:0 0 0.75rem;color:var(--gray-800);">Order totals</h4>
                        <div style="font-size:0.95rem;line-height:1.6;">
                            <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>${this.formatAdminMoney(order.subtotal)}</span></div>
                            <div style="display:flex;justify-content:space-between;"><span>Discount</span><span>-${this.formatAdminMoney(order.discount_amount)}</span></div>
                            <div style="display:flex;justify-content:space-between;"><span>Shipping</span><span>${this.formatAdminMoney(order.shipping_amount)}</span></div>
                            <div style="display:flex;justify-content:space-between;"><span>Tax</span><span>${this.formatAdminMoney(order.tax_amount)}</span></div>
                            <div style="display:flex;justify-content:space-between;font-weight:700;margin-top:0.35rem;padding-top:0.35rem;border-top:1px solid var(--gray-200);"><span>Total</span><span>${this.formatAdminMoney(order.total_amount)}</span></div>
                            ${order.promo_code ? `<div style="margin-top:0.5rem;color:var(--gray-600);">Promo: <code>${this.escapeHtml(order.promo_code)}</code></div>` : ''}
                        </div>
                    </div>
                    <div>
                        <h4 style="margin:0 0 0.75rem;color:var(--gray-800);">Shipping address</h4>
                        ${this._formatAddressBlock('shipping', order)}
                    </div>
                    <div>
                        <h4 style="margin:0 0 0.75rem;color:var(--gray-800);">Billing address</h4>
                        ${this._formatAddressBlock('billing', order)}
                    </div>
                </div>

                <div style="padding:0 1.5rem 1.5rem;">
                    <h4 style="margin:0 0 0.75rem;color:var(--gray-800);">Items (${items.length})</h4>
                    ${itemsHtml}
                </div>

                <div id="order-progress-panel" style="padding:0 1.5rem 1.5rem;border-top:1px solid var(--gray-200);">
                    <h4 style="margin:1rem 0 0.75rem;color:var(--gray-800);">Order progress</h4>
                    ${this._renderOrderProgress(order)}
                </div>

                <div id="order-shipping-fulfillment" style="padding:0 1.5rem 1.5rem;border-top:1px solid var(--gray-200);"></div>

                <div style="padding:0 1.5rem 1.5rem;display:flex;justify-content:flex-end;">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">Close</button>
                </div>
            `);

            if (!modal) return;

            const shipSlot = modal.querySelector('#order-shipping-fulfillment');
            if (shipSlot && window.HMShippingFulfillment) {
                void window.HMShippingFulfillment.mount(orderId, shipSlot, this, modal);
            }

            const viewCustomerBtn = modal.querySelector('#orderViewCustomerBtn');
            if (viewCustomerBtn && order.user_id && typeof this.showCustomerProfile === 'function') {
                viewCustomerBtn.addEventListener('click', () => {
                    modal.remove();
                    this.showCustomerProfile(order.user_id);
                });
            }

        } catch (error) {
            this.showNotification(error.message || 'Failed to load order', 'error');
        }
    }

    setupEventListeners() {
        if (this._adminUiListenersBound) return;
        this._adminUiListenersBound = true;

        // Login form
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        const adminGoogleSignInBtn = document.getElementById('adminGoogleSignInBtn');
        if (adminGoogleSignInBtn && !adminGoogleSignInBtn.dataset.wired) {
            adminGoogleSignInBtn.dataset.wired = '1';
            adminGoogleSignInBtn.addEventListener('click', () => this.startGoogleSignIn());
        }

        // Forgot password link
        const forgotPasswordLink = document.getElementById('forgotPasswordLink');
        if (forgotPasswordLink) {
            forgotPasswordLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.showForgotPasswordModal();
            });
        }

        // Forgot password form
        const forgotPasswordForm = document.getElementById('forgotPasswordForm');
        if (forgotPasswordForm) {
            forgotPasswordForm.addEventListener('submit', (e) => this.handleForgotPassword(e));
        }

        // Close forgot password modal
        const closeForgotPasswordModal = document.getElementById('closeForgotPasswordModal');
        const cancelForgotPassword = document.getElementById('cancelForgotPassword');
        if (closeForgotPasswordModal) {
            closeForgotPasswordModal.addEventListener('click', () => this.hideForgotPasswordModal());
        }
        if (cancelForgotPassword) {
            cancelForgotPassword.addEventListener('click', () => this.hideForgotPasswordModal());
        }

        // Navigation
        document.querySelectorAll('.nav-link[data-section]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.target.closest('.nav-link').dataset.section;
                this.showSection(section);
            });
        });

        const lowStockCardLink = document.getElementById('lowStockCardLink');
        if (lowStockCardLink) {
            lowStockCardLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.showSection('low-stock');
            });
        }

        window.addEventListener('hashchange', () => {
            if (!this.authToken) return;
            const deep = this.parseAdminDeepLink();
            if (deep) {
                this.showSection(deep.section, { skipHashUpdate: true }).then(() => {
                    if (deep.bookingId && deep.section === 'edsa') {
                        this.openEdsaBookingWhenReady(deep.bookingId);
                    }
                });
            }
        });
    }

    parseAdminDeepLink() {
        const hash = window.location.hash.replace(/^#/, '').trim();
        if (!hash) return null;
        const section = hash.split(/[/?&]/)[0];
        if (!document.querySelector(`[data-section="${section}"]`)) return null;
        const bookingParam = new URLSearchParams(window.location.search).get('booking');
        const bookingId = Number(bookingParam);
        return {
            section,
            bookingId: Number.isFinite(bookingId) && bookingId > 0 ? bookingId : null,
        };
    }

    updateAdminUrlHash(sectionName) {
        try {
            const url = new URL(window.location.href);
            url.hash = sectionName;
            if (sectionName !== 'edsa') {
                url.searchParams.delete('booking');
            }
            const next = `${url.pathname}${url.search}${url.hash}`;
            if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
                history.replaceState(null, '', next);
            }
        } catch (_) {
            /* ignore */
        }
    }

    async openEdsaBookingWhenReady(bookingId, attemptsLeft = 20) {
        const id = Number(bookingId);
        if (!Number.isFinite(id) || id < 1) return;
        if (this._edsaBookingsById.has(id)) {
            this.openEdsaBookingModal(id);
            return;
        }
        if (attemptsLeft <= 0) {
            this.showToast(
                `Booking #${id} is not on the current calendar view. Use the table below or change the month.`,
                'info'
            );
            return;
        }
        await new Promise((r) => setTimeout(r, 150));
        return this.openEdsaBookingWhenReady(id, attemptsLeft - 1);
    }

    async applyAdminDeepLink() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('gbp') || params.get('gcal') || window.location.hash === '#settings') {
            await this.showSection('settings', { skipHashUpdate: true });
            this.handleGoogleBusinessOAuthReturn();
            this.handleGoogleCalendarOAuthReturn();
            return;
        }

        const deep = this.parseAdminDeepLink();
        if (!deep) return;

        await this.showSection(deep.section, { skipHashUpdate: true });
        if (deep.bookingId && deep.section === 'edsa') {
            await this.openEdsaBookingWhenReady(deep.bookingId);
        }
    }

    _googleButtonSvg() {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';
    }

    async setupGoogleSignIn() {
        const block = document.querySelector('[data-admin-oauth-block]');
        const btn = document.getElementById('adminGoogleSignInBtn');
        if (!block || !btn) return;

        if (!btn.dataset.wired) {
            btn.dataset.wired = '1';
            btn.addEventListener('click', () => this.startGoogleSignIn());
        }

        let enabled = true;
        try {
            const res = await fetch(`${this.apiBaseUrl}/admin/auth/google/status`);
            if (res.ok) {
                const data = await res.json();
                enabled = Boolean(data?.google?.enabled);
            }
        } catch (_) {
            /* Keep button visible if status check fails - server validates on start */
        }

        if (enabled) {
            block.removeAttribute('hidden');
            block.classList.remove('hidden');
        } else {
            block.setAttribute('hidden', '');
            block.classList.add('hidden');
        }
    }

    startGoogleSignIn() {
        localStorage.removeItem('adminToken');
        this.authToken = null;
        window.location.href = `${this.apiBaseUrl}/admin/auth/google/start?returnTo=${encodeURIComponent('/admin.html')}`;
    }

    async handleLogin(e) {
        e.preventDefault();

        const emailElement = document.getElementById('email');
        const passwordElement = document.getElementById('password');
        const errorDiv = document.getElementById('loginError');
        const submitBtn = document.querySelector('#loginForm button[type="submit"]');

        if (!emailElement || !passwordElement) {
            console.error('Admin login: email or password field not found');
            return;
        }

        const showLoginError = (message) => {
            if (!errorDiv) {
                window.alert(message);
                return;
            }
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            errorDiv.classList.add('show');
        };

        const email = emailElement.value.trim();
        const password = passwordElement.value;

        if (!email || !password) {
            showLoginError('Enter your email and password.');
            return;
        }

        if (errorDiv) {
            errorDiv.textContent = '';
            errorDiv.style.display = 'none';
            errorDiv.classList.remove('show');
        }

        if (submitBtn) {
            submitBtn.disabled = true;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json().catch(() => ({}));

            if (response.ok) {
                this.authToken = data.token;
                this.currentUser = data.admin;
                this.allowedSections = data.allowedSections ?? null;
                this.canManageStoreHours = Boolean(data.canManageStoreHours);
                this.canManageStoreHoursDelegation = Boolean(data.canManageStoreHoursDelegation);
                this.defaultSection = data.defaultSection || 'dashboard';
                localStorage.setItem('adminToken', this.authToken);

                await this.loadDashboard();
            } else {
                const errorMessage = data.error || data.details || 'Login failed';
                showLoginError(errorMessage);
                console.error('Login error:', {
                    status: response.status,
                    error: data.error,
                    details: data.details
                });
            }
        } catch (error) {
            showLoginError('Connection error. Please try again.');
            console.error('Login request failed:', error);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
            }
        }
    }

    showForgotPasswordModal() {
        const modal = document.getElementById('forgotPasswordModal');
        if (modal) {
            modal.style.display = 'flex';
            const emailInput = document.getElementById('forgotPasswordEmail');
            if (emailInput) {
                setTimeout(() => emailInput.focus(), 100);
            }
        }
    }

    hideForgotPasswordModal() {
        const modal = document.getElementById('forgotPasswordModal');
        if (modal) {
            modal.style.display = 'none';
            const form = document.getElementById('forgotPasswordForm');
            const errorDiv = document.getElementById('forgotPasswordError');
            const successDiv = document.getElementById('forgotPasswordSuccess');
            if (form) form.reset();
            if (errorDiv) {
                errorDiv.textContent = '';
                errorDiv.style.display = 'none';
            }
            if (successDiv) successDiv.style.display = 'none';
        }
    }

    async handleForgotPassword(e) {
        e.preventDefault();

        const emailInput = document.getElementById('forgotPasswordEmail');
        const errorDiv = document.getElementById('forgotPasswordError');
        const successDiv = document.getElementById('forgotPasswordSuccess');
        const submitBtn = e.target.querySelector('button[type="submit"]');

        if (!emailInput || !errorDiv || !successDiv) return;

        const email = emailInput.value.trim();
        const originalText = submitBtn ? submitBtn.textContent : '';

        // Clear previous messages
        errorDiv.style.display = 'none';
        successDiv.style.display = 'none';

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/auth/forgot-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (response.ok) {
                successDiv.style.display = 'block';
                if (emailInput) emailInput.value = '';
                // Auto-close modal after 3 seconds
                setTimeout(() => {
                    this.hideForgotPasswordModal();
                }, 3000);
            } else {
                errorDiv.textContent = data.error || 'Failed to send reset link. Please try again.';
                errorDiv.style.display = 'block';
            }
        } catch (error) {
            errorDiv.textContent = 'Connection error. Please try again.';
            errorDiv.style.display = 'block';
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        }
    }

    async loadSession() {
        if (!this.authToken) return false;
        try {
            const data = await this.apiRequest('/admin/auth/me');
            if (!data?.admin) return false;
            this.currentUser = data.admin;
            this.allowedSections = data.allowedSections ?? null;
            this.canManageStoreHours = Boolean(data.canManageStoreHours);
            this.canManageStoreHoursDelegation = Boolean(data.canManageStoreHoursDelegation);
            this.defaultSection = data.defaultSection || 'dashboard';
            return true;
        } catch (error) {
            const msg = String(error?.message || '').toLowerCase();
            if (msg.includes('authentication required') || msg.includes('invalid admin token')) {
                return false;
            }
            console.warn('loadSession failed:', error.message || error);
            return false;
        }
    }

    canAccessSection(sectionName) {
        if (sectionName === 'personnel') {
            return this.isFullAdmin;
        }
        if (sectionName === 'developer-tools') {
            return this.currentUser?.role === 'developer';
        }
        if (this.allowedSections === null || this.allowedSections === undefined) {
            return true;
        }
        return this.allowedSections.includes(sectionName);
    }

    applyRoleAccess() {
        const allowed = this.allowedSections;
        const isFullAdmin = allowed === null || allowed === undefined;
        const isDeveloper = this.currentUser?.role === 'developer';

        document.querySelectorAll('.nav-link[data-section]').forEach((link) => {
            const section = link.getAttribute('data-section');
            const item = link.closest('.nav-item');
            if (!item || !section) return;
            let show = isFullAdmin || (Array.isArray(allowed) && allowed.includes(section));
            if (section === 'personnel') {
                show = isFullAdmin;
            }
            if (section === 'developer-tools') {
                show = isDeveloper;
            }
            item.style.display = show ? '' : 'none';
        });

        const personnelNav = document.getElementById('nav-personnel-item');
        if (personnelNav) {
            personnelNav.style.display = isFullAdmin ? '' : 'none';
        }
        const refundPermRow = document.getElementById('register-refund-permission-row');
        if (refundPermRow) {
            refundPermRow.style.display = isFullAdmin ? 'flex' : 'none';
        }
        const viewCostPermRow = document.getElementById('register-view-cost-permission-row');
        if (viewCostPermRow) {
            viewCostPermRow.style.display = isFullAdmin ? 'flex' : 'none';
        }

        const developerNav = document.getElementById('nav-developer-tools-item');
        if (developerNav) {
            developerNav.style.display = isDeveloper ? '' : 'none';
        }

        document.querySelectorAll('.sidebar-nav .nav-section').forEach((sec) => {
            const visibleItems = [...sec.querySelectorAll('.nav-item')].filter(
                (el) => el.style.display !== 'none'
            );
            sec.style.display = visibleItems.length ? '' : 'none';
        });

        this._applyStoreHoursFieldAccess();
    }

    _showStoreHoursPermissionAlert() {
        return this.showAdminAlert({
            title: 'Store hours restricted',
            message:
                'Store hours and holidays can only be edited by Admin or Developer accounts, unless an Admin has enabled that permission on your personnel profile. You can still update contact details.',
        });
    }

    _applyStoreHoursFieldAccess() {
        const allowed = Boolean(this.canManageStoreHours);
        ['store_hours_weekdays', 'store_hours_saturday', 'store_hours_sunday'].forEach((name) => {
            const el = document.querySelector(`[name="${name}"]`);
            if (!el) return;
            el.readOnly = !allowed;
            el.disabled = false;
            el.classList.toggle('store-hours-readonly', !allowed);
            if (!allowed && !el.dataset.hoursGuardBound) {
                el.dataset.hoursGuardBound = '1';
                const guard = (e) => {
                    if (this.canManageStoreHours) return;
                    e.preventDefault();
                    el.blur();
                    this._showStoreHoursPermissionAlert();
                };
                el.addEventListener('focus', guard);
                el.addEventListener('mousedown', guard);
                el.addEventListener('keydown', (e) => {
                    if (!this.canManageStoreHours && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
                        guard(e);
                    }
                });
            }
        });
        const holidayCard = document.getElementById('holiday-schedule-card');
        if (holidayCard) {
            holidayCard.querySelectorAll('input, select, button').forEach((el) => {
                el.disabled = false;
            });
            if (!holidayCard.dataset.hoursGuardBound) {
                holidayCard.dataset.hoursGuardBound = '1';
                holidayCard.addEventListener(
                    'click',
                    (e) => {
                        if (this.canManageStoreHours) return;
                        const interactive = e.target.closest('input, select, button');
                        if (!interactive) return;
                        e.preventDefault();
                        e.stopPropagation();
                        this._showStoreHoursPermissionAlert();
                    },
                    true
                );
            }
        }
        const saveBtn = document.querySelector('#store-info-settings-form button[type="submit"]');
        if (saveBtn) {
            saveBtn.textContent = allowed ? 'Save store info & holidays' : 'Save store info';
        }
        const syncBtn = document.getElementById('store-hours-sync-google-btn');
        if (syncBtn) syncBtn.disabled = !allowed;
    }

    async loadDashboard() {
        // Hide login screen and show dashboard
        const loginScreen = document.getElementById('loginScreen');
        const adminDashboard = document.getElementById('adminDashboard');
        const userName = document.getElementById('userName');

        if (loginScreen) loginScreen.style.display = 'none';
        if (adminDashboard) adminDashboard.style.display = 'flex';
        document.body.classList.add('admin-layout-locked');

        // Update user info
        if (this.currentUser && userName) {
            const label = this.currentUser.roleLabel || this.currentUser.role || '';
            userName.textContent = label
                ? `${this.currentUser.firstName} ${this.currentUser.lastName} \u00B7 ${label}`
                : `${this.currentUser.firstName} ${this.currentUser.lastName}`;
        }

        this.applyRoleAccess();

        const landing = this.canAccessSection(this.defaultSection)
            ? this.defaultSection
            : (this.allowedSections && this.allowedSections[0]) || 'dashboard';

        await this.showSection(landing, { skipHashUpdate: true });

        if (this.canAccessSection('dashboard')) {
            await this.loadDashboardStats();
        }
        await this.applyAdminDeepLink();
    }

    get isFullAdmin() {
        return this.allowedSections === null || this.allowedSections === undefined;
    }

    async loadDashboardStats() {
        // Don't try to load stats if user isn't authenticated
        if (!this.authToken) {
            // Clear loading state if not authenticated
            const recentActivityEl = document.getElementById('recentActivity');
            if (recentActivityEl) {
                recentActivityEl.className = '';
                recentActivityEl.innerHTML = '<p style="text-align: center; color: var(--gray-500); padding: 2rem;">Please log in to view activity</p>';
            }
            return;
        }

        try {
            // Note: Browser will log 403 errors in console for invalid/expired tokens
            // This is expected browser behavior and cannot be prevented
            // Our code handles 403s gracefully by returning null
            const response = await this.apiRequest('/admin/dashboard/stats');

            // Handle case where response is null (403 Forbidden - not authenticated)
            if (!response) {
                // Clear loading state
                const recentActivityEl = document.getElementById('recentActivity');
                if (recentActivityEl) {
                    recentActivityEl.className = '';
                    recentActivityEl.innerHTML = '<p style="text-align: center; color: var(--gray-500); padding: 2rem;">Please log in to view activity</p>';
                }
                return;
            }

            if (response.products) {
                const totalProducts = document.getElementById('totalProducts');
                const lowStockProducts = document.getElementById('lowStockProducts');

                if (totalProducts) totalProducts.textContent = response.products.total_products || 0;
                if (lowStockProducts) lowStockProducts.textContent = response.products.low_stock_products || 0;
            }

            if (response.orders) {
                const totalOrders = document.getElementById('totalOrders');
                if (totalOrders) totalOrders.textContent = response.orders.total_orders || 0;
            }

            if (response.edsa) {
                const totalBookings = document.getElementById('totalBookings');
                if (totalBookings) totalBookings.textContent = response.edsa.pending_bookings || 0;
            }

            // Render recent activity
            if (response.recentActivity) {
                this.renderRecentActivity(response.recentActivity);
            } else {
                // If no recent activity data, show empty state
                const recentActivityEl = document.getElementById('recentActivity');
                if (recentActivityEl) {
                    recentActivityEl.className = '';
                    recentActivityEl.innerHTML = '<p style="text-align: center; color: var(--gray-500); padding: 2rem;">No recent activity</p>';
                }
            }
        } catch (error) {
            // Always clear loading state on error
            const recentActivityEl = document.getElementById('recentActivity');
            if (recentActivityEl) {
                recentActivityEl.className = '';
            }

            // Completely silent for authentication errors - they're expected when not logged in
            const errorMsg = (error.message || '').toLowerCase();
            const isAuthError = errorMsg.includes('authentication required') ||
                errorMsg.includes('invalid admin token') ||
                errorMsg.includes('403') ||
                errorMsg.includes('forbidden') ||
                errorMsg.includes('unauthorized') ||
                errorMsg.includes('401');

            if (!isAuthError) {
                // Only log unexpected errors
                console.error('Failed to load dashboard stats:', error);
                this.showNotification('Failed to load dashboard statistics', 'error');
                // Show error message in recent activity section
                if (recentActivityEl) {
                    recentActivityEl.innerHTML = '<p style="text-align: center; color: var(--error); padding: 2rem;">Failed to load recent activity</p>';
                }
            } else {
                // For auth errors, show login message
                if (recentActivityEl) {
                    recentActivityEl.innerHTML = '<p style="text-align: center; color: var(--gray-500); padding: 2rem;">Please log in to view activity</p>';
                }
            }
        }
    }

    renderRecentActivity(activity) {
        const recentActivityEl = document.getElementById('recentActivity');
        if (!recentActivityEl) return;

        // Remove loading class
        recentActivityEl.className = '';

        const activities = [];

        // Add recent orders
        if (activity.orders && activity.orders.length > 0) {
            activity.orders.forEach(order => {
                activities.push({
                    type: 'order',
                    icon: 'fa-shopping-cart',
                    title: `Order #${order.order_number || order.id}`,
                    description: `${order.customer_name || 'Customer'} - $${parseFloat(order.total_amount || 0).toFixed(2)}`,
                    status: order.status,
                    time: this.formatTimeAgo(order.created_at)
                });
            });
        }

        // Add recent products
        if (activity.products && activity.products.length > 0) {
            activity.products.forEach(product => {
                activities.push({
                    type: 'product',
                    icon: 'fa-box',
                    title: 'New Product',
                    description: product.name || product.sku,
                    time: this.formatTimeAgo(product.created_at)
                });
            });
        }

        // Add recent bookings
        if (activity.bookings && activity.bookings.length > 0) {
            activity.bookings.forEach(booking => {
                activities.push({
                    type: 'booking',
                    icon: 'fa-calendar',
                    title: 'EDSA Booking',
                    description: `${booking.customer_name || 'Customer'} - ${booking.appointment_date ? new Date(booking.appointment_date).toLocaleDateString() : 'Pending'}`,
                    status: booking.status,
                    time: this.formatTimeAgo(booking.created_at)
                });
            });
        }

        // Sort by time (most recent first) - activities already sorted by created_at DESC from DB
        // Limit to 10 most recent
        const recentActivities = activities.slice(0, 10);

        if (recentActivities.length === 0) {
            recentActivityEl.innerHTML = '<p style="text-align: center; color: var(--gray-500); padding: 2rem;">No recent activity</p>';
            return;
        }

        recentActivityEl.innerHTML = `
            <div class="activity-list">
                ${recentActivities.map(activity => `
                    <div class="activity-item">
                        <div class="activity-icon">
                            <i class="fas ${activity.icon}"></i>
                        </div>
                        <div class="activity-content">
                            <div class="activity-title">${this.escapeHtml(activity.title)}</div>
                            <div class="activity-description">${this.escapeHtml(activity.description)}</div>
                            ${activity.status ? `<span class="activity-status badge badge-${activity.status === 'pending' ? 'warning' : activity.status === 'completed' || activity.status === 'confirmed' ? 'success' : 'info'}">${this.escapeHtml(activity.status)}</span>` : ''}
                        </div>
                        <div class="activity-time">${activity.time}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    formatTimeAgo(dateString) {
        if (!dateString) return 'Unknown';

        try {
            const date = new Date(dateString);
            const now = new Date();
            const diffInSeconds = Math.floor((now - date) / 1000);

            if (diffInSeconds < 60) {
                return 'Just now';
            } else if (diffInSeconds < 3600) {
                const minutes = Math.floor(diffInSeconds / 60);
                return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
            } else if (diffInSeconds < 86400) {
                const hours = Math.floor(diffInSeconds / 3600);
                return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
            } else if (diffInSeconds < 604800) {
                const days = Math.floor(diffInSeconds / 86400);
                return `${days} day${days !== 1 ? 's' : ''} ago`;
            } else {
                return date.toLocaleDateString();
            }
        } catch (error) {
            return 'Unknown';
        }
    }

    async showSection(sectionName, { skipHashUpdate = false } = {}) {
        if (!this.canAccessSection(sectionName)) {
            this.showToast('You do not have access to that section.', 'error');
            return;
        }

        // Update navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });

        const activeNavLink = document.querySelector(`[data-section="${sectionName}"]`);
        if (activeNavLink) activeNavLink.classList.add('active');

        this._mountOnlyActiveSection(sectionName);
        this._parkMainContentOrphans();

        const mainContent = document.querySelector('.main-content');
        if (mainContent) mainContent.scrollTop = 0;

        // Load section data
        if (sectionName === 'products') {
            await new Promise((resolve) => {
                requestAnimationFrame(() => {
                    const section = document.getElementById(sectionName);
                    if (section && section.classList.contains('active')) {
                        this.loadSectionData(sectionName).then(resolve);
                    } else {
                        setTimeout(() => this.loadSectionData(sectionName).then(resolve), 100);
                    }
                });
            });
        } else {
            await this.loadSectionData(sectionName);
        }

        this._refreshMainContentScroll();

        if (!skipHashUpdate) {
            this.updateAdminUrlHash(sectionName);
        }
    }

    _ensureSectionStorage() {
        let storage = document.getElementById('admin-section-storage');
        if (!storage) {
            storage = document.createElement('div');
            storage.id = 'admin-section-storage';
            storage.hidden = true;
            storage.setAttribute('aria-hidden', 'true');
            document.body.insertBefore(storage, document.body.firstChild);
        }
        return storage;
    }

    /** Keep only the active section inside .main-content so hidden sections cannot inflate scroll height. */
    _mountOnlyActiveSection(sectionName) {
        const mainContent = document.querySelector('.main-content');
        const storage = this._ensureSectionStorage();
        if (!mainContent) return;

        document.querySelectorAll('.content-section').forEach((section) => {
            const isActive = section.id === sectionName;
            section.classList.toggle('active', isActive);
            if (isActive) {
                if (section.parentElement !== mainContent) {
                    mainContent.appendChild(section);
                }
            } else if (section.parentElement !== storage) {
                storage.appendChild(section);
            }
        });

        this._parkMainContentOrphans();
    }

    /** Move modals and other non-section nodes out of .main-content (they inflate scroll height). */
    _parkMainContentOrphans() {
        const mainContent = document.querySelector('.main-content');
        if (!mainContent) return;

        const portalIds = new Set([
            'pos-support-connect-modal',
            'promo-editor-modal',
            'vendors-edit-modal',
            'vendors-po-detail-modal'
        ]);

        [...mainContent.children].forEach((child) => {
            if (!(child instanceof HTMLElement)) return;
            if (child.classList.contains('content-section')) return;
            if (
                child.classList.contains('modal-backdrop') ||
                child.classList.contains('promo-editor-modal') ||
                portalIds.has(child.id)
            ) {
                if (child.parentElement !== document.body) {
                    document.body.appendChild(child);
                }
            }
        });
    }

    _refreshMainContentScroll() {
        const mainContent = document.querySelector('.main-content');
        if (!mainContent) return;

        const apply = () => {
            this._parkMainContentOrphans();
            const active = mainContent.querySelector('.content-section.active');
            if (!active) {
                mainContent.scrollTop = 0;
                return;
            }

            mainContent.scrollTop = 0;
            const maxScroll = Math.max(0, mainContent.scrollHeight - mainContent.clientHeight);
            if (mainContent.scrollTop > maxScroll) {
                mainContent.scrollTop = maxScroll;
            }

            const style = window.getComputedStyle(mainContent);
            const padBottom = parseFloat(style.paddingBottom) || 0;
            const contentBottom = active.offsetTop + active.offsetHeight + padBottom;
            if (mainContent.scrollHeight > contentBottom + 12) {
                [...mainContent.children].forEach((child) => {
                    if (child instanceof HTMLElement && !child.classList.contains('content-section')) {
                        if (child.parentElement === mainContent) {
                            document.body.appendChild(child);
                        }
                    }
                });
            }
        };

        apply();
        requestAnimationFrame(() => {
            apply();
            requestAnimationFrame(apply);
        });
    }

    async loadSectionData(sectionName) {
        switch (sectionName) {
            case 'dashboard':
                await this.loadDashboardStats();
                break;
            case 'products':
                // Ensure brands and categories are loaded first for the filter dropdowns
                // This ensures filters are populated before products are loaded
                await Promise.all([
                    this.loadBrandsForFilters(),
                    this.loadCategoriesForFilters()
                ]);
                // Then load products - ensure this completes before any rendering
                await this.loadProducts();
                // After loadProducts completes, ensure render happens
                // loadProducts will call renderFilteredProductsImmediate, but add a safeguard
                if (this.allProducts.length > 0) {
                    // Products loaded successfully, ensure they're rendered
                    requestAnimationFrame(() => {
                        if (this.allProducts.length > 0) {
                            this.renderFilteredProductsImmediate();
                        }
                    });
                }
                break;
            case 'categories':
                await this.loadCategories();
                break;
            case 'brands':
                await this.loadBrands();
                break;
            case 'vendors':
                if (window.AdminVendors) {
                    window.AdminVendors.init();
                }
                break;
            case 'orders':
                await this.loadOrders();
                break;
            case 'tax-ledger':
                await this.loadTaxLedger();
                break;
            case 'low-stock':
                await this.loadLowStock();
                break;
            case 'edsa':
                await this.loadEDSABookings();
                break;
            case 'customers':
                if (typeof this.loadCustomers === 'function') {
                    await this.loadCustomers();
                }
                break;
            case 'customer-groups':
                if (typeof this.loadCustomerGroups === 'function') {
                    await this.loadCustomerGroups();
                }
                break;
            case 'gift-cards':
                if (typeof this.loadGiftCards === 'function') {
                    await this.loadGiftCards();
                }
                break;
            case 'marketing':
                await this.loadMarketingHub();
                break;
            case 'personnel':
                await this.loadAdminTeam();
                if (window.AdminPersonnelPos) {
                    window.AdminPersonnelPos.init();
                }
                break;
            case 'pos':
                await this.loadPosSettings();
                if (window.AdminPosHub) {
                    await window.AdminPosHub.init();
                }
                if (window.AdminPosTroubleshoot) {
                    await window.AdminPosTroubleshoot.init();
                }
                break;
            case 'settings':
                await this.loadStoreInfoSettings();
                break;
            case 'developer-tools':
                await this.loadDeveloperTools();
                await this.loadIntegrationCredentials();
                break;
        }
    }

    async loadDeveloperTools() {
        const backupMeta = document.getElementById('dev-tools-backup-meta');
        const migrationsSummary = document.getElementById('dev-tools-migrations-summary');
        const migrationsList = document.getElementById('dev-tools-migrations-list');
        const msg = document.getElementById('dev-tools-migrations-msg');
        if (!backupMeta || !migrationsSummary || !migrationsList) return;

        backupMeta.textContent = 'Loading backup info...';
        migrationsSummary.textContent = 'Loading migration status...';
        migrationsList.innerHTML = '<p style="margin:0;color:var(--gray-500);">Loading...</p>';
        if (msg) msg.textContent = '';

        try {
            const status = await this.apiRequest('/admin/dev-tools/status');
            const db = status?.database || {};
            const backup = status?.backup || {};
            const migrations = status?.migrations || {};
            const method = backup.mysqldumpAvailable ? 'mysqldump (fast)' : 'built-in exporter';
            backupMeta.textContent = `Connected to ${db.name || 'database'} on ${db.host || 'localhost'}${db.ssl ? ' (SSL)' : ''}. Backup method: ${method}.`;

            const pending = migrations.pendingCount || 0;
            const applied = migrations.appliedCount || 0;
            migrationsSummary.innerHTML =
                pending === 0
                    ? `<strong style="color:var(--success);">Database is up to date.</strong> ${applied} migration file(s) recorded.`
                    : `<strong style="color:var(--warning);">${pending} pending</strong> migration file(s), ${applied} already applied.`;

            const rows = Array.isArray(migrations.migrations) ? migrations.migrations : [];
            if (!rows.length) {
                migrationsList.innerHTML =
                    '<p style="margin:0;color:var(--gray-500);">No migration files found in database/migrations/.</p>';
            } else {
                migrationsList.innerHTML = `
                    <table class="table" style="margin:0;background:transparent;">
                        <thead>
                            <tr>
                                <th>File</th>
                                <th>Status</th>
                                <th>Applied</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows
                                .map((m) => {
                                    const statusLabel =
                                        m.status === 'applied'
                                            ? '<span class="badge badge-success">Applied</span>'
                                            : '<span class="badge badge-warning">Pending</span>';
                                    const mismatch = m.checksumMismatch
                                        ? ' <span class="badge" style="background:#fef3c7;color:#92400e;">Changed since apply</span>'
                                        : '';
                                    const appliedAt = m.appliedAt
                                        ? this._escapeHtml(this._formatPersonnelDate(m.appliedAt))
                                        : '-';
                                    return `<tr>
                                        <td style="font-family:monospace;font-size:0.82rem;">${this._escapeHtml(m.filename)}</td>
                                        <td>${statusLabel}${mismatch}</td>
                                        <td style="font-size:0.85rem;color:var(--gray-600);">${appliedAt}</td>
                                    </tr>`;
                                })
                                .join('')}
                        </tbody>
                    </table>`;
            }
        } catch (err) {
            backupMeta.textContent = 'Could not load developer tools status.';
            migrationsSummary.textContent = '';
            migrationsList.innerHTML = `<p style="margin:0;color:var(--error);">${this._escapeHtml(err.message || 'Failed to load status')}</p>`;
        }
    }

    _integrationCredFields() {
        const form = document.getElementById('dev-integrations-form');
        return form ? Array.from(form.querySelectorAll('[data-cred-field]')) : [];
    }

    /** Collect credential fields from the active website + POS processor cards only (avoids blanking hidden keys). */
    _integrationCredFieldsActive() {
        const form = document.getElementById('dev-integrations-form');
        if (!form) return [];

        const seen = new Set();
        const out = [];
        const add = (input) => {
            const key = input.name;
            if (!key || seen.has(key)) return;
            seen.add(key);
            out.push(input);
        };

        const websiteCard = form
            .querySelector('.dev-website-processor-radios input[type="radio"]:checked')
            ?.closest('.payment-processor-option');
        if (websiteCard) {
            websiteCard.querySelectorAll('[data-cred-field]').forEach(add);
        }

        const posCard = form
            .querySelector('.dev-pos-processor-radios input[type="radio"]:checked')
            ?.closest('.payment-processor-option');
        if (posCard) {
            posCard.querySelectorAll('[data-cred-field]').forEach((input) => {
                const sharedKeys = input.closest('[data-cred-pos-epi-keys]');
                if (sharedKeys && sharedKeys.style.display === 'none') return;
                add(input);
            });
        }

        form.querySelectorAll('.integration-shippo-wrap [data-cred-field]').forEach(add);
        return out;
    }

    _wireIntegrationCredStopPropagation() {
        document.querySelectorAll('#dev-integrations-form [data-cred-stop]').forEach((el) => {
            if (el.dataset.credStopWired) return;
            el.dataset.credStopWired = '1';
            el.addEventListener('mousedown', (e) => e.stopPropagation());
            el.addEventListener('click', (e) => e.stopPropagation());
        });
    }

    _toggleIntegrationPhysicalFields() {
        this._syncIntegrationCredentialVisibility();
    }

    _syncIntegrationCredentialVisibility() {
        const form = document.getElementById('dev-integrations-form');
        if (!form) return;

        const modeForSelect = (selectId) => {
            const el = document.getElementById(selectId);
            return String(el?.value || 'virtual').trim().toLowerCase();
        };

        document.querySelectorAll('[data-cred-physical]').forEach((block) => {
            const selectId = block.getAttribute('data-cred-physical');
            const isPhysical = modeForSelect(selectId) === 'physical';
            block.style.display = isPhysical ? '' : 'none';
        });

        // Deployment mode blocks apply to in-store POS cards only.
        form.querySelectorAll('.dev-pos-processor-radios [data-cred-modes]').forEach((block) => {
            const modes = String(block.getAttribute('data-cred-modes') || '')
                .split(',')
                .map((m) => m.trim().toLowerCase())
                .filter(Boolean);
            if (!modes.length) return;
            const body = block.closest('.payment-processor-cred-body') || form;
            const select =
                body.querySelector('select[name$="_deployment_mode"]') ||
                body.querySelector('select[id*="deployment_mode"]');
            const mode = String(select?.value || 'virtual').trim().toLowerCase();
            block.style.display = modes.includes(mode) ? '' : 'none';
        });

        const authSel = document.getElementById('cred_mxmerchant_auth_method');
        const authMethod = String(authSel?.value || 'consumer').toLowerCase() === 'username' ? 'username' : 'consumer';
        form.querySelectorAll('[data-cred-mx-auth]').forEach((block) => {
            const want = String(block.getAttribute('data-cred-mx-auth') || '').toLowerCase();
            block.style.display = want === authMethod ? '' : 'none';
        });

        const websiteEpi =
            form.querySelector('.dev-website-processor-radios input[type="radio"]:checked')?.value === 'epi';
        const posEpi = form.querySelector('.dev-pos-processor-radios input[type="radio"]:checked')?.value === 'epi';
        form.querySelectorAll('[data-cred-pos-epi-keys]').forEach((block) => {
            block.style.display = posEpi && !websiteEpi ? '' : 'none';
        });
        form.querySelectorAll('[data-cred-pos-epi-shared-note]').forEach((block) => {
            block.style.display = posEpi && websiteEpi ? '' : 'none';
        });
    }

    async loadIntegrationCredentials() {
        const statusEl = document.getElementById('dev-integrations-status');
        const msg = document.getElementById('dev-integrations-msg');
        if (!statusEl) return;
        if (this.currentUser?.role !== 'developer') return;

        statusEl.textContent = 'Loading credentials…';
        if (msg) msg.textContent = '';

        try {
            const data = await this.apiRequest('/admin/dev-tools/integrations');
            const fields = data?.fields || {};
            const st = data?.status || {};

            for (const input of this._integrationCredFields()) {
                const key = input.name;
                if (!key) continue;
                if (input.dataset.credBool === 'true') {
                    input.checked = String(fields[key]).toLowerCase() === 'true';
                    continue;
                }
                const val = fields[key] != null ? String(fields[key]) : '';
                if (input.dataset.credSecret === 'true') {
                    input.value = '';
                    input.placeholder = val || input.getAttribute('placeholder') || 'Not set';
                } else {
                    input.value = val;
                }
            }

            const processor =
                data.storeProcessor === 'mxmerchant'
                    ? 'mxmerchant'
                    : data.storeProcessor === 'nmi'
                      ? 'nmi'
                      : 'epi';
            const procRadio = document.querySelector(
                `#dev-integrations-form input[name="dev_store_card_payment_processor"][value="${processor}"]`
            );
            if (procRadio) procRadio.checked = true;

            const posProcessorRaw = String(data.posProcessor || 'inherit').toLowerCase();
            const posProcessor =
                posProcessorRaw === 'inherit'
                    ? processor
                    : posProcessorRaw === 'mxmerchant'
                      ? 'mxmerchant'
                      : posProcessorRaw === 'nmi'
                        ? 'nmi'
                        : 'epi';
            const posProcRadio = document.querySelector(
                `#dev-integrations-form input[name="dev_pos_card_payment_processor"][value="${posProcessor}"]`
            );
            if (posProcRadio) posProcRadio.checked = true;

            this._wireIntegrationCredStopPropagation();
            this._syncIntegrationCredentialVisibility();

            const badges = [];
            badges.push(
                st.epi?.configured
                    ? '<span class="badge badge-success">EPI ready</span>'
                    : '<span class="badge badge-warning">EPI keys missing</span>'
            );
            const nmiStatus = st.nmi || {};
            badges.push(
                nmiStatus.websiteConfigured
                    ? '<span class="badge badge-success">NMI website ready</span>'
                    : '<span class="badge badge-warning">NMI website keys missing</span>'
            );
            badges.push(
                nmiStatus.posConfigured
                    ? '<span class="badge badge-success">NMI POS ready</span>'
                    : '<span class="badge badge-warning">NMI POS keys missing</span>'
            );
            badges.push(
                st.mxmerchant?.websiteConfigured
                    ? '<span class="badge badge-success">MX website ready</span>'
                    : '<span class="badge badge-warning">MX website keys missing</span>'
            );
            badges.push(
                st.mxmerchant?.posConfigured
                    ? '<span class="badge badge-success">MX POS ready</span>'
                    : '<span class="badge badge-warning">MX POS keys missing</span>'
            );
            badges.push(
                st.shippo?.configured
                    ? '<span class="badge badge-success">Shippo ready</span>'
                    : '<span class="badge badge-warning">Shippo token missing</span>'
            );
            if (st.shippo?.configured && st.shippo?.originPhoneConfigured === false) {
                badges.push('<span class="badge badge-warning">Ship-from phone needed for UPS/FedEx</span>');
            }
            if (Array.isArray(st.shippo?.carriers) && st.shippo.carriers.length) {
                badges.push(
                    `<span class="badge badge-secondary">Carriers: ${st.shippo.carriers.map((c) => c.toUpperCase()).join(', ')}</span>`
                );
            }
            const processorLabel =
                processor === 'mxmerchant'
                    ? 'MX'
                    : processor === 'nmi'
                      ? 'NMI'
                      : 'EPI';
            const posProcessorLabel =
                posProcessor === 'mxmerchant'
                    ? 'MX'
                    : posProcessor === 'nmi'
                      ? 'NMI'
                      : 'EPI';
            badges.push(`<span class="badge badge-secondary">Website: ${processorLabel}</span>`);
            badges.push(`<span class="badge badge-secondary">In-store POS: ${posProcessorLabel}</span>`);
            const mxPos = st.mxmerchant || {};
            const nmiPos = st.nmi || {};
            const posMode =
                posProcessor === 'mxmerchant'
                    ? mxPos.deploymentMode === 'physical'
                        ? 'POS: MX physical terminal'
                        : mxPos.deploymentMode === 'quick_pay'
                          ? 'POS: MX Quick Pay'
                          : 'POS: MX on screen'
                    : posProcessor === 'nmi' && nmiPos.deploymentMode === 'physical'
                      ? 'POS: NMI physical terminal'
                      : posProcessor === 'nmi'
                        ? 'POS: NMI on screen'
                        : st.epi?.deploymentMode === 'physical'
                          ? 'POS: EPI physical terminal'
                          : 'POS: EPI on screen';
            badges.push(`<span class="badge badge-secondary">${posMode}</span>`);
            statusEl.innerHTML = badges.join(' ');
        } catch (err) {
            statusEl.textContent = '';
            if (msg) {
                msg.textContent = err.message || 'Could not load integration credentials.';
                msg.style.color = 'var(--error)';
            }
        }
    }

    async saveIntegrationCredentials(e) {
        e?.preventDefault();
        if (this.currentUser?.role !== 'developer') {
            this.showNotification('Developer access required', 'error');
            return;
        }

        const msg = document.getElementById('dev-integrations-msg');
        const btn = document.getElementById('dev-integrations-save-btn');
        const payload = {};

        for (const input of this._integrationCredFieldsActive()) {
            const key = input.name;
            if (!key) continue;
            if (input.dataset.credBool === 'true') {
                payload[key] = input.checked ? 'true' : 'false';
            } else {
                payload[key] = input.value.trim();
            }
        }

        const processorRadio = document.querySelector(
            '#dev-integrations-form input[name="dev_store_card_payment_processor"]:checked'
        );
        if (processorRadio) {
            payload.store_card_payment_processor = processorRadio.value;
        }

        const posProcessorRadio = document.querySelector(
            '#dev-integrations-form input[name="dev_pos_card_payment_processor"]:checked'
        );
        if (posProcessorRadio) {
            payload.pos_card_payment_processor = posProcessorRadio.value;
        }

        if (btn) btn.disabled = true;
        if (msg) {
            msg.textContent = 'Saving…';
            msg.style.color = 'var(--gray-600)';
        }

        try {
            const res = await this.apiRequest('/admin/dev-tools/integrations', {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            this.showNotification(res.message || 'Credentials saved', 'success');
            if (msg) {
                msg.textContent = 'Saved. Keys are active immediately.';
                msg.style.color = 'var(--success)';
            }
            await this.loadIntegrationCredentials();
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed';
                msg.style.color = 'var(--error)';
            }
            this.showNotification(err.message || 'Save failed', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async testIntegrationCredentials() {
        if (this.currentUser?.role !== 'developer') {
            this.showNotification('Developer access required', 'error');
            return;
        }

        const msg = document.getElementById('dev-integrations-msg');
        const btn = document.getElementById('dev-integrations-test-btn');
        if (btn) btn.disabled = true;
        if (msg) {
            msg.textContent = 'Testing connections…';
            msg.style.color = 'var(--gray-600)';
        }

        try {
            const res = await this.apiRequest('/admin/dev-tools/integrations/test', {
                method: 'POST',
                body: JSON.stringify({ target: 'all' }),
            });
            const lines = Object.entries(res.results || {}).map(([k, v]) => {
                const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
                let line = `${label}: ${v.ok ? 'OK' : 'Failed'} — ${v.message}`;
                if (k === 'shippo' && Array.isArray(v.carrierSummary) && v.carrierSummary.length) {
                    line += `<br><span style="font-size:0.9em;margin-left:1rem;">${v.carrierSummary.map((c) => this._escapeHtml(c)).join('<br><span style="margin-left:1rem;"></span>')}</span>`;
                }
                if (k === 'shippo' && Array.isArray(v.blockers) && v.blockers.length > 1) {
                    line += `<br><span style="font-size:0.9em;margin-left:1rem;color:var(--warning);">${v.blockers.slice(1).map((b) => this._escapeHtml(b)).join('<br><span style="margin-left:1rem;"></span>')}</span>`;
                }
                if (k === 'shippo' && Array.isArray(v.warnings) && v.warnings.length) {
                    line += `<br><span style="font-size:0.9em;margin-left:1rem;color:var(--gray-600);">${v.warnings.map((b) => this._escapeHtml(b)).join('<br><span style="margin-left:1rem;"></span>')}</span>`;
                }
                return line;
            });
            if (msg) {
                msg.innerHTML = lines.map((l) => this._escapeHtml(l)).join('<br>');
                const allOk = Object.values(res.results || {}).every((v) => v.ok);
                msg.style.color = allOk ? 'var(--success)' : 'var(--warning)';
            }
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Test failed';
                msg.style.color = 'var(--error)';
            }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async downloadDatabaseBackup() {
        if (this.currentUser?.role !== 'developer') {
            this.showNotification('Developer access required', 'error');
            return;
        }
        const proceedWithBackup = await this.showAdminConfirm({
            title: 'Download database backup',
            message:
                'Download a full SQL backup of the database now?\n\nThis may take a minute on large databases.',
            confirmLabel: 'Download backup',
            cancelLabel: 'Cancel',
        });
        if (!proceedWithBackup) {
            return;
        }

        const url = `${this.apiBaseUrl}/admin/dev-tools/backup`;
        this.showNotification('Building database backup…', 'info');
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { Authorization: `Bearer ${this.authToken}` },
            });

            if (!response.ok) {
                let message = `Backup failed (${response.status})`;
                try {
                    const err = await response.json();
                    if (err?.error) message = err.error;
                } catch (_) {
                    /* ignore */
                }
                this.showNotification(message, 'error');
                return;
            }

            const method = response.headers.get('X-Backup-Method') || 'sql';
            const blob = await response.blob();
            const href = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = href;
            const stamp = new Date().toISOString().slice(0, 10);
            link.download = `merchant-backup-${stamp}.sql`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(href);
            this.showNotification(`Database backup downloaded (${method})`, 'success');
        } catch (err) {
            this.showNotification(err.message || 'Backup download failed', 'error');
        }
    }

    async runPendingMigrations() {
        if (this.currentUser?.role !== 'developer') {
            this.showNotification('Developer access required', 'error');
            return;
        }

        const msg = document.getElementById('dev-tools-migrations-msg');
        const confirmed = await this.showAdminConfirm({
            title: 'Run pending migrations',
            message:
                'Run all PENDING database migrations?\n\nThis applies schema updates only - it does not delete customers, orders, or sales data.',
            confirmLabel: 'Continue',
            cancelLabel: 'Cancel',
        });
        if (!confirmed) return;

        const typedResult = await this.showAdminInputModal({
            title: 'Confirm migration run',
            message: 'Type RUN MIGRATIONS to confirm.',
            inputs: [
                {
                    key: 'confirmText',
                    label: 'Confirmation',
                    placeholder: 'RUN MIGRATIONS',
                    required: true,
                },
            ],
            submitLabel: 'Run migrations',
            cancelLabel: 'Cancel',
        });
        const typed = typedResult ? typedResult.confirmText : null;
        if (typed !== 'RUN MIGRATIONS') {
            if (msg) msg.textContent = 'Migration run cancelled - confirmation text did not match.';
            return;
        }

        const btn = document.getElementById('dev-tools-run-migrations-btn');
        const original = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Running...';
        }
        if (msg) msg.textContent = 'Running pending migrations...';

        try {
            const result = await this.apiRequest('/admin/dev-tools/run-migrations', {
                method: 'POST',
                body: JSON.stringify({ confirm: 'RUN MIGRATIONS' }),
            });
            if (msg) {
                msg.style.color = 'var(--success)';
                msg.textContent = result?.message || 'Migrations complete.';
            }
            this.showNotification(result?.message || 'Migrations complete', 'success');
            await this.loadDeveloperTools();
        } catch (err) {
            if (msg) {
                msg.style.color = 'var(--error)';
                msg.textContent = err.message || 'Migration run failed';
            }
            this.showNotification(err.message || 'Migration run failed', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = original;
            }
        }
    }

    _employeeDiscountSettingMeta() {
        return {
            employee_discount_enabled: 'Enable employee merchandise discount at checkout',
            employee_discount_percent: 'Employee discount percentage (0-100)',
        };
    }

    _posCashDiscountSettingMeta() {
        return {
            pos_cash_discount_enabled: 'Enable in-store cash discount (card price vs lower cash price)',
            pos_cash_discount_percent: 'In-store POS cash discount percent off merchandise (max 15)',
            pos_payment_cash_enabled: 'Allow cash payments on Business One POS',
            pos_payment_check_enabled: 'Allow check payments on Business One POS',
            pos_payment_card_enabled: 'Allow card terminal payments on Business One POS',
            pos_store_logo_url: 'Optional store logo URL for POS customer display',
            store_card_payment_processor: 'Website card processor for checkout: epi, nmi, or mxmerchant',
            pos_card_payment_processor: 'In-store POS processor: inherit (match website), epi, nmi, or mxmerchant',
            pos_card_payment_adapter: 'POS card payment mode (semi-integrated NMI terminal)',
            pos_custom_payment_driver_url: 'Optional URL to custom POS payment driver script when adapter is custom',
            pos_receipt_header_text: 'Optional extra line printed under store name on POS receipts',
            pos_receipt_footer_text: 'Closing message on POS receipts',
            pos_receipt_show_address: 'Show store address on POS receipts',
            pos_receipt_show_phone: 'Show store phone on POS receipts',
            pos_receipt_show_logo: 'Show logo on POS receipts',
            pos_receipt_show_sku: 'Show SKU on each line item on POS receipts',
            pos_receipt_show_platform_line: 'Show Business One POS line on receipts',
            pos_receipt_show_cashier: 'Show cashier name on POS receipts',
            pos_receipt_show_cash_savings: 'Show cash savings line on POS receipts',
            pos_receipt_auto_print: 'Auto-open print dialog after each sale',
            pos_receipt_copy_count: 'Number of receipt copies to print (1-3)',
            pos_receipt_show_order_barcode: 'Show order number as barcode on receipts',
            pos_receipt_return_policy: 'Return policy line printed on POS receipts (text only)',
            pos_session_timeout_minutes: 'Minutes before POS employee must re-enter PIN',
            pos_pin_max_attempts: 'Failed PIN attempts before lockout',
            pos_pin_lockout_minutes: 'Minutes to lock PIN entry after too many failures',
            pos_sign_out_after_sale: 'Sign cashier out after each completed sale (shared registers)',
            pos_require_manager_pin_discounts: 'Require manager PIN for line discounts above threshold',
            pos_require_manager_pin_void_refund: 'Refunds always require manager PIN on the register',
            pos_max_line_discount_percent: 'Max line discount percent without manager PIN (0 = any discount needs manager)',
            pos_daily_sales_email_enabled: 'Email daily in-store sales summary to owner',
            pos_daily_sales_email_to: 'Recipient for daily POS sales email',
            pos_daily_sales_email_hour: 'Hour to send daily sales email (0-23 server time)',
            pos_daily_sales_email_minute: 'Minute to send daily sales email',
            pos_payroll_email_enabled: 'Email payroll hours to accountant/bookkeeper on a schedule',
            pos_payroll_email_to: 'Recipient for payroll hours email',
            pos_payroll_email_frequency: 'Payroll email frequency: weekly, biweekly, semimonthly, monthly',
            pos_payroll_email_weekday: 'Weekday to send weekly/biweekly payroll email (0=Sun..6=Sat)',
            pos_payroll_email_hour: 'Hour to send payroll email (0-23 server time)',
            pos_payroll_email_minute: 'Minute to send payroll email',
            pos_payroll_email_include_pay: 'Include estimated pay from employee hourly rates in payroll email',
            pos_eod_reminder_enabled: 'Remind register if shift still open after end-of-day time',
            pos_eod_reminder_hour: 'End-of-day reminder hour (0-23)',
            pos_eod_reminder_minute: 'End-of-day reminder minute',
            pos_support_phone: 'Support phone shown on POS register help',
            pos_help_url: 'Help URL shown on POS register',
            pos_store_base_url: 'Public HTTPS store URL for Web POS registers and platform support sync',
            pos_catalog_refresh_minutes: 'Auto-refresh product catalog interval in minutes',
            pos_large_touch_mode: 'Large touch mode with bigger category buttons on POS',
            pos_scan_beep_enabled: 'Play beep when barcode scan finds a product',
            pos_display_store_hours_idle: 'Show store hours on idle customer display',
            pos_show_cost_in_cart: 'Show product cost in POS cart for manual discounts',
            pos_personnel_mode: 'Personnel mode: time_clock_only or time_clock_and_pos',
            pos_display_card_checkout: 'NMI terminal card checkout enabled',
            pos_card_display_mode: 'Card checkout: NMI terminal mode',
        };
    }

    _storeInfoSettingMeta() {
        return {
            store_name: 'Store display name',
            store_phone: 'Primary store phone number',
            store_email: 'Primary store contact email',
            store_address_line1: 'Store street address line 1',
            store_address_line2: 'Store street address line 2',
            store_city: 'Store city',
            store_state: 'Store state/province',
            store_postal_code: 'Store postal code',
            tax_rate: 'Store sales tax rate (decimal)',
            store_cash_discount_enabled: 'Enable website/host cash discount (card price vs lower cash price)',
            store_cash_discount_percent: 'Website cash discount percent off merchandise (max 15)',
            store_hours_weekdays: 'Operating hours for weekdays',
            store_hours_saturday: 'Operating hours for Saturday',
            store_hours_sunday: 'Operating hours for Sunday',
            store_holiday_schedule: 'Structured holiday schedule for closures/special hours',
        };
    }

    _nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
        const first = new Date(year, monthIndex, 1);
        const delta = (weekday - first.getDay() + 7) % 7;
        return new Date(year, monthIndex, 1 + delta + (nth - 1) * 7);
    }

    _lastWeekdayOfMonth(year, monthIndex, weekday) {
        const last = new Date(year, monthIndex + 1, 0);
        const delta = (last.getDay() - weekday + 7) % 7;
        return new Date(year, monthIndex, last.getDate() - delta);
    }

    _toIsoDate(date) {
        if (!(date instanceof Date)) return '';
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    _holidayDefinitions() {
        return [
            { key: 'new-year', name: "New Year's Day", dateForYear: (y) => `${y}-01-01` },
            { key: 'mlk', name: 'Martin Luther King Jr. Day', dateForYear: (y) => this._toIsoDate(this._nthWeekdayOfMonth(y, 0, 1, 3)) },
            { key: 'presidents', name: "Presidents' Day", dateForYear: (y) => this._toIsoDate(this._nthWeekdayOfMonth(y, 1, 1, 3)) },
            { key: 'memorial', name: 'Memorial Day', dateForYear: (y) => this._toIsoDate(this._lastWeekdayOfMonth(y, 4, 1)) },
            { key: 'independence', name: 'Independence Day', dateForYear: (y) => `${y}-07-04` },
            { key: 'labor', name: 'Labor Day', dateForYear: (y) => this._toIsoDate(this._nthWeekdayOfMonth(y, 8, 1, 1)) },
            { key: 'columbus', name: 'Columbus Day', dateForYear: (y) => this._toIsoDate(this._nthWeekdayOfMonth(y, 9, 1, 2)) },
            { key: 'veterans', name: "Veterans Day", dateForYear: (y) => `${y}-11-11` },
            { key: 'thanksgiving', name: 'Thanksgiving Day', dateForYear: (y) => this._toIsoDate(this._nthWeekdayOfMonth(y, 10, 4, 4)) },
            { key: 'christmas', name: 'Christmas Day', dateForYear: (y) => `${y}-12-25` },
        ];
    }

    _buildUsHolidayTemplates() {
        const year = new Date().getFullYear();
        const defs = this._holidayDefinitions();
        return defs.map((def) => ({
            key: def.key,
            templateKey: def.key,
            name: def.name,
            date: def.dateForYear(year),
            hours: 'Closed',
        }));
    }

    _renderHolidayTemplateOptions() {
        const typeSelect = document.getElementById('holiday-template-type');
        if (!typeSelect) return;
        const defs = this._holidayDefinitions();
        const currentType = typeSelect.value;
        const options = ['<option value="">Select U.S. holiday...</option>']
            .concat(
                defs.map((def) => {
                    return `<option value="${this.escapeHtml(def.key)}">${this.escapeHtml(def.name)}</option>`;
                })
            )
            .concat('<option value="__custom__">Create holiday</option>');
        typeSelect.innerHTML = options.join('');
        if (Array.from(typeSelect.options).some((opt) => opt.value === currentType)) typeSelect.value = currentType;
    }

    _renderHolidayScheduleList() {
        const list = document.getElementById('holiday-list');
        if (!list) return;
        if (!Array.isArray(this.holidaySchedule) || !this.holidaySchedule.length) {
            list.innerHTML = '<p style="margin:0;color:var(--gray-500);font-size:0.9rem;">No holidays scheduled.</p>';
            return;
        }
        const sorted = [...this.holidaySchedule].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        this.holidaySchedule = sorted;
        list.innerHTML = sorted.map((holiday, idx) => {
            const name = this.escapeHtml(holiday.name || 'Holiday');
            const date = this.escapeHtml(holiday.date || '');
            const computedHours = holiday.isClosed
                ? 'Closed'
                : `${holiday.openTime || ''}${holiday.closeTime ? ` - ${holiday.closeTime}` : ''}`.trim();
            const hours = this.escapeHtml(holiday.hours || computedHours || 'Closed');
            const note = holiday.note ? `<div style="font-size:0.82rem;color:var(--gray-500);">${this.escapeHtml(holiday.note)}</div>` : '';
            return `<div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start;padding:0.55rem 0;border-bottom:1px solid var(--gray-200);">
                <div>
                    <div style="font-weight:600;font-size:0.92rem;">${name}</div>
                    <div style="font-size:0.85rem;color:var(--gray-600);">${date} - ${hours}</div>
                    ${note}
                </div>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end;">
                    <button type="button" class="btn btn-secondary btn-sm" data-holiday-revert="${idx}">Remove &amp; save</button>
                    <button type="button" class="btn btn-danger btn-sm" data-holiday-remove="${idx}">Remove from list</button>
                </div>
            </div>`;
        }).join('');
    }

    _toggleCustomHolidayFields() {
        const select = document.getElementById('holiday-template-type');
        const wrap = document.getElementById('holiday-custom-fields');
        if (!select || !wrap) return;
        wrap.style.display = select.value === '__custom__' ? 'block' : 'none';
        this._toggleCustomHolidayTimeRange();
    }

    _toggleCustomHolidayTimeRange() {
        const status = document.getElementById('holiday-custom-status');
        const timeWrap = document.getElementById('holiday-custom-time-range');
        if (!status || !timeWrap) return;
        timeWrap.style.display = status.value === 'open' ? 'grid' : 'none';
    }

    addHolidayFromSelection() {
        if (!this.canManageStoreHours) {
            this._showStoreHoursPermissionAlert();
            return;
        }
        const select = document.getElementById('holiday-template-type');
        if (!select) return;
        if (select.value === '__custom__') {
            const name = (document.getElementById('holiday-custom-name')?.value || '').trim();
            const date = (document.getElementById('holiday-custom-date')?.value || '').trim();
            const status = (document.getElementById('holiday-custom-status')?.value || 'closed').trim();
            const openTime = (document.getElementById('holiday-custom-open-time')?.value || '').trim();
            const closeTime = (document.getElementById('holiday-custom-close-time')?.value || '').trim();
            const note = (document.getElementById('holiday-custom-note')?.value || '').trim();
            if (!name || !date) {
                this.showToast('Custom holiday needs name and date', 'warning');
                return;
            }
            if (status === 'open' && (!openTime || !closeTime || openTime >= closeTime)) {
                this.showToast('Set a valid open and close time', 'warning');
                return;
            }
            this.holidaySchedule.push({
                name,
                date,
                isClosed: status !== 'open',
                openTime: status === 'open' ? openTime : null,
                closeTime: status === 'open' ? closeTime : null,
                hours: status === 'open' ? `${openTime} - ${closeTime}` : 'Closed',
                note,
                source: 'custom',
            });
            this._renderHolidayScheduleList();
            document.getElementById('holiday-custom-name').value = '';
            document.getElementById('holiday-custom-date').value = '';
            document.getElementById('holiday-custom-status').value = 'closed';
            document.getElementById('holiday-custom-open-time').value = '09:00';
            document.getElementById('holiday-custom-close-time').value = '17:00';
            document.getElementById('holiday-custom-note').value = '';
            this._toggleCustomHolidayTimeRange();
            return;
        }
        const template = this._buildUsHolidayTemplates().find((item) => item.templateKey === select.value);
        if (!template) {
            this.showToast('Select a holiday first', 'warning');
            return;
        }
        const duplicate = this.holidaySchedule.some((item) => item.date === template.date && item.name === template.name);
        if (duplicate) {
            this.showToast('That holiday is already scheduled', 'warning');
            return;
        }
        this.holidaySchedule.push({
            name: template.name,
            date: template.date,
            isClosed: true,
            openTime: null,
            closeTime: null,
            hours: template.hours || 'Closed',
            note: '',
            source: 'preset',
        });
        this._renderHolidayScheduleList();
    }

    removeHolidayAt(index) {
        if (!this.canManageStoreHours) {
            this._showStoreHoursPermissionAlert();
            return;
        }
        if (!Number.isInteger(index)) return;
        this.holidaySchedule = this.holidaySchedule.filter((_, i) => i !== index);
        this._renderHolidayScheduleList();
    }

    _collectPromoBannerFromForm() {
        const presetRaw = (document.getElementById('promo-preset')?.value || 'sale').trim().toLowerCase();
        const presets = new Set(['sale', 'flash', 'holiday', 'info', 'custom']);
        const preset = presets.has(presetRaw) ? presetRaw : 'sale';
        return {
            enabled: !!document.getElementById('promo-enabled')?.checked,
            preset,
            headline: (document.getElementById('promo-headline')?.value || '').trim().slice(0, 200),
            subline: (document.getElementById('promo-subline')?.value || '').trim().slice(0, 280),
            linkUrl: (document.getElementById('promo-link-url')?.value || '').trim().slice(0, 500),
            linkLabel: (document.getElementById('promo-link-label')?.value || '').trim().slice(0, 80),
            icon: (document.getElementById('promo-icon')?.value || '').trim().slice(0, 12),
            iconUrl: (() => {
                const v = (document.getElementById('promo-icon-url')?.value || '').trim().slice(0, 200);
                return /^\/uploads\/promo-icons\/[a-zA-Z0-9._-]+$/.test(v) ? v : '';
            })(),
            customBg: (document.getElementById('promo-custom-bg')?.value || '#047857').trim(),
            customText: (document.getElementById('promo-custom-text')?.value || '#ffffff').trim(),
            customAccent: (document.getElementById('promo-custom-accent')?.value || '#d4af37').trim(),
        };
    }

    _applyPromoBannerToForm(raw) {
        let cfg = {};
        try {
            cfg = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
        } catch (_) {
            cfg = {};
        }
        const el = (id) => document.getElementById(id);
        if (el('promo-enabled')) el('promo-enabled').checked = !!cfg.enabled;
        if (el('promo-preset')) el('promo-preset').value = cfg.preset || 'sale';
        if (el('promo-headline')) el('promo-headline').value = cfg.headline || '';
        if (el('promo-subline')) el('promo-subline').value = cfg.subline || '';
        if (el('promo-link-url')) el('promo-link-url').value = cfg.linkUrl || '';
        if (el('promo-link-label')) el('promo-link-label').value = cfg.linkLabel || '';
        if (el('promo-icon')) el('promo-icon').value = cfg.icon || '';
        if (el('promo-icon-url')) el('promo-icon-url').value = cfg.iconUrl || '';
        if (el('promo-custom-bg')) el('promo-custom-bg').value = cfg.customBg || '#047857';
        if (el('promo-custom-text')) el('promo-custom-text').value = cfg.customText || '#ffffff';
        if (el('promo-custom-accent')) el('promo-custom-accent').value = cfg.customAccent || '#d4af37';
        this._togglePromoCustomColors();
        this._refreshPromoIconPreview();
    }

    _promoIconAssetBase() {
        return (this.apiBaseUrl || '').replace(/\/api\/?$/, '');
    }

    _refreshPromoIconPreview() {
        const path = document.getElementById('promo-icon-url')?.value?.trim();
        const wrap = document.getElementById('promo-icon-preview-wrap');
        const img = document.getElementById('promo-icon-preview-img');
        if (!wrap || !img) return;
        if (!path || !/^\/uploads\/promo-icons\//.test(path)) {
            wrap.style.display = 'none';
            img.removeAttribute('src');
            return;
        }
        img.src = `${this._promoIconAssetBase()}${path}`;
        wrap.style.display = 'block';
    }

    async uploadPromoBannerIcon() {
        const input = document.getElementById('promo-icon-file');
        if (!input?.files?.length) {
            this.showToast('Choose an image file first', 'warning');
            return;
        }
        const fd = new FormData();
        fd.append('icon', input.files[0]);
        const url = `${this.apiBaseUrl}/admin/promo-banner/upload-icon`;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${this.authToken}` },
                body: fd,
            });
            if (res.status === 401) {
                this.logout();
                throw new Error('Authentication required');
            }
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'Upload failed');
            }
            const hidden = document.getElementById('promo-icon-url');
            if (hidden) hidden.value = data.url || '';
            input.value = '';
            this._refreshPromoIconPreview();
            this.showToast('Banner icon uploaded', 'success');
        } catch (e) {
            this.showToast(e.message || 'Upload failed', 'error');
        }
    }

    clearPromoBannerUploadedIcon() {
        const hidden = document.getElementById('promo-icon-url');
        const file = document.getElementById('promo-icon-file');
        if (hidden) hidden.value = '';
        if (file) file.value = '';
        this._refreshPromoIconPreview();
    }

    bindPromoProductLinkSearch() {
        const input = document.getElementById('promo-product-link-search');
        const results = document.getElementById('promo-product-link-results');
        if (!input || !results || input.dataset.bound === '1') return;
        input.dataset.bound = '1';
        this._promoProductLinkRows = [];
        this._promoProductLinkHighlightIdx = -1;
        this._promoProductLinkSearchPending = false;

        if (!this._promoProductLinkReposBound) {
            this._promoProductLinkReposBound = () => this._promoProductLinkSyncPanelPosition();
            window.addEventListener('scroll', this._promoProductLinkReposBound, true);
            window.addEventListener('resize', this._promoProductLinkReposBound);
        }

        input.addEventListener('keydown', (ev) => this._promoProductLinkSearchKeydown(ev));
        document.addEventListener('click', (e) => {
            if (e.target.closest('.promo-product-link-field')) return;
            this._promoProductLinkHidePanel();
        });

        if (typeof window.hmBindSearchInput === 'function') {
            window.hmBindSearchInput(input, {
                debounceMs: 200,
                onSearch: () => this._promoProductLinkSearchFetch()
            });
        } else {
            input.addEventListener('input', () => {
                clearTimeout(this._promoProductLinkSearchTimer);
                this._promoProductLinkSearchTimer = setTimeout(() => this._promoProductLinkSearchFetch(), 200);
            });
        }
        input.addEventListener('focus', () => {
            if (input.value.trim().length >= 1) this._promoProductLinkSearchFetch();
            else this._promoProductLinkShowTypingHint();
        });
    }

    _promoProductLinkSetAriaExpanded(open) {
        const input = document.getElementById('promo-product-link-search');
        if (input) input.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    _promoProductLinkSyncPanelPosition() {
        const input = document.getElementById('promo-product-link-search');
        const results = document.getElementById('promo-product-link-results');
        if (!input || !results || results.hasAttribute('hidden')) return;
        const r = input.getBoundingClientRect();
        const w = Math.max(Math.round(r.width), 220);
        const maxLeft = Math.max(8, window.innerWidth - w - 8);
        results.style.left = `${Math.min(Math.round(r.left), maxLeft)}px`;
        results.style.width = `${w}px`;
        const placeBelow = () => {
            const panelH = results.offsetHeight || 200;
            let top = Math.round(r.bottom) + 6;
            if (top + panelH > window.innerHeight - 8) {
                top = Math.max(8, Math.round(r.top) - panelH - 6);
            }
            results.style.top = `${top}px`;
        };
        placeBelow();
        requestAnimationFrame(placeBelow);
    }

    _promoProductLinkShowTypingHint() {
        const results = document.getElementById('promo-product-link-results');
        if (!results) return;
        this._promoProductLinkRows = [];
        this._promoProductLinkHighlightIdx = -1;
        results.removeAttribute('hidden');
        results.classList.add('prompt');
        results.textContent =
            'Type a product name or SKU - suggestions appear below; click one or highlight with arrows and press Enter.';
        results.style.display = 'block';
        this._promoProductLinkSetAriaExpanded(true);
        this._promoProductLinkSyncPanelPosition();
    }

    _promoProductLinkHidePanel() {
        const results = document.getElementById('promo-product-link-results');
        if (!results) return;
        results.innerHTML = '';
        results.style.display = 'none';
        results.setAttribute('hidden', '');
        results.classList.remove('prompt');
        this._promoProductLinkRows = [];
        this._promoProductLinkHighlightIdx = -1;
        this._promoProductLinkSetAriaExpanded(false);
    }

    _promoProductLinkApplyHighlight() {
        const results = document.getElementById('promo-product-link-results');
        if (!results) return;
        const opts = results.querySelectorAll('.promo-product-link-option');
        opts.forEach((el, i) => {
            el.classList.toggle('promo-product-link-option--highlight', i === this._promoProductLinkHighlightIdx);
            el.setAttribute('aria-selected', i === this._promoProductLinkHighlightIdx ? 'true' : 'false');
        });
    }

    _promoProductLinkSetHighlight(idx) {
        const n = this._promoProductLinkRows.length;
        if (n === 0) return;
        this._promoProductLinkHighlightIdx = ((idx % n) + n) % n;
        this._promoProductLinkApplyHighlight();
    }

    _promoProductLinkSearchKeydown(ev) {
        const input = document.getElementById('promo-product-link-search');
        const results = document.getElementById('promo-product-link-results');
        if (!input || !results) return;
        const open = !results.hasAttribute('hidden') && results.style.display !== 'none';
        const q = (input.value || '').trim();

        if (ev.key === 'Escape') {
            if (open) {
                ev.preventDefault();
                this._promoProductLinkHidePanel();
            }
            return;
        }

        if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            if (q.length < 1) return;
            if (!open || !this._promoProductLinkRows.length) {
                void this._promoProductLinkSearchFetch();
                return;
            }
            this._promoProductLinkSetHighlight(this._promoProductLinkHighlightIdx + 1);
            return;
        }

        if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            if (q.length < 1) return;
            if (!open || !this._promoProductLinkRows.length) {
                void this._promoProductLinkSearchFetch();
                return;
            }
            this._promoProductLinkSetHighlight(
                this._promoProductLinkHighlightIdx <= 0 ? this._promoProductLinkRows.length - 1 : this._promoProductLinkHighlightIdx - 1
            );
            return;
        }

        if (ev.key === 'Enter') {
            ev.preventDefault();
            if (open && this._promoProductLinkRows.length) {
                const i = this._promoProductLinkHighlightIdx >= 0 ? this._promoProductLinkHighlightIdx : 0;
                const p = this._promoProductLinkRows[i];
                if (p) this.applyPromoProductLink(p);
            }
        }
    }

    applyPromoProductLink(product) {
        if (!product || product.id == null) return;
        const urlField = document.getElementById('promo-link-url');
        const labelField = document.getElementById('promo-link-label');
        if (!urlField) return;
        const slug = String(product.slug || '').trim();
        const id = Number(product.id);
        if (slug) {
            urlField.value = `product.html?slug=${encodeURIComponent(slug)}`;
        } else if (Number.isFinite(id) && id > 0) {
            urlField.value = `product.html?id=${id}`;
        } else {
            return;
        }
        if (labelField) {
            const cur = labelField.value.trim();
            const name = String(product.name || '').trim();
            if (!cur && name) {
                labelField.value = name.length > 40 ? `${name.slice(0, 37)}...` : name;
            }
        }
        this._promoProductLinkHidePanel();
        const searchIn = document.getElementById('promo-product-link-search');
        if (searchIn) searchIn.value = '';
        this.showToast('CTA set to this product - save Settings to publish', 'success');
    }

    async _promoProductLinkSearchFetch() {
        const input = document.getElementById('promo-product-link-search');
        const results = document.getElementById('promo-product-link-results');
        if (!input || !results) return;
        const q = input.value.trim();
        if (q.length < 1) {
            this._promoProductLinkHidePanel();
            return;
        }
        if (!this.authToken) return;

        this._promoProductLinkSearchPending = true;
        results.classList.add('prompt');
        results.textContent = 'Searching...';
        results.removeAttribute('hidden');
        results.style.display = 'block';
        this._promoProductLinkSetAriaExpanded(true);
        this._promoProductLinkRows = [];
        this._promoProductLinkHighlightIdx = -1;
        this._promoProductLinkSyncPanelPosition();

        try {
            const url = `${this.apiBaseUrl}/admin/products?search=${encodeURIComponent(q)}&limit=12&page=1`;
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${this.authToken}` },
            });
            if (res.status === 401) {
                this._promoProductLinkHidePanel();
                this.logout();
                return;
            }
            const data = await res.json().catch(() => ({}));
            const rows = Array.isArray(data.products) ? data.products : [];
            results.textContent = '';
            results.innerHTML = '';
            this._promoProductLinkRows = rows;

            if (!rows.length) {
                results.classList.add('prompt');
                results.textContent = 'No matching products. Try another word or SKU.';
            } else {
                results.classList.remove('prompt');
                rows.forEach((p, idx) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'promo-product-link-option';
                    btn.setAttribute('role', 'option');
                    btn.setAttribute('aria-selected', 'false');
                    btn.addEventListener('mousedown', (e) => e.preventDefault());
                    btn.addEventListener('mouseenter', () => {
                        this._promoProductLinkHighlightIdx = idx;
                        this._promoProductLinkApplyHighlight();
                    });
                    const sku = String(p.sku || '').trim();
                    btn.textContent = sku ? `${p.name} (${sku})` : String(p.name || 'Product');
                    btn.addEventListener('click', () => this.applyPromoProductLink(p));
                    results.appendChild(btn);
                });
                this._promoProductLinkHighlightIdx = 0;
                this._promoProductLinkApplyHighlight();
            }
            this._promoProductLinkSyncPanelPosition();
        } catch (_) {
            results.classList.add('prompt');
            results.textContent = 'Search failed. Try again.';
            results.removeAttribute('hidden');
            results.style.display = 'block';
            this._promoProductLinkSyncPanelPosition();
        } finally {
            this._promoProductLinkSearchPending = false;
        }
    }

    _togglePromoCustomColors() {
        const preset = document.getElementById('promo-preset')?.value || '';
        const wrap = document.getElementById('promo-custom-colors');
        if (wrap) wrap.style.display = preset === 'custom' ? 'block' : 'none';
    }

    _buildStoreInfoSettingsPayload(form, { includePromoBanner = false } = {}) {
        const meta = this._storeInfoSettingMeta();
        const hourKeys = new Set([
            'store_hours_weekdays',
            'store_hours_saturday',
            'store_hours_sunday',
            'store_holiday_schedule',
        ]);
        const rows = Object.keys(meta)
            .filter((key) => this.canManageStoreHours || !hourKeys.has(key))
            .map((key) => {
            const input = key === 'store_holiday_schedule' ? null : form.querySelector(`[name="${key}"]`);
            let value = key === 'store_holiday_schedule'
                ? JSON.stringify(this.holidaySchedule || [])
                : (input?.value || '').trim();
            if (key === 'tax_rate') {
                let pct = Number(input?.value);
                if (!Number.isFinite(pct) || pct < 0) pct = 0;
                if (pct > 100) pct = 100;
                value = String(Math.round(pct * 10000) / 1000000);
            }
            if (key === 'store_cash_discount_enabled') {
                const el = form.querySelector('[name="store_cash_discount_enabled"]');
                return {
                    key_name: key,
                    value: el?.checked ? 'true' : 'false',
                    description: meta[key],
                    type: 'boolean',
                };
            }
            if (key === 'store_cash_discount_percent') {
                let pct = Number(form.querySelector('[name="store_cash_discount_percent"]')?.value);
                if (!Number.isFinite(pct) || pct < 0) pct = 0;
                if (pct > 15) pct = 15;
                return {
                    key_name: key,
                    value: String(pct),
                    description: meta[key],
                    type: 'number',
                };
            }
            return {
                key_name: key,
                value,
                description: meta[key],
                type: key === 'store_holiday_schedule' ? 'json' : (key === 'tax_rate' ? 'number' : 'string'),
            };
        });
        if (includePromoBanner) {
            rows.push({
                key_name: 'store_promo_banner',
                value: JSON.stringify(this._collectPromoBannerFromForm()),
                description: 'Site-wide promotional banner (JSON)',
                type: 'json',
            });
        }
        return rows;
    }

    _buildPromoBannerSettingRow() {
        return {
            key_name: 'store_promo_banner',
            value: JSON.stringify(this._collectPromoBannerFromForm()),
            description: 'Site-wide promotional banner (JSON)',
            type: 'json',
        };
    }

    async revertHolidayToDefaultAt(index) {
        if (!this.canManageStoreHours) {
            this._showStoreHoursPermissionAlert();
            return;
        }
        if (!Number.isInteger(index)) return;
        const item = this.holidaySchedule[index];
        if (!item) return;

        const ok = await this.showAdminConfirm({
            title: 'Remove this holiday?',
            message: `This removes "${item.name || 'holiday override'}" from your schedule and saves. If Google is connected, your listing will be updated too.`,
            confirmLabel: 'Remove and save',
            cancelLabel: 'Cancel',
        });
        if (!ok) return;

        const form = document.getElementById('store-info-settings-form');
        if (!form) return;

        const storePhone = form.querySelector('[name="store_phone"]')?.value?.trim() || '';
        if (storePhone && window.HMHERBS_PHONE_US && !HMHERBS_PHONE_US.isValidDisplay(storePhone, false)) {
            this.showToast('Store phone must be formatted as (555) 123-4567', 'error');
            return;
        }

        this.holidaySchedule = this.holidaySchedule.filter((_, i) => i !== index);
        this._renderHolidayScheduleList();

        try {
            const settings = this._buildStoreInfoSettingsPayload(form, { includePromoBanner: false });
            const res = await this.apiRequest('/admin/settings', {
                method: 'PUT',
                body: JSON.stringify({ settings }),
            });
            const syncNote = this._googleSyncResultMessage(res?.googleBusinessSync);
            this.showToast(
                syncNote ? `Holiday removed - ${syncNote}` : 'Holiday removed and hours saved',
                res?.googleBusinessSync?.synced === false ? 'warning' : 'success'
            );
            await this.loadIntegrationLogs();
        } catch (err) {
            this.showToast('Could not remove holiday: ' + (err.message || 'Please try again.'), 'error');
        }
    }

    _applyEmployeeDiscountToForm(map) {
        const form = document.getElementById('employee-discount-settings-form');
        if (!form) return;
        const enabled = String(map.get('employee_discount_enabled') || 'false').toLowerCase();
        const enabledEl = form.querySelector('[name="employee_discount_enabled"]');
        if (enabledEl) enabledEl.checked = enabled === 'true' || enabled === '1';
        const percentEl = form.querySelector('[name="employee_discount_percent"]');
        if (percentEl) {
            const p = Number(map.get('employee_discount_percent'));
            percentEl.value = Number.isFinite(p) ? String(p) : '0';
        }
    }

    _inventorySettingsMeta() {
        return {
            inventory_global_low_stock_threshold: 'Default low-stock warning threshold when a product has no per-item threshold',
            inventory_allow_oversell: 'Allow website sales when inventory is zero',
            inventory_hide_out_of_stock: 'Hide out-of-stock products from category/browse grids'
        };
    }

    _applyInventorySettingsToForm(map) {
        const form = document.getElementById('inventory-settings-form');
        if (!form) return;
        const thresholdEl = form.querySelector('[name="inventory_global_low_stock_threshold"]');
        if (thresholdEl) {
            const t = Number(map.get('inventory_global_low_stock_threshold'));
            thresholdEl.value = Number.isFinite(t) ? String(t) : '5';
        }
        const oversellEl = form.querySelector('[name="inventory_allow_oversell"]');
        if (oversellEl) {
            const raw = String(map.get('inventory_allow_oversell') || 'false').toLowerCase();
            oversellEl.checked = raw === 'true' || raw === '1';
        }
        const hideEl = form.querySelector('[name="inventory_hide_out_of_stock"]');
        if (hideEl) {
            const raw = String(map.get('inventory_hide_out_of_stock') || 'false').toLowerCase();
            hideEl.checked = raw === 'true' || raw === '1';
        }
    }

    _buildInventorySettingsPayload(form) {
        const meta = this._inventorySettingsMeta();
        let threshold = Number(form.querySelector('[name="inventory_global_low_stock_threshold"]')?.value);
        if (!Number.isFinite(threshold) || threshold < 0) threshold = 5;
        const oversell = form.querySelector('[name="inventory_allow_oversell"]')?.checked ? 'true' : 'false';
        const hide = form.querySelector('[name="inventory_hide_out_of_stock"]')?.checked ? 'true' : 'false';
        return Object.keys(meta).map((key) => {
            let value = '';
            if (key === 'inventory_global_low_stock_threshold') value = String(Math.floor(threshold));
            else if (key === 'inventory_allow_oversell') value = oversell;
            else if (key === 'inventory_hide_out_of_stock') value = hide;
            return {
                key_name: key,
                value,
                description: meta[key],
                type: key === 'inventory_global_low_stock_threshold' ? 'number' : 'boolean'
            };
        });
    }

    async saveInventorySettings(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const form = document.getElementById('inventory-settings-form');
        if (!form) return;
        const msg = document.querySelector('[data-inventory-settings-save-msg]');
        if (msg) msg.textContent = '';
        const settings = this._buildInventorySettingsPayload(form);
        try {
            await this.apiRequest('/admin/settings', {
                method: 'PUT',
                body: JSON.stringify({ settings })
            });
            if (msg) {
                msg.textContent = 'Inventory settings saved.';
                msg.style.color = 'var(--success)';
            }
            this.showToast('Inventory settings saved', 'success');
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed.';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Inventory settings save failed: ' + (err.message || 'error'), 'error');
        }
    }

    _applyPosSettingsToForm(map) {
        const form = document.getElementById('pos-settings-form');
        if (!form) return;
        const enabled = String(map.get('pos_cash_discount_enabled') || 'false').toLowerCase();
        const enabledEl = form.querySelector('[name="pos_cash_discount_enabled"]');
        if (enabledEl) enabledEl.checked = enabled === 'true' || enabled === '1';
        const percentEl = form.querySelector('[name="pos_cash_discount_percent"]');
        if (percentEl) {
            const p = Number(map.get('pos_cash_discount_percent'));
            percentEl.value = Number.isFinite(p) ? String(p) : '0';
        }
        for (const key of ['pos_payment_cash_enabled', 'pos_payment_check_enabled', 'pos_payment_card_enabled']) {
            const el = form.querySelector(`[name="${key}"]`);
            if (!el) continue;
            const raw = String(map.get(key) ?? 'true').toLowerCase();
            el.checked = raw === 'true' || raw === '1' || raw === '';
        }
        const logoEl = form.querySelector('[name="pos_store_logo_url"]');
        if (logoEl) logoEl.value = String(map.get('pos_store_logo_url') || '');
        const storeProcessor = String(map.get('store_card_payment_processor') || 'epi').toLowerCase();
        const storeProcessorEl = form.querySelector(`[name="store_card_payment_processor"][value="${['epi', 'nmi', 'mxmerchant'].includes(storeProcessor) ? storeProcessor : 'epi'}"]`);
        if (storeProcessorEl) storeProcessorEl.checked = true;
        const posProcessor = String(map.get('pos_card_payment_processor') || 'inherit').toLowerCase();
        const posProcessorEl = form.querySelector(
            `[name="pos_card_payment_processor"][value="${['inherit', 'epi', 'nmi', 'mxmerchant'].includes(posProcessor) ? posProcessor : 'inherit'}"]`
        );
        if (posProcessorEl) posProcessorEl.checked = true;
        const headerEl = form.querySelector('[name="pos_receipt_header_text"]');
        if (headerEl) headerEl.value = String(map.get('pos_receipt_header_text') || '');
        const footerEl = form.querySelector('[name="pos_receipt_footer_text"]');
        if (footerEl) {
            footerEl.value = String(map.get('pos_receipt_footer_text') || 'Thank you for your purchase!');
        }
        const receiptBools = [
            'pos_receipt_show_address',
            'pos_receipt_show_phone',
            'pos_receipt_show_logo',
            'pos_receipt_show_sku',
            'pos_receipt_show_platform_line',
            'pos_receipt_show_cashier',
            'pos_receipt_show_cash_savings',
            'pos_receipt_auto_print',
            'pos_receipt_show_order_barcode',
        ];
        for (const key of receiptBools) {
            const el = form.querySelector(`[name="${key}"]`);
            if (!el) continue;
            const raw = String(map.get(key) ?? 'true').toLowerCase();
            el.checked = raw === 'true' || raw === '1' || raw === '';
        }
        const copyEl = form.querySelector('[name="pos_receipt_copy_count"]');
        if (copyEl) {
            const copies = Number(map.get('pos_receipt_copy_count'));
            copyEl.value = Number.isFinite(copies) ? String(Math.min(3, Math.max(1, Math.round(copies)))) : '2';
        }
        const returnPolicyFill = form.querySelector('[name="pos_receipt_return_policy"]');
        if (returnPolicyFill) returnPolicyFill.value = String(map.get('pos_receipt_return_policy') || '');
        const timeoutEl = form.querySelector('[name="pos_session_timeout_minutes"]');
        if (timeoutEl) timeoutEl.value = String(map.get('pos_session_timeout_minutes') || '30');
        const attemptsEl = form.querySelector('[name="pos_pin_max_attempts"]');
        if (attemptsEl) attemptsEl.value = String(map.get('pos_pin_max_attempts') || '10');
        const lockoutEl = form.querySelector('[name="pos_pin_lockout_minutes"]');
        if (lockoutEl) lockoutEl.value = String(map.get('pos_pin_lockout_minutes') || '15');
        const signOutEl = form.querySelector('[name="pos_sign_out_after_sale"]');
        if (signOutEl) {
            const raw = String(map.get('pos_sign_out_after_sale') ?? 'false').toLowerCase();
            signOutEl.checked = raw === 'true' || raw === '1';
        }
        const mgrDiscEl = form.querySelector('[name="pos_require_manager_pin_discounts"]');
        if (mgrDiscEl) {
            const raw = String(map.get('pos_require_manager_pin_discounts') ?? 'true').toLowerCase();
            mgrDiscEl.checked = raw === 'true' || raw === '1' || raw === '';
        }
        const maxDiscEl = form.querySelector('[name="pos_max_line_discount_percent"]');
        if (maxDiscEl) maxDiscEl.value = String(map.get('pos_max_line_discount_percent') ?? '10');
        const dailyEmailEl = form.querySelector('[name="pos_daily_sales_email_enabled"]');
        if (dailyEmailEl) {
            const raw = String(map.get('pos_daily_sales_email_enabled') ?? 'false').toLowerCase();
            dailyEmailEl.checked = raw === 'true' || raw === '1';
        }
        const dailyToEl = form.querySelector('[name="pos_daily_sales_email_to"]');
        if (dailyToEl) dailyToEl.value = String(map.get('pos_daily_sales_email_to') || '');
        const dailyHourEl = form.querySelector('[name="pos_daily_sales_email_hour"]');
        if (dailyHourEl) dailyHourEl.value = String(map.get('pos_daily_sales_email_hour') ?? '21');
        const dailyMinEl = form.querySelector('[name="pos_daily_sales_email_minute"]');
        if (dailyMinEl) dailyMinEl.value = String(map.get('pos_daily_sales_email_minute') ?? '0');
        const payrollEmailEl = form.querySelector('[name="pos_payroll_email_enabled"]');
        if (payrollEmailEl) {
            const raw = String(map.get('pos_payroll_email_enabled') ?? 'false').toLowerCase();
            payrollEmailEl.checked = raw === 'true' || raw === '1';
        }
        const payrollToEl = form.querySelector('[name="pos_payroll_email_to"]');
        if (payrollToEl) payrollToEl.value = String(map.get('pos_payroll_email_to') || '');
        const payrollFreqEl = form.querySelector('[name="pos_payroll_email_frequency"]');
        if (payrollFreqEl) {
            const freq = String(map.get('pos_payroll_email_frequency') || 'weekly').toLowerCase();
            payrollFreqEl.value = ['weekly', 'biweekly', 'semimonthly', 'monthly'].includes(freq)
                ? freq
                : 'weekly';
        }
        const payrollWeekdayEl = form.querySelector('[name="pos_payroll_email_weekday"]');
        if (payrollWeekdayEl) payrollWeekdayEl.value = String(map.get('pos_payroll_email_weekday') ?? '1');
        const payrollHourEl = form.querySelector('[name="pos_payroll_email_hour"]');
        if (payrollHourEl) payrollHourEl.value = String(map.get('pos_payroll_email_hour') ?? '8');
        const payrollMinEl = form.querySelector('[name="pos_payroll_email_minute"]');
        if (payrollMinEl) payrollMinEl.value = String(map.get('pos_payroll_email_minute') ?? '0');
        const payrollPayEl = form.querySelector('[name="pos_payroll_email_include_pay"]');
        if (payrollPayEl) {
            const raw = String(map.get('pos_payroll_email_include_pay') ?? 'true').toLowerCase();
            payrollPayEl.checked = raw === 'true' || raw === '1' || raw === '';
        }
        const storeBaseEl = document.getElementById('pos-store-base-url');
        if (storeBaseEl) storeBaseEl.value = String(map.get('pos_store_base_url') || '');
        const eodEl = form.querySelector('[name="pos_eod_reminder_enabled"]');
        if (eodEl) {
            const raw = String(map.get('pos_eod_reminder_enabled') ?? 'true').toLowerCase();
            eodEl.checked = raw === 'true' || raw === '1' || raw === '';
        }
        const eodHourEl = form.querySelector('[name="pos_eod_reminder_hour"]');
        if (eodHourEl) eodHourEl.value = String(map.get('pos_eod_reminder_hour') ?? '20');
        const eodMinEl = form.querySelector('[name="pos_eod_reminder_minute"]');
        if (eodMinEl) eodMinEl.value = String(map.get('pos_eod_reminder_minute') ?? '0');
        const supportPhoneEl = form.querySelector('[name="pos_support_phone"]');
        if (supportPhoneEl) {
            const rawSupport = String(map.get('pos_support_phone') || '');
            if (window.HMHERBS_PHONE_US) {
                const d = HMHERBS_PHONE_US.digitsOnly(rawSupport);
                supportPhoneEl.value = d ? HMHERBS_PHONE_US.formatDigitsToDisplay(d) : '';
                HMHERBS_PHONE_US.attach(supportPhoneEl);
            } else {
                supportPhoneEl.value = rawSupport;
            }
        }
        const helpUrlEl = form.querySelector('[name="pos_help_url"]');
        if (helpUrlEl) helpUrlEl.value = String(map.get('pos_help_url') || '');
        const catalogRefreshEl = form.querySelector('[name="pos_catalog_refresh_minutes"]');
        if (catalogRefreshEl) catalogRefreshEl.value = String(map.get('pos_catalog_refresh_minutes') ?? '60');
        const largeTouchEl = form.querySelector('[name="pos_large_touch_mode"]');
        if (largeTouchEl) {
            const raw = String(map.get('pos_large_touch_mode') ?? 'false').toLowerCase();
            largeTouchEl.checked = raw === 'true' || raw === '1';
        }
        const scanBeepEl = form.querySelector('[name="pos_scan_beep_enabled"]');
        if (scanBeepEl) {
            const raw = String(map.get('pos_scan_beep_enabled') ?? 'true').toLowerCase();
            scanBeepEl.checked = raw === 'true' || raw === '1' || raw === '';
        }
        const displayHoursEl = form.querySelector('[name="pos_display_store_hours_idle"]');
        if (displayHoursEl) {
            const raw = String(map.get('pos_display_store_hours_idle') ?? 'true').toLowerCase();
            displayHoursEl.checked = raw === 'true' || raw === '1' || raw === '';
        }
        const showCostEl = form.querySelector('[name="pos_show_cost_in_cart"]');
        if (showCostEl) {
            const raw = String(map.get('pos_show_cost_in_cart') ?? 'false').toLowerCase();
            showCostEl.checked = raw === 'true' || raw === '1';
        }
        const personnelMode = String(map.get('pos_personnel_mode') || 'time_clock_and_pos').toLowerCase();
        form.querySelectorAll('[name="pos_personnel_mode"]').forEach((el) => {
            el.checked = el.value === personnelMode;
        });
    }

    _syncPosCustomDriverUrlVisibility() {
        const form = document.getElementById('pos-settings-form');
        if (!form) return;
        const adapter = String(
            form.querySelector('[name="pos_card_payment_adapter"]:checked')?.value || 'integrated'
        );
        const group = document.getElementById('pos-custom-driver-url-group');
        if (group) group.style.display = adapter === 'custom' ? '' : 'none';
    }

    _buildEmployeeDiscountSettingsPayload(form) {
        const meta = this._employeeDiscountSettingMeta();
        const enabledEl = form.querySelector('[name="employee_discount_enabled"]');
        let percent = Number(form.querySelector('[name="employee_discount_percent"]')?.value);
        if (!Number.isFinite(percent) || percent < 0) percent = 0;
        if (percent > 100) percent = 100;
        return Object.keys(meta).map((key) => {
            if (key === 'employee_discount_enabled') {
                return {
                    key_name: key,
                    value: enabledEl?.checked ? 'true' : 'false',
                    description: meta[key],
                    type: 'boolean',
                };
            }
            return {
                key_name: key,
                value: String(percent),
                description: meta[key],
                type: 'number',
            };
        });
    }

    _buildPosSettingsPayload(form) {
        const meta = this._posCashDiscountSettingMeta();
        const enabledEl = form.querySelector('[name="pos_cash_discount_enabled"]');
        let percent = Number(form.querySelector('[name="pos_cash_discount_percent"]')?.value);
        if (!Number.isFinite(percent) || percent < 0) percent = 0;
        if (percent > 15) percent = 15;
        const logoUrl = String(form.querySelector('[name="pos_store_logo_url"]')?.value || '').trim();
        let storeProcessor = String(
            form.querySelector('[name="store_card_payment_processor"]:checked')?.value || 'epi'
        ).toLowerCase();
        if (!['epi', 'nmi', 'mxmerchant'].includes(storeProcessor)) storeProcessor = 'epi';
        let posProcessor = String(
            form.querySelector('[name="pos_card_payment_processor"]:checked')?.value || 'inherit'
        ).toLowerCase();
        if (!['inherit', 'epi', 'nmi', 'mxmerchant'].includes(posProcessor)) posProcessor = 'inherit';
        const adapter = 'integrated';
        const customDriverUrl = '';
        const headerText = String(form.querySelector('[name="pos_receipt_header_text"]')?.value || '').trim().slice(0, 200);
        const footerText = String(form.querySelector('[name="pos_receipt_footer_text"]')?.value || '').trim().slice(0, 500);
        return Object.keys(meta).map((key) => {
            if (key === 'pos_cash_discount_enabled') {
                return {
                    key_name: key,
                    value: enabledEl?.checked ? 'true' : 'false',
                    description: meta[key],
                    type: 'boolean',
                };
            }
            if (
                key === 'pos_payment_cash_enabled' ||
                key === 'pos_payment_check_enabled' ||
                key === 'pos_payment_card_enabled'
            ) {
                const el = form.querySelector(`[name="${key}"]`);
                return {
                    key_name: key,
                    value: el?.checked ? 'true' : 'false',
                    description: meta[key],
                    type: 'boolean',
                };
            }
            if (key === 'pos_store_logo_url') {
                return {
                    key_name: key,
                    value: logoUrl,
                    description: meta[key],
                    type: 'string',
                };
            }
            if (key === 'store_card_payment_processor') {
                return {
                    key_name: key,
                    value: storeProcessor,
                    description: meta[key],
                    type: 'string',
                };
            }
            if (key === 'pos_card_payment_processor') {
                return {
                    key_name: key,
                    value: posProcessor,
                    description: meta[key],
                    type: 'string',
                };
            }
            if (key === 'pos_card_payment_adapter') {
                return {
                    key_name: key,
                    value: adapter,
                    description: meta[key],
                    type: 'string',
                };
            }
            if (key === 'pos_custom_payment_driver_url') {
                return {
                    key_name: key,
                    value: customDriverUrl,
                    description: meta[key],
                    type: 'string',
                };
            }
            if (key === 'pos_receipt_header_text') {
                return {
                    key_name: key,
                    value: headerText,
                    description: meta[key],
                    type: 'string',
                };
            }
            if (key === 'pos_receipt_footer_text') {
                return {
                    key_name: key,
                    value: footerText || 'Thank you for your purchase!',
                    description: meta[key],
                    type: 'string',
                };
            }
            if (key.startsWith('pos_receipt_show_')) {
                const el = form.querySelector(`[name="${key}"]`);
                return {
                    key_name: key,
                    value: el?.checked ? 'true' : 'false',
                    description: meta[key],
                    type: 'boolean',
                };
            }
            if (key === 'pos_receipt_auto_print') {
                const el = form.querySelector('[name="pos_receipt_auto_print"]');
                return {
                    key_name: key,
                    value: el?.checked ? 'true' : 'false',
                    description: meta[key],
                    type: 'boolean',
                };
            }
            if (key === 'pos_receipt_copy_count') {
                let copies = Number(form.querySelector('[name="pos_receipt_copy_count"]')?.value);
                if (!Number.isFinite(copies)) copies = 2;
                copies = Math.min(3, Math.max(1, Math.round(copies)));
                return {
                    key_name: key,
                    value: String(copies),
                    description: meta[key],
                    type: 'number',
                };
            }
            if (key === 'pos_session_timeout_minutes') {
                let minutes = Number(form.querySelector('[name="pos_session_timeout_minutes"]')?.value);
                if (!Number.isFinite(minutes)) minutes = 30;
                minutes = Math.min(480, Math.max(5, Math.round(minutes)));
                return { key_name: key, value: String(minutes), description: meta[key], type: 'number' };
            }
            if (key === 'pos_pin_max_attempts') {
                let attempts = Number(form.querySelector('[name="pos_pin_max_attempts"]')?.value);
                if (!Number.isFinite(attempts)) attempts = 10;
                attempts = Math.min(20, Math.max(3, Math.round(attempts)));
                return { key_name: key, value: String(attempts), description: meta[key], type: 'number' };
            }
            if (key === 'pos_pin_lockout_minutes') {
                let lockout = Number(form.querySelector('[name="pos_pin_lockout_minutes"]')?.value);
                if (!Number.isFinite(lockout)) lockout = 15;
                lockout = Math.min(120, Math.max(5, Math.round(lockout)));
                return { key_name: key, value: String(lockout), description: meta[key], type: 'number' };
            }
            if (key === 'pos_sign_out_after_sale') {
                const el = form.querySelector('[name="pos_sign_out_after_sale"]');
                return {
                    key_name: key,
                    value: el?.checked ? 'true' : 'false',
                    description: meta[key],
                    type: 'boolean',
                };
            }
            if (key === 'pos_require_manager_pin_discounts') {
                const el = form.querySelector('[name="pos_require_manager_pin_discounts"]');
                return {
                    key_name: key,
                    value: el?.checked ? 'true' : 'false',
                    description: meta[key],
                    type: 'boolean',
                };
            }
            if (key === 'pos_require_manager_pin_void_refund') {
                return {
                    key_name: key,
                    value: 'true',
                    description: meta[key],
                    type: 'boolean',
                };
            }
            if (key === 'pos_max_line_discount_percent') {
                let pct = Number(form.querySelector('[name="pos_max_line_discount_percent"]')?.value);
                if (!Number.isFinite(pct)) pct = 10;
                pct = Math.min(100, Math.max(0, Math.round(pct)));
                return { key_name: key, value: String(pct), description: meta[key], type: 'number' };
            }
            if (
                key === 'pos_daily_sales_email_enabled' ||
                key === 'pos_eod_reminder_enabled' ||
                key === 'pos_payroll_email_enabled' ||
                key === 'pos_payroll_email_include_pay'
            ) {
                const el = form.querySelector(`[name="${key}"]`);
                return {
                    key_name: key,
                    value: el?.checked ? 'true' : 'false',
                    description: meta[key],
                    type: 'boolean',
                };
            }
            if (
                key === 'pos_daily_sales_email_to' ||
                key === 'pos_support_phone' ||
                key === 'pos_help_url' ||
                key === 'pos_payroll_email_to'
            ) {
                const el = form.querySelector(`[name="${key}"]`);
                return {
                    key_name: key,
                    value: String(el?.value || '').trim(),
                    description: meta[key],
                    type: 'string',
                };
            }
            if (key === 'pos_store_base_url') {
                const el =
                    document.getElementById('pos-store-base-url') ||
                    form.querySelector('[name="pos_store_base_url"]');
                return {
                    key_name: key,
                    value: String(el?.value || '')
                        .trim()
                        .replace(/\/+$/, ''),
                    description: meta[key],
                    type: 'string',
                };
            }
            if (key === 'pos_payroll_email_frequency') {
                let freq = String(
                    form.querySelector('[name="pos_payroll_email_frequency"]')?.value || 'weekly'
                ).toLowerCase();
                if (!['weekly', 'biweekly', 'semimonthly', 'monthly'].includes(freq)) freq = 'weekly';
                return { key_name: key, value: freq, description: meta[key], type: 'string' };
            }
            if (key === 'pos_payroll_email_weekday') {
                let day = Number(form.querySelector('[name="pos_payroll_email_weekday"]')?.value);
                if (!Number.isFinite(day)) day = 1;
                day = Math.min(6, Math.max(0, Math.round(day)));
                return { key_name: key, value: String(day), description: meta[key], type: 'number' };
            }
            if (
                key === 'pos_daily_sales_email_hour' ||
                key === 'pos_eod_reminder_hour' ||
                key === 'pos_payroll_email_hour'
            ) {
                let hour = Number(form.querySelector(`[name="${key}"]`)?.value);
                if (!Number.isFinite(hour)) {
                    hour = key.includes('daily') ? 21 : key.includes('payroll') ? 8 : 20;
                }
                hour = Math.min(23, Math.max(0, Math.round(hour)));
                return { key_name: key, value: String(hour), description: meta[key], type: 'number' };
            }
            if (
                key === 'pos_daily_sales_email_minute' ||
                key === 'pos_eod_reminder_minute' ||
                key === 'pos_payroll_email_minute'
            ) {
                let minute = Number(form.querySelector(`[name="${key}"]`)?.value);
                if (!Number.isFinite(minute)) minute = 0;
                minute = Math.min(59, Math.max(0, Math.round(minute)));
                return { key_name: key, value: String(minute), description: meta[key], type: 'number' };
            }
            if (key === 'pos_catalog_refresh_minutes') {
                let minutes = Number(form.querySelector('[name="pos_catalog_refresh_minutes"]')?.value);
                if (!Number.isFinite(minutes)) minutes = 60;
                minutes = Math.min(1440, Math.max(15, Math.round(minutes)));
                return { key_name: key, value: String(minutes), description: meta[key], type: 'number' };
            }
            if (
                key === 'pos_large_touch_mode' ||
                key === 'pos_scan_beep_enabled' ||
                key === 'pos_display_store_hours_idle' ||
                key === 'pos_show_cost_in_cart'
            ) {
                const el = form.querySelector(`[name="${key}"]`);
                return {
                    key_name: key,
                    value: el?.checked ? 'true' : 'false',
                    description: meta[key],
                    type: 'boolean',
                };
            }
            if (key === 'pos_personnel_mode') {
                let mode = String(
                    form.querySelector('[name="pos_personnel_mode"]:checked')?.value || 'time_clock_and_pos'
                ).toLowerCase();
                if (!['time_clock_only', 'time_clock_and_pos'].includes(mode)) {
                    mode = 'time_clock_and_pos';
                }
                return { key_name: key, value: mode, description: meta[key], type: 'string' };
            }
            if (key === 'pos_receipt_return_policy') {
                const el = form.querySelector('[name="pos_receipt_return_policy"]');
                return {
                    key_name: key,
                    value: String(el?.value || '').trim().slice(0, 300),
                    description: meta[key],
                    type: 'string',
                };
            }
            if (key === 'pos_card_display_mode') {
                return { key_name: key, value: 'nmi_terminal', description: meta[key], type: 'string' };
            }
            if (key === 'pos_display_card_checkout') {
                return { key_name: key, value: 'true', description: meta[key], type: 'boolean' };
            }
            return {
                key_name: key,
                value: String(percent),
                description: meta[key],
                type: 'number',
            };
        });
    }

    async loadEmployeeDiscountSettings() {
        const form = document.getElementById('employee-discount-settings-form');
        if (!form || !this.authToken) return;
        const msg = document.querySelector('[data-employee-discount-save-msg]');
        if (msg) msg.textContent = '';
        try {
            const res = await this.apiRequest('/admin/settings');
            const settings = Array.isArray(res?.settings) ? res.settings : [];
            const map = new Map(settings.map((item) => [item.key_name, item.value || '']));
            this._applyEmployeeDiscountToForm(map);
            this._applyInventorySettingsToForm(map);
        } catch (err) {
            if (msg) {
                msg.textContent = 'Failed to load employee discount settings.';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Failed to load employee discount: ' + (err.message || 'error'), 'error');
        }
    }

    async saveEmployeeDiscountSettings(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const form = document.getElementById('employee-discount-settings-form');
        if (!form) return;
        const msg = document.querySelector('[data-employee-discount-save-msg]');
        if (msg) msg.textContent = '';
        const settings = this._buildEmployeeDiscountSettingsPayload(form);
        try {
            await this.apiRequest('/admin/settings', {
                method: 'PUT',
                body: JSON.stringify({ settings }),
            });
            if (msg) {
                msg.textContent = 'Employee discount settings saved.';
                msg.style.color = 'var(--success)';
            }
            this.showToast('Employee discount settings saved', 'success');
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed.';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Could not save employee discount: ' + (err.message || 'error'), 'error');
        }
    }

    async loadPosSettings() {
        const form = document.getElementById('pos-settings-form');
        if (!form || !this.authToken) return;
        const msg = document.querySelector('[data-pos-settings-save-msg]');
        if (msg) msg.textContent = '';
        try {
            const res = await this.apiRequest('/admin/pos/settings');
            const settings = Array.isArray(res?.settings) ? res.settings : [];
            const map = new Map(settings.map((item) => [item.key_name, item.value || '']));
            this._applyPosSettingsToForm(map);
            await this.loadPosDevices();
        } catch (err) {
            if (msg) {
                msg.textContent = 'Failed to load POS settings.';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Failed to load POS settings: ' + (err.message || 'error'), 'error');
        }
    }

    async savePosSettings(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const form = document.getElementById('pos-settings-form');
        if (!form) return;
        const msg = document.querySelector('[data-pos-settings-save-msg]');
        if (msg) msg.textContent = '';
        const settings = this._buildPosSettingsPayload(form);
        const paymentToggleKeys = new Set([
            'pos_payment_cash_enabled',
            'pos_payment_check_enabled',
            'pos_payment_card_enabled',
        ]);
        const enabledPaymentCount = settings.filter(
            (row) => paymentToggleKeys.has(row.key_name) && row.value === 'true'
        ).length;
        if (enabledPaymentCount === 0) {
            const errMsg = 'Enable at least one in-store payment method (cash, card, or check).';
            if (msg) {
                msg.textContent = errMsg;
                msg.style.color = 'var(--error)';
            }
            this.showToast(errMsg, 'error');
            return;
        }
        const supportPhone = form.querySelector('[name="pos_support_phone"]')?.value?.trim() || '';
        if (supportPhone && window.HMHERBS_PHONE_US && !HMHERBS_PHONE_US.isValidDisplay(supportPhone, false)) {
            const errMsg = 'Support phone must be formatted as (555) 555-0100 or left blank.';
            if (msg) {
                msg.textContent = errMsg;
                msg.style.color = 'var(--error)';
            }
            this.showToast(errMsg, 'error');
            return;
        }
        try {
            await this.apiRequest('/admin/pos/settings', {
                method: 'PUT',
                body: JSON.stringify({ settings }),
            });
            if (msg) {
                msg.textContent = 'POS settings saved.';
                msg.style.color = 'var(--success)';
            }
            this.showToast('POS settings saved', 'success');
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed.';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Could not save POS settings: ' + (err.message || 'error'), 'error');
        }
    }

    /** @deprecated use loadPosSettings */
    async loadPosCashDiscountSettings() {
        return this.loadPosSettings();
    }

    /** @deprecated use savePosSettings */
    async savePosCashDiscountSettings(e) {
        return this.savePosSettings(e);
    }

    _canManagePosBilling() {
        const role = String(this.currentUser?.role || '').toLowerCase();
        return role === 'admin' || role === 'developer' || role === 'super_admin';
    }

    _isPosLicenseDeveloper() {
        return String(this.currentUser?.role || '').toLowerCase() === 'developer';
    }

    async loadPosLicense() {
        const summary = document.getElementById('pos-license-summary');
        const form = document.getElementById('pos-license-form');
        if (!form || !this.authToken) return;
        const msg = document.getElementById('pos-license-form-msg');
        if (msg) msg.textContent = '';
        try {
            const res = await this.apiRequest('/admin/pos/license');
            const license = res.license || {};
            const activeDevices = Number(res.activeDevices) || 0;
            const flags = res.flags || {};
            if (summary) {
                const pastDueLine =
                    license.status === 'past_due' && Number(license.pastDueOwed) > 0
                        ? `<div><strong>Past due:</strong> $${Number(license.pastDueOwed).toFixed(2)}</div>`
                        : '';
                const compLine = license.serviceCompedUntil
                    ? `<div><strong>Comped until:</strong> ${this.escapeHtml(license.serviceCompedUntil)}</div>`
                    : '';
                const graceLine = license.inGracePeriod
                    ? `<div><strong>Grace period:</strong> until ${license.graceEndsAt ? this.escapeHtml(new Date(license.graceEndsAt).toLocaleDateString()) : '-'}</div>`
                    : '';
                const failoverLine =
                    Number(license.failoverOverageAmount) > 0
                        ? `<div><strong>Failover overage:</strong> $${Number(license.failoverOverageAmount).toFixed(2)} (${Number(license.failoverGbUsed).toFixed(1)} GB used)</div>`
                        : license.failoverGbUsed > 0
                          ? `<div><strong>Failover data:</strong> ${Number(license.failoverGbUsed).toFixed(1)} GB (within included 2 GB)</div>`
                          : '';
                summary.innerHTML = `
                    <div><strong>Business:</strong> ${this.escapeHtml(license.businessName || '—')}</div>
                    <div><strong>Billing email:</strong> ${this.escapeHtml(license.billingEmail || '—')}</div>
                    <div><strong>Status:</strong> ${this.escapeHtml(license.status || 'trial')}</div>
                    <div><strong>Active registers:</strong> ${activeDevices} of ${license.licensedStationCount || 1} licensed</div>
                    <div><strong>Monthly:</strong> ${this.escapeHtml(license.monthlyFormatted || '-')}</div>
                    <div style="color:var(--gray-600);font-size:0.85rem;">${this.escapeHtml(license.pricingSummary || '')}</div>
                    ${failoverLine}
                    ${pastDueLine}
                    ${compLine}
                    ${graceLine}
                    <div><strong>Payment on file:</strong> ${license.hasBillingVault ? 'Yes' : 'No'}</div>
                    <div><strong>Next bill:</strong> ${this.escapeHtml(license.nextBillDate || '-')}</div>
                    <div><strong>Enforcement:</strong> ${flags.enforcementEnabled ? 'On' : 'Off (safe mode)'}</div>
                    <div><strong>Billing dry-run:</strong> ${flags.billingDryRun ? 'On' : 'Off'}</div>
                    <div><strong>Grace days (default):</strong> ${flags.graceDaysDefault ?? 15}</div>`;
            }
            const statusEl = form.querySelector('[name="status"]');
            if (statusEl) statusEl.value = license.status || 'trial';
            const stationsEl = form.querySelector('[name="licensedStationCount"]');
            if (stationsEl) stationsEl.value = String(license.licensedStationCount || 1);
            const compedEl = form.querySelector('[name="serviceCompedUntil"]');
            if (compedEl) compedEl.value = license.serviceCompedUntil || '';
            const graceEl = form.querySelector('[name="graceDaysOverride"]');
            if (graceEl) {
                graceEl.value =
                    license.graceDaysOverride != null && license.graceDaysOverride !== ''
                        ? String(license.graceDaysOverride)
                        : '';
            }
            const businessEl = form.querySelector('[name="businessName"]');
            if (businessEl) businessEl.value = license.businessName || '';
            const emailEl = form.querySelector('[name="billingEmail"]');
            if (emailEl) emailEl.value = license.billingEmail || '';
            const notesEl = form.querySelector('[name="notes"]');
            if (notesEl) notesEl.value = license.notes || '';
            const failoverEl = document.getElementById('pos-license-failover-readout');
            if (failoverEl) {
                const gb = Number(license.failoverGbUsed) || 0;
                const over = Number(license.failoverOverageAmount) || 0;
                failoverEl.textContent =
                    over > 0
                        ? `${gb.toFixed(1)} GB used · $${over.toFixed(2)} overage due`
                        : gb > 0
                          ? `${gb.toFixed(1)} GB used (within included 2 GB)`
                          : '0 GB used this period';
            }
            this._updatePosLicensePricingHint(Number(license.licensedStationCount) || 1, license);

            const waiveCard = document.getElementById('pos-license-waive-card');
            const owedEl = document.getElementById('pos-license-past-due-owed');
            const legUpHint = document.getElementById('pos-license-leg-up-hint');
            const devPanel = document.getElementById('pos-license-dev-panel');
            const isDev = this._isPosLicenseDeveloper();
            const isPastDue = license.status === 'past_due' && Number(license.pastDueOwed) > 0;
            if (form) form.style.display = isDev ? 'grid' : 'none';
            if (waiveCard) waiveCard.style.display = isDev && isPastDue ? '' : 'none';
            if (owedEl) {
                owedEl.innerHTML = isPastDue
                    ? `<strong>Amount to waive:</strong> $${Number(license.pastDueOwed).toFixed(2)}`
                    : '';
            }
            if (legUpHint) legUpHint.style.display = isDev && !isPastDue ? '' : 'none';

            const billingCard = document.getElementById('pos-license-billing-card');
            const canBill = this._canManagePosBilling();
            if (billingCard) billingCard.style.display = canBill ? '' : 'none';
            if (canBill && window.adminPosBilling?.init) {
                window.adminPosBilling.init({
                    hasVault: Boolean(license.hasBillingVault),
                    adminApp: this
                });
            }
        } catch (err) {
            if (summary) summary.textContent = 'Failed to load license.';
            this.showToast('Failed to load POS license: ' + (err.message || 'error'), 'error');
        }
    }

    _updatePosLicensePricingHint(stations, license) {
        const hint = document.getElementById('pos-license-pricing-hint');
        if (!hint) return;
        const n = Math.max(1, Math.min(99, Number(stations) || 1));
        let subscription = 100;
        if (n > 1) subscription += Math.min(n - 1, 4) * 50;
        if (n > 5) subscription += (n - 5) * 25;

        const gb = Math.max(0, Number(license?.failoverGbUsed) || 0);
        const overGb = Math.max(0, gb - 2);
        const failoverOverage = overGb > 0 ? Math.ceil(overGb) * 10 : 0;
        const total = subscription + failoverOverage;

        let text = `Estimated monthly: $${total.toFixed(2)}/mo ($${subscription.toFixed(2)} subscription`;
        if (failoverOverage > 0) {
            text += ` + $${failoverOverage.toFixed(2)} auto-metered failover for ${gb.toFixed(1)} GB`;
        } else {
            text += '; failover over 2 GB is metered automatically at $10/GB';
        }
        text += ').';
        hint.textContent = text;
    }

    async savePosLicense(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (!this._isPosLicenseDeveloper()) return;
        const form = document.getElementById('pos-license-form');
        if (!form) return;
        const msg = document.getElementById('pos-license-form-msg');
        if (msg) msg.textContent = '';
        const body = {};
        if (this._isPosLicenseDeveloper()) {
            Object.assign(body, {
                status: form.querySelector('[name="status"]')?.value,
                licensedStationCount: Number(form.querySelector('[name="licensedStationCount"]')?.value) || 1,
                businessName: form.querySelector('[name="businessName"]')?.value || '',
                billingEmail: form.querySelector('[name="billingEmail"]')?.value || '',
                notes: form.querySelector('[name="notes"]')?.value || '',
                serviceCompedUntil: form.querySelector('[name="serviceCompedUntil"]')?.value || null,
                graceDaysOverride: form.querySelector('[name="graceDaysOverride"]')?.value || null
            });
        }
        try {
            await this.apiRequest('/admin/pos/license', { method: 'PUT', body: JSON.stringify(body) });
            if (msg) {
                msg.textContent = 'License saved.';
                msg.style.color = 'var(--success)';
            }
            this.showToast('POS license saved', 'success');
            await this.loadPosLicense();
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed.';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Could not save POS license: ' + (err.message || 'error'), 'error');
        }
    }

    async runPosBillingTest() {
        try {
            const res = await this.apiRequest('/admin/pos/license/run-billing', {
                method: 'POST',
                body: JSON.stringify({})
            });
            const r = res.result || {};
            const text =
                r.message ||
                (r.skipped
                    ? `Skipped (${r.reason})`
                    : r.ok
                      ? `Charge OK`
                      : 'Charge failed');
            this.showToast(text, r.ok ? 'success' : 'info');
            await this.loadPosLicense();
        } catch (err) {
            this.showToast(err.message || 'Billing run failed', 'error');
        }
    }

    async waivePosPastDue(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const form = document.getElementById('pos-license-waive-form');
        if (!form) return;
        const msg = document.getElementById('pos-license-waive-msg');
        if (msg) msg.textContent = '';
        const note = form.querySelector('[name="note"]')?.value || '';
        const notify = Boolean(form.querySelector('[name="notify"]')?.checked);
        try {
            await this.apiRequest('/admin/pos/license/waive-past-due', {
                method: 'POST',
                body: JSON.stringify({ note, notify })
            });
            if (msg) {
                msg.textContent = 'Past due cleared - account restored to active.';
                msg.style.color = 'var(--success)';
            }
            form.reset();
            const notifyEl = form.querySelector('[name="notify"]');
            if (notifyEl) notifyEl.checked = true;
            this.showToast('Past due waived', 'success');
            await this.loadPosLicense();
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Could not waive past due.';
                msg.style.color = 'var(--error)';
            }
            this.showToast(err.message || 'Waive failed', 'error');
        }
    }

    async savePosStoreBaseUrl() {
        const input = document.getElementById('pos-store-base-url');
        const msg = document.getElementById('pos-store-base-url-msg');
        if (!input) return;
        const value = String(input.value || '').trim().replace(/\/+$/, '');
        if (msg) msg.textContent = '';
        if (value) {
            try {
                // eslint-disable-next-line no-new
                new URL(value);
            } catch {
                const errMsg = 'Enter a full http(s) URL (e.g. https://store.example.com).';
                if (msg) {
                    msg.textContent = errMsg;
                    msg.style.color = 'var(--error)';
                }
                this.showToast(errMsg, 'error');
                return;
            }
        }
        try {
            const meta = this._posCashDiscountSettingMeta();
            await this.apiRequest('/admin/pos/settings', {
                method: 'PUT',
                body: JSON.stringify({
                    settings: [
                        {
                            key_name: 'pos_store_base_url',
                            value,
                            description: meta.pos_store_base_url,
                            type: 'string',
                        },
                    ],
                }),
            });
            if (msg) {
                msg.textContent = value
                    ? 'Store address saved.'
                    : 'Cleared — env FRONTEND_URL / POS_PLATFORM_STORE_URL will be used if set.';
                msg.style.color = 'var(--success)';
            }
            this.showToast('Store website address saved', 'success');
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed.';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Save failed: ' + (err.message || 'error'), 'error');
        }
    }

    async copyPosStoreBaseUrl() {
        const input = document.getElementById('pos-store-base-url');
        const msg = document.getElementById('pos-store-base-url-msg');
        const value = String(input?.value || '').trim();
        if (!value) {
            if (msg) {
                msg.textContent = 'Nothing to copy — enter a store address first.';
                msg.style.color = 'var(--error)';
            }
            return;
        }
        try {
            await navigator.clipboard.writeText(value);
            if (msg) {
                msg.textContent = 'Copied — paste into Web POS setup.';
                msg.style.color = 'var(--success)';
            }
        } catch {
            input.select();
            if (msg) {
                msg.textContent = 'Select and copy manually (Ctrl+C).';
                msg.style.color = 'var(--gray-600)';
            }
        }
    }

    /** Remote support connect lives on Business One ops admin — not merchant admin. */
    async loadPosSupport() {
        const list = document.getElementById('pos-support-agents-list');
        const configMsg = document.getElementById('pos-support-config-msg');
        if (!list || !this.authToken) return;
        try {
            const res = await this.apiRequest('/admin/pos/support/registers');
            if (configMsg) {
                let msg =
                    '<span style="color:var(--gray-600);">For <strong>Business One staff</strong>: use the central Support Desk at <a href="/support-desk" target="_blank" rel="noopener" style="font-weight:600;">/support-desk</a> - you do not log into each merchant admin.</span>';
                if (res.platformHubEnabled) {
                    msg +=
                        ' <a href="/support-desk" target="_blank" rel="noopener" style="font-weight:600;">Open Support Desk</a>';
                } else {
                    msg +=
                        ' <span style="color:var(--gray-500);">(Enable <code>POS_PLATFORM_HUB_ENABLED</code> on your support server and sync on each store.)</span>';
                }
                configMsg.innerHTML = msg;
            }
            const dl = document.getElementById('pos-support-download-link');
            if (dl && res.windowsAgentDownloadUrl) {
                dl.href = res.windowsAgentDownloadUrl;
                dl.style.display = '';
            }

            const registers = Array.isArray(res.registers) ? res.registers : [];
            const agents = Array.isArray(res.windowsAgents) ? res.windowsAgents : [];
            let html = '';

            if (registers.length) {
                html += '<h4 style="margin:0 0 0.5rem 0;">Registers (in-POS screen share)</h4>';
                html += registers
                    .map((r) => {
                        const status = r.online
                            ? '<span style="color:var(--success);font-weight:600;">Online</span>'
                            : '<span style="color:var(--gray-500);">Offline</span>';
                        const seen = r.lastSeenAt ? this.formatAdminDateTime(r.lastSeenAt) : 'Never';
                        const plat = r.platform ? this.escapeHtml(r.platform) : 'unknown';
                        const session = r.activeSession?.sessionCode
                            ? ` \u00B7 Session ${this.escapeHtml(r.activeSession.sessionCode)}`
                            : '';
                        const screenBtn =
                            r.screenShareSupported && r.online
                                ? `<button type="button" class="btn btn-primary btn-sm" data-pos-support-screen="${r.id}">Connect screen</button>`
                                : '';
                        return `<div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:center;padding:0.55rem 0;border-bottom:1px solid var(--gray-200);">
                            <div>
                                <div style="font-weight:600;">${this.escapeHtml(r.deviceLabel)}</div>
                                <div style="font-size:0.85rem;color:var(--gray-600);">${status} \u00B7 ${plat}${session}</div>
                                <div style="font-size:0.8rem;color:var(--gray-500);">Last seen ${this.escapeHtml(seen)}</div>
                            </div>
                            <div>${screenBtn}</div>
                        </div>`;
                    })
                    .join('');
            } else {
                html +=
                    '<p style="margin:0 0 1rem 0;color:var(--gray-500);">No registers yet. Create a register key and open the POS app on Windows or Android.</p>';
            }

            if (agents.length) {
                html += '<h4 style="margin:1.25rem 0 0.5rem 0;">Windows full desktop (optional RustDesk)</h4>';
                html += agents
                    .map((a) => {
                        const status = a.online
                            ? '<span style="color:var(--success);font-weight:600;">Online</span>'
                            : '<span style="color:var(--gray-500);">Offline</span>';
                        const rd = a.rustdeskId ? this.escapeHtml(a.rustdeskId) : '-';
                        return `<div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:center;padding:0.55rem 0;border-bottom:1px solid var(--gray-200);">
                            <div>
                                <div style="font-weight:600;">${this.escapeHtml(a.machineLabel)}</div>
                                <div style="font-size:0.85rem;color:var(--gray-600);">${status} \u00B7 RustDesk ${rd}</div>
                            </div>
                            <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
                                <button type="button" class="btn btn-secondary btn-sm" data-pos-support-desktop="${a.id}">Full desktop</button>
                                <button type="button" class="btn btn-ghost btn-sm" data-pos-support-revoke="${a.id}">Revoke</button>
                            </div>
                        </div>`;
                    })
                    .join('');
            }

            list.innerHTML = html;
            list.querySelectorAll('[data-pos-support-screen]').forEach((btn) => {
                btn.addEventListener('click', () =>
                    this.connectPosRegisterScreen(btn.getAttribute('data-pos-support-screen'))
                );
            });
            list.querySelectorAll('[data-pos-support-desktop]').forEach((btn) => {
                btn.addEventListener('click', () =>
                    this.connectPosSupport(btn.getAttribute('data-pos-support-desktop'))
                );
            });
            list.querySelectorAll('[data-pos-support-revoke]').forEach((btn) => {
                btn.addEventListener('click', () =>
                    this.revokePosSupportAgent(btn.getAttribute('data-pos-support-revoke'))
                );
            });
        } catch (err) {
            if (list) list.textContent = 'Failed to load support registers.';
            this.showToast(err.message || 'Failed to load remote support', 'error');
        }
    }

    async connectPosRegisterScreen(deviceId) {
        try {
            const res = await this.apiRequest(`/admin/pos/support/registers/${deviceId}/session`, {
                method: 'POST'
            });
            const sessionId = res.session?.id || '';
            let url = res.viewerUrl || `/support-viewer.html?session=${sessionId}`;
            if (this.authToken) {
                const viewer = new URL(url, window.location.origin);
                viewer.hash = `token=${encodeURIComponent(this.authToken)}`;
                url = viewer.toString();
            }
            window.open(url, '_blank', 'noopener,noreferrer,width=1100,height=720');
            this.showToast('Waiting for cashier to allow screen share on the register...', 'info');
            await this.loadPosSupport();
        } catch (err) {
            this.showToast(err.message || 'Could not start screen share', 'error');
        }
    }

    async connectPosSupport(agentId) {
        try {
            const res = await this.apiRequest(`/admin/pos/support/agents/${agentId}/connect`, { method: 'POST' });
            const connect = res.connect || {};
            const agent = res.agent || {};
            const modal = document.getElementById('pos-support-connect-modal');
            const machine = document.getElementById('pos-support-connect-machine');
            const idEl = document.getElementById('pos-support-rd-id');
            const pwEl = document.getElementById('pos-support-rd-password');
            const web = document.getElementById('pos-support-web-connect');
            if (machine) machine.textContent = agent.machineLabel || 'Remote PC';
            if (idEl) idEl.value = connect.rustdeskId || '';
            if (pwEl) {
                pwEl.value = connect.password || '';
                pwEl.type = 'password';
            }
            if (web) {
                if (connect.webClientUrl) {
                    web.href = connect.webClientUrl;
                    web.style.display = '';
                } else {
                    web.style.display = 'none';
                }
            }
            this._posSupportConnectUri = connect.rustdeskUriWithPassword || connect.rustdeskUri || '';
            if (modal) {
                modal.classList.remove('hidden');
                modal.style.display = 'flex';
            }
        } catch (err) {
            this.showToast(err.message || 'Could not start remote session', 'error');
        }
    }

    closePosSupportConnectModal() {
        const modal = document.getElementById('pos-support-connect-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }
    }

    async revokePosSupportAgent(agentId) {
        const ok = await this.showAdminConfirm({
            title: 'Revoke support agent?',
            message: 'The PC will need to be re-registered before it can connect again.',
            confirmLabel: 'Revoke agent',
            cancelLabel: 'Cancel',
            danger: true,
        });
        if (!ok) return;
        try {
            await this.apiRequest(`/admin/pos/support/agents/${agentId}`, { method: 'DELETE' });
            this.showToast('Support agent revoked', 'success');
            await this.loadPosSupport();
        } catch (err) {
            this.showToast(err.message || 'Revoke failed', 'error');
        }
    }

    _findPosDeviceByLabel(label) {
        const needle = String(label || '').trim().toLowerCase();
        if (!needle) return null;
        const devices = Array.isArray(this._posDevicesList) ? this._posDevicesList : [];
        return devices.find((d) => String(d.deviceLabel || '').trim().toLowerCase() === needle) || null;
    }

    _highlightPosDeviceRow(deviceId) {
        const list = document.getElementById('pos-devices-list');
        if (!list || !deviceId) return;
        list.querySelectorAll('[data-pos-device-row]').forEach((row) => {
            row.style.background = '';
            row.style.borderRadius = '';
            row.style.padding = '0.55rem 0.35rem';
        });
        const row = list.querySelector(`[data-pos-device-row="${deviceId}"]`);
        if (!row) return;
        row.style.background = 'var(--gray-100, #f3f4f6)';
        row.style.borderRadius = '8px';
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async _offerRegenerateExistingPosDevice(existing, label) {
        const msg = document.getElementById('pos-device-create-msg');
        const name = existing?.deviceLabel || label;
        if (msg) {
            msg.innerHTML = `<strong>${this.escapeHtml(name)}</strong> is already registered (see list above). Click <strong>New key</strong> on that row, or confirm below to rotate the key now.`;
            msg.style.color = 'var(--gray-800)';
        }
        this._highlightPosDeviceRow(existing?.id);
        const regenerate = await this.showAdminConfirm({
            title: 'Register already exists',
            message: `"${name}" is already registered. Generate a new key for it? The old key will stop working.`,
            confirmLabel: 'Generate new key',
            cancelLabel: 'Cancel',
        });
        if (regenerate && existing?.id) {
            await this.regeneratePosDevice(existing.id, { skipConfirm: true });
        }
    }

    async loadPosDevices() {
        const list = document.getElementById('pos-devices-list');
        if (!list || !this.authToken) return;
        try {
            const res = await this.apiRequest('/admin/pos/devices');
            const devices = Array.isArray(res?.devices) ? res.devices : [];
            this._posDevicesList = devices;
            if (!devices.length) {
                list.innerHTML =
                    '<p style="margin:0;color:var(--gray-500);font-size:0.9rem;">No registers yet. Generate a key for each tablet below.</p>';
                return;
            }
            const sorted = [...devices].sort((a, b) =>
                String(a.deviceLabel).localeCompare(String(b.deviceLabel))
            );
            list.innerHTML = sorted
                .map((d) => {
                    const seen = d.lastSeenAt ? this.formatAdminDateTime(d.lastSeenAt) : 'Never';
                    return `<div data-pos-device-row="${d.id}" data-device-label="${this.escapeHtml(d.deviceLabel)}" style="display:flex;justify-content:space-between;gap:0.75rem;align-items:center;padding:0.55rem 0.35rem;border-bottom:1px solid var(--gray-200);">
                        <div>
                            <div style="font-weight:600;">${this.escapeHtml(d.deviceLabel)}</div>
                            <div style="font-size:0.85rem;color:var(--gray-600);">${this.escapeHtml(d.keyPrefix)}... \u00B7 Last seen ${this.escapeHtml(seen)}</div>
                        </div>
                        <div style="display:flex;gap:0.35rem;flex-wrap:wrap;justify-content:flex-end;">
                            <button type="button" class="btn btn-secondary btn-sm" data-regenerate-pos-device="${d.id}">New key</button>
                            <button type="button" class="btn btn-ghost btn-sm" data-revoke-pos-device="${d.id}">Revoke</button>
                        </div>
                    </div>`;
                })
                .join('');
            list.querySelectorAll('[data-revoke-pos-device]').forEach((btn) => {
                btn.addEventListener('click', () => this.revokePosDevice(btn.getAttribute('data-revoke-pos-device')));
            });
            list.querySelectorAll('[data-regenerate-pos-device]').forEach((btn) => {
                btn.addEventListener('click', () => this.regeneratePosDevice(btn.getAttribute('data-regenerate-pos-device')));
            });
        } catch (err) {
            list.innerHTML = `<p style="margin:0;color:var(--error);font-size:0.9rem;">${this.escapeHtml(err.message || 'Could not load devices')}</p>`;
        }
    }

    _posRegisterUrl(register = '') {
        const meta = document.querySelector('meta[name="business-one-pos-register-url"]');
        const base = (meta?.getAttribute('content') || 'https://pos.businessonecomprehensive.com/').trim().replace(/\/+$/, '');
        const reg = String(register || '').trim();
        return reg ? `${base}/?register=${encodeURIComponent(reg)}` : `${base}/`;
    }

    _showPosDeviceKeyMessage(msgEl, apiKey, deviceLabel = '') {
        const msg = msgEl || document.getElementById('pos-device-create-msg');
        if (!msg) return;
        const register = String(deviceLabel || document.getElementById('pos-new-device-label')?.value || '').trim();
        const posUrl = this._posRegisterUrl(register);
        const openPos = `<a href="${this.escapeHtml(posUrl)}" target="_blank" rel="noopener noreferrer">Open POS setup</a>`;
        if (apiKey) {
            msg.innerHTML = `<strong>Copy this key now</strong> (shown once):
                <span style="display:inline-flex;align-items:center;gap:0.35rem;flex-wrap:wrap;margin:0.25rem 0;">
                    <code style="user-select:all">${this.escapeHtml(apiKey)}</code>
                    <button type="button" class="btn btn-secondary btn-sm" data-copy-pos-device-key>Copy</button>
                </span>
                <br><span style="font-size:0.9rem;">Paste this key on the tablet (${openPos}). The key already includes this store’s address.</span>`;
            msg.style.color = 'var(--gray-800)';
            const copyBtn = msg.querySelector('[data-copy-pos-device-key]');
            if (copyBtn) {
                copyBtn.addEventListener('click', async () => {
                    try {
                        if (navigator.clipboard?.writeText) {
                            await navigator.clipboard.writeText(apiKey);
                        } else {
                            const ta = document.createElement('textarea');
                            ta.value = apiKey;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                        }
                        this.showToast('Device key copied', 'success');
                    } catch {
                        this.showToast('Could not copy key', 'error');
                    }
                });
            }
        } else {
            msg.innerHTML = `New register key created. ${openPos}`;
            msg.style.color = 'var(--success)';
        }
    }

    async regeneratePosDevice(id, { skipConfirm = false } = {}) {
        if (!id) return;
        if (!skipConfirm) {
            const ok = await this.showAdminConfirm({
                title: 'Generate a new key?',
                message:
                    'The previous key for this register will stop working immediately. Copy the new key into POS setup on the tablet.',
                confirmLabel: 'Generate new key',
                cancelLabel: 'Cancel',
            });
            if (!ok) return;
        }

        const msg = document.getElementById('pos-device-create-msg');
        if (msg) {
            msg.textContent = 'Generating...';
            msg.style.color = '';
        }
        try {
            const res = await this.apiRequest(`/admin/pos/devices/${id}/regenerate-key`, {
                method: 'POST',
            });
            this._showPosDeviceKeyMessage(msg, res?.apiKey, res?.device?.deviceLabel);
            await this.loadPosDevices();
            this.showToast('New register key generated', 'success');
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Could not regenerate device key';
                msg.style.color = 'var(--error)';
            }
            this.showToast(err.message || 'Could not regenerate device key', 'error');
        }
    }

    async createPosDevice() {
        const msg = document.getElementById('pos-device-create-msg');
        const labelInput = document.getElementById('pos-new-device-label');
        const createBtn = document.getElementById('pos-device-create-btn');
        const label = String(labelInput?.value || '').trim();
        if (!label) {
            if (msg) msg.textContent = 'Enter a register name first.';
            return;
        }
        if (!Array.isArray(this._posDevicesList)) {
            await this.loadPosDevices();
        }
        const existing = this._findPosDeviceByLabel(label);
        if (existing) {
            await this._offerRegenerateExistingPosDevice(existing, label);
            return;
        }
        if (msg) msg.textContent = 'Generating...';
        if (createBtn) createBtn.disabled = true;
        try {
            const res = await this.apiRequest('/admin/pos/devices', {
                method: 'POST',
                body: JSON.stringify({ deviceLabel: label }),
            });
            this._showPosDeviceKeyMessage(msg, res?.apiKey, label);
            if (labelInput) labelInput.value = '';
            await this.loadPosDevices();
        } catch (err) {
            if (err.code === 'DUPLICATE_DEVICE_LABEL' || /already exists/i.test(err.message || '')) {
                await this.loadPosDevices();
                const match =
                    this._findPosDeviceByLabel(label) ||
                    (err.existingDeviceId
                        ? (this._posDevicesList || []).find((d) => Number(d.id) === Number(err.existingDeviceId))
                        : null);
                if (match) {
                    await this._offerRegenerateExistingPosDevice(match, label);
                    return;
                }
            }
            if (msg) {
                msg.textContent = err.message || 'Could not create device key';
                msg.style.color = 'var(--error)';
            }
        } finally {
            if (createBtn) createBtn.disabled = false;
        }
    }

    async revokePosDevice(id) {
        if (!id) return;
        const ok = await this.showAdminConfirm({
            title: 'Revoke register?',
            message:
                'This register is removed from the list and the tablet stops connecting. Generate a new key with the same register name when you set up the hardware again.',
            confirmLabel: 'Revoke register',
            cancelLabel: 'Cancel',
            danger: true,
        });
        if (!ok) return;
        try {
            await this.apiRequest(`/admin/pos/devices/${id}`, { method: 'DELETE' });
            await this.loadPosDevices();
            this.showToast('Register removed', 'success');
        } catch (err) {
            this.showToast(err.message || 'Could not revoke register', 'error');
        }
    }

    async loadPosFrontDisplays() {
        const list = document.getElementById('pos-front-displays-list');
        const msg = document.getElementById('pos-front-displays-msg');
        if (!list || !this.authToken) return;
        if (msg) msg.textContent = '';
        try {
            const displayRes = await this.apiRequest('/admin/pos/front-displays');
            const adsRes = await this.apiRequest('/admin/pos/display-ads');
            const displays = Array.isArray(displayRes?.displays) ? displayRes.displays : [];
            const ads = Array.isArray(adsRes?.ads) ? adsRes.ads : [];

            if (!displays.length) {
                list.innerHTML =
                    '<p style="margin:0;color:var(--gray-500);font-size:0.9rem;">No front-facing displays yet. Add a <strong>Customer display</strong> under Point of Sale â†’ Equipment and assign it to a register.</p>';
                return;
            }

            list.innerHTML = displays
                .map((d) => {
                    const register = d.posDeviceLabel ? this.escapeHtml(d.posDeviceLabel) : 'Unassigned';
                    const modeLabel = d.adPlaylistMode === 'selected' ? 'Selected ads only' : 'All active ads';
                    const assignedCount = (d.assignedAdIds || []).length;
                    const playlistNote =
                        d.adPlaylistMode === 'selected'
                            ? assignedCount
                                ? `${assignedCount} ad${assignedCount === 1 ? '' : 's'} assigned`
                                : 'No ads selected yet'
                            : 'Uses full ad library';
                    const meta = [d.manufacturer, d.model].filter(Boolean).join(' ') || 'Customer display';
                    const checkboxes = ads.length
                        ? ads
                              .map((ad) => {
                                  const checked = (d.assignedAdIds || []).includes(ad.id) ? ' checked' : '';
                                  const label =
                                      [ad.title, ad.sourceLabel].filter(Boolean).join(' \u00B7 ') || `Ad #${ad.id}`;
                                  const thumb = ad.imageUrl
                                      ? `<img src="${this.escapeHtml(ad.imageUrl)}" alt="" style="width:48px;height:32px;object-fit:cover;border-radius:4px;">`
                                      : '';
                                  return `<label style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0;cursor:pointer;">
                                    <input type="checkbox" class="pos-front-display-ad-cb" data-display-id="${d.id}" data-ad-id="${ad.id}"${checked}>
                                    ${thumb}
                                    <span style="font-size:0.9rem;">${this.escapeHtml(label)}</span>
                                </label>`;
                              })
                              .join('')
                        : '<p style="margin:0;font-size:0.85rem;color:var(--gray-500);">Add ads in the library below first.</p>';

                    const playlistEditor =
                        d.adPlaylistMode === 'selected'
                            ? `<div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--gray-200);">
                            <div style="font-size:0.85rem;font-weight:600;margin-bottom:0.35rem;">Assigned ads (drag order = checkbox order)</div>
                            ${checkboxes}
                            <button type="button" class="btn btn-primary btn-sm" data-save-front-display-ads="${d.id}" style="margin-top:0.5rem;">Save playlist</button>
                        </div>`
                            : '<p style="margin:0.35rem 0 0;font-size:0.82rem;color:var(--gray-500);">Set playlist to <em>Selected ads only</em> in Equipment to choose ads for this screen.</p>';

                    return `<div style="border:1px solid var(--gray-200);border-radius:8px;padding:0.85rem 1rem;margin-bottom:0.75rem;">
                        <div style="font-weight:600;">${this.escapeHtml(d.label)}</div>
                        <div style="font-size:0.85rem;color:var(--gray-600);">${this.escapeHtml(meta)} \u00B7 Register: ${register}</div>
                        <div style="font-size:0.85rem;color:var(--gray-600);margin-top:0.25rem;">Playlist: <strong>${modeLabel}</strong> \u00B7 ${playlistNote}</div>
                        ${playlistEditor}
                    </div>`;
                })
                .join('');

            list.querySelectorAll('[data-save-front-display-ads]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const displayId = btn.getAttribute('data-save-front-display-ads');
                    const adIds = [];
                    list
                        .querySelectorAll(`.pos-front-display-ad-cb[data-display-id="${displayId}"]:checked`)
                        .forEach((cb) => {
                            adIds.push(Number(cb.getAttribute('data-ad-id')));
                        });
                    this.savePosFrontDisplayAds(displayId, adIds);
                });
            });
        } catch (err) {
            list.innerHTML = `<p style="margin:0;color:var(--error);font-size:0.9rem;">${this.escapeHtml(err.message || 'Could not load displays')}</p>`;
        }
    }

    async savePosFrontDisplayAds(equipmentId, adIds) {
        const msg = document.getElementById('pos-front-displays-msg');
        if (msg) {
            msg.textContent = 'Saving...';
            msg.style.color = '';
        }
        try {
            await this.apiRequest(`/admin/pos/front-displays/${equipmentId}/ads`, {
                method: 'PUT',
                body: JSON.stringify({ adIds })
            });
            if (msg) {
                msg.textContent = 'Playlist saved.';
                msg.style.color = 'var(--success, #059669)';
            }
            this.showToast('Display playlist saved', 'success');
            await this.loadPosFrontDisplays();
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed';
                msg.style.color = 'var(--error)';
            }
            this.showToast(err.message || 'Could not save playlist', 'error');
        }
    }

    async loadPosDisplayAds() {
        const list = document.getElementById('pos-display-ads-list');
        if (!list || !this.authToken) return;
        try {
            const res = await this.apiRequest('/admin/pos/display-ads');
            const ads = Array.isArray(res?.ads) ? res.ads : [];
            if (!ads.length) {
                list.innerHTML =
                    '<p style="margin:0;color:var(--gray-500);font-size:0.9rem;">No display ads yet. Add one below - use the same images from your email campaigns.</p>';
                return;
            }
            list.innerHTML = ads
                .map((ad) => {
                    const thumb = ad.imageUrl
                        ? `<img src="${this.escapeHtml(ad.imageUrl)}" alt="" style="width:72px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--gray-200);">`
                        : '';
                    const status = ad.isActive ? 'Active' : 'Hidden';
                    const meta = [ad.title, ad.sourceLabel].filter(Boolean).join(' \u00B7 ') || 'Untitled ad';
                    return `<div style="display:flex;gap:0.75rem;align-items:center;padding:0.65rem 0;border-bottom:1px solid var(--gray-200);">
                        ${thumb}
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:600;">${this.escapeHtml(meta)}</div>
                            <div style="font-size:0.85rem;color:var(--gray-600);">${status} \u00B7 Order ${ad.sortOrder}</div>
                        </div>
                        <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
                            <button type="button" class="btn btn-secondary btn-sm" data-toggle-pos-display-ad="${ad.id}" data-active="${ad.isActive ? '1' : '0'}">${ad.isActive ? 'Hide' : 'Show'}</button>
                            <button type="button" class="btn btn-ghost btn-sm" data-delete-pos-display-ad="${ad.id}">Delete</button>
                        </div>
                    </div>`;
                })
                .join('');
            list.querySelectorAll('[data-toggle-pos-display-ad]').forEach((btn) => {
                btn.addEventListener('click', () =>
                    this.togglePosDisplayAd(
                        btn.getAttribute('data-toggle-pos-display-ad'),
                        btn.getAttribute('data-active') !== '1'
                    )
                );
            });
            list.querySelectorAll('[data-delete-pos-display-ad]').forEach((btn) => {
                btn.addEventListener('click', () =>
                    this.deletePosDisplayAd(btn.getAttribute('data-delete-pos-display-ad'))
                );
            });
        } catch (err) {
            list.innerHTML = `<p style="margin:0;color:var(--error);font-size:0.9rem;">${this.escapeHtml(err.message || 'Could not load display ads')}</p>`;
        }
    }

    async uploadPosDisplayAdImage(file) {
        if (!file || !this.authToken) return null;
        const fd = new FormData();
        fd.append('image', file);
        const response = await fetch(`${this.apiBaseUrl}/admin/pos/display-ads/upload-image`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.authToken}` },
            body: fd
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Upload failed');
        return data.url || null;
    }

    async savePosDisplayAd(ev) {
        if (ev?.preventDefault) ev.preventDefault();
        const form = document.getElementById('pos-display-ad-form');
        const msg = document.getElementById('pos-display-ad-msg');
        if (!form) return;
        if (msg) {
            msg.textContent = 'Saving...';
            msg.style.color = '';
        }
        try {
            let imageUrl = String(form.querySelector('[name="imageUrl"]')?.value || '').trim();
            const fileInput = document.getElementById('pos-display-ad-file');
            const file = fileInput?.files?.[0];
            if (file) {
                imageUrl = await this.uploadPosDisplayAdImage(file);
                const urlInput = form.querySelector('[name="imageUrl"]');
                if (urlInput && imageUrl) urlInput.value = imageUrl;
            }
            if (!imageUrl) {
                if (msg) {
                    msg.textContent = 'Add an image URL or upload a file.';
                    msg.style.color = 'var(--error)';
                }
                return;
            }
            await this.apiRequest('/admin/pos/display-ads', {
                method: 'POST',
                body: JSON.stringify({
                    title: form.querySelector('[name="title"]')?.value || '',
                    subtitle: form.querySelector('[name="subtitle"]')?.value || '',
                    sourceLabel: form.querySelector('[name="sourceLabel"]')?.value || '',
                    sortOrder: Number(form.querySelector('[name="sortOrder"]')?.value) || 0,
                    imageUrl,
                    isActive: form.querySelector('[name="isActive"]')?.checked !== false
                })
            });
            form.reset();
            if (fileInput) fileInput.value = '';
            const activeBox = document.getElementById('pos-display-ad-active');
            if (activeBox) activeBox.checked = true;
            if (msg) {
                msg.textContent = 'Display ad added.';
                msg.style.color = 'var(--success)';
            }
            this.showToast('Display ad added', 'success');
            await this.loadPosDisplayAds();
            await this.loadPosFrontDisplays();
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Could not save ad';
                msg.style.color = 'var(--error)';
            }
            this.showToast(err.message || 'Could not save display ad', 'error');
        }
    }

    async togglePosDisplayAd(id, isActive) {
        if (!id) return;
        try {
            await this.apiRequest(`/admin/pos/display-ads/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ isActive: Boolean(isActive) })
            });
            await this.loadPosDisplayAds();
            await this.loadPosFrontDisplays();
        } catch (err) {
            this.showToast(err.message || 'Could not update ad', 'error');
        }
    }

    async deletePosDisplayAd(id) {
        if (!id) return;
        const ok = await this.showAdminConfirm({
            title: 'Delete display ad?',
            message: 'This ad will be removed from customer displays.',
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            danger: true,
        });
        if (!ok) return;
        try {
            await this.apiRequest(`/admin/pos/display-ads/${id}`, { method: 'DELETE' });
            await this.loadPosDisplayAds();
            await this.loadPosFrontDisplays();
            this.showToast('Display ad deleted', 'success');
        } catch (err) {
            this.showToast(err.message || 'Could not delete ad', 'error');
        }
    }

    async loadStoreInfoSettings() {
        const form = document.getElementById('store-info-settings-form');
        if (!form || !this.authToken) return;
        const msg = document.querySelector('[data-store-info-save-msg]');
        if (msg) msg.textContent = '';
        try {
            const res = await this.apiRequest('/admin/settings');
            const settings = Array.isArray(res?.settings) ? res.settings : [];
            const map = new Map(settings.map((item) => [item.key_name, item.value || '']));
            this._applyEmployeeDiscountToForm(map);
            this._applyInventorySettingsToForm(map);
            Object.keys(this._storeInfoSettingMeta()).forEach((key) => {
                const input = form.querySelector(`[name="${key}"]`);
                if (!input || key === 'store_holiday_schedule') return;
                let v = map.get(key) || '';
                if (key === 'store_phone' && window.HMHERBS_PHONE_US && v) {
                    const d = HMHERBS_PHONE_US.digitsOnly(v);
                    v = d ? HMHERBS_PHONE_US.formatDigitsToDisplay(d) : '';
                }
                input.value = v;
            });
            const taxInput = form.querySelector('[name="tax_rate"]');
            if (taxInput) {
                let rate = Number(map.get('tax_rate'));
                if (!Number.isFinite(rate) || rate < 0) rate = 0.08;
                if (rate > 1) rate = rate / 100;
                const pct = rate * 100;
                taxInput.value = pct % 1 === 0 ? String(pct) : pct.toFixed(3).replace(/\.?0+$/, '');
            }
            const storeCashEnabled = String(map.get('store_cash_discount_enabled') || 'false').toLowerCase();
            const storeCashEnabledEl = form.querySelector('[name="store_cash_discount_enabled"]');
            if (storeCashEnabledEl) {
                storeCashEnabledEl.checked = storeCashEnabled === 'true' || storeCashEnabled === '1';
            }
            const storeCashPercentEl = form.querySelector('[name="store_cash_discount_percent"]');
            if (storeCashPercentEl) {
                const p = Number(map.get('store_cash_discount_percent'));
                storeCashPercentEl.value = Number.isFinite(p) ? String(p) : '0';
            }
            const holidayRaw = map.get('store_holiday_schedule') || '[]';
            try {
                const parsed = JSON.parse(holidayRaw);
                this.holidaySchedule = Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                this.holidaySchedule = [];
            }
            this._renderHolidayTemplateOptions();
            this._toggleCustomHolidayFields();
            this._renderHolidayScheduleList();
            await this.loadGoogleBusinessStatus();
            await this.loadGoogleCalendarStatus();
            await this.loadIntegrationLogs();
            this._applyStoreHoursFieldAccess();
        } catch (err) {
            if (msg) {
                msg.textContent = 'Failed to load store info.';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Failed to load store info: ' + (err.message || 'error'), 'error');
        }
    }

    async saveStoreInfoSettings(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const form = document.getElementById('store-info-settings-form');
        if (!form) return;
        const msg = document.querySelector('[data-store-info-save-msg]');
        if (msg) msg.textContent = '';

        const storePhone = form.querySelector('[name="store_phone"]')?.value?.trim() || '';
        if (storePhone && window.HMHERBS_PHONE_US && !HMHERBS_PHONE_US.isValidDisplay(storePhone, false)) {
            this.showToast('Store phone must be formatted as (555) 123-4567', 'error');
            return;
        }
        const taxPct = Number(form.querySelector('[name="tax_rate"]')?.value);
        if (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 100) {
            this.showToast('Sales tax rate must be between 0 and 100 percent', 'error');
            return;
        }

        const settings = this._buildStoreInfoSettingsPayload(form, { includePromoBanner: false });

        try {
            const res = await this.apiRequest('/admin/settings', {
                method: 'PUT',
                body: JSON.stringify({ settings }),
            });
            const syncNote = this._googleSyncResultMessage(res?.googleBusinessSync);
            const statusLine = syncNote
                ? `Store info and holidays saved. ${syncNote}.`
                : 'Store info and holidays saved.';
            if (msg) {
                msg.textContent = statusLine;
                msg.style.color = res?.googleBusinessSync?.synced === false ? 'var(--warning, #b45309)' : 'var(--success)';
            }
            const toastType = res?.googleBusinessSync?.synced === false ? 'warning' : 'success';
            this.showToast(statusLine, toastType);
            if (res?.googleBusinessSync?.synced) {
                await this.loadIntegrationLogs();
            }
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Store info save failed: ' + (err.message || 'error'), 'error');
        }
    }

    async savePromoBannerSettings() {
        if (!this.authToken) return;
        const msg = document.querySelector('[data-promo-banner-save-msg]');
        if (msg) {
            msg.textContent = '';
            msg.style.color = '';
        }
        const settings = [this._buildPromoBannerSettingRow()];
        try {
            await this.apiRequest('/admin/settings', {
                method: 'PUT',
                body: JSON.stringify({ settings }),
            });
            if (msg) {
                msg.textContent = 'Promo banner saved and published.';
                msg.style.color = 'var(--success)';
            }
            this.showToast('Promo banner saved', 'success');
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Promo banner save failed: ' + (err.message || 'error'), 'error');
        }
    }

    async loadIntegrationLogs() {
        const list = document.getElementById('integration-logs-list');
        if (!list) return;
        list.innerHTML = '<p style="margin:0;color:var(--gray-500);">Loading logs...</p>';
        try {
            const res = await this.apiRequest('/admin/integration-logs?limit=10');
            const logs = Array.isArray(res?.logs) ? res.logs : [];
            if (!logs.length) {
                list.innerHTML = '<p style="margin:0;color:var(--gray-500);">No recent integration logs found.</p>';
                return;
            }
            list.innerHTML = logs.map((item) => {
                const ts = this.escapeHtml(item.timestamp || '');
                const level = this.escapeHtml((item.level || 'info').toUpperCase());
                const msg = this.escapeHtml(item.message || '');
                const color = (item.level || '').toLowerCase() === 'error' ? 'var(--error)' : 'var(--gray-700)';
                return `<div style="padding:0.45rem 0;border-bottom:1px solid var(--gray-200);">
                    <div style="font-size:0.78rem;color:var(--gray-500);">${ts} - ${level}</div>
                    <div style="font-size:0.9rem;color:${color};">${msg}</div>
                </div>`;
            }).join('');
        } catch (err) {
            list.innerHTML = '<p style="margin:0;color:var(--error);">Failed to load integration logs.</p>';
        }
    }

    async clearIntegrationLogs() {
        const ok = await this.showAdminConfirm({
            title: 'Clear Integration Logs?',
            message: 'This removes entries from the Integration Logs panel.',
            confirmLabel: 'Clear Logs',
            cancelLabel: 'Cancel',
            danger: true,
        });
        if (!ok) return;
        try {
            const res = await this.apiRequest('/admin/integration-logs', { method: 'DELETE' });
            if (!res) {
                throw new Error('Not authorized to clear logs. Sign in as Manager or Admin.');
            }
            this.showToast('Integration logs cleared', 'success');
            await this.loadIntegrationLogs();
        } catch (err) {
            const msg = err.message === 'Failed to fetch'
                ? 'Could not reach the server. Check that the backend is running, then try again.'
                : (err.message || 'error');
            this.showToast('Failed to clear logs: ' + msg, 'error');
        }
    }

    _googleSyncResultMessage(googleBusinessSync) {
        if (!googleBusinessSync) return '';
        if (googleBusinessSync.synced) {
            return 'Your Google Business listing was updated too.';
        }
        if (googleBusinessSync.skipped && googleBusinessSync.reason === 'not_connected') {
            return 'Saved on your website. Connect Google Business Profile above to update Google too.';
        }
        if (googleBusinessSync.error) {
            return 'Saved on your website, but Google could not be updated. Try "Send hours to Google now" or check your connection above.';
        }
        return '';
    }

    _friendlyGoogleApiError(message) {
        const text = String(message || '').trim();
        if (!text) return 'Something went wrong. Please try again.';
        if (/GBP_CLIENT_ID|GBP_CLIENT_SECRET|GCAL_CLIENT|OAuth|\.env|JWT_SECRET|not configured/i.test(text)) {
            return 'Google sign-in is not available on this site yet.';
        }
        if (/access_denied/i.test(text)) {
            return (
                'Google denied access. If the app is in Testing mode, add your Google test users under ' +
                'Google Cloud â†’ OAuth consent screen â†’ Test users. Also confirm the redirect URI ' +
                'http://localhost:3001/api/admin/settings/google-calendar/callback is listed on your OAuth client.'
            );
        }
        if (/invalid_grant|connection expired|google_token_expired/i.test(text)) {
            if (/business profile/i.test(text)) {
                return 'Your Google Business Profile connection expired. Go to Settings and click Connect Google Account again.';
            }
            return 'Your Google Calendar connection expired. Go to Settings and click Connect Google Calendar again.';
        }
        if (/Cloud Console|My Business Account Management|Business Business Information|quota|QPM/i.test(text)) {
            return '';
        }
        return text;
    }

    _applyGoogleStatusPanelStyle(panel, state) {
        if (!panel) return;
        const styles = {
            notReady: { border: '1px solid #f59e0b', background: '#fffbeb' },
            ready: { border: '1px solid var(--gray-200)', background: 'var(--gray-50)' },
            connected: { border: '1px solid #16a34a', background: '#f0fdf4' },
        };
        const s = styles[state] || styles.ready;
        panel.style.border = s.border;
        panel.style.background = s.background;
    }

    _renderGoogleBusinessStatus(status = {}) {
        const statusText = document.getElementById('gbp-status-text');
        const statusPanel = document.getElementById('gbp-status-panel');
        const connectBtn = document.getElementById('gbp-connect-btn');
        const disconnectBtn = document.getElementById('gbp-disconnect-btn');
        const saveLocBtn = document.getElementById('gbp-save-location-btn');
        const locationWrap = document.getElementById('gbp-location-wrap');
        const syncBtn = document.getElementById('store-hours-sync-google-btn');
        const locationSelect = document.getElementById('gbp-location-select');

        if (!status.clientConfigured) {
            this._applyGoogleStatusPanelStyle(statusPanel, 'notReady');
            if (statusText) {
                statusText.textContent =
                    'Google sign-in is not available on this site yet. When it is turned on, you will use the Connect button below. After you sign in, this box will show that you are connected.';
            }
            if (connectBtn) connectBtn.disabled = true;
            if (disconnectBtn) disconnectBtn.style.display = 'none';
            if (saveLocBtn) saveLocBtn.style.display = 'none';
            if (locationWrap) locationWrap.style.display = 'none';
            if (syncBtn) syncBtn.disabled = true;
            return;
        }

        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.style.display = status.connected ? 'none' : 'inline-flex';
        }
        if (disconnectBtn) {
            disconnectBtn.style.display = status.connected ? 'inline-flex' : 'none';
        }

        if (status.connected) {
            this._applyGoogleStatusPanelStyle(statusPanel, 'connected');
            const email = status.connectedEmail ? ` Signed in as ${status.connectedEmail}.` : '';
            const syncPending = Boolean(status.apiAccessPending || this.gbpGoogleSyncUnavailable);
            if (statusText) {
                if (syncPending) {
                    statusText.textContent =
                        `Connected to Google.${email} Map hour sync is not set up yet; hours you save here still update your website.`;
                } else {
                    const loc = status.locationName
                        ? ' Your store listing on Google is selected.'
                        : ' Choose your store below.';
                    statusText.textContent = `Connected - your hours can update on Google when you save.${email}${loc}`;
                }
            }
            if (locationWrap) locationWrap.style.display = 'block';
            if (locationSelect) {
                locationSelect.disabled = syncPending;
                if (syncPending) {
                    locationSelect.innerHTML =
                        '<option value="">Store list will appear after map sync is enabled</option>';
                }
            }
            if (saveLocBtn) saveLocBtn.style.display = syncPending ? 'none' : 'inline-flex';
        } else {
            this._applyGoogleStatusPanelStyle(statusPanel, 'ready');
            if (statusText) {
                statusText.textContent =
                    'Ready to connect. Click "Connect Google Account" below and sign in with the Google account that manages your store.';
            }
            if (locationWrap) locationWrap.style.display = 'none';
            if (saveLocBtn) saveLocBtn.style.display = 'none';
        }

        if (syncBtn) syncBtn.disabled = !status.readyToSync;
    }

    async loadGoogleBusinessStatus() {
        if (!this.authToken) return;
        try {
            const status = await this.apiRequest('/admin/settings/google-business/status');
            this.gbpStatus = status;
            this.gbpGoogleSyncUnavailable = Boolean(status.apiAccessPending);
            this._renderGoogleBusinessStatus(status);
            if (status.connected) {
                await this.loadGoogleBusinessLocations(status.locationName || '');
            }
        } catch (err) {
            this._renderGoogleBusinessStatus({ clientConfigured: false, connected: false, readyToSync: false });
            this.showToast(
                this._friendlyGoogleApiError(err.message) || 'Could not load Google connection status.',
                'error'
            );
        }
    }

    async loadGoogleBusinessLocations(selectedName = '') {
        const select = document.getElementById('gbp-location-select');
        if (!select) return;
        try {
            const res = await this.apiRequest('/admin/settings/google-business/locations');
            const locations = Array.isArray(res?.locations) ? res.locations : [];
            if (!locations.length) {
                select.innerHTML = '<option value="">No store found on this Google account</option>';
                select.disabled = true;
                return;
            }
            select.disabled = false;
            select.innerHTML =
                '<option value="">Select location...</option>' +
                locations
                    .map((loc) => {
                        const label = `${loc.title || loc.name}${loc.address ? ` - ${loc.address}` : ''}`;
                        return `<option value="${this.escapeHtml(loc.name)}">${this.escapeHtml(label)}</option>`;
                    })
                    .join('');
            if (selectedName) select.value = selectedName;
            this.gbpGoogleSyncUnavailable = false;
            if (this.gbpStatus) {
                this.gbpStatus.apiAccessPending = false;
                this._renderGoogleBusinessStatus(this.gbpStatus);
            }
        } catch (err) {
            if (err.code === 'GOOGLE_TOKEN_EXPIRED') {
                await this.loadGoogleBusinessStatus();
                this.showToast(this._friendlyGoogleApiError(err.message), 'warning');
                return;
            }
            this.gbpGoogleSyncUnavailable = true;
            if (this.gbpStatus) {
                this.gbpStatus.apiAccessPending = true;
                this._renderGoogleBusinessStatus(this.gbpStatus);
            }
        }
    }

    async connectGoogleBusiness() {
        try {
            const res = await this.apiRequest('/admin/settings/google-business/connect');
            if (!res?.authUrl) {
                this.showToast('Could not start Google connection', 'error');
                return;
            }
            window.location.href = res.authUrl;
        } catch (err) {
            this.showToast(this._friendlyGoogleApiError(err.message), 'error');
        }
    }

    async disconnectGoogleBusiness() {
        const ok = await this.showAdminConfirm({
            title: 'Disconnect Google?',
            message: 'Your hours will no longer update on Google automatically until you connect again.',
            confirmLabel: 'Disconnect',
            cancelLabel: 'Cancel',
            danger: true,
        });
        if (!ok) return;
        try {
            await this.apiRequest('/admin/settings/google-business/disconnect', { method: 'POST' });
            this.showToast('Google Business Profile disconnected', 'success');
            await this.loadGoogleBusinessStatus();
        } catch (err) {
            this.showToast('Disconnect failed: ' + (err.message || 'error'), 'error');
        }
    }

    async saveGoogleBusinessLocation() {
        const select = document.getElementById('gbp-location-select');
        const locationName = (select?.value || '').trim();
        if (!locationName) {
            this.showToast('Select or enter a Google location ID', 'warning');
            return;
        }
        try {
            await this.apiRequest('/admin/settings/google-business/location', {
                method: 'PUT',
                body: JSON.stringify({ locationName }),
            });
            this.showToast('Google location saved', 'success');
            await this.loadGoogleBusinessStatus();
        } catch (err) {
            this.showToast('Save location failed: ' + (err.message || 'error'), 'error');
        }
    }

    handleGoogleBusinessOAuthReturn() {
        const params = new URLSearchParams(window.location.search);
        const gbp = params.get('gbp');
        if (!gbp) return;
        const msg = params.get('msg');
        if (gbp === 'connected') {
            this.showToast('Google Business Profile connected', 'success');
        } else if (gbp === 'error') {
            this.showToast(
                'Google connection failed: ' + (this._friendlyGoogleApiError(msg) || msg || 'unknown error'),
                'error'
            );
        }
        const clean = new URL(window.location.href);
        clean.searchParams.delete('gbp');
        if (!params.get('gcal')) clean.searchParams.delete('msg');
        window.history.replaceState({}, '', clean.pathname + clean.hash + (clean.search || ''));
    }

    _setGcalActionMsg(text, isError = false) {
        const msg = document.querySelector('[data-gcal-action-msg]');
        if (!msg) return;
        msg.textContent = text || '';
        msg.style.color = isError ? 'var(--error)' : text ? 'var(--success)' : '';
    }

    _renderGoogleCalendarStatus(status = {}) {
        const statusText = document.getElementById('gcal-status-text');
        const statusPanel = document.getElementById('gcal-status-panel');
        const connectBtn = document.getElementById('gcal-connect-btn');
        const disconnectBtn = document.getElementById('gcal-disconnect-btn');
        const saveBtn = document.getElementById('gcal-save-calendar-btn');
        const calendarWrap = document.getElementById('gcal-calendar-wrap');
        const manualInput = document.getElementById('gcal-calendar-manual');

        if (!status.clientConfigured) {
            this._applyGoogleStatusPanelStyle(statusPanel, 'notReady');
            if (statusText) {
                statusText.textContent =
                    'Google Calendar sign-in is not available on this site yet. When it is turned on, you will use the Connect button below. After you sign in, this box will show that you are connected.';
            }
            if (connectBtn) connectBtn.disabled = true;
            if (disconnectBtn) disconnectBtn.style.display = 'none';
            if (saveBtn) saveBtn.style.display = 'none';
            if (calendarWrap) calendarWrap.style.display = 'none';
            return;
        }

        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.style.display = status.connected ? 'none' : 'inline-flex';
        }
        if (disconnectBtn) {
            disconnectBtn.style.display = status.connected ? 'inline-flex' : 'none';
        }

        if (status.connected) {
            this._applyGoogleStatusPanelStyle(statusPanel, 'connected');
            const email = status.connectedEmail ? ` Signed in as ${status.connectedEmail}.` : '';
            const cal =
                status.calendarId && status.calendarId !== 'primary'
                    ? ' EDSA bookings will use the calendar you selected below.'
                    : status.calendarId === 'primary'
                      ? ' EDSA bookings will go to your main Google calendar.'
                      : ' Choose which calendar should receive EDSA bookings below.';
            if (statusText) {
                statusText.textContent = `Connected - EDSA appointments will sync to your calendar.${email}${cal}`;
            }
            if (calendarWrap) calendarWrap.style.display = 'block';
            if (saveBtn) saveBtn.style.display = 'inline-flex';
            if (manualInput && status.calendarId) manualInput.value = status.calendarId;
        } else {
            this._applyGoogleStatusPanelStyle(statusPanel, 'ready');
            if (statusText) {
                statusText.textContent =
                    'Ready to connect. Click "Connect Google Calendar" below and sign in with the Google account you use for appointments.';
            }
            if (calendarWrap) calendarWrap.style.display = 'none';
            if (saveBtn) saveBtn.style.display = 'none';
        }
    }

    async loadGoogleCalendarStatus() {
        if (!this.authToken) return;
        try {
            const status = await this.apiRequest('/admin/settings/google-calendar/status');
            this.gcalStatus = status;
            this._renderGoogleCalendarStatus(status);
            if (status.connected) {
                await this.loadGoogleCalendarList(status.calendarId || '');
            }
        } catch (err) {
            this._renderGoogleCalendarStatus({ clientConfigured: false, connected: false });
            this._setGcalActionMsg(this._friendlyGoogleApiError(err.message) || 'Could not load calendar connection status.', true);
        }
    }

    async loadGoogleCalendarList(selectedId = '') {
        const select = document.getElementById('gcal-calendar-select');
        if (!select) return;
        try {
            const res = await this.apiRequest('/admin/settings/google-calendar/calendars');
            const calendars = Array.isArray(res?.calendars) ? res.calendars : [];
            if (!calendars.length) {
                select.innerHTML = '<option value="">No calendars found — enter your calendar below</option>';
                return;
            }
            select.innerHTML =
                '<option value="">Select calendar…</option>' +
                calendars
                    .map((cal) => {
                        const label = `${cal.summary || cal.id}${cal.primary ? ' (main calendar)' : ''}`;
                        return `<option value="${this.escapeHtml(cal.id)}">${this.escapeHtml(label)}</option>`;
                    })
                    .join('');
            if (selectedId) select.value = selectedId;
        } catch (err) {
            const msg = String(err?.message || '');
            if (/expired|invalid_grant|google_token_expired/i.test(msg)) {
                await this.loadGoogleCalendarStatus();
                this._setGcalActionMsg(this._friendlyGoogleApiError(msg), true);
            }
            select.innerHTML = '<option value="">Could not load calendars</option>';
        }
    }

    async connectGoogleCalendar() {
        try {
            this._setGcalActionMsg('');
            const res = await this.apiRequest('/admin/settings/google-calendar/connect');
            if (!res?.authUrl) {
                this.showToast('Could not start Google Calendar connection', 'error');
                return;
            }
            window.location.href = res.authUrl;
        } catch (err) {
            this.showToast(this._friendlyGoogleApiError(err.message), 'error');
        }
    }

    async disconnectGoogleCalendar() {
        const ok = await this.showAdminConfirm({
            title: 'Disconnect Google Calendar?',
            message: 'New EDSA bookings will no longer be added to Google Calendar until you connect again.',
            confirmLabel: 'Disconnect',
            cancelLabel: 'Cancel',
            danger: true,
        });
        if (!ok) return;
        try {
            await this.apiRequest('/admin/settings/google-calendar/disconnect', { method: 'POST' });
            this.showToast('Google Calendar disconnected', 'success');
            await this.loadGoogleCalendarStatus();
            this._setGcalActionMsg('');
        } catch (err) {
            this.showToast('Disconnect failed: ' + (err.message || 'error'), 'error');
        }
    }

    async saveGoogleCalendarSelection() {
        const select = document.getElementById('gcal-calendar-select');
        const manual = document.getElementById('gcal-calendar-manual');
        const calendarId = (select?.value || manual?.value || '').trim();
        if (!calendarId) {
            this.showToast('Select or enter a calendar ID', 'warning');
            return;
        }
        try {
            await this.apiRequest('/admin/settings/google-calendar/calendar', {
                method: 'PUT',
                body: JSON.stringify({ calendarId }),
            });
            this.showToast('EDSA calendar saved', 'success');
            this._setGcalActionMsg('Calendar saved for EDSA bookings.');
            await this.loadGoogleCalendarStatus();
        } catch (err) {
            this.showToast('Save calendar failed: ' + (err.message || 'error'), 'error');
        }
    }

    handleGoogleCalendarOAuthReturn() {
        const params = new URLSearchParams(window.location.search);
        const gcal = params.get('gcal');
        if (!gcal) return;
        const msg = params.get('msg');
        if (gcal === 'connected') {
            this.showToast('Google Calendar connected for EDSA', 'success');
            this._setGcalActionMsg('You are signed in. Choose which calendar should receive EDSA bookings, then click Save Calendar.');
            this.loadGoogleCalendarStatus();
        } else if (gcal === 'error') {
            this.showToast('Google Calendar connection failed: ' + (msg || 'unknown error'), 'error');
            this._setGcalActionMsg(msg || 'Connection failed', true);
        }
        const clean = new URL(window.location.href);
        clean.searchParams.delete('gcal');
        if (!params.get('gbp')) clean.searchParams.delete('msg');
        window.history.replaceState({}, '', clean.pathname + clean.hash + (clean.search || ''));
    }

    async syncStoreHoursToGoogleBusiness() {
        if (!this.canManageStoreHours) {
            this._showStoreHoursPermissionAlert();
            return;
        }
        const btn = document.getElementById('store-hours-sync-google-btn');
        const originalText = btn ? btn.textContent : '';
        if (!this.gbpStatus?.readyToSync) {
            this.showToast('Connect Google and select a business location first', 'warning');
            return;
        }
        const ok = await this.showAdminConfirm({
            title: 'Update hours on Google?',
            message:
                'This sends your current weekday, Saturday, Sunday, and holiday hours to your Google Business listing.',
            confirmLabel: 'Push Now',
            cancelLabel: 'Cancel',
        });
        if (!ok) return;

        try {
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Syncing...';
            }
            const res = await this.apiRequest('/admin/settings/google-business/sync-hours', {
                method: 'POST',
            });
            const regular = Number(res?.syncedRegularPeriods || 0);
            const special = Number(res?.syncedSpecialPeriods || res?.syncedPeriods || 0);
            this.showToast('Your hours were sent to Google.', 'success');
            await this.loadIntegrationLogs();
        } catch (err) {
            this.showToast(this._friendlyGoogleApiError(err.message) || 'Could not update Google. Check your connection above.', 'error');
        } finally {
            if (btn) {
                btn.disabled = !this.gbpStatus?.readyToSync;
                btn.textContent = originalText || 'Send hours to Google now';
            }
        }
    }

    async loadPromoBannerSettings() {
        if (!this.authToken || !document.getElementById('promo-banner-save-btn')) return;
        const msg = document.querySelector('[data-promo-banner-save-msg]');
        if (msg) msg.textContent = '';
        try {
            const res = await this.apiRequest('/admin/settings');
            const settings = Array.isArray(res?.settings) ? res.settings : [];
            const map = new Map(settings.map((item) => [item.key_name, item.value || '']));
            this._applyPromoBannerToForm(map.get('store_promo_banner') || '{}');
        } catch (err) {
            if (msg) {
                msg.textContent = 'Failed to load promo banner settings.';
                msg.style.color = 'var(--error)';
            }
            console.warn('loadPromoBannerSettings', err);
        }
    }

    async loadMarketingHub() {
        if (!this.authToken) return;
        try {
            const res = await this.apiRequest('/admin/marketing-settings');
            const signup = document.getElementById('marketing-signup-url');
            const headline = document.getElementById('marketing-newsletter-headline');
            const eff = res && res.effective ? res.effective : {};
            if (signup) signup.value = eff.signupLandingUrl || '';
            if (headline) headline.value = eff.headline || '';
            await this.loadPromoBannerSettings();
            await Promise.all([this.loadPosFrontDisplays(), this.loadPosDisplayAds()]);
            await this.loadWebPromotionsTable();
            this._refreshMainContentScroll();
        } catch (e) {
            console.error('loadMarketingHub', e);
        }
    }

    async saveMarketingHub(ev) {
        if (ev) ev.preventDefault();
        const signup = document.getElementById('marketing-signup-url');
        const headline = document.getElementById('marketing-newsletter-headline');
        try {
            await this.apiRequest('/admin/marketing-settings', {
                method: 'PUT',
                body: JSON.stringify({
                    signupLandingUrl: (signup?.value || '').trim(),
                    headline: (headline?.value || '').trim()
                })
            });
            this.showToast('Marketing settings saved', 'success');
            await this.loadMarketingHub();
        } catch (err) {
            this.showToast('Save failed: ' + (err.message || 'error'), 'error');
        }
    }

    _personnelRoleBadge(role) {
        const map = {
            developer: 'badge-role-admin',
            admin: 'badge-role-admin',
            manager: 'badge-role-manager',
            assistant_manager: 'badge-role-assistant',
        };
        const cls = map[role] || 'badge-info';
        const label =
            {
                developer: 'Developer',
                admin: 'Admin',
                manager: 'Manager',
                assistant_manager: 'Assistant Manager',
            }[role] || role;
        return `<span class="badge ${cls}" style="display:inline-block;padding:0.2rem 0.55rem;border-radius:9999px;font-size:0.75rem;font-weight:600;">${this._escapeHtml(label)}</span>`;
    }

    _formatPersonnelDate(d) {
        if (!d) return '-';
        try {
            return new Date(d).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
            });
        } catch {
            return '-';
        }
    }

    async loadAdminTeam() {
        const list = document.getElementById('admin-team-list');
        const roleSelect = document.getElementById('team-create-role');
        if (!list || !this.isFullAdmin) return;

        list.innerHTML =
            '<div class="loading" style="padding:2rem;text-align:center;color:var(--gray-500);"><div class="spinner" style="margin:0 auto 0.75rem;"></div>Loading personnel...</div>';
        const profileMount = document.getElementById('admin-team-profile');
        if (profileMount) profileMount.style.display = 'none';

        try {
            const res = await this.apiRequest('/admin/team');
            const users = Array.isArray(res?.users) ? res.users : [];
            const roles = Array.isArray(res?.roles) ? res.roles : [];
            this._teamRoleOptions = roles;
            this._teamUsersCache = users;
            this._registerOnlyCache = Array.isArray(res?.registerOnlyEmployees) ? res.registerOnlyEmployees : [];

            if (roleSelect && roleSelect.options.length === 0) {
                roles.forEach((r) => {
                    const opt = document.createElement('option');
                    opt.value = r.id;
                    opt.textContent = r.label || r.id;
                    roleSelect.appendChild(opt);
                });
                const assistantOpt = roleSelect.querySelector('option[value="assistant_manager"]');
                if (assistantOpt) assistantOpt.selected = true;
            }

            if (!users.length && !this._registerOnlyCache.length) {
                list.innerHTML =
                    '<div style="text-align:center;padding:2.5rem 1rem;color:var(--gray-500);"><i class="fas fa-users" style="font-size:2.5rem;opacity:0.25;display:block;margin-bottom:0.75rem;"></i><p style="margin:0;">No personnel yet. Add someone above.</p></div>';
                return;
            }

            const myId = this.currentUser?.id;
            const isDeveloperActor = this.currentUser?.role === 'developer';

            const rows = users
                .map((u) => {
                    const isSelf = myId != null && Number(u.id) === Number(myId);
                    const isDeveloperTarget = u.role === 'developer';
                    const canManageDeveloperTarget = !isDeveloperTarget || isDeveloperActor;
                    const nextRole =
                        u.role === 'admin'
                            ? null
                            : u.role === 'manager'
                              ? 'admin'
                              : u.role === 'assistant_manager'
                                ? 'manager'
                                : null;
                    const nextLabel =
                        nextRole === 'admin'
                            ? 'Admin'
                            : nextRole === 'manager'
                              ? 'Manager'
                              : nextRole === 'assistant_manager'
                                ? 'Assistant Manager'
                                : '';
                    const promoteBtn =
                        nextRole && !isSelf
                            ? `<button type="button" class="btn btn-sm btn-secondary" title="Promote to ${nextLabel}" data-team-action="promote" data-team-id="${u.id}" data-team-role="${nextRole}"><i class="fas fa-arrow-up" aria-hidden="true"></i> Promote</button>`
                            : '';
                    const deleteBtn =
                        isSelf || !canManageDeveloperTarget
                            ? ''
                            : `<button type="button" class="btn btn-sm btn-danger" title="Remove account" data-team-action="delete" data-team-id="${u.id}" data-team-email="${this._escapeHtml(u.email)}"><i class="fas fa-trash" aria-hidden="true"></i></button>`;
                    return `<tr data-team-row="${u.id}">
                        <td>
                            <strong>${this._escapeHtml(u.email)}</strong>
                            ${isSelf ? '<span class="personnel-you-tag">You</span>' : ''}
                        </td>
                        <td>${this._escapeHtml(u.firstName)} ${this._escapeHtml(u.lastName)}</td>
                        <td>${this._personnelRoleBadge(u.role)}</td>
                        <td>${u.isActive ? '<span class="badge badge-success">Active</span>' : '<span class="badge" style="background:#f3f4f6;color:#6b7280;">Inactive</span>'}</td>
                        <td style="font-size:0.85rem;color:var(--gray-600);white-space:nowrap;">${this._escapeHtml(this._formatPersonnelDate(u.lastLogin))}</td>
                        <td>
                            <div class="personnel-actions">
                                <button type="button" class="btn btn-sm btn-secondary btn-icon-edit" title="Edit profile" data-team-action="edit" data-team-id="${u.id}" aria-label="Edit ${this._escapeHtml(u.email)}">
                                    <i class="fas fa-pen" aria-hidden="true"></i>
                                </button>
                                ${promoteBtn}
                                ${deleteBtn}
                            </div>
                        </td>
                    </tr>`;
                })
                .join('');

            const registerRows = (this._registerOnlyCache || [])
                .map((r) => `<tr data-register-row="${r.id}">
                        <td><span style="color:var(--gray-500);">-</span></td>
                        <td>${this._escapeHtml(r.firstName)} ${this._escapeHtml(r.lastName)}</td>
                        <td><span class="badge" style="background:#fef3c7;color:#92400e;">Register only</span></td>
                        <td>${r.isActive ? '<span class="badge badge-success">Active</span>' : '<span class="badge" style="background:#f3f4f6;color:#6b7280;">Inactive</span>'}</td>
                        <td style="font-size:0.85rem;color:var(--gray-600);white-space:nowrap;">-</td>
                        <td>
                            <div class="personnel-actions">
                                <button type="button" class="btn btn-sm btn-secondary btn-icon-edit" title="Edit profile" data-team-action="edit-register" data-register-id="${r.id}" aria-label="Edit ${this._escapeHtml(r.firstName)} ${this._escapeHtml(r.lastName)}">
                                    <i class="fas fa-pen" aria-hidden="true"></i>
                                </button>
                            </div>
                        </td>
                    </tr>`)
                .join('');

            list.innerHTML = `
                <div class="personnel-table-wrap table-container">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Email</th>
                                <th>Name</th>
                                <th>Role</th>
                                <th>Status</th>
                                <th>Last login</th>
                                <th style="text-align:right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>${rows}${registerRows}</tbody>
                    </table>
                </div>`;

            if (!this._teamListClickBound) {
                this._teamListClickBound = true;
                list.addEventListener('click', (ev) => this._handleTeamListClick(ev));
            }
        } catch (err) {
            list.innerHTML = `<div style="padding:1.5rem;color:var(--error);text-align:center;">Could not load personnel: ${this._escapeHtml(err.message || 'error')}</div>`;
        }
    }

    async _handleTeamListClick(ev) {
        const btn = ev.target.closest('[data-team-action]');
        if (!btn) return;

        if (btn.dataset.teamAction === 'edit-register') {
            const registerId = Number(btn.dataset.registerId);
            if (Number.isInteger(registerId) && registerId > 0) {
                this.openPersonnelProfile('register', registerId);
            }
            return;
        }

        const id = Number(btn.dataset.teamId);
        if (!Number.isInteger(id) || id <= 0) return;

        if (btn.dataset.teamAction === 'edit') {
            this.openPersonnelProfile('admin', id);
            return;
        }
        if (btn.dataset.teamAction === 'promote') {
            const role = btn.dataset.teamRole;
            if (role) await this.updateTeamMemberRole(id, role, { promoted: true });
            return;
        }
        if (btn.dataset.teamAction === 'delete') {
            await this.deleteTeamMember(id, btn.dataset.teamEmail || '');
        }
    }

    async updateTeamMemberRole(id, role, { promoted = false } = {}) {
        try {
            await this.apiRequest(`/admin/team/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ role }),
            });
            this.showToast(promoted ? 'Role promoted' : 'Role updated', 'success');
            await this.loadAdminTeam();
            this.openPersonnelProfile('admin', id);
        } catch (err) {
            this.showToast(err.message || 'Update failed', 'error');
        }
    }

    _normalizeRegisterPin(value) {
        return String(value || '').replace(/\D/g, '').slice(0, 4);
    }

    _isValidRegisterPin(pin) {
        return /^\d{4}$/.test(this._normalizeRegisterPin(pin));
    }

    _registerPermissionsHtml(reg) {
        const canAuthorize = Boolean(reg?.canAuthorize);
        const canProcessRefunds = Boolean(reg?.canProcessRefunds);
        const canOpenDrawer = Boolean(reg?.canOpenDrawer);
        const allowManualDiscounts = Boolean(reg?.allowManualDiscounts);
        const canViewCost = Boolean(reg?.canViewCost);
        const restrictedBlocks = this.isFullAdmin
            ? `
                <label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;margin-bottom:0.65rem;">
                    <input type="checkbox" name="canProcessRefunds" value="true"${canProcessRefunds ? ' checked' : ''} style="margin-top:0.2rem;">
                    <span>Can process refunds <span style="color:var(--gray-600);font-weight:400;">(Admin/Developer only — register PIN required)</span></span>
                </label>
                <label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;margin-bottom:0.65rem;">
                    <input type="checkbox" name="canOpenDrawer" value="true"${canOpenDrawer ? ' checked' : ''} style="margin-top:0.2rem;">
                    <span>Can open cash drawer manually <span style="color:var(--gray-600);font-weight:400;">(Admin/Developer only — Shift screen button)</span></span>
                </label>
                <label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;">
                    <input type="checkbox" name="canViewCost" value="true"${canViewCost ? ' checked' : ''} style="margin-top:0.2rem;">
                    <span>Can view product cost at register <span style="color:var(--gray-600);font-weight:400;">(Admin/Developer only — requires store cost display enabled)</span></span>
                </label>`
            : '';
        return `
            <div style="margin:0.75rem 0 0;padding-top:1rem;border-top:1px solid var(--gray-200);">
                <h5 style="margin:0 0 0.75rem;font-size:0.95rem;color:var(--gray-700);">Register permissions</h5>
                <label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;margin-bottom:0.65rem;">
                    <input type="checkbox" name="allowManualDiscounts" value="true"${allowManualDiscounts ? ' checked' : ''} style="margin-top:0.2rem;">
                    <span>Can apply manual line and sale discounts <span style="color:var(--gray-600);font-weight:400;">(off by default — automatic promotions still apply)</span></span>
                </label>
                <label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;margin-bottom:0.65rem;">
                    <input type="checkbox" name="canAuthorize" value="true"${canAuthorize ? ' checked' : ''} style="margin-top:0.2rem;">
                    <span>Can approve line and sale discounts <span style="color:var(--gray-600);font-weight:400;">(manager PIN)</span></span>
                </label>
                ${restrictedBlocks}
            </div>`;
    }

    _registerFieldsHtml(reg, { pinRequired = false, pinFirst = false } = {}) {
        const pinBlock = `
            <div class="form-group personnel-pin-field">
                <label for="profile-register-pin">Register PIN <span style="font-weight:400;color:var(--gray-600);">(4 digits)</span></label>
                <input class="form-input" id="profile-register-pin" name="pin" type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="${pinRequired ? 'Enter 4-digit PIN' : 'Enter new PIN to change'}" style="max-width:8rem;font-size:1.35rem;letter-spacing:0.35em;text-align:center;font-weight:600;">
                <small class="form-help">${pinRequired ? 'Required for register sign-in.' : 'Leave blank to keep the current PIN.'}</small>
            </div>`;
        const idBlock = `
            <div class="form-group">
                <label for="profile-register-code">Register employee ID</label>
                <input class="form-input" id="profile-register-code" name="employeeCode" maxlength="8" value="${this._escapeHtml(reg?.employeeCode || '')}" placeholder="e.g. 1042">
                <small class="form-help">Shown on shift reports (2-8 characters).</small>
            </div>`;
        const rest = `
            <div class="form-group">
                <label for="profile-register-hourly">Hourly rate (optional)</label>
                <input class="form-input" id="profile-register-hourly" name="hourlyRate" type="number" min="0" step="0.01" placeholder="0.00" value="${reg?.hourlyRate != null ? this._escapeHtml(String(reg.hourlyRate)) : ''}">
            </div>
            <div class="form-group">
                <label><input type="checkbox" name="registerActive" ${!reg || reg.isActive ? 'checked' : ''}> Active on register</label>
            </div>
            ${this._registerPermissionsHtml(reg)}`;
        return pinFirst ? pinBlock + idBlock + rest : idBlock + pinBlock + rest;
    }

    _closePersonnelProfileModal() {
        const existing = document.getElementById('personnel-profile-modal');
        if (existing) existing.remove();
    }

    openPersonnelProfile(kind, id) {
        this._closePersonnelProfileModal();

        let title = '';
        let subtitle = '';
        let statusBadge = '';
        let formBody = '';
        let profileKind = kind;
        let profileId = id;

        if (kind === 'register') {
            const reg = (this._registerOnlyCache || []).find((r) => Number(r.id) === Number(id));
            if (!reg) return;
            title = `${reg.firstName} ${reg.lastName}`;
            subtitle = 'Register employee';
            statusBadge = reg.isActive
                ? '<span class="badge badge-success">Active</span>'
                : '<span class="badge" style="background:#f3f4f6;color:#6b7280;">Inactive</span>';
            formBody = `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                    <div class="form-group">
                        <label for="team-profile-first">First name</label>
                        <input class="form-input" id="team-profile-first" name="firstName" required maxlength="100" value="${this._escapeHtml(reg.firstName)}">
                    </div>
                    <div class="form-group">
                        <label for="team-profile-last">Last name</label>
                        <input class="form-input" id="team-profile-last" name="lastName" required maxlength="100" value="${this._escapeHtml(reg.lastName)}">
                    </div>
                </div>
                <div class="form-group">
                    <label for="team-profile-email">Email (optional)</label>
                    <input class="form-input" id="team-profile-email" name="email" type="email" maxlength="255" value="${this._escapeHtml(reg.email || '')}">
                </div>
                ${this._registerFieldsHtml(reg, { pinFirst: true })}`;
        } else {
            const user = (this._teamUsersCache || []).find((u) => Number(u.id) === Number(id));
            if (!user) return;
            const roles = this._teamRoleOptions || [];
            const isDeveloperActor = this.currentUser?.role === 'developer';
            const isDeveloperTarget = user.role === 'developer';
            const roleSelectDisabled = isDeveloperTarget && !isDeveloperActor;
            const roleOptions = roles
                .map((r) => {
                    const sel = r.id === user.role ? ' selected' : '';
                    return `<option value="${this._escapeHtml(r.id)}"${sel}>${this._escapeHtml(r.label || r.id)}</option>`;
                })
                .join('');
            const reg = user.register || null;
            const storeHoursDelegationBlock =
                user.role === 'manager' && this.canManageStoreHoursDelegation
                    ? `
                <div style="margin:0.5rem 0 0.25rem;padding-top:1rem;border-top:1px solid var(--gray-200);">
                    <h5 style="margin:0 0 0.75rem;font-size:0.95rem;color:var(--gray-700);">Store hours</h5>
                    <div class="form-group" style="margin-bottom:0;">
                        <label>
                            <input type="checkbox" name="canManageStoreHours" ${user.canManageStoreHours ? 'checked' : ''}>
                            Allow this manager to edit store hours and holidays
                        </label>
                        <small class="form-help" style="display:block;margin-top:0.35rem;">
                            When enabled, they can update footer hours and sync to Google Business Profile.
                        </small>
                    </div>
                </div>`
                    : '';
            title = `${user.firstName} ${user.lastName}`;
            subtitle = user.email;
            statusBadge = user.isActive
                ? '<span class="badge badge-success">Active</span>'
                : '<span class="badge" style="background:#f3f4f6;color:#6b7280;">Inactive</span>';
            formBody = `
                ${this._registerFieldsHtml(reg, { pinRequired: !reg, pinFirst: true })}
                <div style="margin:0.5rem 0 0.25rem;padding-top:1rem;border-top:1px solid var(--gray-200);">
                    <h5 style="margin:0 0 0.75rem;font-size:0.95rem;color:var(--gray-700);">Admin login</h5>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                    <div class="form-group">
                        <label for="team-profile-first">First name</label>
                        <input class="form-input" id="team-profile-first" name="firstName" required maxlength="100" value="${this._escapeHtml(user.firstName)}">
                    </div>
                    <div class="form-group">
                        <label for="team-profile-last">Last name</label>
                        <input class="form-input" id="team-profile-last" name="lastName" required maxlength="100" value="${this._escapeHtml(user.lastName)}">
                    </div>
                </div>
                <div class="form-group">
                    <label for="team-profile-role">Role</label>
                    <select class="form-input" id="team-profile-role" name="role"${roleSelectDisabled ? ' disabled' : ''}>${roleOptions}</select>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" name="isActive" ${user.isActive ? 'checked' : ''}> Active admin account</label>
                </div>
                <div class="form-group">
                    <label for="team-profile-password">New password (optional)</label>
                    <input class="form-input" id="team-profile-password" name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Leave blank to keep current">
                </div>
                ${storeHoursDelegationBlock}`;
        }

        const overlay = document.createElement('div');
        overlay.id = 'personnel-profile-modal';
        overlay.className = 'admin-branded-dialog-overlay';
        overlay.style.cssText =
            'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:11000;display:flex;align-items:flex-start;justify-content:center;padding:1.5rem;overflow-y:auto;';

        const box = document.createElement('div');
        box.style.cssText =
            'background:#fff;border-radius:12px;max-width:480px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.15);padding:1.5rem;margin:auto;';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');

        box.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;margin-bottom:1rem;">
                <div>
                    <h2 style="margin:0 0 0.2rem;font-size:1.25rem;color:var(--primary-green);">${this._escapeHtml(title)}</h2>
                    <p style="margin:0;color:var(--gray-600);font-size:0.9rem;">${this._escapeHtml(subtitle)}</p>
                </div>
                ${statusBadge}
            </div>
            <form id="admin-team-profile-form" class="pos-employee-profile-form" style="max-width:none;">
                ${formBody}
                <p id="admin-team-profile-msg" style="min-height:1.25rem;font-size:0.9rem;margin:0;"></p>
                <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:0.5rem;">
                    <button type="button" class="btn btn-secondary" id="personnel-profile-cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary"><i class="fas fa-save" aria-hidden="true"></i> Save</button>
                </div>
            </form>`;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const form = box.querySelector('#admin-team-profile-form');
        const cancelBtn = box.querySelector('#personnel-profile-cancel');
        const pinInput = box.querySelector('#profile-register-pin');

        if (pinInput) {
            pinInput.focus();
            pinInput.addEventListener('input', () => {
                const next = this._normalizeRegisterPin(pinInput.value);
                if (pinInput.value !== next) pinInput.value = next;
            });
        }

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this._closePersonnelProfileModal();
                document.removeEventListener('keydown', onKey);
            }
        };
        document.addEventListener('keydown', onKey);

        cancelBtn?.addEventListener('click', () => {
            this._closePersonnelProfileModal();
            document.removeEventListener('keydown', onKey);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this._closePersonnelProfileModal();
                document.removeEventListener('keydown', onKey);
            }
        });

        if (form) {
            form.addEventListener('submit', async (e) => {
                const ok = await this.savePersonnelProfile(e, profileKind, profileId);
                if (ok) {
                    this._closePersonnelProfileModal();
                    document.removeEventListener('keydown', onKey);
                }
            });
        }
    }

    async savePersonnelProfile(ev, kind, id) {
        ev.preventDefault();
        const form = ev.target;
        const msg = document.getElementById('admin-team-profile-msg');
        if (msg) {
            msg.textContent = '';
            msg.style.color = '';
        }

        const fd = new FormData(form);
        const firstName = String(fd.get('firstName') || '').trim();
        const lastName = String(fd.get('lastName') || '').trim();
        const email = String(fd.get('email') || '').trim() || null;
        const pin = this._normalizeRegisterPin(fd.get('pin'));
        const employeeCode = String(fd.get('employeeCode') || '').trim();
        const hourlyRaw = String(fd.get('hourlyRate') || '').trim();
        const registerActive = !!form.querySelector('[name="registerActive"]')?.checked;
        const canAuthorize = !!form.querySelector('[name="canAuthorize"]')?.checked;
        const allowManualDiscounts = !!form.querySelector('[name="allowManualDiscounts"]')?.checked;
        const canProcessRefunds = this.isFullAdmin
            ? !!form.querySelector('[name="canProcessRefunds"]')?.checked
            : undefined;
        const canOpenDrawer = this.isFullAdmin
            ? !!form.querySelector('[name="canOpenDrawer"]')?.checked
            : undefined;
        const canViewCost = this.isFullAdmin
            ? !!form.querySelector('[name="canViewCost"]')?.checked
            : undefined;

        if (pin && !this._isValidRegisterPin(pin)) {
            if (msg) {
                msg.textContent = 'Register PIN must be exactly 4 digits.';
                msg.style.color = 'var(--error)';
            }
            return false;
        }

        if (employeeCode && employeeCode.length < 2) {
            if (msg) {
                msg.textContent = 'Register employee ID must be 2-8 characters.';
                msg.style.color = 'var(--error)';
            }
            return false;
        }

        try {
            if (kind === 'register') {
                const payload = {
                    employeeCode,
                    firstName,
                    lastName,
                    email,
                    isActive: registerActive,
                    hourlyRate: hourlyRaw === '' ? null : Number(hourlyRaw),
                    canAuthorize,
                    allowManualDiscounts,
                    ...(canProcessRefunds !== undefined ? { canProcessRefunds } : {}),
                    ...(canOpenDrawer !== undefined ? { canOpenDrawer } : {}),
                    ...(canViewCost !== undefined ? { canViewCost } : {}),
                };
                if (pin) payload.pin = pin;
                await this.apiRequest(`/admin/personnel/employees/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload),
                });
            } else {
                const user = (this._teamUsersCache || []).find((u) => Number(u.id) === Number(id));
                const existingReg = user?.register || null;

                if (!existingReg && (pin || employeeCode)) {
                    if (!employeeCode) {
                        if (msg) {
                            msg.textContent = 'Enter a register employee ID (2-8 characters) when setting up register access.';
                            msg.style.color = 'var(--error)';
                        }
                        return false;
                    }
                    if (!pin) {
                        if (msg) {
                            msg.textContent = 'Enter a 4-digit register PIN when setting up register access.';
                            msg.style.color = 'var(--error)';
                        }
                        return false;
                    }
                }

                const payload = {
                    firstName,
                    lastName,
                    isActive: !!form.querySelector('[name="isActive"]')?.checked,
                };
                const roleSel = form.querySelector('[name="role"]');
                const nextRole = roleSel && !roleSel.disabled ? roleSel.value : user?.role;
                if (roleSel && !roleSel.disabled) payload.role = roleSel.value;
                const hoursDelegationChk = form.querySelector('[name="canManageStoreHours"]');
                if (hoursDelegationChk && nextRole === 'manager') {
                    payload.canManageStoreHours = hoursDelegationChk.checked;
                }
                const password = String(fd.get('password') || '');
                if (password) payload.password = password;

                await this.apiRequest(`/admin/team/${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload),
                });

                if (employeeCode || existingReg || pin) {
                    await this.apiRequest(`/admin/team/${id}/register`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            registerEnabled: !!(existingReg || (employeeCode && pin)),
                            employeeCode,
                            pin: pin || undefined,
                            firstName,
                            lastName,
                            email: user?.email || null,
                            isActive: registerActive,
                            hourlyRate: hourlyRaw === '' ? null : Number(hourlyRaw),
                            canAuthorize,
                            allowManualDiscounts,
                            ...(canProcessRefunds !== undefined ? { canProcessRefunds } : {}),
                            ...(canOpenDrawer !== undefined ? { canOpenDrawer } : {}),
                            ...(canViewCost !== undefined ? { canViewCost } : {}),
                        }),
                    });
                }
            }

            this.showToast('Profile saved', 'success');
            await this.loadAdminTeam();
            return true;
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed';
                msg.style.color = 'var(--error)';
            } else {
                this.showToast(err.message || 'Save failed', 'error');
            }
            return false;
        }
    }

    async handleCreateRegisterOnlyEmployee(ev) {
        if (ev) ev.preventDefault();
        const form = document.getElementById('register-only-create-form');
        if (!form) return;
        const fd = new FormData(form);
        const pin = this._normalizeRegisterPin(fd.get('pin'));
        if (!this._isValidRegisterPin(pin)) {
            this.showToast('Register PIN must be exactly 4 digits', 'warning');
            return;
        }
        try {
            await this.apiRequest('/admin/personnel/employees', {
                method: 'POST',
                body: JSON.stringify({
                    employeeCode: fd.get('employeeCode'),
                    firstName: fd.get('firstName'),
                    lastName: fd.get('lastName'),
                    email: fd.get('email'),
                    pin,
                    canAuthorize: fd.get('canAuthorize') === 'on' || fd.get('canAuthorize') === 'true',
                    allowManualDiscounts:
                        fd.get('allowManualDiscounts') === 'on' || fd.get('allowManualDiscounts') === 'true',
                    ...(this.isFullAdmin
                        ? {
                              canProcessRefunds:
                                  fd.get('canProcessRefunds') === 'on' || fd.get('canProcessRefunds') === 'true',
                              canOpenDrawer:
                                  fd.get('canOpenDrawer') === 'on' || fd.get('canOpenDrawer') === 'true',
                              canViewCost:
                                  fd.get('canViewCost') === 'on' || fd.get('canViewCost') === 'true'
                          }
                        : {}),
                }),
            });
            this.showToast('Register employee added', 'success');
            form.reset();
            await this.loadAdminTeam();
        } catch (err) {
            this.showToast(err.message || 'Create failed', 'error');
        }
    }

    openAdminTeamProfile(id) {
        this.openPersonnelProfile('admin', id);
    }

    async saveAdminTeamProfile(ev, id) {
        return this.savePersonnelProfile(ev, 'admin', id);
    }

    async deleteTeamMember(id, email) {
        const ok = await this.showAdminConfirm({
            title: 'Remove team member?',
            message: `This permanently removes the login for ${email || 'this user'}. They will no longer access the admin panel.`,
            confirmLabel: 'Remove',
            cancelLabel: 'Cancel',
            danger: true,
        });
        if (!ok) return;
        try {
            await this.apiRequest(`/admin/team/${id}`, { method: 'DELETE' });
            this.showToast('Team member removed', 'success');
            await this.loadAdminTeam();
        } catch (err) {
            this.showToast(err.message || 'Delete failed', 'error');
        }
    }

    async handleCreateTeamMember(ev) {
        if (ev) ev.preventDefault();
        const form = document.getElementById('admin-team-create-form');
        const msg = document.getElementById('admin-team-form-msg');
        if (!form || !this.isFullAdmin) return;
        const email = form.querySelector('#team-create-email')?.value?.trim();
        const firstName = form.querySelector('#team-create-first')?.value?.trim();
        const lastName = form.querySelector('#team-create-last')?.value?.trim();
        const role = form.querySelector('#team-create-role')?.value;
        const password = form.querySelector('#team-create-password')?.value;
        if (msg) msg.textContent = '';
        try {
            await this.apiRequest('/admin/team', {
                method: 'POST',
                body: JSON.stringify({ email, firstName, lastName, role, password }),
            });
            if (msg) {
                msg.textContent = 'Account created. Send them the email and password securely.';
                msg.style.color = 'var(--success)';
            }
            form.reset();
            const assistantOpt = form.querySelector('#team-create-role option[value="assistant_manager"]');
            if (assistantOpt) assistantOpt.selected = true;
            await this.loadAdminTeam();
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Create failed';
                msg.style.color = 'var(--error)';
            }
        }
    }

    _escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _promoRulesFromEditor() {
        const scope = document.getElementById('promo-form-scope')?.value || 'all';
        const strat = document.getElementById('promo-form-product-promo-strategy')?.value || 'trigger_reward';
        const parseIds = (s) =>
            String(s || '')
                .split(/[\s,]+/)
                .map((x) => Number(String(x).trim()))
                .filter((n) => Number.isFinite(n) && n > 0);

        const effects = [];
        const classicMerchAllowed = !(scope === 'products' && strat === 'trigger_reward');

        if (classicMerchAllowed) {
            const pct = Number(document.getElementById('promo-form-pct')?.value);
            if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
                effects.push({ type: 'percent_off', percent: pct });
            }
            const fixed = Number(document.getElementById('promo-form-fixed')?.value);
            if (Number.isFinite(fixed) && fixed > 0) {
                effects.push({ type: 'fixed_off', amount: fixed });
            }
            const buyQty = Number(document.getElementById('promo-form-buy-qty')?.value);
            const getQty = Number(document.getElementById('promo-form-get-qty')?.value);
            if (Number.isFinite(buyQty) && Number.isFinite(getQty) && buyQty >= 1 && getQty >= 1) {
                const buySkus = this._promoProdPickerIds('buy');
                const getSkus = this._promoProdPickerIds('get');
                const eff = { type: 'buy_get', buyQty, getQty };
                if (buySkus.length > 0 && getSkus.length > 0) {
                    eff.buyProductIds = buySkus;
                    eff.getProductIds = getSkus;
                }
                const rw = (document.getElementById('promo-form-bogo-reward-type')?.value || 'free').toLowerCase();
                const getPct = Number(document.getElementById('promo-form-bogo-get-pct')?.value);
                const getFixed = Number(document.getElementById('promo-form-bogo-get-fixed')?.value);
                if (rw === 'percent_off') {
                    eff.getRewardType = 'percent_off';
                    if (Number.isFinite(getPct) && getPct > 0) eff.getPercent = Math.min(100, getPct);
                } else if (rw === 'fixed_off') {
                    eff.getRewardType = 'fixed_off';
                    if (Number.isFinite(getFixed) && getFixed > 0) eff.getFixedAmount = getFixed;
                } else {
                    eff.getRewardType = 'free';
                }
                effects.push(eff);
            }
        }
        if (document.getElementById('promo-form-free-shipping')?.checked) {
            effects.push({ type: 'free_standard_shipping' });
        }

        this._promoPickerSyncProdHiddenField();
        this._promoPickerSyncCategoryHiddenField();
        let triggerReward = null;
        let productIdsMerged =
            scope === 'products'
                ? (() => {
                      const scopeIds = this._promoProdPickerIds('scope');
                      const buyIds = this._promoProdPickerIds('buy');
                      const getIds = this._promoProdPickerIds('get');
                      return [...new Set([...scopeIds, ...buyIds, ...getIds])].sort((a, b) => a - b);
                  })()
                : [];

        if (scope === 'products' && strat === 'trigger_reward') {
            const trigIds = this._promoProdPickerIds('trigger');
            const minTriggerQty = Math.floor(Number(document.getElementById('promo-form-trigger-min-qty')?.value));
            const rewardRules = [];
            document.querySelectorAll('[data-reward-rule-id]').forEach((row) => {
                const rid = row.getAttribute('data-reward-rule-id');
                if (!rid) return;
                const kind = `reward-${rid}`;
                const targetProductIds = this._promoProdPickerIds(kind);
                const discSel = document.getElementById(`promo-reward-disc-${rid}`);
                const valInp = document.getElementById(`promo-reward-val-${rid}`);
                const dt = String(discSel?.value || 'percent_off').toLowerCase();
                const valRaw = valInp?.value;
                const val = Number(valRaw);
                if (!targetProductIds.length) return;
                const entry = { targetProductIds: [...targetProductIds].sort((a, b) => a - b), discountType: dt };
                if (dt === 'percent_off') {
                    if (!Number.isFinite(val) || val <= 0 || val > 100) return;
                    entry.percent = val;
                    rewardRules.push(entry);
                } else if (dt === 'fixed_off') {
                    if (!Number.isFinite(val) || val <= 0) return;
                    entry.amount = val;
                    rewardRules.push(entry);
                } else if (dt === 'set_price') {
                    if (!Number.isFinite(val) || val < 0) return;
                    entry.setPrice = val;
                    rewardRules.push(entry);
                }
            });
            const idPool = new Set(trigIds);
            rewardRules.forEach((rr) => rr.targetProductIds.forEach((id) => idPool.add(id)));
            productIdsMerged = [...idPool].sort((a, b) => a - b);
            if (trigIds.length > 0 && Number.isFinite(minTriggerQty) && minTriggerQty >= 1 && rewardRules.length > 0) {
                triggerReward = {
                    triggerProductIds: [...trigIds].sort((a, b) => a - b),
                    minTriggerQty,
                    rewardRules
                };
            }
        }

        return {
            scope,
            productIds: productIdsMerged,
            categoryIds:
                scope === 'categories' ? parseIds(document.getElementById('promo-form-category-ids')?.value) : [],
            effects,
            triggerReward: triggerReward || null
        };
    }

    _togglePromoScopeHints() {
        const scope = document.getElementById('promo-form-scope')?.value || 'all';
        const pq = document.getElementById('promo-scope-products');
        const cq = document.getElementById('promo-scope-categories');
        if (pq) pq.style.display = scope === 'products' ? 'block' : 'none';
        if (cq) cq.style.display = scope === 'categories' ? 'block' : 'none';
        if (scope === 'categories') {
            void this._promoHydrateCategoryDropdown();
        }
        this._togglePromoProductStrategyUi();
        this._togglePromoBogoPickersVisibility();
    }

    _promoAllProdSearchKinds() {
        const rewardKeys = Object.keys(this._promoPickerProducts || {}).filter((k) =>
            String(k).startsWith('reward-')
        );
        return [...new Set(['scope', 'buy', 'get', 'trigger', ...rewardKeys])];
    }

    _togglePromoProductStrategyUi() {
        const scope = document.getElementById('promo-form-scope')?.value || '';
        const stratSel = document.getElementById('promo-form-product-promo-strategy');
        const trPanel = document.getElementById('promo-panel-trigger-reward');
        const clsPanel = document.getElementById('promo-panel-classic-products');
        const classicMerch = document.getElementById('promo-block-classic-merch-effects');
        if (!stratSel || !trPanel || !clsPanel || !classicMerch) return;
        const strat = stratSel.value || 'trigger_reward';
        const isProd = scope === 'products';
        const grp = stratSel.closest('.form-group');
        if (grp) grp.style.display = isProd ? 'block' : 'none';
        if (!isProd) {
            trPanel.style.display = 'none';
            clsPanel.style.display = 'none';
            classicMerch.style.display = '';
            return;
        }
        if (strat === 'trigger_reward') {
            trPanel.style.display = 'block';
            clsPanel.style.display = 'none';
            classicMerch.style.display = 'none';
            const list = document.getElementById('promo-reward-rules-list');
            if (list && !list.querySelector('[data-reward-rule-id]')) {
                this.initPromoProductPickers();
                this._promoAddRewardRuleRow();
            }
        } else {
            trPanel.style.display = 'none';
            clsPanel.style.display = 'block';
            classicMerch.style.display = '';
        }
        this._togglePromoBogoPickersVisibility();
    }

    _promoClearRewardRuleUi() {
        const list = document.getElementById('promo-reward-rules-list');
        if (list) list.innerHTML = '';
        for (const k of Object.keys(this._promoPickerProducts || {})) {
            if (k.startsWith('reward-')) delete this._promoPickerProducts[k];
        }
        this._promoRewardRuleSeq = 0;
    }

    _toggleRewardRuleDiscountFields(ruleId) {
        const ds = document.getElementById(`promo-reward-disc-${ruleId}`);
        const lbl = document.getElementById(`promo-reward-val-lbl-${ruleId}`);
        const inp = document.getElementById(`promo-reward-val-${ruleId}`);
        if (!ds || !lbl || !inp) return;
        const t = ds.value;
        if (t === 'percent_off') {
            lbl.textContent = 'Percent (%)';
            inp.placeholder = 'e.g. 25';
        } else if (t === 'fixed_off') {
            lbl.textContent = 'Flat $ off order line';
            inp.placeholder = 'e.g. 5';
        } else {
            lbl.textContent = 'Set price per unit ($)';
            inp.placeholder = '0 = free';
        }
    }

    _promoRemoveRewardRuleRow(id) {
        const kind = `reward-${id}`;
        delete this._promoPickerProducts[kind];
        document.querySelector(`[data-reward-rule-id="${id}"]`)?.remove();
        this._promoPickerSyncProdHiddenField();
    }

    _promoAddRewardRuleRow(prefillRow) {
        this.initPromoProductPickers();
        const list = document.getElementById('promo-reward-rules-list');
        if (!list) return;
        const id = ++this._promoRewardRuleSeq;
        const kind = `reward-${id}`;
        this._promoPickerProducts[kind] = new Map();
        const wrap = document.createElement('div');
        wrap.className = 'promo-reward-rule-row';
        wrap.setAttribute('data-reward-rule-id', String(id));
        wrap.style.cssText =
            'padding:0.75rem;border:1px solid var(--gray-200);border-radius:var(--border-radius);background:#fff';
        wrap.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;flex-wrap:wrap;">
                <strong>Reward SKU group #${id}</strong>
                <button type="button" class="btn btn-secondary btn-sm" data-remove-reward-rule="${id}">Remove group</button>
            </div>
            <label for="promo-reward-q-${id}">Target SKUs</label>
            <div id="promo-reward-chips-${id}" class="promo-prod-chips" aria-live="polite"></div>
            <div class="promo-prod-search-wrap">
                <input type="text" class="form-input" id="promo-reward-q-${id}" autocomplete="off" placeholder="Products that receive this discount..." data-reward-rule-search="${id}">
                <div id="promo-reward-res-${id}" class="promo-prod-results-local promo-product-link-results-panel" role="listbox" hidden></div>
            </div>
            <div class="form-row" style="margin-top:0.65rem;">
                <div class="form-group">
                    <label for="promo-reward-disc-${id}">Discount type</label>
                    <select class="form-input" id="promo-reward-disc-${id}" data-reward-disc-type="${id}">
                        <option value="percent_off">Percent off</option>
                        <option value="fixed_off">Flat $ off order line</option>
                        <option value="set_price">Set price (per unit)</option>
                    </select>
                </div>
                <div class="form-group" style="flex:1;">
                    <label for="promo-reward-val-${id}" id="promo-reward-val-lbl-${id}">Value</label>
                    <input class="form-input" id="promo-reward-val-${id}" type="number" step="any" data-reward-val="${id}">
                </div>
            </div>
            <small class="form-help">Each group is evaluated on its own. Set price lowers every matching unit toward the amount you enter (use 0 with "Set price" for a free accessory).</small>
        `;
        list.appendChild(wrap);
        const rm = wrap.querySelector(`[data-remove-reward-rule="${id}"]`);
        rm?.addEventListener('click', () => this._promoRemoveRewardRuleRow(id));
        const qs = wrap.querySelector(`[data-reward-rule-search]`);

        qs?.addEventListener('input', () => this._promoScheduleProdSearch(kind));

        qs?.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') this._promoHideProdResults(kind);

        });

        wrap
            .querySelector(`[data-reward-disc-type]`)
            ?.addEventListener('change', () => this._toggleRewardRuleDiscountFields(id));
        const pr = typeof prefillRow === 'object' && prefillRow ? prefillRow : null;

        const dsEl = wrap.querySelector(`[data-reward-disc-type]`);
        if (pr) {
            const dt = String(pr.discountType || 'percent_off').toLowerCase();
            if (dt === 'set_price') dsEl.value = 'set_price';

            else if (dt === 'fixed_off') dsEl.value = 'fixed_off';

            else dsEl.value = 'percent_off';

            const vInp = document.getElementById(`promo-reward-val-${id}`);
            if (vInp) {
                if (pr.percent != null) vInp.value = String(pr.percent);
                else if (pr.amount != null) vInp.value = String(pr.amount);

                else if (pr.setPrice != null) vInp.value = String(pr.setPrice);
            }
            for (const pid of pr.targetProductIds || []) {

                const n = Number(pid);
                if (!Number.isFinite(n) || n <= 0) continue;
                this._promoPickerProducts[kind].set(n, `Product #${n}`);
            }
            this._promoRenderProdChips(kind);

        }

        this._toggleRewardRuleDiscountFields(id);

        this._promoPickerSyncProdHiddenField();
    }

    _promoProdPickerIds(kind) {
        const pmap = this._promoPickerProducts[kind];
        return pmap ? [...pmap.keys()].map((n) => Number(n)).filter((n) => n > 0) : [];
    }

    _promoProdPickerElements(kind) {
        if (kind === 'trigger') {
            return {
                chips: document.getElementById('promo-trigger-chips'),
                q: document.getElementById('promo-trigger-prod-q'),
                res: document.getElementById('promo-trigger-results')
            };
        }
        const rew = typeof kind === 'string' ? kind.match(/^reward-(\d+)$/) : null;
        if (rew) {
            const rid = rew[1];
            return {
                chips: document.getElementById(`promo-reward-chips-${rid}`),
                q: document.getElementById(`promo-reward-q-${rid}`),
                res: document.getElementById(`promo-reward-res-${rid}`)
            };
        }
        const elMap = {
            scope: { chips: 'promo-scope-prod-chips', q: 'promo-scope-prod-q', res: 'promo-scope-prod-results' },
            buy: { chips: 'promo-bogo-buy-chips', q: 'promo-bogo-buy-q', res: 'promo-bogo-buy-results' },
            get: { chips: 'promo-bogo-get-chips', q: 'promo-bogo-get-q', res: 'promo-bogo-get-results' }
        };
        const c = elMap[kind];
        if (!c) return null;
        return {
            chips: document.getElementById(c.chips),
            q: document.getElementById(c.q),
            res: document.getElementById(c.res)
        };
    }

    _promoHideProdResults(kind) {
        const el = this._promoProdPickerElements(kind)?.res;
        if (el) {
            el.hidden = true;
            el.style.display = '';
        }
    }

    _promoRenderProdChips(kind) {
        const { chips } = this._promoProdPickerElements(kind) || {};
        const map = this._promoPickerProducts[kind];
        if (!chips || !map) return;
        chips.innerHTML = '';
        for (const id of [...map.keys()].sort((a, b) => Number(a) - Number(b))) {
            const label = map.get(id);
            const pill = document.createElement('span');
            pill.className = 'promo-prod-chip';
            const sp = document.createElement('span');
            sp.textContent = label || `Product #${id}`;
            pill.appendChild(sp);
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'promo-prod-chip-remove';
            rm.setAttribute('aria-label', `Remove product ${id}`);
            rm.innerHTML = '&times;';
            rm.addEventListener('click', () => {
                map.delete(id);
                this._promoRenderProdChips(kind);
                this._promoPickerSyncProdHiddenField();
            });
            pill.appendChild(rm);
            chips.appendChild(pill);
        }
    }

    _promoPickerSyncProdHiddenField() {
        const hid = document.getElementById('promo-form-product-ids');
        const scopeMode = document.getElementById('promo-form-scope')?.value;
        const strat = document.getElementById('promo-form-product-promo-strategy')?.value;
        let merged;
        if (scopeMode === 'products' && strat === 'trigger_reward') {
            const ids = new Set(this._promoProdPickerIds('trigger'));
            for (const node of document.querySelectorAll('[data-reward-rule-id]')) {
                const rid = node.getAttribute('data-reward-rule-id');
                if (!rid) continue;
                const kind = `reward-${rid}`;
                this._promoProdPickerIds(kind).forEach((pid) => ids.add(pid));
            }
            merged = [...ids].sort((a, b) => a - b);
        } else {
            const scopeIds = this._promoProdPickerIds('scope');
            const buyIds = this._promoProdPickerIds('buy');
            const getIds = this._promoProdPickerIds('get');
            merged = [...new Set([...scopeIds, ...buyIds, ...getIds])].sort((a, b) => a - b);
        }
        if (hid) hid.value = merged.join(', ');
    }

    _promoPickerSyncCategoryHiddenField() {
        const hid = document.getElementById('promo-form-category-ids');
        if (!hid) return;
        hid.value = [...this._promoPickerCategories.keys()]
            .map((n) => Number(n))
            .filter((n) => n > 0)
            .sort((a, b) => a - b)
            .join(', ');
    }

    _promoRenderCatChips() {
        const chips = document.getElementById('promo-scope-cat-chips');
        if (!chips) return;
        chips.innerHTML = '';
        for (const id of [...this._promoPickerCategories.keys()].sort((a, b) => Number(a) - Number(b))) {
            const label = this._promoPickerCategories.get(id);
            const pill = document.createElement('span');
            pill.className = 'promo-prod-chip';
            const sp = document.createElement('span');
            sp.textContent = label || `Category #${id}`;
            pill.appendChild(sp);
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'promo-prod-chip-remove';
            rm.setAttribute('aria-label', `Remove category ${id}`);
            rm.innerHTML = '&times;';
            rm.addEventListener('click', () => {
                this._promoPickerCategories.delete(id);
                this._promoRenderCatChips();
                this._promoPickerSyncCategoryHiddenField();
            });
            pill.appendChild(rm);
            chips.appendChild(pill);
        }
        this._promoUpdateCategoryDropdownState();
    }

    async _promoEnsureCategoriesCache() {
        if (Array.isArray(this._promoCategoriesCache)) return;
        try {
            const rows = await this.apiRequest('/admin/categories');
            this._promoCategoriesCache = Array.isArray(rows) ? rows : [];
        } catch {
            this._promoCategoriesCache = [];
        }
    }

    _promoUpdateCategoryDropdownState() {
        const sel = document.getElementById('promo-scope-category-add');
        if (!sel) return;
        for (let i = 0; i < sel.options.length; i++) {
            const opt = sel.options[i];
            const id = Number(opt.value);
            if (!Number.isFinite(id) || id <= 0) {
                opt.disabled = false;
                continue;
            }
            opt.disabled = this._promoPickerCategories.has(id);
        }
    }

    async _promoHydrateCategoryDropdown() {
        const sel = document.getElementById('promo-scope-category-add');
        if (!sel) return;
        sel.innerHTML = '';
        const loading = document.createElement('option');
        loading.value = '';
        loading.textContent = 'Loading categories...';
        sel.appendChild(loading);
        sel.disabled = true;
        await this._promoEnsureCategoriesCache();
        sel.disabled = false;
        sel.innerHTML = '';
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = 'Choose a category to add...';
        sel.appendChild(ph);
        const rows = [...(this._promoCategoriesCache || [])].sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || ''))
        );
        for (const c of rows) {
            const id = Number(c.id);
            if (!Number.isFinite(id) || id <= 0) continue;
            const opt = document.createElement('option');
            opt.value = String(id);
            opt.textContent = `${c.name} (id ${id})`;
            sel.appendChild(opt);
        }
        sel.value = '';
        this._promoUpdateCategoryDropdownState();
    }

    _togglePromoBogoPickersVisibility() {
        const wrap = document.getElementById('promo-bogo-product-pickers');
        if (!wrap) return;
        const scope = document.getElementById('promo-form-scope')?.value || '';
        const bq = Number(document.getElementById('promo-form-buy-qty')?.value);
        const gq = Number(document.getElementById('promo-form-get-qty')?.value);
        const ok =
            scope === 'products' &&
            Number.isFinite(bq) &&
            Number.isFinite(gq) &&
            bq >= 1 &&
            gq >= 1;
        wrap.style.display = ok ? 'block' : 'none';
        this._togglePromoBogoRewardFields();
    }

    /** Buy/get reward type + conditional % / $ inputs (requires both buy and get qty). */
    _togglePromoBogoRewardFields() {
        const wrap = document.getElementById('promo-bogo-reward-fields');
        const pctRow = document.getElementById('promo-bogo-reward-pct-row');
        const fixedRow = document.getElementById('promo-bogo-reward-fixed-row');
        const typeSel = document.getElementById('promo-form-bogo-reward-type');
        if (!wrap || !pctRow || !fixedRow) return;
        const bq = Number(document.getElementById('promo-form-buy-qty')?.value);
        const gq = Number(document.getElementById('promo-form-get-qty')?.value);
        const show = Number.isFinite(bq) && Number.isFinite(gq) && bq >= 1 && gq >= 1;
        wrap.style.display = show ? 'block' : 'none';
        if (!show) {
            pctRow.style.display = 'none';
            fixedRow.style.display = 'none';
            return;
        }
        const t = (typeSel?.value || 'free').toLowerCase();
        pctRow.style.display = t === 'percent_off' ? '' : 'none';
        fixedRow.style.display = t === 'fixed_off' ? '' : 'none';
    }

    _promoPickProduct(kind, row) {
        const id = Number(row?.id);
        if (!Number.isFinite(id) || id <= 0) return;
        const sku = String(row.sku || '').trim();
        const label = sku ? `${row.name} (${sku})` : String(row.name || `Product #${id}`);
        if (!this._promoPickerProducts[kind]) this._promoPickerProducts[kind] = new Map();
        this._promoPickerProducts[kind].set(id, label);
        this._promoRenderProdChips(kind);
        this._promoPickerSyncProdHiddenField();
        const el = this._promoProdPickerElements(kind);
        if (el?.q) el.q.value = '';
        this._promoHideProdResults(kind);
    }

    _promoScheduleProdSearch(kind) {
        const el = this._promoProdPickerElements(kind);
        if (!el?.q) return;
        clearTimeout(this._promoProdSearchTimers[kind]);
        this._promoProdSearchTimers[kind] = window.setTimeout(() => {
            this._promoRunProdSearch(kind, el.q.value.trim());
        }, 280);
    }

    async _promoRunProdSearch(kind, q) {
        const el = this._promoProdPickerElements(kind);
        if (!el?.res) return;
        const results = el.res;
        if (q.length < 1) {
            this._promoHideProdResults(kind);
            return;
        }
        if (!this.authToken) return;
        results.hidden = false;
        results.style.display = 'block';
        results.classList.add('prompt');
        results.textContent = 'Searching...';
        try {
            const data = await this.apiRequest(
                `/admin/products?search=${encodeURIComponent(q)}&limit=15&page=1`
            );
            const rows = data && Array.isArray(data.products) ? data.products : [];
            results.textContent = '';
            results.innerHTML = '';
            results.classList.remove('prompt');
            if (!rows.length) {
                results.classList.add('prompt');
                results.textContent = 'No matches. Try another name or SKU.';
            } else {
                rows.forEach((p) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'promo-product-link-option';
                    btn.addEventListener('mousedown', (e) => e.preventDefault());
                    const sku = String(p.sku || '').trim();
                    btn.textContent = sku ? `${p.name} (${sku})` : String(p.name || 'Product');
                    btn.addEventListener('click', () => this._promoPickProduct(kind, p));
                    results.appendChild(btn);
                });
            }
        } catch {
            results.classList.add('prompt');
            results.textContent = 'Search failed.';
        }
    }

    async _promoEnrichProductLabels(ids) {
        const uniq = [...new Set((ids || []).map((n) => Number(n)).filter((n) => n > 0))].slice(0, 96);
        for (const id of uniq) {
            try {
                const p = await this.apiRequest(`/admin/products/${id}`);
                if (!p?.id) continue;
                const sku = String(p.sku || '').trim();
                const label = sku ? `${p.name} (${sku})` : String(p.name || `Product #${id}`);
                for (const k of this._promoAllProdSearchKinds()) {
                    const m = this._promoPickerProducts[k];
                    if (m && m.has(id)) m.set(id, label);
                }
            } catch (_) {
                /* ignore */
            }
        }
        this._promoAllProdSearchKinds().forEach((k) => this._promoRenderProdChips(k));
    }

    _promoPostFillEnrichLabels(allProductIds) {
        void (async () => {
            await this._promoEnrichProductLabels(allProductIds);
            await this._promoEnsureCategoriesCache();
            for (const id of [...this._promoPickerCategories.keys()]) {
                const hit = (this._promoCategoriesCache || []).find((c) => Number(c.id) === Number(id));
                if (hit?.name) this._promoPickerCategories.set(Number(id), hit.name);
            }
            this._promoRenderCatChips();
        })();
    }

    initPromoProductPickers() {
        if (this._promoProductPickersReady) return;
        const bind = (kind) => {
            const el = this._promoProdPickerElements(kind);
            if (!el?.q || el.q.dataset.hmPromoSearchBound === '1') return;
            el.q.dataset.hmPromoSearchBound = '1';
            if (typeof window.hmBindSearchInput === 'function') {
                window.hmBindSearchInput(el.q, {
                    debounceMs: 280,
                    onSearch: (raw) => this._promoRunProdSearch(kind, String(raw || '').trim())
                });
            } else {
                el.q.addEventListener('input', () => this._promoScheduleProdSearch(kind));
            }
            el.q.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape') this._promoHideProdResults(kind);
            });
        };
        bind('scope');
        bind('buy');
        bind('get');
        bind('trigger');
        const prodStrat = document.getElementById('promo-form-product-promo-strategy');

        if (prodStrat) {
            prodStrat.addEventListener('change', () => this._togglePromoProductStrategyUi());
        }
        const addRew = document.getElementById('promo-add-reward-rule-btn');
        if (addRew) addRew.addEventListener('click', () => this._promoAddRewardRuleRow());
        const catSel = document.getElementById('promo-scope-category-add');
        if (catSel) {
            catSel.addEventListener('change', () => {
                const id = Number(catSel.value);
                if (!Number.isFinite(id) || id <= 0) return;
                if (this._promoPickerCategories.has(id)) {
                    catSel.value = '';
                    return;
                }
                const hit = (this._promoCategoriesCache || []).find((c) => Number(c.id) === id);
                const label = hit?.name ? String(hit.name) : `Category #${id}`;
                this._promoPickerCategories.set(id, label);
                this._promoRenderCatChips();
                this._promoPickerSyncCategoryHiddenField();
                catSel.value = '';
                this._promoUpdateCategoryDropdownState();
            });
        }
        const bq = document.getElementById('promo-form-buy-qty');
        const gq = document.getElementById('promo-form-get-qty');
        if (bq) {
            bq.addEventListener('input', () => this._togglePromoBogoPickersVisibility());
        }
        if (gq) {
            gq.addEventListener('input', () => this._togglePromoBogoPickersVisibility());
        }
        const bogoRewardType = document.getElementById('promo-form-bogo-reward-type');
        if (bogoRewardType) {
            bogoRewardType.addEventListener('change', () => this._togglePromoBogoRewardFields());
        }
        document.addEventListener('click', (ev) => {
            if (!(ev.target instanceof Element)) return;
            const inPanel =
                ev.target.closest('.promo-prod-search-wrap') ||
                ev.target.closest('.promo-prod-results-local');
            if (inPanel) return;
            this._promoAllProdSearchKinds().forEach((k) => this._promoHideProdResults(k));
        });
        this._promoProductPickersReady = true;
        this._togglePromoBogoRewardFields();
        this._togglePromoProductStrategyUi();
    }

    _promoClearProductPickers() {
        ['scope', 'buy', 'get', 'trigger'].forEach((k) => {
            if (!this._promoPickerProducts[k]) this._promoPickerProducts[k] = new Map();
            this._promoPickerProducts[k].clear();

            this._promoRenderProdChips(k);
            this._promoHideProdResults(k);

            const el = this._promoProdPickerElements(k);
            if (el?.q) el.q.value = '';
        });
        this._promoClearRewardRuleUi();
        this._promoPickerCategories.clear();
        this._promoRenderCatChips();
        const catSelClear = document.getElementById('promo-scope-category-add');
        if (catSelClear) catSelClear.value = '';
        this._promoUpdateCategoryDropdownState();
        this._promoPickerSyncProdHiddenField();
        this._promoPickerSyncCategoryHiddenField();
    }

    _promoEnsure12hHourSelect(sel) {
        if (!sel || sel.dataset.promoPopulated12h === '1') return;
        for (let h = 1; h <= 12; h++) {
            const o = document.createElement('option');
            o.value = String(h);
            o.textContent = String(h);
            sel.appendChild(o);
        }
        sel.dataset.promoPopulated12h = '1';
    }

    _promoEnsureMinuteSelect(sel) {
        if (!sel || sel.dataset.promoPopulatedMm === '1') return;
        for (let m = 0; m <= 59; m++) {
            const o = document.createElement('option');
            o.value = String(m);
            o.textContent = String(m).padStart(2, '0');
            sel.appendChild(o);
        }
        sel.dataset.promoPopulatedMm = '1';
    }

    _promoEnsureAmpmSelect(sel) {
        if (!sel || sel.dataset.promoPopulatedAmpm === '1') return;
        for (const x of ['AM', 'PM']) {
            const o = document.createElement('option');
            o.value = x;
            o.textContent = x;
            sel.appendChild(o);
        }
        sel.dataset.promoPopulatedAmpm = '1';
    }

    /**
     * Populates scrollable selects and wires change handlers.
     * Does not infer hidden timestamps from widgets (caller uses fill/sync).
     */
    initPromoDatetimeUi() {
        const probe = document.getElementById('promo-form-starts-hour');
        if (!probe) return;
        if (!this._promoDatetimeUiReady) {
            for (const prefix of ['starts', 'ends']) {
                this._promoEnsure12hHourSelect(document.getElementById(`promo-form-${prefix}-hour`));
                this._promoEnsureMinuteSelect(document.getElementById(`promo-form-${prefix}-minute`));
                this._promoEnsureAmpmSelect(document.getElementById(`promo-form-${prefix}-ampm`));
            }
            const syncBoth = () => {
                this._promoSyncDatetimePartsToHidden('starts');
                this._promoSyncDatetimePartsToHidden('ends');
            };
            for (const prefix of ['starts', 'ends']) {
                for (const part of ['date', 'hour', 'minute', 'ampm']) {
                    const el = document.getElementById(`promo-form-${prefix}-${part}`);
                    if (el) el.addEventListener('change', syncBoth);
                }
            }
            this._promoDatetimeUiReady = true;
        }
    }

    _promoSyncDatetimePartsToHidden(prefix) {
        const hid = document.getElementById(`promo-form-${prefix}`);
        const dateEl = document.getElementById(`promo-form-${prefix}-date`);
        const hEl = document.getElementById(`promo-form-${prefix}-hour`);
        const mEl = document.getElementById(`promo-form-${prefix}-minute`);
        const apEl = document.getElementById(`promo-form-${prefix}-ampm`);
        if (!hid || !dateEl || !hEl || !mEl || !apEl) return;
        const d = String(dateEl.value || '').trim();
        if (!d) {
            hid.value = '';
            return;
        }
        const h12 = Number(hEl.value);
        const mi = Number(mEl.value);
        const ap = String(apEl.value || 'AM').toUpperCase();
        if (!Number.isFinite(h12) || h12 < 1 || h12 > 12 || !Number.isFinite(mi) || mi < 0 || mi > 59) {
            hid.value = '';
            return;
        }
        let h24;
        if (ap === 'AM') {
            h24 = h12 === 12 ? 0 : h12;
        } else if (ap === 'PM') {
            h24 = h12 === 12 ? 12 : h12 + 12;
        } else {
            hid.value = '';
            return;
        }
        hid.value = `${d}T${String(h24).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    }

    _promoFillDatetimePartsFromHidden(prefix) {
        const hid = document.getElementById(`promo-form-${prefix}`);
        const dateEl = document.getElementById(`promo-form-${prefix}-date`);
        const hEl = document.getElementById(`promo-form-${prefix}-hour`);
        const mEl = document.getElementById(`promo-form-${prefix}-minute`);
        const apEl = document.getElementById(`promo-form-${prefix}-ampm`);
        if (!hid || !dateEl || !hEl || !mEl || !apEl) return;
        const raw = String(hid.value || '').trim();
        if (!raw) {
            dateEl.value = '';
            hEl.value = '12';
            mEl.value = '0';
            apEl.value = 'AM';
            return;
        }
        const normalized = raw.includes('T') ? raw : raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
        const m = normalized.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})/);
        if (!m) {
            dateEl.value = '';
            hEl.value = '12';
            mEl.value = '0';
            apEl.value = 'AM';
            return;
        }
        dateEl.value = m[1];
        const H = Number(m[2]);
        const minute = Number(m[3]);
        let ap;
        let h12;
        if (H === 0) {
            h12 = 12;
            ap = 'AM';
        } else if (H === 12) {
            h12 = 12;
            ap = 'PM';
        } else if (H < 12) {
            h12 = H;
            ap = 'AM';
        } else {
            h12 = H - 12;
            ap = 'PM';
        }
        hEl.value = String(h12);
        mEl.value = String(minute);
        apEl.value = ap;
    }

    resetPromoEditor() {
        this.initPromoProductPickers();
        this.initPromoDatetimeUi();
        this._promoClearProductPickers();
        const idEl = document.getElementById('promo-edit-id');
        if (idEl) idEl.value = '';
        const hdr = document.getElementById('promo-editor-title');
        if (hdr) hdr.textContent = 'New checkout promotion';

        const fields = [
            ['promo-form-code', ''],
            ['promo-form-desc', ''],
            ['promo-form-pct', ''],
            ['promo-form-fixed', ''],
            ['promo-form-buy-qty', ''],
            ['promo-form-get-qty', ''],
            ['promo-form-product-ids', ''],
            ['promo-form-category-ids', ''],
            ['promo-form-starts', ''],
            ['promo-form-ends', ''],
            ['promo-form-limit-total', ''],
            ['promo-form-limit-email', '']
        ];
        fields.forEach(([id, v]) => {
            const el = document.getElementById(id);
            if (el) el.value = v;
        });
        this._promoFillDatetimePartsFromHidden('starts');
        this._promoFillDatetimePartsFromHidden('ends');

        const scope = document.getElementById('promo-form-scope');
        if (scope) scope.value = 'all';
        const act = document.getElementById('promo-form-active');
        if (act) act.checked = true;
        this._setPromoFormChannel('both');
        const fs = document.getElementById('promo-form-free-shipping');
        if (fs) fs.checked = false;
        const bogort = document.getElementById('promo-form-bogo-reward-type');
        if (bogort) bogort.value = 'free';
        const bogopct = document.getElementById('promo-form-bogo-get-pct');
        if (bogopct) bogopct.value = '';
        const bogofix = document.getElementById('promo-form-bogo-get-fixed');
        if (bogofix) bogofix.value = '';
        const pstr = document.getElementById('promo-form-product-promo-strategy');
        if (pstr) pstr.value = 'trigger_reward';
        const tmin = document.getElementById('promo-form-trigger-min-qty');
        if (tmin) tmin.value = '';
        this._togglePromoScopeHints();

        const msg = document.getElementById('promo-form-msg');
        if (msg) msg.textContent = '';
    }

    _ensurePromoEditorModalMounted() {
        const m = document.getElementById('promo-editor-modal');
        if (!m) return null;
        if (m.parentElement !== document.body) {
            document.body.appendChild(m);
        }
        return m;
    }

    _ensureAdminPortals() {
        this._ensureSectionStorage();
        this._ensurePromoEditorModalMounted();
        this._parkMainContentOrphans();

        const mainContent = document.querySelector('.main-content');
        const active = document.querySelector('.content-section.active');
        if (mainContent && active?.id) {
            this._mountOnlyActiveSection(active.id);
        }
    }

    openPromoEditorModal() {
        const m = this._ensurePromoEditorModalMounted();
        if (!m) return;
        const prev = document.activeElement;
        this._promoEditorReturnFocus =
            prev instanceof HTMLElement &&
            typeof prev.focus === 'function' &&
            document.body.contains(prev) &&
            !m.contains(prev)
                ? prev
                : null;
        m.hidden = false;
        m.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        const scrollEl = m.querySelector('.promo-editor-modal__scroll');
        if (scrollEl) scrollEl.scrollTop = 0;
        const first = document.getElementById('promo-form-code');
        window.setTimeout(() => {
            try {
                first?.focus();
            } catch (_) {
                /* ignore */
            }
        }, 60);
    }

    closePromoEditorModal() {
        const m = document.getElementById('promo-editor-modal');
        if (!m) return;
        const ae = document.activeElement;
        if (ae instanceof HTMLElement && m.contains(ae)) {
            const ret = this._promoEditorReturnFocus;
            if (
                ret &&
                document.body.contains(ret) &&
                typeof ret.focus === 'function' &&
                !m.contains(ret)
            ) {
                try {
                    ret.focus({ preventScroll: true });
                } catch (_) {
                    /* ignore */
                }
            } else {
                const fb = document.getElementById('promo-editor-open-new-btn');
                if (fb && typeof fb.focus === 'function') {
                    try {
                        fb.focus({ preventScroll: true });
                    } catch (_) {
                        try {
                            ae.blur();
                        } catch (_) {
                            /* ignore */
                        }
                    }
                } else {
                    try {
                        ae.blur();
                    } catch (_) {
                        /* ignore */
                    }
                }
            }
        }
        this._promoEditorReturnFocus = null;
        m.hidden = true;
        m.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    _parseRulesField(raw) {
        if (raw == null) return {};
        if (typeof raw === 'object') return raw;
        try {
            return JSON.parse(String(raw));
        } catch {
            return {};
        }
    }

    _promoChannelFromRow(row) {
        const web = row.applies_web == null || Number(row.applies_web) !== 0;
        const pos = row.applies_pos == null || Number(row.applies_pos) !== 0;
        if (web && pos) return 'both';
        if (web && !pos) return 'web';
        if (!web && pos) return 'pos';
        return 'both';
    }

    _promoChannelLabel(channel) {
        if (channel === 'web') return 'Website only';
        if (channel === 'pos') return 'In-store only';
        return 'Website + in-store';
    }

    _setPromoFormChannel(channel) {
        const val = channel === 'web' || channel === 'pos' ? channel : 'both';
        document.querySelectorAll('input[name="promo-form-channel"]').forEach((el) => {
            el.checked = el.value === val;
        });
    }

    _getPromoFormChannel() {
        const checked = document.querySelector('input[name="promo-form-channel"]:checked');
        const v = checked?.value;
        return v === 'web' || v === 'pos' ? v : 'both';
    }

    fillPromoEditor(row) {
        if (!row) return;
        const idEl = document.getElementById('promo-edit-id');
        if (idEl) idEl.value = String(row.id);
        const hdr = document.getElementById('promo-editor-title');
        if (hdr) hdr.textContent = `Edit promotion #${row.id}`;

        const code = document.getElementById('promo-form-code');
        const desc = document.getElementById('promo-form-desc');
        if (code) code.value = row.code || '';
        if (desc) desc.value = row.description || '';
        document.getElementById('promo-form-active').checked = Number(row.is_active) === 1;
        this._setPromoFormChannel(this._promoChannelFromRow(row));
        const startsNorm = row.starts_at
            ? String(row.starts_at).trim().replace(' ', 'T').slice(0, 16)
            : '';
        const endsNorm = row.ends_at
            ? String(row.ends_at).trim().replace(' ', 'T').slice(0, 16)
            : '';
        this.initPromoDatetimeUi();
        document.getElementById('promo-form-starts').value = startsNorm;
        document.getElementById('promo-form-ends').value = endsNorm;
        this._promoFillDatetimePartsFromHidden('starts');
        this._promoFillDatetimePartsFromHidden('ends');
        document.getElementById('promo-form-limit-total').value =
            row.usage_limit_total != null ? String(row.usage_limit_total) : '';
        document.getElementById('promo-form-limit-email').value =
            row.usage_limit_per_email != null ? String(row.usage_limit_per_email) : '';

        const rules = this._parseRulesField(row.rules);
        this.initPromoProductPickers();
        this._promoPickerProducts.scope.clear();
        this._promoPickerProducts.buy.clear();
        this._promoPickerProducts.get.clear();
        this._promoPickerProducts.trigger.clear();
        this._promoClearRewardRuleUi();
        this._promoPickerCategories.clear();

        const scopeEl = document.getElementById('promo-form-scope');
        const stratEl = document.getElementById('promo-form-product-promo-strategy');
        const sc = rules.scope === 'products' || rules.scope === 'categories' ? rules.scope : 'all';
        if (scopeEl) scopeEl.value = sc;

        const allP = Array.isArray(rules.productIds)
            ? rules.productIds.map((x) => Number(x)).filter((n) => n > 0)
            : [];
        const trRaw = rules.triggerReward;
        const useTrigger =
            sc === 'products' &&
            trRaw &&
            typeof trRaw === 'object' &&
            Array.isArray(trRaw.triggerProductIds) &&
            trRaw.triggerProductIds.length > 0;
        if (stratEl) stratEl.value = useTrigger ? 'trigger_reward' : 'classic';

        if (useTrigger) {
            for (const tid of trRaw.triggerProductIds || []) {

                const n = Number(tid);
                if (Number.isFinite(n) && n > 0)
                    this._promoPickerProducts.trigger.set(n, `Product #${n}`);
            }
            const mq = document.getElementById('promo-form-trigger-min-qty');

            if (mq) mq.value = trRaw.minTriggerQty != null ? String(trRaw.minTriggerQty) : '';

            const rrules = Array.isArray(trRaw.rewardRules) ? trRaw.rewardRules : [];

            if (rrules.length) {

                rrules.forEach((rr) => this._promoAddRewardRuleRow(rr));
            } else {
                this._promoAddRewardRuleRow();
            }
        } else {
            const effsEarly = Array.isArray(rules.effects) ? rules.effects : [];
            const bogoEarly = effsEarly.find((e) => {
                const t = String(e?.type || '').toLowerCase();

                return t === 'buy_get' || t === 'bogo';
            });
            const buySide = new Set(
                Array.isArray(bogoEarly?.buyProductIds)
                    ? bogoEarly.buyProductIds.map((n) => Number(n)).filter((n) => n > 0)
                    : []
            );
            const getSide = new Set(
                Array.isArray(bogoEarly?.getProductIds)
                    ? bogoEarly.getProductIds.map((n) => Number(n)).filter((n) => n > 0)
                    : []
            );
            if (buySide.size > 0 && getSide.size > 0) {

                for (const id of allP) {

                    if (!buySide.has(id) && !getSide.has(id))
                        this._promoPickerProducts.scope.set(id, `Product #${id}`);
                }
                for (const id of buySide) this._promoPickerProducts.buy.set(id, `Product #${id}`);
                for (const id of getSide) this._promoPickerProducts.get.set(id, `Product #${id}`);
            } else {

                for (const id of allP) this._promoPickerProducts.scope.set(id, `Product #${id}`);
            }
        }

        const cats = Array.isArray(rules.categoryIds)
            ? rules.categoryIds.map((x) => Number(x)).filter((n) => n > 0)
            : [];
        for (const id of cats) this._promoPickerCategories.set(id, `Category #${id}`);

        this._promoPickerSyncProdHiddenField();
        this._promoPickerSyncCategoryHiddenField();
        if (useTrigger) {
            this._promoRenderProdChips('trigger');
            Object.keys(this._promoPickerProducts)

                .filter((k) => k.startsWith('reward-'))

                .forEach((k) => this._promoRenderProdChips(k));

        } else {
            ['scope', 'buy', 'get'].forEach((k) => this._promoRenderProdChips(k));

        }

        this._promoRenderCatChips();

        const pctEl = document.getElementById('promo-form-pct');
        const fixedEl = document.getElementById('promo-form-fixed');
        const buyEl = document.getElementById('promo-form-buy-qty');
        const getEl = document.getElementById('promo-form-get-qty');
        const fsEl = document.getElementById('promo-form-free-shipping');
        const rewardSel = document.getElementById('promo-form-bogo-reward-type');
        const getPctBogo = document.getElementById('promo-form-bogo-get-pct');
        const getFixedBogo = document.getElementById('promo-form-bogo-get-fixed');
        if (pctEl) pctEl.value = '';
        if (fixedEl) fixedEl.value = '';
        if (buyEl) buyEl.value = '';
        if (getEl) getEl.value = '';
        if (fsEl) fsEl.checked = false;
        if (rewardSel) rewardSel.value = 'free';
        if (getPctBogo) getPctBogo.value = '';
        if (getFixedBogo) getFixedBogo.value = '';

        const effs = Array.isArray(rules.effects) ? rules.effects : [];
        for (const e of effs) {

            const t = String(e.type || '').toLowerCase();
            if (
                (t === 'free_standard_shipping' || t === 'free_standard_shipping_only') &&
                fsEl
            ) {

                fsEl.checked = true;

                continue;

            }
            if (!useTrigger) {

                if (t === 'percent_off' && pctEl) pctEl.value = e.percent ?? '';
                if (t === 'fixed_off' && fixedEl) fixedEl.value = e.amount ?? '';
                if ((t === 'buy_get' || t === 'bogo') && buyEl && getEl) {

                    buyEl.value = e.buyQty ?? '';

                    getEl.value = e.getQty ?? '';

                    if (rewardSel) {

                        const grt = String(e.getRewardType || 'free').toLowerCase();
                        if (grt === 'percent_off' || grt === 'percent') rewardSel.value = 'percent_off';
                        else if (grt === 'fixed_off' || grt === 'fixed') rewardSel.value = 'fixed_off';
                        else rewardSel.value = 'free';

                    }

                    if (getPctBogo && e.getPercent != null && e.getPercent !== '') {

                        getPctBogo.value = String(e.getPercent);

                    }

                    const fa = e.getFixedAmount != null ? e.getFixedAmount : e.getAmount;

                    if (getFixedBogo && fa != null && fa !== '') getFixedBogo.value = String(fa);

                }

            }

        }

        this._togglePromoScopeHints();
        this._promoPostFillEnrichLabels(allP);
        this.openPromoEditorModal();
    }

    async loadWebPromotionsTable() {
        const tbody = document.getElementById('promotions-table-body');
        if (!tbody) return;
        if (!this.authToken) return;
        try {
            const res = await this.apiRequest('/admin/promotions');
            const rows = Array.isArray(res.promotions) ? res.promotions : [];
            tbody.innerHTML = rows
                .map((r) => {
                    const active = Number(r.is_active) === 1 ? 'Yes' : 'No';
                    const channel = this._promoChannelLabel(this._promoChannelFromRow(r));
                    return `<tr data-promo-row="${r.id}">
                        <td><code>${this.escapeHtml(r.code)}</code></td>
                        <td>${this.escapeHtml(channel)}</td>
                        <td>${this.escapeHtml(active)}</td>
                        <td style="font-size:0.88rem">${this.escapeHtml(r.description || '—')}</td>
                        <td style="white-space:nowrap">
                            <button type="button" class="btn btn-secondary btn-sm" data-promo-edit="${r.id}">Edit</button>
                            <button type="button" class="btn btn-danger btn-sm" data-promo-delete="${r.id}">Delete</button>
                        </td>
                    </tr>`;
                })
                .join('');
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="5" style="color:var(--error)">Unable to load promotions.</td></tr>`;
        }
    }

    async submitPromoForm(ev) {
        ev.preventDefault();
        const msg = document.getElementById('promo-form-msg');
        if (msg) {
            msg.textContent = '';
            msg.style.color = '';
        }

        const rules = this._promoRulesFromEditor();
        const usesTriggerSku =
            rules.scope === 'products' &&
            rules.triggerReward &&
            typeof rules.triggerReward === 'object' &&
            rules.triggerReward.triggerProductIds &&
            rules.triggerReward.triggerProductIds.length > 0;
        if (!rules.effects.length && !usesTriggerSku) {
            if (msg) {
                msg.textContent =
                    'Add a Triggerâ†’Reward SKU setup, cart discount (classic), buy/get, or check Free shipping.';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Add promotion rules first', 'error');
            return;
        }
        const promoProdStrat = document.getElementById('promo-form-product-promo-strategy')?.value;
        if (rules.scope === 'products' && promoProdStrat === 'trigger_reward') {
            const tr = rules.triggerReward;

            const bad = () => {
                const t =
                    'Trigger mode: add at least one Trigger SKU, minimum quantity â‰¥ 1, and one reward SKU group with a valid discount value.';
                if (msg) {

                    msg.textContent = t;
                    msg.style.color = 'var(--error)';
                }

                this.showToast(t, 'error');
            };


            if (!tr || !tr.triggerProductIds?.length || !Number.isFinite(tr.minTriggerQty) || tr.minTriggerQty < 1) {

                bad();
                return;
            }

            if (!Array.isArray(tr.rewardRules) || !tr.rewardRules.length) {

                bad();
                return;

            }


        }


        if (rules.scope === 'products' && (!rules.productIds || rules.productIds.length === 0)) {
            const t = 'Add at least one product to the SKU lists above, or change "Applies to".';
            if (msg) {
                msg.textContent = t;

                msg.style.color = 'var(--error)';
            }
            this.showToast(t, 'error');
            return;
        }
        if (rules.scope === 'categories' && (!rules.categoryIds || rules.categoryIds.length === 0)) {
            const t = 'Add at least one category, or change "Applies to".';
            if (msg) {
                msg.textContent = t;
                msg.style.color = 'var(--error)';
            }
            this.showToast(t, 'error');
            return;
        }

        for (const e of rules.effects) {
            const tp = String(e.type || '').toLowerCase();
            if (tp !== 'buy_get' && tp !== 'bogo') continue;
            const rt = String(e.getRewardType || 'free').toLowerCase();
            if (rt === 'percent_off' || rt === 'percent') {
                const p = Number(e.getPercent);
                if (!Number.isFinite(p) || p <= 0 || p > 100) {
                    const tx =
                        'Buy/get is set to percent off reward items - enter a percent between 1 and 100, or choose Free.';
                    if (msg) {
                        msg.textContent = tx;
                        msg.style.color = 'var(--error)';
                    }
                    this.showToast(tx, 'error');
                    return;
                }
            } else if (rt === 'fixed_off' || rt === 'fixed') {
                const f = Number(e.getFixedAmount);
                if (!Number.isFinite(f) || f <= 0) {
                    const tx =
                        'Buy/get is set to dollar off reward items - enter an amount greater than zero, or choose Free.';
                    if (msg) {
                        msg.textContent = tx;
                        msg.style.color = 'var(--error)';
                    }
                    this.showToast(tx, 'error');
                    return;
                }
            }
        }

        const id = Number(document.getElementById('promo-edit-id')?.value || '0');
        this.initPromoDatetimeUi();
        this._promoSyncDatetimePartsToHidden('starts');
        this._promoSyncDatetimePartsToHidden('ends');
        const promoNormDt = (v) => {
            const s = String(v ?? '').trim();
            if (!s) return null;
            const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
            if (m) return `${m[1]} ${m[2]}:00`;
            return s;
        };
        const payload = {
            code: (document.getElementById('promo-form-code')?.value || '').trim(),
            description: (document.getElementById('promo-form-desc')?.value || '').trim(),
            is_active: document.getElementById('promo-form-active')?.checked ? 1 : 0,
            promotion_channel: this._getPromoFormChannel(),
            starts_at: promoNormDt(document.getElementById('promo-form-starts')?.value),
            ends_at: promoNormDt(document.getElementById('promo-form-ends')?.value),
            usage_limit_total: document.getElementById('promo-form-limit-total')?.value,
            usage_limit_per_email: document.getElementById('promo-form-limit-email')?.value,
            rules
        };

        try {
            if (id > 0) {
                await this.apiRequest(`/admin/promotions/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
                this.showToast('Promotion updated', 'success');
                this.closePromoEditorModal();
            } else {
                await this.apiRequest('/admin/promotions', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                this.showToast('Promotion created', 'success');
                this.resetPromoEditor();
                this.closePromoEditorModal();
            }
            await this.loadWebPromotionsTable();
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed';
                msg.style.color = 'var(--error)';
            }
            this.showToast('Save failed: ' + (err.message || ''), 'error');
        }
    }

    async deletePromoById(id) {
        const pid = Number(id);
        if (!Number.isFinite(pid)) return;
        const ok = await this.showAdminConfirm({
            title: 'Delete promotion?',
            message: 'This cannot be undone. Existing orders keep their totals.',
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            danger: true
        });
        if (!ok) return;
        try {
            await this.apiRequest(`/admin/promotions/${pid}`, { method: 'DELETE' });
            this.showToast('Promotion deleted', 'success');
            await this.loadWebPromotionsTable();
            const cur = Number(document.getElementById('promo-edit-id')?.value || '0');
            if (cur === pid) {
                this.resetPromoEditor();
                this.closePromoEditorModal();
            }
        } catch (err) {
            this.showToast('Delete failed: ' + (err.message || ''), 'error');
        }
    }

    async loadOrders() {
        // Implementation for loading orders
        const container = document.getElementById('ordersTable');
        if (!container) {
            console.warn('Orders table container not found');
            return;
        }

        container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading orders...</div>';

        // Don't make API call if not authenticated
        if (!this.authToken) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view orders.</p></div>';
            return;
        }

        try {
            const response = await this.apiRequest('/admin/orders?limit=50');

            // Handle null response (403 Forbidden)
            if (!response) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view orders.</p></div>';
                return;
            }

            if (response.orders && response.orders.length > 0) {
                container.innerHTML = this.renderOrdersTable(response.orders);
            } else {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>No orders yet.</p><p style="font-size:0.875rem;margin-top:0.5rem;">Orders from checkout will appear here once customers place them.</p></div>';
            }
        } catch (error) {
            // Don't show error for authentication issues
            if (error.message === 'Authentication required' || error.message.includes('Invalid admin token')) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view orders.</p></div>';
            } else {
                container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);"><p>Failed to load orders: ${this.escapeHtml(error.message)}</p></div>`;
            }
        }
    }

    formatMoney(value) {
        const n = Number(value) || 0;
        return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    }

    getTodayDateKey() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    setTaxReportDefaultRange() {
        const startInput = document.getElementById('taxReportStartDate');
        const endInput = document.getElementById('taxReportEndDate');
        if (!startInput || !endInput) return;
        if (startInput.value && endInput.value) return;

        const now = new Date();
        const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
        const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);

        const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        startInput.value = toKey(firstOfPrevMonth);
        endInput.value = toKey(lastOfPrevMonth);
    }

    getTaxReportDateRange() {
        const startDate = (document.getElementById('taxReportStartDate')?.value || '').trim();
        const endDate = (document.getElementById('taxReportEndDate')?.value || '').trim();
        return { startDate, endDate };
    }

    async loadTaxLedger() {
        try {
            const date = this.getTodayDateKey();
            this.setTaxReportDefaultRange();
            const response = await this.apiRequest(`/admin/tax-ledger/overview?date=${encodeURIComponent(date)}`);
            if (!response || !response.overview) return;

            const overview = response.overview;
            const webstore = Number(overview.webstore_total) || 0;
            const pos = Number(overview.pos_total) || 0;
            const combined = Number(overview.combined_reserve_needed) || 0;
            const status = String(overview.status || 'pending').toLowerCase();

            const webstoreEl = document.getElementById('taxLedgerWebstoreTotal');
            const posEl = document.getElementById('taxLedgerPosTotal');
            const combinedEl = document.getElementById('taxLedgerCombinedTotal');
            const statusEl = document.getElementById('taxLedgerStatus');
            const instructionEl = document.getElementById('taxLedgerInstruction');

            if (webstoreEl) webstoreEl.textContent = this.formatMoney(webstore);
            if (posEl) posEl.textContent = this.formatMoney(pos);
            if (combinedEl) combinedEl.textContent = this.formatMoney(combined);
            if (statusEl) statusEl.textContent = `Status: ${status}`;
            if (instructionEl) {
                instructionEl.textContent = `Based on today's sales, please transfer ${this.formatMoney(combined)} to your Tax Savings Account.`;
            }

            const settings = response.taxSettings || {};
            const hmEmail =
                settings.hmAccountantEmail ||
                response.accountantEmail ||
                'wandaforto@aol.com';
            const hmDisplay = document.getElementById('taxAccountantEmailDisplay');
            if (hmDisplay) hmDisplay.textContent = hmEmail;

            const keyInput = document.getElementById('taxZiptaxApiKey');
            const keyStatus = document.getElementById('taxZiptaxKeyStatus');
            const hmIgnore = document.getElementById('taxHmIgnoreStates');
            const hmEmailInput = document.getElementById('taxHmAccountantEmail');

            if (keyInput && !keyInput.dataset.dirty) {
                keyInput.value = '';
                keyInput.placeholder = settings.ziptaxApiKeyConfigured
                    ? 'Ziptax key saved — leave blank to keep current'
                    : 'Paste Ziptax API key';
            }
            if (keyStatus) {
                keyStatus.textContent = settings.ziptaxApiKeyConfigured
                    ? `Configured: ${settings.ziptaxApiKey || '[configured]'}`
                    : 'Not configured yet — online checkout tax will fail until a key is saved.';
            }
            if (hmIgnore && !hmIgnore.dataset.dirty) hmIgnore.value = settings.hmIgnoreStates || '';
            if (hmEmailInput && !hmEmailInput.dataset.dirty) hmEmailInput.value = hmEmail;
        } catch (error) {
            this.showNotification('Tax ledger endpoint unavailable. Restart backend to load new routes.', 'error');
            console.warn('Tax ledger load failed:', error?.message || error);
        }
    }

    async saveTaxSettings() {
        const keyInput = document.getElementById('taxZiptaxApiKey');
        const payload = {
            hmIgnoreStates: document.getElementById('taxHmIgnoreStates')?.value || '',
            hmAccountantEmail: document.getElementById('taxHmAccountantEmail')?.value || ''
        };
        const keyVal = (keyInput?.value || '').trim();
        if (keyVal) payload.ziptaxApiKey = keyVal;

        const response = await this.apiRequest('/admin/tax-settings', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        if (!response) return;
        if (keyInput) {
            keyInput.value = '';
            delete keyInput.dataset.dirty;
        }
        ['taxHmIgnoreStates', 'taxHmAccountantEmail'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) delete el.dataset.dirty;
        });
        this.showNotification('Tax settings saved', 'success');
        await this.loadTaxLedger();
    }

    async runDailyTaxSync() {
        const date = this.getTodayDateKey();
        const response = await this.apiRequest('/admin/tax-ledger/sync-daily', {
            method: 'POST',
            body: JSON.stringify({ date })
        });
        if (!response) return;
        this.showNotification('Daily tax sync finished', 'success');
        await this.loadTaxLedger();
    }

    async markTaxReserveTransferred() {
        const date = this.getTodayDateKey();
        const response = await this.apiRequest('/admin/tax-ledger/mark-transferred', {
            method: 'POST',
            body: JSON.stringify({ date })
        });
        if (!response) return;
        this.showNotification('Reserve marked as transferred', 'success');
        await this.loadTaxLedger();
    }

    async exportTaxAccountantExcel() {
        const { startDate, endDate } = this.getTaxReportDateRange();
        if (!startDate || !endDate) {
            this.showNotification('Select both start and end dates', 'error');
            return;
        }

        this.showNotification('Building online sales tax reports by state...', 'info');

        let stateFiles = [];
        try {
            const listRes = await this.apiRequest(
                `/admin/tax-ledger/export/accountant-states?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
            );
            stateFiles = listRes?.files || [];
        } catch (error) {
            this.showNotification(error?.message || 'Could not list state reports', 'error');
            return;
        }

        if (!stateFiles.length) {
            this.showNotification('No online tax transactions in that date range', 'warning');
            return;
        }

        for (const file of stateFiles) {
            const url = `${this.apiBaseUrl}/admin/tax-ledger/export/accountant.xlsx?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&state=${encodeURIComponent(file.stateCode)}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { Authorization: `Bearer ${this.authToken}` }
            });
            if (!response.ok) {
                this.showNotification(`Download failed for ${file.stateLabel}`, 'error');
                continue;
            }
            const blob = await response.blob();
            const href = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = href;
            link.download = file.filename || `merchant-tax-${file.stateCode}-${startDate}-to-${endDate}.xlsx`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(href);
        }

        this.showNotification(
            `Downloaded ${stateFiles.length} state Excel file(s) (online sales only)`,
            'success'
        );
    }

    async sendTaxAccountantReport() {
        const { startDate, endDate } = this.getTaxReportDateRange();
        if (!startDate || !endDate) {
            this.showNotification('Select both start and end dates', 'error');
            return;
        }

        const ok = await this.showAdminConfirm({
            title: 'Email tax report to accountant?',
            message: `Send separate online sales tax Excel files (one per state) for ${startDate} through ${endDate}? In-store sales are excluded. Website orders are synced first.`,
            confirmLabel: 'Send email',
            cancelLabel: 'Cancel'
        });
        if (!ok) return;

        try {
            this.showNotification('Syncing online sales and sending email...', 'info');
            const response = await this.apiRequest('/admin/tax-ledger/send-accountant-report', {
                method: 'POST',
                body: JSON.stringify({ startDate, endDate, syncBeforeExport: true })
            });
            if (!response?.success) return;
            const to = response.result?.recipientEmail || 'accountant';
            const count = response.result?.rowCount ?? 0;
            const fileCount = response.result?.stateFiles?.length ?? 0;
            this.showNotification(
                `Tax report emailed to ${to} (${fileCount} file(s), ${count} online transactions)`,
                'success'
            );
        } catch (error) {
            this.showNotification(error?.message || 'Failed to send tax report', 'error');
        }
    }

    async loadLowStock() {
        const container = document.getElementById('lowStockTable');
        if (!container) {
            console.warn('Low stock table container not found');
            return;
        }

        container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading low stock products...</div>';

        if (!this.authToken) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view low stock products.</p></div>';
            return;
        }

        try {
            const rows = await this.apiRequest('/admin/inventory/low-stock?limit=10000');

            if (!rows) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view low stock products.</p></div>';
                return;
            }

            if (!Array.isArray(rows) || rows.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>No low stock products. All tracked inventory is above threshold.</p><p style="font-size:0.875rem;margin-top:0.5rem;">Only products with inventory tracking enabled appear here.</p></div>';
                return;
            }

            container.innerHTML = `
                <div class="table-container">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>SKU</th>
                                <th>Product</th>
                                <th>Brand</th>
                                <th>Category</th>
                                <th>Qty</th>
                                <th>Threshold</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map((p) => `
                            <tr>
                                <td><code>${this.escapeHtml(p.sku || '')}</code></td>
                                <td>${this.escapeHtml(p.name || '')}</td>
                                <td>${this.escapeHtml(p.brand_name || '-')}</td>
                                <td>${this.escapeHtml(p.category_name || '-')}</td>
                                <td><span class="badge ${Number(p.inventory_quantity) <= 0 ? 'badge-danger' : 'badge-warning'}">${Number(p.inventory_quantity) || 0}</span></td>
                                <td>${Number(p.low_stock_threshold) || 0}</td>
                                <td>
                                    <button type="button" class="btn btn-sm btn-secondary" onclick="editProduct(${p.id})">
                                        <i class="fas fa-edit"></i> Edit
                                    </button>
                                </td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <p style="margin: 1rem 0 0; font-size: 0.875rem; color: var(--gray-600);">
                    Showing ${rows.length} product${rows.length === 1 ? '' : 's'}.
                </p>
            `;
        } catch (error) {
            if (error.message === 'Authentication required' || error.message.includes('Invalid admin token')) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view low stock products.</p></div>';
            } else {
                container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);"><p>Failed to load low stock: ${this.escapeHtml(error.message)}</p></div>`;
            }
        }
    }

    renderOrdersTable(orders) {
        return `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Order #</th>
                            <th>Channel</th>
                            <th>Customer</th>
                            <th>Email</th>
                            <th>Status</th>
                            <th>Payment</th>
                            <th>Total</th>
                            <th>Items</th>
                            <th>Date</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${orders.map(order => `
                            <tr>
                                <td><code>${this.escapeHtml(order.order_number)}</code></td>
                                <td>
                                    <span class="badge ${this._salesChannelBadgeClass(order)}">
                                        ${this.escapeHtml(this._formatSalesChannel(order))}
                                    </span>
                                </td>
                                <td>${this.escapeHtml((order.shipping_first_name || '') + ' ' + (order.shipping_last_name || ''))}</td>
                                <td>${this.escapeHtml(order.email)}</td>
                                <td>
                                    <span class="badge ${this._orderStatusBadgeClass(order.status)}">
                                        ${this.escapeHtml(this._formatOrderStatus(order.status))}
                                    </span>
                                </td>
                                <td>
                                    <span class="badge ${order.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}">
                                        ${this.escapeHtml(order.payment_status)}
                                    </span>
                                </td>
                                <td>$${parseFloat(order.total_amount || 0).toFixed(2)}</td>
                                <td>${order.item_count || 0}</td>
                                <td>${new Date(order.created_at).toLocaleDateString()}</td>
                                <td>
                                    <button class="btn btn-sm btn-secondary" onclick="viewOrder(${order.id})">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    async loadEDSABookings() {
        // Implementation for loading EDSA bookings
        const container = document.getElementById('edsaBookingsTable');
        if (!container) {
            console.warn('EDSA bookings table container not found');
            return;
        }

        container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading EDSA bookings...</div>';

        // Don't make API call if not authenticated
        if (!this.authToken) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view EDSA bookings.</p></div>';
            return;
        }

        try {
            this.initEdsaCalendarState();
            const range = this.getEdsaCalendarRange();
            const response = await this.apiRequest(
                `/admin/edsa/bookings?limit=500&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
            );

            // Handle null response (403 Forbidden)
            if (!response) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view EDSA bookings.</p></div>';
                return;
            }

            if (response.bookings && response.bookings.length > 0) {
                this._edsaBookingsById = new Map(
                    response.bookings.map((b) => [Number(b.id), b])
                );
                this._edsaBookingsList = response.bookings;
                container.innerHTML = this.renderEdsaCalendarShell();
                this.renderEdsaCalendarBody();
                this.bindEdsaCalendarControls();
            } else {
                this._edsaBookingsById = new Map();
                this._edsaBookingsList = [];
                container.innerHTML = this.renderEdsaCalendarShell();
                this.renderEdsaCalendarBody();
                this.bindEdsaCalendarControls();
            }
        } catch (error) {
            // Don't show error for authentication issues
            if (error.message === 'Authentication required' || error.message.includes('Invalid admin token')) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view EDSA bookings.</p></div>';
            } else {
                container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);"><p>Failed to load EDSA bookings: ${this.escapeHtml(error.message)}</p></div>`;
            }
        }
    }

    renderEdsaCustomerRequest(booking) {
        const type = booking.customer_request_type || 'none';
        if (type === 'none') {
            return '<span class="text-muted">-</span>';
        }
        let text = type === 'cancel' ? 'Cancel requested' : 'Reschedule requested';
        if (type === 'reschedule' && booking.requested_date) {
            const d = new Date(booking.requested_date);
            const dateStr = Number.isNaN(d.getTime()) ? booking.requested_date : d.toLocaleDateString();
            const timeStr = booking.requested_time ? String(booking.requested_time).slice(0, 5) : '';
            text += ` â†’ ${dateStr}${timeStr ? ' ' + timeStr : ''}`;
        }
        if (booking.customer_request_notes) {
            text += ` - ${this.escapeHtml(String(booking.customer_request_notes).slice(0, 80))}`;
        }
        return `<span class="badge badge-warning">${this.escapeHtml(text)}</span>`;
    }

    renderEDSABookingsTable(bookings) {
        return `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Appointment date</th>
                            <th>Time</th>
                            <th>Status</th>
                            <th>Customer request</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${bookings.map(booking => `
                            <tr>
                                <td>${this.escapeHtml((booking.first_name || '') + ' ' + (booking.last_name || ''))}</td>
                                <td>${this.escapeHtml(booking.email)}</td>
                                <td>${this.escapeHtml(booking.phone || 'N/A')}</td>
                                <td>${booking.preferred_date ? new Date(booking.preferred_date).toLocaleDateString() : 'N/A'}</td>
                                <td>${booking.preferred_time ? String(booking.preferred_time).slice(0, 5) : 'N/A'}</td>
                                <td>
                                    <span class="badge ${booking.status === 'confirmed' ? 'badge-success' : booking.status === 'pending' ? 'badge-warning' : booking.status === 'cancelled' ? 'badge-danger' : 'badge-info'}">
                                        ${this.escapeHtml(String(booking.status || '').toUpperCase())}
                                    </span>
                                </td>
                                <td>${this.renderEdsaCustomerRequest(booking)}</td>
                                <td>${new Date(booking.created_at).toLocaleDateString()}</td>
                                <td>
                                    <button type="button" class="btn btn-sm btn-secondary" data-edsa-edit-id="${booking.id}" aria-label="Edit booking #${booking.id}">
                                        <i class="fas fa-edit" aria-hidden="true"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    formatEdsaDateInput(value) {
        if (!value) return '';
        const raw = String(value);
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
            return raw.slice(0, 10);
        }
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    buildEdsaTimeOptions(selected) {
        const sel = String(selected || '').slice(0, 5);
        let html = '';
        for (let hour = 10; hour < 18; hour++) {
            const t = `${String(hour).padStart(2, '0')}:00`;
            html += `<option value="${t}"${t === sel ? ' selected' : ''}>${t}</option>`;
        }
        return html;
    }

    bindEdsaBookingsTableActions(root) {
        if (!root) return;
        root.querySelectorAll('[data-edsa-edit-id]').forEach((btn) => {
            if (btn.dataset.edsaEditBound === '1') return;
            btn.dataset.edsaEditBound = '1';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const id = Number(btn.getAttribute('data-edsa-edit-id'));
                if (Number.isFinite(id)) {
                    this.openEdsaBookingModal(id);
                }
            });
        });
    }

    openEdsaBookingModal(bookingId) {
        const booking = this._edsaBookingsById.get(Number(bookingId));
        if (!booking) {
            this.showToast('Booking not found. Refresh the list and try again.', 'error');
            return;
        }

        const dateVal = this.formatEdsaDateInput(booking.preferred_date);
        const timeVal = String(booking.preferred_time || '10:00').slice(0, 5);
        const name = `${booking.first_name || ''} ${booking.last_name || ''}`.trim();

        const modal = this._mountAdminModal(`
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:1.25rem 1.5rem;border-bottom:1px solid var(--gray-200);background:var(--light-green, #f0f7ef);">
                <h2 id="edsa-edit-title" style="margin:0;color:var(--primary-green);font-size:1.25rem;">EDSA booking #${booking.id}</h2>
                <button type="button" class="modal-close" id="edsa-edit-close" aria-label="Close">${HM_CLOSE_ICON_SVG}</button>
            </div>
            <div class="modal-body" style="padding:1.5rem;">
                <p style="margin:0 0 1rem;color:var(--gray-600);">${this.escapeHtml(name)} \u00B7 ${this.escapeHtml(booking.email)}</p>
                <div class="form-group">
                    <label for="edsa-edit-status">Status</label>
                    <select id="edsa-edit-status" class="form-control">
                        <option value="pending"${booking.status === 'pending' ? ' selected' : ''}>Pending</option>
                        <option value="confirmed"${booking.status === 'confirmed' ? ' selected' : ''}>Confirmed</option>
                        <option value="cancelled"${booking.status === 'cancelled' ? ' selected' : ''}>Cancelled</option>
                        <option value="completed"${booking.status === 'completed' ? ' selected' : ''}>Completed</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="edsa-edit-date">Appointment date</label>
                    <input type="date" id="edsa-edit-date" class="form-control" value="${this.escapeHtml(dateVal)}">
                </div>
                <div class="form-group">
                    <label for="edsa-edit-time">Appointment time</label>
                    <select id="edsa-edit-time" class="form-control">${this.buildEdsaTimeOptions(timeVal)}</select>
                </div>
                <div class="form-group">
                    <label for="edsa-edit-notes">Staff notes (internal)</label>
                    <textarea id="edsa-edit-notes" class="form-control" rows="2">${this.escapeHtml(booking.admin_notes || '')}</textarea>
                </div>
                <label style="display:flex;align-items:center;gap:0.5rem;margin:1rem 0;">
                    <input type="checkbox" id="edsa-edit-notify" checked>
                    Email customer about cancel or time change
                </label>
                <p style="font-size:0.875rem;color:var(--gray-500);margin:0;">
                    Saving updates Google Calendar when connected. Customers receive an email if the date, time, or status (cancelled) changes.
                </p>
            </div>
            <div class="modal-footer" style="display:flex;gap:0.5rem;justify-content:flex-end;padding:1rem 1.5rem;border-top:1px solid var(--gray-200);">
                <button type="button" class="btn btn-secondary" id="edsa-edit-cancel">Close</button>
                <button type="button" class="btn btn-primary" id="edsa-edit-save">Save changes</button>
            </div>`);

        if (!modal) {
            this.showToast('Could not open booking editor.', 'error');
            return;
        }

        const close = () => modal.remove();

        modal.querySelector('#edsa-edit-close')?.addEventListener('click', close);
        modal.querySelector('#edsa-edit-cancel')?.addEventListener('click', close);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });

        modal.querySelector('#edsa-edit-save')?.addEventListener('click', async () => {
            const btn = modal.querySelector('#edsa-edit-save');
            btn.disabled = true;
            btn.textContent = 'Saving...';
            try {
                await this.apiRequest(`/admin/edsa/bookings/${booking.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        status: modal.querySelector('#edsa-edit-status').value,
                        preferred_date: modal.querySelector('#edsa-edit-date').value,
                        preferred_time: modal.querySelector('#edsa-edit-time').value,
                        admin_notes: modal.querySelector('#edsa-edit-notes').value,
                        notify_customer: modal.querySelector('#edsa-edit-notify').checked
                    })
                });
                this.showToast('EDSA booking updated', 'success');
                close();
                await this.loadEDSABookings();
            } catch (err) {
                this.showToast(err.message || 'Could not save booking', 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Save changes';
            }
        });
    }

    _getProductsFilterState(overrides = {}) {
        const searchInput = document.getElementById('productsSearchInput');
        const brandFilter = document.getElementById('productsBrandFilter');
        const categoryFilter = document.getElementById('productsCategoryFilter');
        const featuredFilter = document.getElementById('productsFeaturedFilter');

        const search = overrides.search != null
            ? String(overrides.search).trim()
            : (searchInput ? searchInput.value.trim() : '');
        const brandId = overrides.brandId != null
            ? String(overrides.brandId)
            : (brandFilter ? brandFilter.value : '');
        const categoryId = overrides.categoryId != null
            ? String(overrides.categoryId)
            : (categoryFilter ? categoryFilter.value : '');
        const featured = overrides.featured != null
            ? String(overrides.featured)
            : (featuredFilter ? featuredFilter.value : '');

        const hasSearch = search !== '';
        const hasBrandFilter = brandId !== '';
        const hasCategoryFilter = categoryId !== '';
        const hasFeaturedFilter = featured !== '';
        const hasServerFilters = hasSearch || hasBrandFilter || hasCategoryFilter;

        return {
            search,
            brandId,
            categoryId,
            featured,
            hasSearch,
            hasBrandFilter,
            hasCategoryFilter,
            hasFeaturedFilter,
            hasServerFilters,
            hasAnyFilter: hasSearch || hasBrandFilter || hasCategoryFilter || hasFeaturedFilter,
            needsBulkFetch: hasFeaturedFilter && !hasServerFilters
        };
    }

    _buildAdminProductsQuery(page, limit, filterState) {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        params.set('page', String(page));

        if (filterState.hasSearch) {
            params.set('search', filterState.search);
        }
        if (filterState.hasBrandFilter) {
            const brand = this.allBrands.find(b => b.id == filterState.brandId);
            if (brand && brand.slug) {
                params.set('brand', brand.slug);
            }
        }
        if (filterState.hasCategoryFilter) {
            const category = this.allCategories.find(c => c.id == filterState.categoryId);
            if (category && category.slug) {
                params.set('category', category.slug);
            }
        }

        return params.toString();
    }

    async loadProducts() {
        const requestId = ++this._productsLoadRequestId;
        this._loadingProducts = true;
        const container = document.getElementById('productsTable');

        // Preserve filter values before setupProductsSearch clones elements
        const searchInput = document.getElementById('productsSearchInput');
        const brandFilter = document.getElementById('productsBrandFilter');
        const categoryFilter = document.getElementById('productsCategoryFilter');
        const featuredFilter = document.getElementById('productsFeaturedFilter');
        const preservedSearchValue = searchInput ? searchInput.value : '';
        const preservedBrandValue = brandFilter ? brandFilter.value : '';
        const preservedCategoryValue = categoryFilter ? categoryFilter.value : '';
        const preservedFeaturedValue = featuredFilter ? featuredFilter.value : '';

        // Create loading indicator safely
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'loading';
        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        const loadingText = document.createTextNode('Loading products...');
        loadingDiv.appendChild(spinner);
        loadingDiv.appendChild(loadingText);

        if (container) {
            container.innerHTML = '';
            container.appendChild(loadingDiv);
        }

        // Don't make API call if not authenticated
        if (!this.authToken) {
            if (container) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view products.</p></div>';
            }
            this._loadingProducts = false;
            return;
        }

        try {
            const filterState = this._getProductsFilterState({
                search: preservedSearchValue,
                brandId: preservedBrandValue,
                categoryId: preservedCategoryValue,
                featured: preservedFeaturedValue
            });

            const page = this.productsPagination.currentPage;
            const limit = this.productsPagination.itemsPerPage;

            let response;
            if (filterState.needsBulkFetch) {
                // Featured-only filter: fetch a large batch for client-side filtering
                this.productsPagination.useServerPagination = false;
                this._serverProductsSearch = '';
                console.log('Featured filter active, fetching products for client-side filtering...');
                response = await this.apiRequest('/admin/products?limit=10000&page=1');
            } else if (filterState.hasServerFilters) {
                // Search / brand / category: use server-side filtering + pagination (scales to full catalog)
                this.productsPagination.useServerPagination = true;
                this._serverProductsSearch = filterState.hasSearch ? filterState.search : '';

                if ((filterState.hasBrandFilter && this.allBrands.length === 0) ||
                    (filterState.hasCategoryFilter && this.allCategories.length === 0)) {
                    await this.loadBrandsForFilters();
                    await this.loadCategoriesForFilters();
                }

                const query = this._buildAdminProductsQuery(page, limit, filterState);
                console.log('Server-side product filters:', { page, limit, query });
                response = await this.apiRequest(`/admin/products?${query}`);
            } else {
                this.productsPagination.useServerPagination = true;
                this._serverProductsSearch = '';
                console.log('No filters, using server-side pagination:', { page, limit });
                response = await this.apiRequest(`/admin/products?limit=${limit}&page=${page}`);
            }

            console.log('API Response received:', {
                hasResponse: !!response,
                hasProducts: !!(response && response.products),
                productsCount: response && response.products ? response.products.length : 0,
                hasPagination: !!(response && response.pagination)
            });

            // Handle null response (403 Forbidden)
            if (!response) {
                if (container) {
                    container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view products.</p></div>';
                }
                return;
            }

            if (requestId !== this._productsLoadRequestId) {
                return;
            }

            if (response.pagination) {
                this.productsPagination.totalPages = response.pagination.totalPages;
                this.productsPagination.totalProducts = response.pagination.totalProducts;
                if (this.productsPagination.useServerPagination) {
                    this.productsPagination.currentPage =
                        response.pagination.currentPage || this.productsPagination.currentPage;
                }
            }

            if (response.products && response.products.length > 0) {
                const requestedPage = this.productsPagination.currentPage;
                // Update pagination info if available
                if (response.pagination && !this.productsPagination.useServerPagination) {
                    this.productsPagination.currentPage = Math.min(
                        requestedPage,
                        Math.max(1, response.pagination.totalPages || 1)
                    );
                }

                // Store all products for search/filtering
                // Always replace with fresh products to ensure we have the latest data
                this.allProducts = response.products || [];

                console.log('âœ… Products stored in allProducts:', {
                    count: this.allProducts.length,
                    useServerPagination: this.productsPagination.useServerPagination,
                    totalProducts: this.productsPagination.totalProducts,
                    sampleNames: this.allProducts.slice(0, 3).map(p => p.name),
                    responseProductsCount: response.products ? response.products.length : 0,
                    hasPagination: !!response.pagination
                });

                // Log sample products to verify they have category_id and is_featured
                if (this.allProducts.length > 0) {
                    console.log('ðŸ“¦ Sample products after loading:', this.allProducts.slice(0, 5).map(p => ({
                        id: p.id,
                        name: p.name,
                        category_id: p.category_id,
                        category_name: p.category_name,
                        brand_id: p.brand_id,
                        brand_name: p.brand_name,
                        is_featured: p.is_featured,
                        is_featured_type: typeof p.is_featured,
                        is_featured_raw: p.is_featured,
                        allKeys: Object.keys(p)
                    })));

                    // Check specifically for featured products
                    const featuredProducts = this.allProducts.filter(p =>
                        p.is_featured === true ||
                        p.is_featured === 1 ||
                        p.is_featured === '1' ||
                        p.is_featured === 'true'
                    );
                    console.log('â­ Featured products found:', {
                        count: featuredProducts.length,
                        products: featuredProducts.map(p => ({
                            id: p.id,
                            name: p.name,
                            is_featured: p.is_featured,
                            is_featured_type: typeof p.is_featured
                        }))
                    });
                }

                // Setup search and filter functionality FIRST (before populating filters)
                // Only setup if not already set up to prevent losing focus
                const existingSearchInput = document.getElementById('productsSearchInput');
                if (!existingSearchInput || !existingSearchInput.hasAttribute('data-listeners-setup')) {
                    this.setupProductsSearch();
                }
                // Load brands and categories for filters (after setup, so cloned elements get populated)
                await this.loadBrandsForFilters();
                await this.loadCategoriesForFilters();

                // Restore preserved filter values after setup and population
                if (preservedSearchValue) {
                    const currentSearchInput = document.getElementById('productsSearchInput');
                    if (currentSearchInput && document.activeElement !== currentSearchInput) {
                        this._restoreProductsSearchInput(currentSearchInput, preservedSearchValue);
                        const clearBtn = document.getElementById('clearProductsSearch');
                        if (clearBtn) {
                            clearBtn.style.display = currentSearchInput.value ? 'block' : 'none';
                        }
                        if (document.activeElement !== currentSearchInput) {
                            setTimeout(() => {
                                this.renderFilteredProducts();
                            }, 150);
                        }
                    }
                }
                if (preservedBrandValue) {
                    const currentBrandFilter = document.getElementById('productsBrandFilter');
                    if (currentBrandFilter && this.allBrands.some(b => b.id == preservedBrandValue)) {
                        currentBrandFilter.value = preservedBrandValue;
                    }
                }
                if (preservedCategoryValue) {
                    const currentCategoryFilter = document.getElementById('productsCategoryFilter');
                    if (currentCategoryFilter && this.allCategories.some(c => c.id == preservedCategoryValue)) {
                        currentCategoryFilter.value = preservedCategoryValue;
                    }
                }
                if (preservedFeaturedValue) {
                    const currentFeaturedFilter = document.getElementById('productsFeaturedFilter');
                    if (currentFeaturedFilter) {
                        // Set data-suppress-change to prevent triggering change event during restoration
                        currentFeaturedFilter.setAttribute('data-suppress-change', 'true');
                        currentFeaturedFilter.value = preservedFeaturedValue;
                        // Remove the flag after a short delay to allow setupProductsSearch to complete
                        setTimeout(() => {
                            currentFeaturedFilter.removeAttribute('data-suppress-change');
                        }, 200);
                    }
                }

                // Setup pagination controls
                this.setupProductsPagination();
                // Render products immediately (will be filtered if search term or filters exist)
                // Use requestAnimationFrame to ensure DOM is ready, then render
                requestAnimationFrame(() => {
                    // Double-check products are still loaded before rendering
                    if (this.allProducts.length > 0) {
                        console.log('ðŸŽ¨ Rendering products via requestAnimationFrame, product count:', this.allProducts.length);
                        this.renderFilteredProductsImmediate();
                    } else {
                        // If products disappeared (shouldn't happen), try loading again
                        console.warn('âš ï¸ Products were loaded but allProducts is empty, reloading...');
                        setTimeout(() => this.loadProducts(), 200);
                    }
                });

                // Also add a fallback render after a short delay to ensure it happens
                setTimeout(() => {
                    const container = document.getElementById('productsTable');
                    // Only render if container is still showing loading or is empty
                    if (container && (container.querySelector('.loading') || container.innerHTML.trim() === '')) {
                        if (this.allProducts.length > 0) {
                            console.log('ðŸ”„ Fallback render triggered, product count:', this.allProducts.length);
                            this.renderFilteredProductsImmediate();
                        }
                    }
                }, 500);
            } else {
                this.allProducts = [];
                // Setup search and filter functionality FIRST
                const existingSearchInput = document.getElementById('productsSearchInput');
                if (!existingSearchInput || !existingSearchInput.hasAttribute('data-listeners-setup')) {
                    this.setupProductsSearch();
                }
                await this.loadBrandsForFilters();
                await this.loadCategoriesForFilters();

                if (preservedSearchValue) {
                    const currentSearchInput = document.getElementById('productsSearchInput');
                    if (currentSearchInput && document.activeElement !== currentSearchInput) {
                        this._restoreProductsSearchInput(currentSearchInput, preservedSearchValue);
                    }
                }
                if (preservedBrandValue) {
                    const currentBrandFilter = document.getElementById('productsBrandFilter');
                    if (currentBrandFilter && this.allBrands.some(b => b.id == preservedBrandValue)) {
                        currentBrandFilter.value = preservedBrandValue;
                    }
                }
                if (preservedCategoryValue) {
                    const currentCategoryFilter = document.getElementById('productsCategoryFilter');
                    if (currentCategoryFilter && this.allCategories.some(c => c.id == preservedCategoryValue)) {
                        currentCategoryFilter.value = preservedCategoryValue;
                    }
                }
                if (preservedFeaturedValue) {
                    const currentFeaturedFilter = document.getElementById('productsFeaturedFilter');
                    if (currentFeaturedFilter) {
                        currentFeaturedFilter.setAttribute('data-suppress-change', 'true');
                        currentFeaturedFilter.value = preservedFeaturedValue;
                        setTimeout(() => {
                            currentFeaturedFilter.removeAttribute('data-suppress-change');
                        }, 200);
                    }
                }

                this.setupProductsPagination();
                if (filterState.hasAnyFilter) {
                    this.renderFilteredProductsImmediate();
                } else if (container) {
                    const emptyDiv = document.createElement('div');
                    emptyDiv.style.textAlign = 'center';
                    emptyDiv.style.padding = '2rem';
                    emptyDiv.style.color = 'var(--gray-500)';

                    const icon = document.createElement('i');
                    icon.className = 'fas fa-box-open';
                    icon.style.fontSize = '3rem';
                    icon.style.marginBottom = '1rem';

                    const message = document.createElement('p');
                    message.textContent = 'No products found. Import products from a CSV backup or add products manually.';

                    emptyDiv.appendChild(icon);
                    emptyDiv.appendChild(message);
                    container.innerHTML = '';
                    container.appendChild(emptyDiv);
                }
            }
        } catch (error) {
            console.error('âŒ Error loading products:', error);
            // Create error message safely
            const errorDiv = document.createElement('div');
            errorDiv.style.textAlign = 'center';
            errorDiv.style.padding = '2rem';
            errorDiv.style.color = 'var(--error)';

            const errorIcon = document.createElement('i');
            errorIcon.className = 'fas fa-exclamation-triangle';
            errorIcon.style.fontSize = '3rem';
            errorIcon.style.marginBottom = '1rem';

            const errorMessage = document.createElement('p');
            errorMessage.textContent = `Failed to load products: ${error.message}`;

            errorDiv.appendChild(errorIcon);
            errorDiv.appendChild(errorMessage);

            if (container) {
                container.innerHTML = '';
                container.appendChild(errorDiv);
            }
        } finally {
            if (requestId === this._productsLoadRequestId) {
                this._loadingProducts = false;
            }
        }
    }

    async loadBrandsForFilters() {
        try {
            if (!this.authToken) return;
            const response = await this.apiRequest('/admin/brands');
            if (response && Array.isArray(response)) {
                this.allBrands = response;
                this.populateBrandFilter();
            }
        } catch (error) {
            console.warn('Failed to load brands for filter:', error);
            this.allBrands = [];
        }
    }

    async loadCategoriesForFilters() {
        try {
            if (!this.authToken) {
                console.warn('âš ï¸ Cannot load categories: not authenticated');
                return;
            }

            console.log('ðŸ“¥ Loading categories for filter...');
            const response = await this.apiRequest('/admin/categories');

            console.log('ðŸ“¦ Categories API response:', {
                response: response,
                isArray: Array.isArray(response),
                length: response ? response.length : 0
            });

            if (response && Array.isArray(response)) {
                this.allCategories = response;
                console.log('âœ… Loaded categories:', this.allCategories.length);
                this.populateCategoryFilter();
            } else {
                console.warn('âš ï¸ Categories response is not an array:', response);
                this.allCategories = [];
            }
        } catch (error) {
            console.error('âŒ Failed to load categories for filter:', error);
            this.allCategories = [];
        }
    }

    populateBrandFilter() {
        const brandFilter = document.getElementById('productsBrandFilter');
        if (!brandFilter) return;

        // Save the currently selected value
        const currentValue = brandFilter.value;

        // Set a flag to prevent change event from triggering filter
        brandFilter.setAttribute('data-suppress-change', 'true');

        // Clear existing options except "All Brands"
        brandFilter.innerHTML = '<option value="">All Brands</option>';

        // Add brand options
        this.allBrands.forEach(brand => {
            const option = document.createElement('option');
            option.value = brand.id;
            option.textContent = brand.name || `Brand ${brand.id}`;
            brandFilter.appendChild(option);
        });

        // Restore the selected value if it still exists (this won't trigger change event)
        if (currentValue && this.allBrands.some(b => b.id == currentValue)) {
            brandFilter.value = currentValue;
        }

        // Remove the flag after a short delay to allow value to be set
        setTimeout(() => {
            brandFilter.removeAttribute('data-suppress-change');
        }, 0);
    }

    populateCategoryFilter() {
        const categoryFilter = document.getElementById('productsCategoryFilter');
        if (!categoryFilter) {
            console.warn('âš ï¸ Category filter dropdown not found');
            return;
        }

        console.log('ðŸ”„ Populating category filter:', {
            categoriesCount: this.allCategories.length,
            categories: this.allCategories
        });

        // Save the currently selected value
        const currentValue = categoryFilter.value;

        // Clear existing options except "All Categories"
        categoryFilter.innerHTML = '<option value="">All Categories</option>';

        // Add category options
        if (this.allCategories && this.allCategories.length > 0) {
            this.allCategories.forEach(category => {
                const option = document.createElement('option');
                option.value = category.id;
                option.textContent = category.name || `Category ${category.id}`;
                categoryFilter.appendChild(option);
            });
            console.log('âœ… Added', this.allCategories.length, 'categories to filter dropdown');
        } else {
            console.warn('âš ï¸ No categories to add to filter dropdown');
        }

        // Restore the selected value if it still exists
        if (currentValue && this.allCategories.some(c => c.id == currentValue)) {
            categoryFilter.value = currentValue;
            console.log('âœ… Restored selected category:', currentValue);
        }
    }

    _restoreProductsSearchInput(input, preserved) {
        if (!input || preserved == null) return;
        if (typeof window.hmSafeRestoreSearchValue === 'function') {
            window.hmSafeRestoreSearchValue(input, preserved);
            return;
        }
        if (document.activeElement === input) return;
        if (input.value !== preserved) {
            input.value = preserved;
        }
    }

    _handleProductsSearchInput(input) {
        const searchInput = input || document.getElementById('productsSearchInput');
        if (!searchInput) return;

        this.productsPagination.currentPage = 1;
        const loadToken = ++this._productsSearchLoadToken;
        searchInput.setAttribute('data-listeners-setup', 'true');

        this.loadProducts().then(() => {
            if (loadToken !== this._productsSearchLoadToken) return;
            this.renderFilteredProducts();
        });
    }

    setupProductsSearch() {
        const searchInput = document.getElementById('productsSearchInput');
        const clearBtn = document.getElementById('clearProductsSearch');
        const clearFiltersBtn = document.getElementById('clearProductsFilters');
        const brandFilter = document.getElementById('productsBrandFilter');
        const categoryFilter = document.getElementById('productsCategoryFilter');
        const featuredFilter = document.getElementById('productsFeaturedFilter');
        const container = document.getElementById('productsTable');

        if (!searchInput || !container) return;

        if (searchInput.hasAttribute('data-listeners-setup')) {
            return;
        }

        searchInput.setAttribute('data-listeners-setup', 'true');

        if (!this._productsSearchDebounceTimer) {
            this._productsSearchDebounceTimer = null;
        }
        if (!this._productsSearchLoadToken) {
            this._productsSearchLoadToken = 0;
        }

        const onProductsSearch = () => {
            const input = document.getElementById('productsSearchInput');
            if (!input) return;
            const searchTerm = input.value.trim();
            if (clearBtn) {
                clearBtn.style.display = searchTerm ? 'block' : 'none';
            }
            this.updateClearFiltersButton();
            this._handleProductsSearchInput(input);
        };

        if (typeof window.hmBindSearchInput === 'function') {
            window.hmBindSearchInput(searchInput, {
                debounceMs: 350,
                clearButton: clearBtn,
                onClear: () => {
                    this.updateClearFiltersButton();
                    this.productsPagination.currentPage = 1;
                    this.loadProducts().then(() => this.renderFilteredProducts());
                },
                onSearch: () => onProductsSearch()
            });
        } else {
            searchInput.addEventListener('input', () => {
                clearTimeout(this._productsSearchDebounceTimer);
                this._productsSearchDebounceTimer = setTimeout(onProductsSearch, 350);
            });
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    searchInput.value = '';
                    clearBtn.style.display = 'none';
                    this.updateClearFiltersButton();
                    this.productsPagination.currentPage = 1;
                    this.loadProducts().then(() => this.renderFilteredProducts());
                });
            }
        }

        // Setup brand filter listener - clone to remove old listeners
        if (brandFilter) {
            // Preserve the selected value before cloning
            const preservedValue = brandFilter.value;
            const newBrandFilter = brandFilter.cloneNode(true);
            brandFilter.parentNode.replaceChild(newBrandFilter, brandFilter);

            // Restore the preserved value after cloning (if it exists)
            if (preservedValue) {
                newBrandFilter.value = preservedValue;
            }

            newBrandFilter.addEventListener('change', () => {
                if (newBrandFilter.getAttribute('data-suppress-change') === 'true') {
                    return;
                }

                this.updateClearFiltersButton();
                this.productsPagination.currentPage = 1;
                this.loadProducts().then(() => this.renderFilteredProducts());
            });
        }

        // Setup category filter listener - clone to remove old listeners
        if (categoryFilter) {
            const newCategoryFilter = categoryFilter.cloneNode(true);
            categoryFilter.parentNode.replaceChild(newCategoryFilter, categoryFilter);
            newCategoryFilter.addEventListener('change', () => {
                this.updateClearFiltersButton();
                this.productsPagination.currentPage = 1;
                this.loadProducts().then(() => this.renderFilteredProducts());
            });
        }

        // Setup featured filter listener - clone to remove old listeners
        if (featuredFilter) {
            // Preserve the selected value before cloning
            const preservedValue = featuredFilter.value;
            const newFeaturedFilter = featuredFilter.cloneNode(true);
            featuredFilter.parentNode.replaceChild(newFeaturedFilter, featuredFilter);

            // Restore the preserved value after cloning (if it exists)
            if (preservedValue) {
                // Set data-suppress-change to prevent triggering change event during restoration
                newFeaturedFilter.setAttribute('data-suppress-change', 'true');
                newFeaturedFilter.value = preservedValue;
                // Remove the flag after a short delay
                setTimeout(() => {
                    newFeaturedFilter.removeAttribute('data-suppress-change');
                }, 100);
            }

            newFeaturedFilter.addEventListener('change', () => {
                if (newFeaturedFilter.getAttribute('data-suppress-change') === 'true') {
                    return;
                }

                this.updateClearFiltersButton();
                this.productsPagination.currentPage = 1;

                const featuredValue = newFeaturedFilter.value;
                if (featuredValue) {
                    sessionStorage.setItem('adminFeaturedFilter', featuredValue);
                } else {
                    sessionStorage.removeItem('adminFeaturedFilter');
                }

                this.loadProducts().then(() => {
                    const currentFeaturedFilter = document.getElementById('productsFeaturedFilter');
                    const storedFeaturedValue = sessionStorage.getItem('adminFeaturedFilter') || featuredValue;
                    if (currentFeaturedFilter && storedFeaturedValue) {
                        currentFeaturedFilter.setAttribute('data-suppress-change', 'true');
                        currentFeaturedFilter.value = storedFeaturedValue;
                        setTimeout(() => {
                            currentFeaturedFilter.removeAttribute('data-suppress-change');
                            this.renderFilteredProducts();
                        }, 100);
                    } else {
                        this.renderFilteredProducts();
                    }
                }).catch((error) => {
                    console.error('Error loading products:', error);
                    this.renderFilteredProducts();
                });
            });
        }

        // Setup clear all filters button
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => {
                const currentSearchInput = document.getElementById('productsSearchInput');
                if (currentSearchInput) currentSearchInput.value = '';
                if (clearBtn) clearBtn.style.display = 'none';
                // Get current elements by ID (in case they were cloned)
                const currentBrandFilter = document.getElementById('productsBrandFilter');
                const currentCategoryFilter = document.getElementById('productsCategoryFilter');
                const currentFeaturedFilter = document.getElementById('productsFeaturedFilter');
                if (currentBrandFilter) currentBrandFilter.value = '';
                if (currentCategoryFilter) currentCategoryFilter.value = '';
                if (currentFeaturedFilter) currentFeaturedFilter.value = '';
                // Clear from sessionStorage as well
                sessionStorage.removeItem('adminFeaturedFilter');
                this.updateClearFiltersButton();
                // Switch back to server-side pagination when filters cleared
                this.productsPagination.useServerPagination = true;
                this.productsPagination.currentPage = 1;
                this.loadProducts();
            });
        }
    }

    setupProductsPagination() {
        const perPageSelect = document.getElementById('productsPerPage');

        // Setup per-page dropdown
        if (perPageSelect) {
            perPageSelect.addEventListener('change', (e) => {
                this.productsPagination.itemsPerPage = parseInt(e.target.value, 10);
                this.productsPagination.currentPage = 1;
                this.loadProducts();
            });
        }

        // Render pagination controls
        this.renderProductsPagination();
        this.setupProductsBulkActions();
    }

    renderProductsPagination() {
        const paginationContainer = document.getElementById('productsPagination');
        if (!paginationContainer) return;

        const pagination = this.productsPagination;
        const totalPages = pagination.totalPages || 1;
        const currentPage = pagination.currentPage || 1;
        const totalProducts = pagination.totalProducts || 0;

        if (totalPages <= 1 && !pagination.useServerPagination) {
            // For client-side filtering, calculate pages from filtered products
            const filteredCount = this.getFilteredProductsCount();
            const itemsPerPage = pagination.itemsPerPage;
            const clientTotalPages = Math.ceil(filteredCount / itemsPerPage);

            if (clientTotalPages <= 1) {
                paginationContainer.innerHTML = '';
                return;
            }
        }

        let html = '<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--gray-200);">';

        // Left side: Page info
        const startItem = ((currentPage - 1) * pagination.itemsPerPage) + 1;
        const endItem = Math.min(currentPage * pagination.itemsPerPage, totalProducts);
        html += `<div style="color: var(--gray-600); font-size: 0.875rem;">`;
        html += `Showing ${startItem}-${endItem} of ${totalProducts} products`;
        html += `</div>`;

        // Right side: Pagination controls
        html += '<div style="display: flex; gap: 0.5rem; align-items: center;">';

        // Previous button
        html += `<button class="btn btn-sm btn-secondary" ${currentPage <= 1 ? 'disabled' : ''} onclick="window.adminApp.goToProductsPage(${currentPage - 1})" style="min-width: auto;">`;
        html += '<i class="fas fa-chevron-left"></i>';
        html += '</button>';

        // Page numbers
        const maxPagesToShow = 7;
        let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
        let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

        if (endPage - startPage < maxPagesToShow - 1) {
            startPage = Math.max(1, endPage - maxPagesToShow + 1);
        }

        if (startPage > 1) {
            html += `<button class="btn btn-sm btn-secondary" onclick="window.adminApp.goToProductsPage(1)" style="min-width: auto;">1</button>`;
            if (startPage > 2) {
                html += '<span style="padding: 0 0.5rem; color: var(--gray-400);">...</span>';
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            html += `<button class="btn btn-sm ${i === currentPage ? 'btn-primary' : 'btn-secondary'}" onclick="window.adminApp.goToProductsPage(${i})" style="min-width: auto;">${i}</button>`;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                html += '<span style="padding: 0 0.5rem; color: var(--gray-400);">...</span>';
            }
            html += `<button class="btn btn-sm btn-secondary" onclick="window.adminApp.goToProductsPage(${totalPages})" style="min-width: auto;">${totalPages}</button>`;
        }

        // Next button
        html += `<button class="btn btn-sm btn-secondary" ${currentPage >= totalPages ? 'disabled' : ''} onclick="window.adminApp.goToProductsPage(${currentPage + 1})" style="min-width: auto;">`;
        html += '<i class="fas fa-chevron-right"></i>';
        html += '</button>';

        html += '</div>';
        html += '</div>';

        paginationContainer.innerHTML = html;
    }

    goToProductsPage(page) {
        if (page < 1 || page > this.productsPagination.totalPages) return;
        this.productsPagination.currentPage = page;
        if (this.productsPagination.useServerPagination) {
            // Server pagination: fetch the requested page from the API.
            this.loadProducts().then(() => {
                this.renderProductsPagination();
            });
        } else {
            // Client-side filtering: all matching products are already loaded, so just
            // re-render the requested slice. Reloading here would refetch with a huge
            // limit and clamp the page back to 1.
            this.renderFilteredProductsImmediate();
            this.renderProductsPagination();
        }
        const paginationContainer = document.getElementById('productsPagination');
        if (paginationContainer) {
            paginationContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    getFilteredProductsCount() {
        if (this.productsPagination.useServerPagination) {
            return this.productsPagination.totalProducts || this.allProducts.length;
        }

        const filterState = this._getProductsFilterState();
        const filtered = this.filterProducts(
            filterState.search,
            filterState.brandId,
            filterState.categoryId,
            filterState.featured
        );
        return filtered.length;
    }

    updateClearFiltersButton() {
        const clearFiltersBtn = document.getElementById('clearProductsFilters');
        const searchInput = document.getElementById('productsSearchInput');
        const brandFilter = document.getElementById('productsBrandFilter');
        const categoryFilter = document.getElementById('productsCategoryFilter');
        const featuredFilter = document.getElementById('productsFeaturedFilter');

        if (!clearFiltersBtn) return;

        const hasSearch = searchInput && searchInput.value.trim() !== '';
        const hasBrandFilter = brandFilter && brandFilter.value !== '';
        const hasCategoryFilter = categoryFilter && categoryFilter.value !== '';
        const hasFeaturedFilter = featuredFilter && featuredFilter.value !== '';

        clearFiltersBtn.style.display = (hasSearch || hasBrandFilter || hasCategoryFilter || hasFeaturedFilter) ? 'block' : 'none';
    }

    filterProducts(searchTerm, brandId, categoryId, featuredStatus) {
        // Ensure featuredStatus is always a string, never undefined
        featuredStatus = featuredStatus || '';

        // Ensure searchTerm is a string
        searchTerm = searchTerm || '';

        console.log('ðŸ” filterProducts() called with:', {
            searchTerm: searchTerm,
            searchTermType: typeof searchTerm,
            brandId: brandId,
            categoryId: categoryId,
            featuredStatus: featuredStatus,
            totalProducts: this.allProducts.length
        });

        let filtered = this.allProducts;

        // IMPORTANT: Filter by search term FIRST, before other filters
        // This ensures we search the full dataset, not a pre-filtered subset
        if (searchTerm && searchTerm.trim()) {
            const searchTerms = searchTerm.toLowerCase().trim().split(/\s+/).filter(word => word.length > 0);

            console.log('ðŸ” Filtering by search term (FIRST):', {
                searchTerm: searchTerm,
                searchTerms: searchTerms,
                totalProductsBeforeFilter: filtered.length
            });

            if (searchTerms.length > 0) {
                filtered = filtered.filter(product => {
                    const name = (product.name || '').toLowerCase();
                    const sku = (product.sku || '').toLowerCase();
                    const brand = (product.brand_name || '').toLowerCase();
                    const category = (product.category_name || '').toLowerCase();

                    // Combine all searchable fields
                    const searchableText = `${name} ${sku} ${brand} ${category}`;

                    // Check if ALL search terms are found (AND logic)
                    // This means "buried treasure" will match products containing both "buried" AND "treasure"
                    const matches = searchTerms.every(term => searchableText.includes(term));
                    return matches;
                });

                console.log('âœ… After search filter (FIRST):', {
                    filteredCount: filtered.length,
                    sampleProducts: filtered.slice(0, 5).map(p => p.name)
                });
            }
        }

        // Filter by brand - use brand_id if available, otherwise fall back to brand_name matching
        if (brandId) {
            const selectedBrandId = parseInt(brandId, 10);

            console.log('ðŸ” Filtering by brand:', {
                brandId: brandId,
                selectedBrandId: selectedBrandId,
                totalProductsBeforeFilter: filtered.length,
                allBrandsCount: this.allBrands.length,
                selectedBrand: this.allBrands.find(b => b.id == brandId)
            });

            filtered = filtered.filter(product => {
                // First try to match by brand_id (most reliable)
                if (product.brand_id !== null && product.brand_id !== undefined) {
                    // Use loose equality to handle type mismatches (string vs number)
                    return product.brand_id == selectedBrandId;
                }

                // Fall back to brand_name matching if brand_id is not available
                const selectedBrand = this.allBrands.find(b => b.id == brandId);
                if (selectedBrand) {
                    const brandName = (selectedBrand.name || '').trim();
                    const productBrandName = (product.brand_name || '').trim();

                    if (!productBrandName) return false;

                    // Normalize for comparison: lowercase and normalize whitespace
                    const normalizedBrandName = brandName.toLowerCase().replace(/\s+/g, ' ').trim();
                    const normalizedProductBrand = productBrandName.toLowerCase().replace(/\s+/g, ' ').trim();

                    // Use exact match first (most reliable)
                    if (normalizedProductBrand === normalizedBrandName) {
                        return true;
                    }

                    // Also check if product brand starts with selected brand (for cases like "Skinny Magic" vs "Skinny Magic Plus")
                    if (normalizedProductBrand.startsWith(normalizedBrandName + ' ') ||
                        normalizedBrandName.startsWith(normalizedProductBrand + ' ')) {
                        return true;
                    }
                }

                return false;
            });

            console.log('âœ… After brand filter:', {
                filteredCount: filtered.length,
                sampleProducts: filtered.slice(0, 5).map(p => ({
                    id: p.id,
                    name: p.name,
                    brand_id: p.brand_id,
                    brand_name: p.brand_name
                }))
            });
        }

        // Filter by category - use category_id if available, otherwise fall back to category_name matching
        if (categoryId) {
            const selectedCategoryId = parseInt(categoryId, 10);
            const selectedCategory = this.allCategories.find(c => c.id == categoryId);

            console.log('ðŸ” Filtering by category:', {
                categoryId: categoryId,
                selectedCategoryId: selectedCategoryId,
                totalProductsBeforeFilter: filtered.length,
                allCategoriesCount: this.allCategories.length,
                selectedCategory: selectedCategory,
                selectedCategoryName: selectedCategory ? selectedCategory.name : 'NOT FOUND'
            });

            // Log sample products before filtering to see their category data
            const sampleProducts = filtered.slice(0, 10).map(p => ({
                id: p.id,
                name: p.name,
                category_id: p.category_id,
                category_id_type: typeof p.category_id,
                category_name: p.category_name
            }));
            console.log('ðŸ“¦ Sample products before category filter:', sampleProducts);

            // Also log what we're trying to match
            console.log('ðŸŽ¯ Trying to match category:', {
                selectedCategoryId: selectedCategoryId,
                selectedCategoryIdType: typeof selectedCategoryId,
                selectedCategoryName: selectedCategory ? selectedCategory.name : 'NOT FOUND',
                selectedCategoryIdFromDropdown: categoryId,
                selectedCategoryIdFromDropdownType: typeof categoryId
            });

            // Check if any products have the matching category_id
            const productsWithMatchingId = filtered.filter(p => p.category_id == selectedCategoryId);
            console.log('ðŸ” Products with matching category_id:', {
                count: productsWithMatchingId.length,
                sample: productsWithMatchingId.slice(0, 5).map(p => ({
                    id: p.id,
                    name: p.name,
                    category_id: p.category_id,
                    category_name: p.category_name
                }))
            });

            // Check category_id distribution (including null/undefined)
            const categoryIdDistribution = {};
            let nullCategoryCount = 0;
            filtered.slice(0, 50).forEach(p => {
                const cid = p.category_id;
                if (cid === null || cid === undefined) {
                    nullCategoryCount++;
                } else {
                    categoryIdDistribution[cid] = (categoryIdDistribution[cid] || 0) + 1;
                }
            });
            if (nullCategoryCount > 0) {
                categoryIdDistribution['null/undefined'] = nullCategoryCount;
            }
            console.log('ðŸ“Š Category ID distribution (first 50 products):', categoryIdDistribution);

            // Show what categories these IDs correspond to
            const categoryIdNames = {};
            Object.keys(categoryIdDistribution).forEach(cid => {
                const cat = this.allCategories.find(c => c.id == cid);
                categoryIdNames[cid] = cat ? cat.name : `Unknown (ID: ${cid})`;
            });
            console.log('ðŸ“‹ Category names for product category_ids:', categoryIdNames);

            // Show all available categories in dropdown
            console.log('ðŸ“‹ All available categories in dropdown:', this.allCategories.map(c => ({
                id: c.id,
                name: c.name
            })));

            let matchedByCategoryId = 0;
            let matchedByCategoryName = 0;
            let noMatch = 0;

            filtered = filtered.filter(product => {
                // First try to match by category_id (most reliable)
                if (product.category_id !== null && product.category_id !== undefined) {
                    // Use loose equality to handle type mismatches (string vs number)
                    const matches = product.category_id == selectedCategoryId;
                    if (matches) {
                        matchedByCategoryId++;
                        return true;
                    }
                }

                // Fall back to category_name matching if category_id is not available or didn't match
                if (selectedCategory) {
                    const categoryName = (selectedCategory.name || '').trim();
                    const productCategoryName = (product.category_name || '').trim();

                    if (productCategoryName) {
                        // Normalize for comparison: lowercase and normalize whitespace
                        const normalizedCategoryName = categoryName.toLowerCase().replace(/\s+/g, ' ').trim();
                        const normalizedProductCategory = productCategoryName.toLowerCase().replace(/\s+/g, ' ').trim();

                        // Use exact match first (most reliable)
                        if (normalizedProductCategory === normalizedCategoryName) {
                            matchedByCategoryName++;
                            return true;
                        }

                        // Also check if product category starts with selected category
                        if (normalizedProductCategory.startsWith(normalizedCategoryName + ' ') ||
                            normalizedCategoryName.startsWith(normalizedProductCategory + ' ')) {
                            matchedByCategoryName++;
                            return true;
                        }
                    }
                }

                noMatch++;
                return false;
            });

            // Get full category distribution for all products (not just first 50)
            const fullCategoryDistribution = {};
            let fullNullCount = 0;
            filtered.forEach(p => {
                const cid = p.category_id;
                if (cid === null || cid === undefined) {
                    fullNullCount++;
                } else {
                    fullCategoryDistribution[cid] = (fullCategoryDistribution[cid] || 0) + 1;
                }
            });
            if (fullNullCount > 0) {
                fullCategoryDistribution['null/undefined'] = fullNullCount;
            }

            console.log('âœ… After category filter:', {
                filteredCount: filtered.length,
                matchedByCategoryId: matchedByCategoryId,
                matchedByCategoryName: matchedByCategoryName,
                noMatch: noMatch,
                fullCategoryDistribution: fullCategoryDistribution,
                tryingToMatchCategoryId: selectedCategoryId,
                tryingToMatchCategoryName: selectedCategory ? selectedCategory.name : 'NOT FOUND',
                sampleProducts: filtered.slice(0, 5).map(p => ({
                    id: p.id,
                    name: p.name,
                    category_id: p.category_id,
                    category_name: p.category_name
                }))
            });

            // If no matches, show helpful message
            if (filtered.length === 0 && noMatch > 0) {
                console.warn('âš ï¸ No products match this category filter!', {
                    reason: 'Products have different category_id values',
                    selectedCategoryId: selectedCategoryId,
                    selectedCategoryName: selectedCategory ? selectedCategory.name : 'NOT FOUND',
                    productCategoryIds: Object.keys(fullCategoryDistribution),
                    suggestion: 'Products may need to be assigned to this category, or you may need to select a different category'
                });
            }
        }

        // Filter by featured status
        // Ensure featuredStatus is always a string, never undefined
        const featuredStatusStr = featuredStatus || '';

        // Debug: Log if featuredStatus was undefined
        if (featuredStatus === undefined) {
            console.warn('âš ï¸ filterProducts() called with undefined featuredStatus!', {
                searchTerm,
                brandId,
                categoryId,
                stackTrace: new Error().stack
            });
        }

        if (featuredStatusStr !== '') {
            const isFeatured = featuredStatusStr === 'true';

            console.log('ðŸ” Filtering by featured status:', {
                featuredStatus: featuredStatusStr,
                isFeatured: isFeatured,
                totalProductsBeforeFilter: filtered.length,
                sampleProducts: filtered.slice(0, 5).map(p => ({
                    id: p.id,
                    name: p.name,
                    is_featured: p.is_featured,
                    is_featured_type: typeof p.is_featured,
                    is_featured_raw: p.is_featured
                }))
            });

            filtered = filtered.filter(product => {
                // Handle both boolean and numeric values (1/0 from database)
                // Also handle null/undefined as false
                const productIsFeatured = product.is_featured === true ||
                    product.is_featured === 1 ||
                    product.is_featured === '1' ||
                    product.is_featured === 'true';
                return productIsFeatured === isFeatured;
            });

            console.log('âœ… After featured filter:', {
                filteredCount: filtered.length,
                sampleFilteredProducts: filtered.slice(0, 5).map(p => ({
                    id: p.id,
                    name: p.name,
                    is_featured: p.is_featured,
                    is_featured_type: typeof p.is_featured
                }))
            });
        }

        // Search filter has already been applied at the beginning, so we skip it here
        // This prevents double-filtering by search

        return filtered;
    }

    renderFilteredProducts() {
        // Debounce to prevent multiple rapid calls
        if (this._renderFilteredProductsTimeout) {
            clearTimeout(this._renderFilteredProductsTimeout);
        }

        this._renderFilteredProductsTimeout = setTimeout(() => {
            this._renderFilteredProductsImpl();
        }, 50);
    }

    // Force immediate render (bypasses debounce) - used when we know data is ready
    renderFilteredProductsImmediate() {
        if (this._renderFilteredProductsTimeout) {
            clearTimeout(this._renderFilteredProductsTimeout);
            this._renderFilteredProductsTimeout = null;
        }
        this._renderFilteredProductsImpl();
    }

    _renderFilteredProductsImpl() {
        const container = document.getElementById('productsTable');
        if (!container) {
            console.error('âŒ Products table container not found!');
            return;
        }

        const searchInput = document.getElementById('productsSearchInput');
        const brandFilter = document.getElementById('productsBrandFilter');
        const categoryFilter = document.getElementById('productsCategoryFilter');
        const featuredFilter = document.getElementById('productsFeaturedFilter');

        const searchTerm = searchInput ? searchInput.value.trim() : '';
        const brandId = brandFilter ? brandFilter.value : '';
        const categoryId = categoryFilter ? categoryFilter.value : '';

        console.log('ðŸŽ¨ _renderFilteredProductsImpl - reading filter values:', {
            searchTerm: searchTerm,
            searchTermLength: searchTerm ? searchTerm.length : 0,
            searchInputExists: !!searchInput,
            searchInputValue: searchInput ? searchInput.value : 'NO INPUT',
            brandId: brandId,
            categoryId: categoryId
        });

        // Featured filter: read DOM only during render (sessionStorage restore happens in loadProducts).
        let featuredStatus = featuredFilter ? (featuredFilter.value || '') : '';
        if (!featuredFilter) {
            const tempFilter = document.getElementById('productsFeaturedFilter');
            if (tempFilter) featuredStatus = tempFilter.value || '';
        }

        // Ensure featuredStatus is always a string, never undefined
        featuredStatus = featuredStatus || '';

        console.log('ðŸŽ¨ Rendering filtered products:', {
            searchTerm: searchTerm,
            brandId: brandId,
            categoryId: categoryId,
            featuredStatus: featuredStatus,
            featuredStatusType: typeof featuredStatus,
            featuredFilterExists: !!featuredFilter,
            featuredFilterValue: featuredFilter ? featuredFilter.value : 'NOT FOUND',
            sessionStorageValue: sessionStorage.getItem('adminFeaturedFilter'),
            totalProducts: this.allProducts.length,
            categoriesLoaded: this.allCategories.length,
            useServerPagination: this.productsPagination.useServerPagination,
            containerExists: !!container
        });

        // If no products are loaded and no filters are active, products may still be loading
        if (this.allProducts.length === 0 && !searchTerm && !brandId && !categoryId && !featuredStatus) {
            console.log('â³ Products not loaded yet, showing loading state...');
            container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading products...</div>';
            // Try to load products if they haven't been loaded yet
            // Use a longer delay to avoid race conditions
            setTimeout(() => {
                if (this.allProducts.length === 0) {
                    console.log('ðŸ”„ Retrying product load...');
                    this.loadProducts();
                } else {
                    // Products loaded in the meantime, render them
                    console.log('âœ… Products loaded, rendering...');
                    this._renderFilteredProductsImpl();
                }
            }, 300);
            return;
        }

        // Ensure categories are loaded if category filter is active
        if (categoryId && this.allCategories.length === 0) {
            console.warn('âš ï¸ Category filter active but categories not loaded yet. Loading...');
            this.loadCategoriesForFilters().then(() => {
                // Retry filtering after categories are loaded
                this.renderFilteredProducts();
            });
            return;
        }

        // Filter changes trigger loadProducts(); do not refetch during render (resets page to 1).
        let filteredProducts;

        if (this.productsPagination.useServerPagination) {
            filteredProducts = this.allProducts;
            if (featuredStatus) {
                filteredProducts = this.filterProducts('', '', '', featuredStatus);
            }
        } else {
            filteredProducts = this.filterProducts(searchTerm, brandId, categoryId, featuredStatus);
        }

        // Apply client-side pagination if not using server pagination
        if (!this.productsPagination.useServerPagination && filteredProducts.length > 0) {
            const page = this.productsPagination.currentPage;
            const itemsPerPage = this.productsPagination.itemsPerPage;
            const startIndex = (page - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;

            // Update pagination info for client-side
            this.productsPagination.totalProducts = filteredProducts.length;
            this.productsPagination.totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

            filteredProducts = filteredProducts.slice(startIndex, endIndex);
        }

        if (filteredProducts.length === 0) {
            const hasFilters = searchTerm || brandId || categoryId || featuredStatus;
            if (hasFilters) {
                let filterText = [];
                if (searchTerm) filterText.push(`search "${this.escapeHtml(searchTerm)}"`);
                if (brandId) {
                    const brand = this.allBrands.find(b => b.id == brandId);
                    filterText.push(`brand "${this.escapeHtml(brand ? brand.name : 'Unknown')}"`);
                }
                if (categoryId) {
                    const category = this.allCategories.find(c => c.id == categoryId);
                    filterText.push(`category "${this.escapeHtml(category ? category.name : 'Unknown')}"`);
                }
                if (featuredStatus) {
                    filterText.push(`featured: ${featuredStatus === 'true' ? 'Yes' : 'No'}`);
                }
                container.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--gray-500);">
                        <i class="fas fa-search" style="font-size: 3rem; margin-bottom: 1rem; color: var(--gray-400);"></i>
                        <p>No products found matching ${filterText.join(' and ')}</p>
                        <p style="font-size: 0.875rem; margin-top: 0.5rem;">Try adjusting your filters or search terms</p>
                    </div>
                `;
            } else {
                container.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--gray-500);">
                        <i class="fas fa-box-open" style="font-size: 3rem; margin-bottom: 1rem; color: var(--gray-400);"></i>
                        <p>No products found. Import products from a CSV backup or add products manually.</p>
                    </div>
                `;
            }
        } else {
            // Ensure we have products to render
            if (filteredProducts.length === 0 && this.allProducts.length > 0) {
                // This shouldn't happen, but if it does, use allProducts
                console.warn('âš ï¸ Filtered products empty but allProducts has data, using allProducts');
                filteredProducts = this.allProducts.slice(0, this.productsPagination.itemsPerPage);
            }

            if (filteredProducts.length > 0) {
                // Debug: Check featured status of products being rendered
                const featuredInFiltered = filteredProducts.filter(p =>
                    p.is_featured === true ||
                    p.is_featured === 1 ||
                    p.is_featured === '1' ||
                    p.is_featured === 'true'
                );
                console.log('ðŸŽ¨ About to render products table:', {
                    totalProducts: filteredProducts.length,
                    featuredProducts: featuredInFiltered.length,
                    featuredProductIds: featuredInFiltered.map(p => ({ id: p.id, name: p.name, is_featured: p.is_featured }))
                });

                container.innerHTML = this.renderProductsTable(filteredProducts);
                this.setupProductsBulkActions();
                this.syncProductsSelectAllCheckbox();
                this.updateProductsBulkBar();
                // Update pagination after rendering
                this.renderProductsPagination();
            } else {
                // No products to show
                container.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--gray-500);">
                        <i class="fas fa-box-open" style="font-size: 3rem; margin-bottom: 1rem; color: var(--gray-400);"></i>
                        <p>No products found. Import products from a CSV backup or add products manually.</p>
                    </div>
                `;
            }
        }
    }

    renderProductsTable(products) {
        const esc = (v) => this.escapeHtml(v);
        const money = (v) => {
            const n = typeof v === 'string' ? parseFloat(v) : Number(v);
            return Number.isFinite(n) ? `$${n.toFixed(2)}` : '-';
        };
        const pageIds = products.map((p) => Number(p.id));
        const allPageSelected = pageIds.length > 0 && pageIds.every((id) => this.selectedProductIds.has(id));
        const rows = products.map((product) => {
            const productId = Number(product.id);
            const name = esc(product.name || '');
            const cat = esc(product.category_name || 'No category');
            const brand = esc(product.brand_name || 'Unknown');
            const isFeatured = product.is_featured === true ||
                product.is_featured === 1 ||
                product.is_featured === '1' ||
                product.is_featured === 'true';
            const showOnWeb = product.show_on_web === true ||
                product.show_on_web === 1 ||
                product.show_on_web === '1' ||
                product.show_on_web === 'true' ||
                product.show_on_web == null;
            const lowStock = product.inventory_quantity <= (product.low_stock_threshold || 10);
            const variantCount = Number(product.variant_count) || 0;
            const variantBadge = variantCount > 0
                ? `<span class="badge badge-info" title="${variantCount} purchasable option${variantCount === 1 ? '' : 's'}">${variantCount} variant${variantCount === 1 ? '' : 's'}</span>`
                : '';
            const isSelected = this.selectedProductIds.has(productId);
            return `
                <tr class="${isSelected ? 'admin-row-selected' : ''}">
                    <td class="col-select">
                        <label class="sr-only">
                            <input type="checkbox" class="product-row-select"
                                id="product-row-select-${productId}"
                                name="selected_product_ids"
                                value="${productId}"
                                data-product-id="${productId}" data-hm-choice-skip${isSelected ? ' checked' : ''}>
                            Select ${name}
                        </label>
                    </td>
                    <td class="col-sku"><code title="${esc(product.sku)}">${esc(product.sku)}</code></td>
                    <td class="product-name-cell">
                        <span class="product-name-primary" title="${name}">${name}</span>
                        <span class="product-name-meta" title="${cat}">${cat}${variantBadge ? ` · ${variantBadge}` : ''}</span>
                    </td>
                    <td><span class="cell-ellipsis" title="${brand}">${brand}</span></td>
                    <td class="col-money">${money(product.price)}</td>
                    <td class="col-money">${product.cost_price != null && product.cost_price !== ''
                        ? money(product.cost_price)
                        : '<span style="color:var(--gray-400);">-</span>'}</td>
                    <td class="col-stock">
                        <span class="badge ${lowStock ? 'badge-warning' : 'badge-success'}">${product.inventory_quantity}</span>
                    </td>
                    <td class="col-status">
                        <span class="status-inline">
                            <span class="badge badge-pos ${product.is_active ? 'badge-success' : 'badge-danger'}" title="POS register — ${product.is_active ? 'available at in-store register' : 'hidden from POS register'}">${product.is_active ? 'POS on' : 'POS off'}</span>
                            <span class="badge badge-web ${showOnWeb ? 'badge-success' : 'badge-secondary'}" title="Website storefront — ${showOnWeb ? 'visible on website' : 'hidden from website (in-store only)'}">${showOnWeb ? 'Web on' : 'Web off'}</span>
                            ${isFeatured ? '<span class="badge badge-info" title="Featured" style="padding:0.2rem 0.4rem;"><i class="fas fa-star" aria-hidden="true"></i></span>' : ''}
                        </span>
                    </td>
                    <td class="col-actions">
                        <div class="admin-row-actions">
                            <button type="button" class="btn btn-sm btn-secondary" onclick="editProduct(${product.id})" title="Edit">
                                <i class="fas fa-edit" aria-hidden="true"></i>
                            </button>
                            <button type="button" class="btn btn-sm btn-danger" onclick="deleteProduct(${product.id})" title="Delete">
                                <i class="fas fa-trash" aria-hidden="true"></i>
                            </button>
                        </div>
                    </td>
                </tr>`;
        }).join('');

        return `
            <div class="admin-products-table-wrap hm-choice-skip table-container" tabindex="0" role="region" aria-label="Product list"
                data-hm-choice-skip data-page-product-ids="${esc(pageIds.join(','))}">
                <table class="table">
                    <colgroup>
                        <col style="width:3%">
                        <col style="width:11%">
                        <col style="width:28%">
                        <col style="width:12%">
                        <col style="width:8%">
                        <col style="width:8%">
                        <col style="width:7%">
                        <col style="width:11%">
                        <col style="width:12%">
                    </colgroup>
                    <thead>
                        <tr>
                            <th class="col-select" scope="col">
                                <label class="sr-only">
                                    <input type="checkbox" id="productsSelectAll" name="select_all_products" data-hm-choice-skip
                                        title="Select all on this page"${allPageSelected ? ' checked' : ''}>
                                    Select all products on this page
                                </label>
                            </th>
                            <th class="col-sku" scope="col">SKU</th>
                            <th>Name</th>
                            <th>Brand</th>
                            <th>Price</th>
                            <th>Cost</th>
                            <th>Stock</th>
                            <th scope="col" title="POS register and website visibility">POS / Web</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    setupProductsBulkActions() {
        if (this._productsBulkBound) return;
        const productsSection = document.getElementById('products');
        if (!productsSection) return;
        this._productsBulkBound = true;

        productsSection.addEventListener('change', (e) => {
            const target = e.target;
            if (target.classList?.contains('product-row-select')) {
                const id = Number(target.dataset.productId);
                if (!Number.isFinite(id)) return;
                if (target.checked) this.selectedProductIds.add(id);
                else this.selectedProductIds.delete(id);
                target.closest('tr')?.classList.toggle('admin-row-selected', target.checked);
                this.syncProductsSelectAllCheckbox();
                this.updateProductsBulkBar();
                return;
            }
            if (target.id === 'productsSelectAll') {
                const wrap = target.closest('.admin-products-table-wrap');
                const raw = wrap?.dataset.pageProductIds || '';
                const pageIds = raw.split(',').map((v) => Number(v)).filter((id) => Number.isFinite(id) && id > 0);
                pageIds.forEach((id) => {
                    if (target.checked) this.selectedProductIds.add(id);
                    else this.selectedProductIds.delete(id);
                });
                wrap?.querySelectorAll('.product-row-select').forEach((cb) => {
                    cb.checked = target.checked;
                    cb.closest('tr')?.classList.toggle('admin-row-selected', target.checked);
                });
                this.syncProductsSelectAllCheckbox();
                this.updateProductsBulkBar();
            }
        });

        document.getElementById('productsBulkEditBtn')?.addEventListener('click', () => this.showProductsBulkEditModal());
        document.getElementById('productsBulkActivate')?.addEventListener('click', () => this.runProductsBulkPreset('activate'));
        document.getElementById('productsBulkDeactivate')?.addEventListener('click', () => this.runProductsBulkPreset('deactivate'));
        document.getElementById('productsBulkShowWeb')?.addEventListener('click', () => this.runProductsBulkPreset('show_on_web'));
        document.getElementById('productsBulkHideWeb')?.addEventListener('click', () => this.runProductsBulkPreset('hide_from_web'));
        document.getElementById('productsBulkDelete')?.addEventListener('click', () => this.runProductsBulkPreset('delete'));
        document.getElementById('productsBulkClear')?.addEventListener('click', () => this.clearProductSelection(true));
        this.updateProductsBulkBar();
    }

    syncProductsSelectAllCheckbox() {
        const selectAll = document.getElementById('productsSelectAll');
        const wrap = document.querySelector('#productsTable .admin-products-table-wrap');
        if (!selectAll || !wrap) return;
        const raw = wrap.dataset.pageProductIds || '';
        const pageIds = raw.split(',').map((v) => Number(v)).filter((id) => Number.isFinite(id) && id > 0);
        if (pageIds.length === 0) {
            selectAll.checked = false;
            selectAll.indeterminate = false;
            return;
        }
        const selectedOnPage = pageIds.filter((id) => this.selectedProductIds.has(id)).length;
        selectAll.checked = selectedOnPage === pageIds.length;
        selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
    }

    updateProductsBulkBar() {
        const bar = document.getElementById('productsBulkBar');
        const countEl = document.getElementById('productsBulkCount');
        const count = this.selectedProductIds.size;
        const buttonIds = [
            'productsBulkEditBtn',
            'productsBulkActivate',
            'productsBulkDeactivate',
            'productsBulkShowWeb',
            'productsBulkHideWeb',
            'productsBulkDelete',
            'productsBulkClear'
        ];
        if (countEl) {
            countEl.textContent =
                count === 0
                    ? 'Select products below — bulk actions for POS register and website'
                    : count === 1
                      ? '1 product selected'
                      : `${count} products selected`;
        }
        if (bar) {
            bar.hidden = false;
            bar.classList.toggle('admin-products-bulk-bar--empty', count === 0);
        }
        buttonIds.forEach((id) => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = count === 0;
        });
    }

    clearProductSelection(rerender = false) {
        this.selectedProductIds.clear();
        this.updateProductsBulkBar();
        if (rerender) {
            this.renderFilteredProductsImmediate();
        } else {
            document.querySelectorAll('#productsTable .product-row-select').forEach((cb) => {
                cb.checked = false;
                cb.closest('tr')?.classList.remove('admin-row-selected');
            });
            this.syncProductsSelectAllCheckbox();
        }
    }

    async runProductsBulkPreset(action) {
        const ids = [...this.selectedProductIds];
        if (!ids.length) {
            this.showNotification('Select at least one product.', 'error');
            return;
        }

        const actionLabels = {
            activate: 'activate on the POS register',
            deactivate: 'deactivate on the POS register (cannot be sold in-store)',
            show_on_web: 'show on the website',
            hide_from_web: 'hide from the website (store only)',
            delete: 'permanently delete'
        };

        const ok = await this.showAdminConfirm({
            title: 'Apply to selected products?',
            message: `${actionLabels[action]} ${ids.length} selected product(s)?`,
            confirmLabel: 'Apply',
            cancelLabel: 'Cancel',
            danger: action === 'delete'
        });
        if (!ok) return;

        try {
            const response = await this.apiRequest('/admin/products/bulk', {
                method: 'POST',
                body: JSON.stringify({ ids, action })
            });
            if (!response) return;
            this.showNotification(response.message || 'Bulk action completed.', 'success');
            this.clearProductSelection(false);
            await this.loadProducts();
        } catch (error) {
            this.showNotification('Bulk action failed: ' + (error.message || 'Unknown error'), 'error');
        }
    }

    showProductsBulkEditModal() {
        const ids = [...this.selectedProductIds];
        if (!ids.length) {
            this.showNotification('Select at least one product.', 'error');
            return;
        }

        const esc = (v) => this.escapeHtml(v);
        const brandOptions = (this.allBrands || [])
            .map((b) => `<option value="${b.id}">${esc(b.name)}</option>`)
            .join('');
        const categoryOptions = (this.allCategories || this.allCategoriesForFilter || [])
            .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
            .join('');

        const boolRow = (field, label, defaultOn = true) => `
            <div class="bulk-edit-row hm-choice-skip">
                <input type="checkbox" class="bulk-edit-enable" data-field="${field}" id="products-bulk-enable-${field}" data-hm-choice-skip>
                <label for="products-bulk-enable-${field}">${label}</label>
                <select class="form-input bulk-edit-value" data-field="${field}" id="products-bulk-value-${field}" disabled data-hm-choice-skip>
                    <option value="1"${defaultOn ? ' selected' : ''}>Yes</option>
                    <option value="0"${defaultOn ? '' : ' selected'}>No</option>
                </select>
            </div>`;

        const numberRow = (field, label, step = '0.01', placeholder = '') => `
            <div class="bulk-edit-row hm-choice-skip">
                <input type="checkbox" class="bulk-edit-enable" data-field="${field}" id="products-bulk-enable-${field}" data-hm-choice-skip>
                <label for="products-bulk-enable-${field}">${label}</label>
                <input type="number" class="form-input bulk-edit-value" data-field="${field}" id="products-bulk-value-${field}"
                    step="${step}" placeholder="${placeholder}" disabled data-hm-choice-skip>
            </div>`;

        const selectRow = (field, label, optionsHtml) => `
            <div class="bulk-edit-row hm-choice-skip">
                <input type="checkbox" class="bulk-edit-enable" data-field="${field}" id="products-bulk-enable-${field}" data-hm-choice-skip>
                <label for="products-bulk-enable-${field}">${label}</label>
                <select class="form-input bulk-edit-value" data-field="${field}" id="products-bulk-value-${field}" disabled data-hm-choice-skip>
                    ${optionsHtml}
                </select>
            </div>`;

        const modal = document.createElement('div');
        modal.className = 'modal products-bulk-edit-modal hm-choice-skip';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:42rem;max-height:90vh;display:flex;flex-direction:column;">
                <div class="modal-header">
                    <h2>Bulk edit ${ids.length} product(s)</h2>
                    <button type="button" class="modal-close" aria-label="Close">${HM_CLOSE_ICON_SVG}</button>
                </div>
                <div class="modal-body" style="overflow-y:auto;padding:1.25rem 1.5rem;">
                    <form id="products-bulk-edit-form" class="hm-choice-skip" onsubmit="return false;">
                    <p class="bulk-edit-hint">Check the fields you want to change. Unchecked fields are left as-is on each product. Names, SKU, and descriptions are not changed here.</p>
                    <div class="bulk-edit-section">
                        <h4>Availability &amp; visibility</h4>
                        ${boolRow('is_active', 'Active on POS register', true)}
                        ${boolRow('show_on_web', 'Show on website', true)}
                        ${boolRow('is_featured', 'Featured product', false)}
                        ${boolRow('is_cannabis', 'Cannabis / hemp product', false)}
                    </div>
                    <div class="bulk-edit-section">
                        <h4>Organization</h4>
                        ${selectRow('brand_id', 'Brand', `<option value="">— Select brand —</option>${brandOptions}`)}
                        ${selectRow('category_id', 'Category', `<option value="">— Select category —</option>${categoryOptions}`)}
                    </div>
                    <div class="bulk-edit-section" style="border-bottom:none;margin-bottom:0;padding-bottom:0;">
                        <h4>Pricing &amp; inventory</h4>
                        ${numberRow('price', 'Price ($)', '0.01', 'e.g. 24.99')}
                        ${numberRow('cost_price', 'Cost ($)', '0.01', 'Leave blank to clear')}
                        ${numberRow('compare_price', 'Compare at price ($)', '0.01', 'Leave blank to clear')}
                        ${numberRow('inventory_quantity', 'Stock quantity', '1', 'e.g. 100')}
                        ${numberRow('low_stock_threshold', 'Low stock alert', '1', 'e.g. 10')}
                        ${numberRow('weight', 'Weight (oz)', '0.01', 'Leave blank to clear')}
                    </div>
                    </form>
                </div>
                <div class="form-actions" style="margin:0;padding:1rem 1.5rem;border-top:1px solid var(--gray-200);">
                    <button type="button" class="btn btn-danger modal-cancel">Cancel</button>
                    <button type="button" class="btn btn-primary" id="productsBulkEditSubmit">Apply to ${ids.length} product(s)</button>
                </div>
            </div>`;

        document.body.appendChild(modal);
        modal.style.display = 'block';

        const close = () => {
            modal.remove();
            document.removeEventListener('keydown', onEscape, true);
        };
        const onEscape = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        };
        document.addEventListener('keydown', onEscape, true);

        modal.querySelector('.modal-close')?.addEventListener('click', close);
        modal.querySelector('.modal-cancel')?.addEventListener('click', close);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });

        modal.querySelectorAll('.bulk-edit-enable').forEach((cb) => {
            cb.addEventListener('change', () => {
                const field = cb.dataset.field;
                const valueEl = modal.querySelector(`.bulk-edit-value[data-field="${field}"]`);
                if (valueEl) valueEl.disabled = !cb.checked;
            });
        });

        modal.querySelector('#productsBulkEditSubmit')?.addEventListener('click', async () => {
            const updates = {};
            const missingLabels = [];
            const fieldLabels = {
                brand_id: 'Brand',
                category_id: 'Category',
                price: 'Price',
                inventory_quantity: 'Stock quantity',
                low_stock_threshold: 'Low stock alert'
            };

            modal.querySelectorAll('.bulk-edit-enable:checked').forEach((cb) => {
                const field = cb.dataset.field;
                const valueEl = modal.querySelector(`.bulk-edit-value[data-field="${field}"]`);
                if (!valueEl) return;
                let val = valueEl.value;

                if (['brand_id', 'category_id'].includes(field) && (val === '' || val == null)) {
                    missingLabels.push(fieldLabels[field] || field);
                    return;
                }
                if (field === 'price' && (val === '' || val == null || Number.isNaN(parseFloat(val)))) {
                    missingLabels.push(fieldLabels.price);
                    return;
                }
                if (
                    ['inventory_quantity', 'low_stock_threshold'].includes(field) &&
                    (val === '' || val == null || Number.isNaN(parseInt(val, 10)))
                ) {
                    missingLabels.push(fieldLabels[field] || field);
                    return;
                }

                if (['is_active', 'is_featured', 'show_on_web', 'is_cannabis'].includes(field)) {
                    val = val === '1';
                } else if (['brand_id', 'category_id', 'inventory_quantity', 'low_stock_threshold'].includes(field)) {
                    val = parseInt(val, 10);
                } else if (['price', 'cost_price', 'compare_price', 'weight'].includes(field)) {
                    if (val === '') val = null;
                    else val = parseFloat(val);
                }
                updates[field] = val;
            });

            if (missingLabels.length) {
                this.showNotification(`Choose a value for: ${missingLabels.join(', ')}.`, 'error');
                return;
            }

            if (!Object.keys(updates).length) {
                this.showNotification('Check at least one field to update.', 'error');
                return;
            }

            const fieldCount = Object.keys(updates).length;
            const ok = await this.showAdminConfirm({
                title: 'Update selected products?',
                message: `Change ${fieldCount} setting(s) on ${ids.length} product(s)?`,
                confirmLabel: 'Update products',
                cancelLabel: 'Cancel',
                danger: false
            });
            if (!ok) return;

            const submitBtn = modal.querySelector('#productsBulkEditSubmit');
            if (submitBtn) submitBtn.disabled = true;

            try {
                const response = await this.apiRequest('/admin/products/bulk', {
                    method: 'POST',
                    body: JSON.stringify({ ids, updates })
                });
                if (!response) return;
                this.showNotification(response.message || 'Products updated.', 'success');
                close();
                this.clearProductSelection(false);
                await this.loadProducts();
            } catch (error) {
                this.showNotification('Bulk update failed: ' + (error.message || 'Unknown error'), 'error');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    async loadCategories() {
        this.setupCategoriesTabs();

        if (this.categoriesViewTab === 'health') {
            await this.loadHealthCategories();
            return;
        }

        const container = document.getElementById('categoriesTable');
        if (!container) {
            console.warn('Categories table container not found');
            return;
        }

        container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading categories...</div>';

        // Don't make API call if not authenticated
        if (!this.authToken) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view categories.</p></div>';
            return;
        }

        try {
            // Use admin API endpoint (requires auth)
            const response = await this.apiRequest('/admin/categories');

            // Handle null response (403 Forbidden)
            if (!response) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view categories.</p></div>';
                return;
            }

            // Store all categories for filtering
            this.allCategoriesForFilter = response || [];

            // Setup search and filters
            this.setupCategoriesSearch();
            this.setupCategoriesPagination();
            this.populateParentFilter();

            // Apply filters and render
            this.renderFilteredCategories();

            // Refresh category dropdown in edit modal if it exists
            refreshCategoryDropdown();

        } catch (error) {
            container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);"><p>Failed to load categories: ${this.escapeHtml(error.message)}</p></div>`;
        }
    }

    setupCategoriesTabs() {
        if (this._categoriesTabsReady) return;
        const shopBtn = document.getElementById('categoriesTabShop');
        const healthBtn = document.getElementById('categoriesTabHealth');
        if (!shopBtn || !healthBtn) return;

        shopBtn.addEventListener('click', () => this.switchCategoriesTab('shop'));
        healthBtn.addEventListener('click', () => this.switchCategoriesTab('health'));
        this._categoriesTabsReady = true;
    }

    switchCategoriesTab(tab) {
        this.categoriesViewTab = tab === 'health' ? 'health' : 'shop';
        const shopBtn = document.getElementById('categoriesTabShop');
        const healthBtn = document.getElementById('categoriesTabHealth');
        const shopPanel = document.getElementById('shopCategoriesPanel');
        const healthPanel = document.getElementById('healthCategoriesPanel');
        const addGroup = document.getElementById('categoriesAddButtonGroup');
        const help = document.getElementById('healthCategoriesHelp');
        const isHealth = this.categoriesViewTab === 'health';

        if (shopBtn && healthBtn) {
            shopBtn.classList.toggle('btn-primary', !isHealth);
            shopBtn.classList.toggle('btn-secondary', isHealth);
            healthBtn.classList.toggle('btn-primary', isHealth);
            healthBtn.classList.toggle('btn-secondary', !isHealth);
        }
        if (shopPanel) shopPanel.style.display = isHealth ? 'none' : 'block';
        if (healthPanel) healthPanel.style.display = isHealth ? 'block' : 'none';
        if (addGroup) addGroup.style.display = isHealth ? 'none' : '';
        if (help) help.style.display = isHealth ? 'block' : 'none';

        if (isHealth) {
            this.loadHealthCategories();
        } else {
            const container = document.getElementById('categoriesTable');
            if (container && !container.innerHTML.trim()) {
                this.loadCategories();
            }
        }
    }

    async loadHealthCategories() {
        const container = document.getElementById('healthCategoriesTable');
        if (!container) return;

        container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading health categories...</div>';

        if (!this.authToken) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view health categories.</p></div>';
            return;
        }

        try {
            const response = await this.apiRequest('/admin/health-categories');
            if (!response) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view health categories.</p></div>';
                return;
            }
            if (response.length > 0) {
                container.innerHTML = this.renderHealthCategoriesTable(response);
            } else {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>No health categories found.</p></div>';
            }
        } catch (error) {
            container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);"><p>Failed to load health categories: ${this.escapeHtml(error.message)}</p></div>`;
        }
    }

    renderHealthCategoriesTable(categories) {
        const sorted = [...categories].sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
        );
        return `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Name</th>
                            <th>Slug</th>
                            <th>Products</th>
                            <th>Description</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sorted.map((category, index) => `
                            <tr title="Database ID: ${category.id}">
                                <td>${index + 1}</td>
                                <td>${this.escapeHtml(category.name || 'N/A')}</td>
                                <td><code>${this.escapeHtml(category.slug || 'N/A')}</code></td>
                                <td>${Number(category.product_count) || 0}</td>
                                <td>${this.escapeHtml((category.description || '').substring(0, 100))}${category.description && category.description.length > 100 ? '...' : ''}</td>
                                <td>
                                    <span class="badge ${category.is_active ? 'badge-success' : 'badge-danger'}">
                                        ${category.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderCategoriesTable(categories, categoryMap, startIndex = 0) {
        return `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Name</th>
                            <th>Slug</th>
                            <th>Parent</th>
                            <th>Sort Order</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${categories.map((category, index) => `
                            <tr title="Database ID: ${category.id} (stable; used by products and API)">
                                <td>${startIndex + index + 1}</td>
                                <td>${this.escapeHtml(category.name || 'N/A')}</td>
                                <td><code>${this.escapeHtml(category.slug || 'N/A')}</code></td>
                                <td>${category.parent_id ? this.escapeHtml(categoryMap[category.parent_id] || `ID: ${category.parent_id}`) : '<em>None</em>'}</td>
                                <td>${category.sort_order || 0}</td>
                                <td>
                                    <span class="badge ${category.is_active ? 'badge-success' : 'badge-danger'}">
                                        ${category.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn btn-sm btn-secondary" onclick="editCategory(${category.id})">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteCategory(${category.id})" style="margin-left: 0.5rem;">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    setupCategoriesSearch() {
        const searchInput = document.getElementById('categoriesSearchInput');
        const clearSearchBtn = document.getElementById('clearCategoriesSearch');
        const parentFilter = document.getElementById('categoriesParentFilter');
        const statusFilter = document.getElementById('categoriesStatusFilter');
        const clearFiltersBtn = document.getElementById('clearCategoriesFilters');

        if (!searchInput) return;
        if (searchInput.dataset.hmCategoriesSearchBound === '1') return;
        searchInput.dataset.hmCategoriesSearchBound = '1';

        const runSearch = () => {
            this.categoriesPagination.currentPage = 1;
            this.renderFilteredCategories();
            this.updateClearCategoriesFiltersButton();
        };

        const bindSearch = typeof window.hmBindSearchInput === 'function'
            ? window.hmBindSearchInput
            : null;

        if (bindSearch) {
            bindSearch(searchInput, {
                debounceMs: 300,
                clearButton: clearSearchBtn,
                onSearch: (raw) => {
                    if (clearSearchBtn) {
                        clearSearchBtn.style.display = String(raw || '').trim() ? 'block' : 'none';
                    }
                    runSearch();
                },
                onClear: () => {
                    if (clearSearchBtn) clearSearchBtn.style.display = 'none';
                    runSearch();
                }
            });
        } else {
            searchInput.setAttribute('autocomplete', 'off');
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                if (clearSearchBtn) {
                    clearSearchBtn.style.display = e.target.value ? 'block' : 'none';
                }
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(runSearch, 300);
            });
            if (clearSearchBtn) {
                clearSearchBtn.addEventListener('click', () => {
                    searchInput.value = '';
                    clearSearchBtn.style.display = 'none';
                    runSearch();
                });
            }
        }

        // Parent filter change
        if (parentFilter) {
            parentFilter.addEventListener('change', () => {
                this.categoriesPagination.currentPage = 1;
                this.renderFilteredCategories();
                this.updateClearCategoriesFiltersButton();
            });
        }

        // Status filter change
        if (statusFilter) {
            statusFilter.addEventListener('change', () => {
                this.categoriesPagination.currentPage = 1;
                this.renderFilteredCategories();
                this.updateClearCategoriesFiltersButton();
            });
        }

        // Clear filters button
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                if (clearSearchBtn) clearSearchBtn.style.display = 'none';
                if (parentFilter) parentFilter.value = '';
                if (statusFilter) statusFilter.value = '';
                this.categoriesPagination.currentPage = 1;
                this.renderFilteredCategories();
                this.updateClearCategoriesFiltersButton();
            });
        }
    }

    setupCategoriesPagination() {
        const perPageSelect = document.getElementById('categoriesPerPage');
        if (perPageSelect) {
            perPageSelect.addEventListener('change', (e) => {
                this.categoriesPagination.itemsPerPage = parseInt(e.target.value, 10);
                this.categoriesPagination.currentPage = 1;
                this.renderFilteredCategories();
            });
        }
    }

    populateParentFilter() {
        const parentFilter = document.getElementById('categoriesParentFilter');
        if (!parentFilter) return;

        const currentValue = parentFilter.value;

        // Clear existing options except "All Categories"
        parentFilter.innerHTML = '<option value="">All Categories</option>';

        // Add category options (excluding root categories for parent selection)
        this.allCategoriesForFilter.forEach(category => {
            const option = document.createElement('option');
            option.value = category.id;
            option.textContent = category.name || `Category ${category.id}`;
            parentFilter.appendChild(option);
        });

        // Restore selected value if it still exists
        if (currentValue && this.allCategoriesForFilter.some(c => c.id == currentValue)) {
            parentFilter.value = currentValue;
        }
    }

    filterCategories(searchTerm, parentId, statusFilter) {
        let filtered = [...this.allCategoriesForFilter];

        // Filter by search term (name or slug)
        if (searchTerm) {
            const term = searchTerm.toLowerCase().trim();
            filtered = filtered.filter(category => {
                const name = (category.name || '').toLowerCase();
                const slug = (category.slug || '').toLowerCase();
                return name.includes(term) || slug.includes(term);
            });
        }

        // Filter by parent
        if (parentId) {
            const selectedParentId = parseInt(parentId, 10);
            filtered = filtered.filter(category => {
                return category.parent_id === selectedParentId;
            });
        }

        // Filter by status
        if (statusFilter) {
            const isActive = statusFilter === 'active';
            filtered = filtered.filter(category => {
                return category.is_active === isActive;
            });
        }

        // Same order as API: sort_order then name (stable, sensible row numbers in "#" column)
        filtered.sort((a, b) => {
            const so = (a.sort_order || 0) - (b.sort_order || 0);
            if (so !== 0) return so;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        });

        return filtered;
    }

    renderFilteredCategories() {
        const container = document.getElementById('categoriesTable');
        if (!container) return;

        const searchInput = document.getElementById('categoriesSearchInput');
        const parentFilter = document.getElementById('categoriesParentFilter');
        const statusFilter = document.getElementById('categoriesStatusFilter');

        const searchTerm = searchInput ? searchInput.value.trim() : '';
        const parentId = parentFilter ? parentFilter.value : '';
        const status = statusFilter ? statusFilter.value : '';

        // Filter categories
        let filteredCategories = this.filterCategories(searchTerm, parentId, status);

        // Build category map for parent lookup
        const categoryMap = {};
        this.allCategoriesForFilter.forEach(cat => {
            categoryMap[cat.id] = cat.name;
        });

        // Pagination
        const page = this.categoriesPagination.currentPage;
        const itemsPerPage = this.categoriesPagination.itemsPerPage;
        const totalCategories = filteredCategories.length;
        const totalPages = Math.ceil(totalCategories / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginatedCategories = filteredCategories.slice(startIndex, endIndex);

        // Update pagination state
        this.categoriesPagination.totalCategories = totalCategories;
        this.categoriesPagination.totalPages = totalPages;

        // Render table
        if (paginatedCategories.length > 0) {
            container.innerHTML = this.renderCategoriesTable(paginatedCategories, categoryMap, startIndex);
        } else {
            let message = 'No categories found.';
            if (searchTerm || parentId || status) {
                message = 'No categories match your filters.';
            }
            container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>${message}</p></div>`;
        }

        // Render pagination
        this.renderCategoriesPagination();
    }

    renderCategoriesPagination() {
        const paginationContainer = document.getElementById('categoriesPagination');
        if (!paginationContainer) return;

        const pagination = this.categoriesPagination;
        const totalCategories = pagination.totalCategories;
        const totalPages = pagination.totalPages;
        const currentPage = pagination.currentPage;

        if (totalPages <= 1) {
            paginationContainer.innerHTML = '';
            return;
        }

        let paginationHTML = '<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--gray-200);">';

        // Results count
        const startItem = totalCategories > 0 ? ((currentPage - 1) * pagination.itemsPerPage) + 1 : 0;
        const endItem = Math.min(currentPage * pagination.itemsPerPage, totalCategories);
        paginationHTML += `<div style="color: var(--gray-600); font-size: 0.875rem;">Showing ${startItem}-${endItem} of ${totalCategories} categories</div>`;

        // Pagination controls
        paginationHTML += '<div style="display: flex; gap: 0.5rem; align-items: center;">';

        // Previous button
        paginationHTML += `<button class="btn btn-sm btn-secondary" ${currentPage === 1 ? 'disabled' : ''} onclick="app.goToCategoriesPage(${currentPage - 1})" style="min-width: auto;">
            <i class="fas fa-chevron-left"></i>
        </button>`;

        // Page numbers
        const maxPagesToShow = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
        let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
        if (endPage - startPage < maxPagesToShow - 1) {
            startPage = Math.max(1, endPage - maxPagesToShow + 1);
        }

        if (startPage > 1) {
            paginationHTML += `<button class="btn btn-sm btn-secondary" onclick="app.goToCategoriesPage(1)" style="min-width: auto;">1</button>`;
            if (startPage > 2) {
                paginationHTML += `<span style="padding: 0 0.5rem; color: var(--gray-500);">...</span>`;
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `<button class="btn btn-sm ${i === currentPage ? 'btn-primary' : 'btn-secondary'}" onclick="app.goToCategoriesPage(${i})" style="min-width: auto;">${i}</button>`;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                paginationHTML += `<span style="padding: 0 0.5rem; color: var(--gray-500);">...</span>`;
            }
            paginationHTML += `<button class="btn btn-sm btn-secondary" onclick="app.goToCategoriesPage(${totalPages})" style="min-width: auto;">${totalPages}</button>`;
        }

        // Next button
        paginationHTML += `<button class="btn btn-sm btn-secondary" ${currentPage === totalPages ? 'disabled' : ''} onclick="app.goToCategoriesPage(${currentPage + 1})" style="min-width: auto;">
            <i class="fas fa-chevron-right"></i>
        </button>`;

        paginationHTML += '</div></div>';
        paginationContainer.innerHTML = paginationHTML;
    }

    goToCategoriesPage(page) {
        if (page < 1 || page > this.categoriesPagination.totalPages) return;
        this.categoriesPagination.currentPage = page;
        this.renderFilteredCategories();
        // Scroll to top of table
        const container = document.getElementById('categoriesTable');
        if (container) {
            container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    updateClearCategoriesFiltersButton() {
        const clearFiltersBtn = document.getElementById('clearCategoriesFilters');
        if (!clearFiltersBtn) return;

        const searchInput = document.getElementById('categoriesSearchInput');
        const parentFilter = document.getElementById('categoriesParentFilter');
        const statusFilter = document.getElementById('categoriesStatusFilter');

        const hasSearch = searchInput && searchInput.value.trim() !== '';
        const hasParentFilter = parentFilter && parentFilter.value !== '';
        const hasStatusFilter = statusFilter && statusFilter.value !== '';

        clearFiltersBtn.style.display = (hasSearch || hasParentFilter || hasStatusFilter) ? 'block' : 'none';
    }

    async loadBrands() {
        const container = document.getElementById('brandsTable');
        if (!container) {
            console.warn('Brands table container not found');
            return;
        }

        container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading brands...</div>';

        // Don't make API call if not authenticated
        if (!this.authToken) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view brands.</p></div>';
            return;
        }

        try {
            // Use admin API endpoint (requires auth)
            const response = await this.apiRequest('/admin/brands');

            // Handle null response (403 Forbidden)
            if (!response) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>Please log in to view brands.</p></div>';
                return;
            }

            if (response && response.length > 0) {
                container.innerHTML = this.renderBrandsTable(response, 0);
            } else {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--gray-500);"><p>No brands found.</p></div>';
            }

            // Refresh brand dropdown in edit modal if it exists
            refreshBrandDropdown();

        } catch (error) {
            container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);"><p>Failed to load brands: ${this.escapeHtml(error.message)}</p></div>`;
        }
    }

    renderBrandsTable(brands, startIndex = 0) {
        const sorted = [...brands].sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
        );
        const logoCell = (brand) => {
            const logo = String(brand.logo_url || '').trim();
            if (!logo) {
                return '<span style="color:var(--gray-400);font-size:0.8rem;">No logo</span>';
            }
            const src = this.escapeHtml(logo.startsWith('/') ? logo : `/${logo}`);
            const alt = this.escapeHtml(brand.name || 'Brand logo');
            return `<img src="${src}" alt="${alt}" style="width:40px;height:40px;object-fit:contain;border-radius:6px;background:#fff;border:1px solid var(--gray-200);">`;
        };
        return `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Logo</th>
                            <th>Name</th>
                            <th>Slug</th>
                            <th>Description</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sorted.map((brand, index) => `
                            <tr title="Database ID: ${brand.id} (stable; used by products and API)">
                                <td>${startIndex + index + 1}</td>
                                <td>${logoCell(brand)}</td>
                                <td>${this.escapeHtml(brand.name || 'N/A')}</td>
                                <td><code>${this.escapeHtml(brand.slug || 'N/A')}</code></td>
                                <td>${this.escapeHtml((brand.description || '').substring(0, 100))}${brand.description && brand.description.length > 100 ? '...' : ''}</td>
                                <td>
                                    <span class="badge ${brand.is_active ? 'badge-success' : 'badge-danger'}">
                                        ${brand.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn btn-sm btn-secondary" onclick="editBrand(${brand.id})">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteBrand(${brand.id})" style="margin-left: 0.5rem;">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    async apiRequest(endpoint, options = {}) {
        const url = `${this.apiBaseUrl}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.authToken}`,
                ...options.headers
            },
            ...options
        };

        const response = await fetch(url, config);

        if (response.status === 401) {
            let data = {};
            try {
                data = await response.json();
            } catch (_) {
                /* ignore */
            }
            if (data.code === 'GOOGLE_TOKEN_EXPIRED') {
                const err = new Error(data.error || 'Google connection expired');
                err.code = data.code;
                throw err;
            }
            this.logout();
            throw new Error('Authentication required');
        }

        // 403 = authenticated but not allowed for this action.
        // Do NOT treat permission denials as a full session logout.
        // (Older servers used 403 for invalid JWTs; still handle that message.)
        if (response.status === 403) {
            let data = {};
            try {
                data = await response.json();
            } catch (_) {
                /* ignore */
            }
            const msg = String(data.error || '').toLowerCase();
            if (msg.includes('invalid admin token') || msg.includes('admin access token required')) {
                this.logout();
                throw new Error('Authentication required');
            }
            const err = new Error(data.error || 'Insufficient permissions');
            err.status = 403;
            err.code = data.code;
            throw err;
        }

        // Only try to parse JSON if response is ok or if we need error details
        let data;
        try {
            data = await response.json();
        } catch (parseError) {
            // If JSON parsing fails, return null for non-ok responses
            if (!response.ok) {
                return null;
            }
            throw parseError;
        }

        if (!response.ok) {
            // Check if this is an authentication error even if status isn't 401/403
            const errorMsg = (data.error || '').toLowerCase();
            if (errorMsg.includes('invalid admin token') ||
                errorMsg.includes('authentication') ||
                errorMsg.includes('unauthorized')) {
                this.logout();
                throw new Error('Authentication required');
            }
            // Include status code and message for better debugging
            const errorMessage = data.error || data.message || `API request failed with status ${response.status}`;
            const err = new Error(errorMessage);
            err.code = data.code;
            err.existingDeviceId = data.existingDeviceId;
            throw err;
        }

        return data;
    }

    logout() {
        // Clean up event listeners and timeouts
        this.cleanup();

        localStorage.removeItem('adminToken');
        this.authToken = null;
        this.currentUser = null;

        const adminDashboard = document.getElementById('adminDashboard');
        const loginScreen = document.getElementById('loginScreen');
        const loginForm = document.getElementById('loginForm');
        const loginError = document.getElementById('loginError');

        if (adminDashboard) adminDashboard.style.display = 'none';
        if (loginScreen) loginScreen.style.display = 'flex';
        document.body.classList.remove('admin-layout-locked');

        // Clear forms
        if (loginForm) loginForm.reset();
        if (loginError) loginError.style.display = 'none';
        void this.setupGoogleSignIn();
    }

    // Add event listener with tracking for cleanup
    addEventListenerWithCleanup(element, event, handler, options = false) {
        element.addEventListener(event, handler, options);
        this.eventListeners.push({ element, event, handler, options });
    }

    // Add timeout with tracking for cleanup
    addTimeoutWithCleanup(callback, delay) {
        const timeoutId = setTimeout(callback, delay);
        this.timeouts.push(timeoutId);
        return timeoutId;
    }

    // Clean up all tracked event listeners and timeouts
    cleanup() {
        // Remove all tracked event listeners
        this.eventListeners.forEach(({ element, event, handler, options }) => {
            try {
                element.removeEventListener(event, handler, options);
            } catch (error) {
                console.warn('Error removing event listener:', error);
            }
        });
        this.eventListeners = [];

        // Clear all tracked timeouts
        this.timeouts.forEach(timeoutId => {
            try {
                clearTimeout(timeoutId);
            } catch (error) {
                console.warn('Error clearing timeout:', error);
            }
        });
        this.timeouts = [];
    }

    showNotification(message, type = 'info', options = {}) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        // Create notification content safely
        const container = document.createElement('div');
        container.style.cssText = 'display: flex; align-items: flex-start; gap: 0.65rem; max-width: 28rem;';

        const icon = document.createElement('i');
        const iconClass = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle';
        icon.className = `fas fa-${iconClass}`;
        icon.style.marginTop = '0.15rem';
        icon.setAttribute('aria-hidden', 'true');

        const messageSpan = document.createElement('span');
        messageSpan.style.flex = '1';
        messageSpan.style.lineHeight = '1.4';
        messageSpan.style.whiteSpace = 'pre-wrap';
        messageSpan.textContent = message;

        container.appendChild(icon);
        container.appendChild(messageSpan);

        // Errors stay on screen longer and can be dismissed manually.
        const defaultDuration = type === 'error' ? 20000 : type === 'warning' ? 10000 : 5000;
        const duration = Number.isFinite(options.duration) ? options.duration : defaultDuration;
        const sticky = options.sticky === true || (type === 'error' && options.sticky !== false && duration >= 15000);

        if (sticky || type === 'error') {
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.setAttribute('aria-label', 'Dismiss notification');
            closeBtn.textContent = '×';
            closeBtn.style.cssText = 'background:transparent;border:none;color:white;font-size:1.4rem;line-height:1;cursor:pointer;padding:0 0.15rem;margin-left:0.25rem;opacity:0.9;';
            closeBtn.addEventListener('click', () => dismissNotification(notification));
            container.appendChild(closeBtn);
        }

        notification.appendChild(container);

        // Add styles
        Object.assign(notification.style, {
            position: 'fixed',
            top: '2rem',
            right: '2rem',
            padding: '1rem 1.5rem',
            borderRadius: 'var(--border-radius)',
            color: 'white',
            backgroundColor: type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--error)' : type === 'warning' ? '#b45309' : 'var(--info)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: '15000',
            transform: 'translateX(100%)',
            transition: 'transform 0.3s ease'
        });

        // Stack multiple notifications
        const existing = document.querySelectorAll('.notification');
        if (existing.length) {
            notification.style.top = `${2 + existing.length * 5}rem`;
        }

        document.body.appendChild(notification);

        function dismissNotification(el) {
            if (!el || !el.parentNode) return;
            el.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 300);
        }

        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);

        // Auto-remove after duration (errors linger longer)
        if (duration > 0) {
            setTimeout(() => {
                dismissNotification(notification);
            }, duration);
        }
    }

    /** Non-blocking toast (alias used by admin-customers.js and other modules). */
    showToast(message, type = 'info') {
        this.showNotification(message, type);
    }

    /**
     * Branded confirmation dialog (replaces window.confirm).
     * @returns {Promise<boolean>} true if confirmed
     */
    showAdminConfirm({
        title = 'Please confirm',
        message = '',
        confirmLabel = 'Confirm',
        cancelLabel = 'Cancel',
        danger = false,
    } = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'admin-branded-dialog-overlay';
            overlay.style.cssText =
                'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:11000;display:flex;align-items:center;justify-content:center;padding:1.5rem;';
            const box = document.createElement('div');
            box.style.cssText =
                'background:#fff;border-radius:var(--border-radius-lg,12px);max-width:440px;width:100%;box-shadow:var(--shadow-lg);padding:1.5rem 1.5rem 1.25rem;';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.setAttribute('aria-labelledby', 'admin-branded-dialog-title');

            const h = document.createElement('h2');
            h.id = 'admin-branded-dialog-title';
            h.textContent = title;
            h.style.cssText =
                'margin:0 0 0.75rem;font-size:1.25rem;color:var(--primary-green);font-weight:600;letter-spacing:-0.02em;';

            const p = document.createElement('p');
            p.textContent = message;
            p.style.cssText =
                'margin:0 0 1.25rem;color:var(--gray-700);line-height:1.55;font-size:0.95rem;white-space:pre-line;';

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:0.75rem;justify-content:flex-end;flex-wrap:wrap;';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn btn-secondary';
            cancelBtn.textContent = cancelLabel;

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
            okBtn.textContent = confirmLabel;

            const cleanup = (result) => {
                overlay.remove();
                document.removeEventListener('keydown', onKey);
                resolve(result);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup(false);
                }
            };

            cancelBtn.addEventListener('click', () => cleanup(false));
            okBtn.addEventListener('click', () => cleanup(true));
            document.addEventListener('keydown', onKey);

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            box.appendChild(h);
            box.appendChild(p);
            box.appendChild(btnRow);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
            okBtn.focus();
        });
    }

    /**
     * Branded informational alert (replaces window.alert for multi-line / titled notices).
     * @returns {Promise<void>}
     */
    showAdminAlert({ title = 'Notice', message = '', okLabel = 'OK' } = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'admin-branded-dialog-overlay';
            overlay.style.cssText =
                'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:11000;display:flex;align-items:center;justify-content:center;padding:1.5rem;';
            const box = document.createElement('div');
            box.style.cssText =
                'background:#fff;border-radius:var(--border-radius-lg,12px);max-width:440px;width:100%;box-shadow:var(--shadow-lg);padding:1.5rem 1.5rem 1.25rem;';
            box.setAttribute('role', 'alertdialog');
            box.setAttribute('aria-modal', 'true');
            box.setAttribute('aria-labelledby', 'admin-branded-alert-title');

            const h = document.createElement('h2');
            h.id = 'admin-branded-alert-title';
            h.textContent = title;
            h.style.cssText =
                'margin:0 0 0.75rem;font-size:1.25rem;color:var(--primary-green);font-weight:600;letter-spacing:-0.02em;';

            const p = document.createElement('p');
            p.textContent = message;
            p.style.cssText =
                'margin:0 0 1.25rem;color:var(--gray-700);line-height:1.55;font-size:0.95rem;white-space:pre-line;';

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'btn btn-primary';
            okBtn.textContent = okLabel;

            const btnWrap = document.createElement('div');
            btnWrap.style.cssText = 'display:flex;justify-content:flex-end;';
            btnWrap.appendChild(okBtn);

            const cleanup = () => {
                overlay.remove();
                document.removeEventListener('keydown', onKey);
                resolve();
            };
            const onKey = (e) => {
                if (e.key === 'Escape' || e.key === 'Enter') {
                    e.preventDefault();
                    cleanup();
                }
            };

            okBtn.addEventListener('click', cleanup);
            document.addEventListener('keydown', onKey);

            box.appendChild(h);
            box.appendChild(p);
            box.appendChild(btnWrap);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
            okBtn.focus();
        });
    }

    /**
     * Simple branded form dialog (replaces window.prompt).
     * @param {Array<{key:string,label:string,placeholder?:string,inputType?:string,required?:boolean}>} inputs
     * @returns {Promise<Record<string,string|null>|null>}
     */
    showAdminInputModal({
        title = '',
        message = '',
        inputs = [],
        submitLabel = 'OK',
        cancelLabel = 'Cancel',
    } = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText =
                'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:11000;display:flex;align-items:center;justify-content:center;padding:1.5rem;';
            const box = document.createElement('div');
            box.style.cssText =
                'background:#fff;border-radius:var(--border-radius-lg,12px);max-width:440px;width:100%;box-shadow:var(--shadow-lg);padding:1.5rem;';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');

            const h = document.createElement('h2');
            h.textContent = title;
            h.style.cssText =
                'margin:0 0 0.5rem;font-size:1.2rem;color:var(--primary-green);font-weight:600;';
            box.appendChild(h);

            if (message) {
                const pm = document.createElement('p');
                pm.textContent = message;
                pm.style.cssText = 'margin:0 0 1rem;color:var(--gray-600);font-size:0.92rem;line-height:1.5;';
                box.appendChild(pm);
            }

            const form = document.createElement('form');
            form.style.cssText = 'display:flex;flex-direction:column;gap:0.9rem;';
            const els = {};
            for (let i = 0; i < inputs.length; i++) {
                const inp = inputs[i];
                const wrap = document.createElement('div');
                wrap.className = 'form-group';
                const lab = document.createElement('label');
                lab.textContent = inp.label;
                lab.style.cssText = 'display:block;margin-bottom:0.35rem;font-weight:500;font-size:0.88rem;color:var(--gray-800);';
                const input = document.createElement('input');
                const fieldId = `admin-inp-${i}-${String(inp.key).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                input.id = fieldId;
                lab.setAttribute('for', fieldId);
                input.className = 'form-input';
                input.name = inp.key;
                input.type = inp.inputType || 'text';
                input.placeholder = inp.placeholder || '';
                input.required = !!inp.required;
                wrap.appendChild(lab);
                wrap.appendChild(input);
                form.appendChild(wrap);
                els[inp.key] = input;
            }

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:0.75rem;justify-content:flex-end;margin-top:0.75rem;';
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn btn-danger';
            cancelBtn.textContent = cancelLabel;
            const subBtn = document.createElement('button');
            subBtn.type = 'submit';
            subBtn.className = 'btn btn-primary';
            subBtn.textContent = submitLabel;
            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(subBtn);
            form.appendChild(btnRow);

            const cleanup = (val) => {
                overlay.remove();
                document.removeEventListener('keydown', onKey);
                resolve(val);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup(null);
                }
            };

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const out = {};
                for (const inp of inputs) {
                    const v = (els[inp.key].value || '').trim();
                    if (inp.required && !v) {
                        els[inp.key].focus();
                        return;
                    }
                    out[inp.key] = v || null;
                }
                cleanup(out);
            });
            cancelBtn.addEventListener('click', () => cleanup(null));
            document.addEventListener('keydown', onKey);

            box.appendChild(form);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
            const first = form.querySelector('input');
            if (first) first.focus();
        });
    }

    showProgressModal(title, initialMessage = '') {
        const existingModal = document.getElementById('progressModal');
        if (existingModal) {
            document.body.removeChild(existingModal);
        }

        const modal = document.createElement('div');
        modal.id = 'progressModal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';

        const content = document.createElement('div');
        content.style.cssText = 'background: white; border-radius: var(--border-radius-lg); padding: 2rem; max-width: 600px; width: 90%; box-shadow: var(--shadow-lg);';

        const titleEl = document.createElement('h2');
        titleEl.textContent = title;
        titleEl.style.cssText = 'margin: 0 0 1.5rem 0; color: var(--primary-green); font-size: 1.5rem;';
        content.appendChild(titleEl);

        const messageEl = document.createElement('div');
        messageEl.id = 'progressMessage';
        messageEl.textContent = initialMessage;
        messageEl.style.cssText = 'margin-bottom: 1.5rem; color: var(--gray-600); font-weight: 500;';
        content.appendChild(messageEl);

        const progressSection = document.createElement('div');
        progressSection.style.cssText = 'margin-bottom: 1.5rem;';

        const progressLabel = document.createElement('div');
        progressLabel.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 600; color: var(--gray-700);';
        progressLabel.innerHTML = '<span>Overall progress</span><span id="overallPercentLabel">0%</span>';
        progressSection.appendChild(progressLabel);

        const progressWrapper = document.createElement('div');
        progressWrapper.style.cssText = 'width: 100%; height: 1.5rem; background-color: var(--gray-200); border-radius: var(--border-radius); overflow: hidden;';

        const progressBar = document.createElement('div');
        progressBar.id = 'overallProgressBar';
        progressBar.style.cssText = 'height: 100%; background: linear-gradient(90deg, var(--primary-green) 0%, var(--secondary-sage) 100%); width: 0%; transition: width 0.3s ease; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.75rem; font-weight: 600;';
        progressBar.textContent = '0%';

        progressWrapper.appendChild(progressBar);
        progressSection.appendChild(progressWrapper);
        content.appendChild(progressSection);

        const progressInfo = document.createElement('div');
        progressInfo.id = 'progressInfo';
        progressInfo.style.cssText = 'display: flex; justify-content: space-between; font-size: 0.8125rem; color: var(--gray-600); margin-bottom: 1.5rem;';
        progressInfo.innerHTML = '<span id="progressStatus">Working...</span><span id="progressCount">0 products found</span>';
        content.appendChild(progressInfo);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.id = 'progressCancelBtn';
        cancelBtn.className = 'btn btn-danger';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'width: 100%;';
        cancelBtn.addEventListener('click', () => this.cancelActiveLongTask());
        content.appendChild(cancelBtn);

        modal.appendChild(content);
        document.body.appendChild(modal);

        return modal;
    }

    registerActiveLongTask(task) {
        this.activeLongTask = task;
        const cancelBtn = document.getElementById('progressCancelBtn');
        if (cancelBtn) {
            cancelBtn.disabled = false;
            cancelBtn.textContent = 'Cancel';
        }
    }

    clearActiveLongTask() {
        this.activeLongTask = null;
        const cancelBtn = document.getElementById('progressCancelBtn');
        if (cancelBtn) {
            cancelBtn.disabled = true;
        }
    }

    async cancelActiveLongTask() {
        const task = this.activeLongTask;
        if (!task) return;

        const cancelBtn = document.getElementById('progressCancelBtn');
        if (cancelBtn) {
            cancelBtn.disabled = true;
            cancelBtn.textContent = 'Cancelling...';
        }

        if (task.abortController) {
            task.abortController.abort();
        }
        if (task.cancelUrl) {
            try {
                await fetch(task.cancelUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.authToken}`,
                        'Content-Type': 'application/json'
                    }
                });
            } catch (e) {
                console.warn('Cancel request failed:', e);
            }
        }
        if (typeof task.onCancel === 'function') {
            task.onCancel();
        }
    }

    updateProgressModal(percentage, message = '', productsFound = 0, stage = null) {
        const progressBar = document.getElementById('overallProgressBar');
        const percentLabel = document.getElementById('overallPercentLabel');
        const progressMessage = document.getElementById('progressMessage');
        const progressStatus = document.getElementById('progressStatus');
        const progressCount = document.getElementById('progressCount');

        const overall = Math.min(100, Math.max(0, Math.round(percentage)));

        if (progressBar) {
            progressBar.style.width = `${overall}%`;
            progressBar.textContent = `${overall}%`;
        }
        if (percentLabel) {
            percentLabel.textContent = `${overall}%`;
        }
        if (progressMessage && message) {
            progressMessage.textContent = message;
        }

        const isComplete = stage === 'complete' || stage === 'saving';
        const isCancelled = stage === 'cancelled';
        const isError = stage === 'error';

        if (progressStatus) {
            if (isCancelled) {
                progressStatus.textContent = 'Cancelled';
            } else if (isError) {
                progressStatus.textContent = 'Error';
            } else if (isComplete) {
                progressStatus.textContent = 'Complete!';
            } else if (stage === 'importing') {
                progressStatus.textContent = 'Importing...';
            } else if (stage === 'scraping_products') {
                progressStatus.textContent = 'Scraping...';
            } else {
                progressStatus.textContent = 'Working...';
            }
        }

        if (progressCount) {
            if (productsFound > 0) {
                progressCount.textContent = `${productsFound} products found`;
            } else if (isCancelled) {
                progressCount.textContent = 'Stopped';
            } else {
                progressCount.textContent = 'In progress...';
            }
        }
    }

    closeProgressModal() {
        this.clearActiveLongTask();
        const modal = document.getElementById('progressModal');
        if (modal) {
            document.body.removeChild(modal);
        }
    }
}

// Global functions for button clicks
async function matchProductsToBrands() {
    const app = window.adminApp;
    const btn = document.getElementById('matchBrandsBtn');

    if (!app || !app.authToken) {
        app.showNotification('Please log in to match products to brands', 'error');
        return;
    }

    const proceed = await app.showAdminConfirm({
        title: 'Match products to brands?',
        message:
            'H&M Herbs will match catalog products to brands using name prefixes. Many product rows may be updated. Continue?',
        confirmLabel: 'Run match',
        cancelLabel: 'Cancel',
    });
    if (!proceed) return;

    try {
        // Disable button and show loading
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Matching...';
        }

        app.showNotification('Matching products to brands...', 'info');

        const response = await app.apiRequest('/admin/products/match-brands', {
            method: 'POST'
        });

        if (response && response.success) {
            const results = response.results;
            let message = `Matching complete! `;
            message += `Matched: ${results.matched}, Updated: ${results.updated}`;
            if (results.notMatched > 0) {
                message += `, Not matched: ${results.notMatched}`;
            }

            app.showNotification(message, 'success');

            // Reload products to show updated brand associations
            setTimeout(() => {
                app.loadProducts();
            }, 1000);

            // Show details if there are unmatched products
            if (results.notMatchedProducts && results.notMatchedProducts.length > 0) {
                console.log('Products that could not be matched:', results.notMatchedProducts);
            }
        } else {
            app.showNotification(response?.error || 'Failed to match products to brands', 'error');
        }
    } catch (error) {
        app.showNotification('Error matching products to brands: ' + error.message, 'error');
        console.error('Match products to brands error:', error);
    } finally {
        // Re-enable button
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-link"></i> Match Products to Brands';
        }
    }
}

async function downloadProductCatalogBackup() {
    const app = window.adminApp;
    try {
        app.showNotification('Preparing product catalog backup...', 'info');
        const response = await fetch(`${app.apiBaseUrl}/admin/products/export`, {
            headers: { Authorization: `Bearer ${app.authToken}` }
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || `Export failed (${response.status})`);
        }
        const blob = await response.blob();
        const count = response.headers.get('X-Product-Count');
        const stamp = new Date().toISOString().slice(0, 10);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `product-catalog-backup-${stamp}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        const n = count ? `${count} products` : 'Catalog';
        app.showNotification(`${n} downloaded - store this file somewhere safe`, 'success');
    } catch (error) {
        app.showNotification(error.message || 'Catalog backup failed', 'error');
    }
}

async function downloadProductImportTemplate() {
    const app = window.adminApp;
    try {
        const response = await fetch(`${app.apiBaseUrl}/admin/import-products/template`, {
            headers: { Authorization: `Bearer ${app.authToken}` }
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Could not download template');
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'product-import-template.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        app.showNotification(error.message || 'Template download failed', 'error');
    }
}

function renderImportResults(container, data) {
    if (!container) return;
    const errors = Array.isArray(data.errorDetails) ? data.errorDetails : [];
    const errorList = errors.length
        ? `<ul style="margin:0.5rem 0 0;padding-left:1.25rem;">${errors
              .map((e) => `<li>Row ${e.row}: ${e.name || e.sku || 'Item'} - ${e.message}</li>`)
              .join('')}</ul>`
        : '';
    container.innerHTML = `
        <div style="padding:0.85rem 1rem;border-radius:8px;background:var(--gray-50);border:1px solid var(--gray-200);font-size:0.9rem;">
            <strong>Import complete</strong>
            <p style="margin:0.35rem 0 0;">
                ${data.imported || 0} of ${data.total || 0} rows imported
                (${data.created || 0} created, ${data.updated || 0} updated)
                ${data.errors ? ` \u00B7 ${data.errors} error(s)` : ''}
                ${data.skipped ? ` \u00B7 ${data.skipped} skipped` : ''}
            </p>
            ${errorList}
        </div>`;
    container.style.display = 'block';
}

async function importProducts(fileInputId = 'csvFile', progressId = 'importProgress', resultsId = 'importResults') {
    const app = window.adminApp;
    const fileInput = document.getElementById(fileInputId);
    const progressDiv = document.getElementById(progressId);
    const resultsDiv = document.getElementById(resultsId);

    if (!fileInput?.files?.[0]) {
        app.showNotification('Please select a CSV file first', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('csvFile', fileInput.files[0]);

    try {
        if (progressDiv) progressDiv.style.display = 'block';
        if (resultsDiv) resultsDiv.style.display = 'none';

        const response = await fetch(`${app.apiBaseUrl}/admin/import-products`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${app.authToken}`
            },
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            const summary = `${data.imported || 0} imported (${data.created || 0} new, ${data.updated || 0} updated)`;
            app.showNotification(summary, data.errors ? 'warning' : 'success');
            renderImportResults(resultsDiv, data);
            fileInput.value = '';
            if (app.currentSection === 'products' && typeof app.loadProducts === 'function') {
                await app.loadProducts();
            }
        } else {
            app.showNotification(data.error || 'Import failed', 'error');
        }
    } catch (error) {
        app.showNotification('Failed to import products: ' + error.message, 'error');
    } finally {
        if (progressDiv) progressDiv.style.display = 'none';
    }
}

// Helper function to add Escape key support to modals
function addEscapeKeySupport(modal) {
    const escapeHandler = (e) => {
        if (e.key === 'Escape' || e.keyCode === 27) {
            // Check if this modal is still open and visible
            if (modal && modal.parentNode && (modal.style.display === 'block' || window.getComputedStyle(modal).display === 'block')) {
                modal.remove();
                document.removeEventListener('keydown', escapeHandler);
            }
        }
    };
    document.addEventListener('keydown', escapeHandler);
}

// Helper function to create modal structure safely
function createProductModal(title, formId, isEdit = false) {
    const modal = document.createElement('div');
    modal.className = 'modal';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.maxWidth = '1100px'; // Wider for product form
    modalContent.style.maxHeight = '95vh'; // Allow more vertical space

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';

    const titleEl = document.createElement('h2');
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = HM_CLOSE_ICON_SVG;
    closeBtn.onclick = function () { this.closest('.modal').remove(); };

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.padding = '2rem';

    const form = document.createElement('form');
    form.id = formId;

    // Create form fields
    const fields = [
        { type: 'input', label: 'SKU / Barcode', id: `${isEdit ? 'edit' : 'add'}-sku`, name: 'sku', inputType: 'text', required: false },
        { type: 'input', label: 'Product Name *', id: `${isEdit ? 'edit' : 'add'}-name`, name: 'name', inputType: 'text', required: true },
        { type: 'textarea', label: 'Short Description', id: `${isEdit ? 'edit' : 'add'}-short-description`, name: 'short_description', rows: 2 },
        { type: 'textarea', label: 'Long Description', id: `${isEdit ? 'edit' : 'add'}-long-description`, name: 'long_description', rows: 4 }
    ];

    // Add brand and category selects for add modal only
    if (!isEdit) {
        fields.push(
            {
                type: 'select', label: 'Brand *', id: 'add-brand', name: 'brand_id', required: true,
                options: [{ value: '', text: 'Loading brands...' }],
                hasLink: true,
                linkSection: 'brands'
            },
            {
                type: 'select', label: 'Category *', id: 'add-category', name: 'category_id', required: true,
                options: [{ value: '', text: 'Loading categories...' }],
                hasLink: true,
                linkSection: 'categories'
            }
        );
    } else {
        // Add brand dropdown for edit mode with link to brands section
        fields.push({
            type: 'select', label: 'Brand *', id: 'edit-brand', name: 'brand_id', required: true,
            options: [{ value: '', text: 'Loading brands...' }],
            hasLink: true, // Flag to add link button
            linkSection: 'brands'
        });
        // Add category dropdown for edit mode with link to categories section
        fields.push({
            type: 'select', label: 'Category *', id: 'edit-category', name: 'category_id', required: true,
            options: [{ value: '', text: 'Loading categories...' }],
            hasLink: true, // Flag to add link button
            linkSection: 'categories'
        });
    }

    // Add remaining fields
    fields.push(
        { type: 'input', label: 'Price *', id: `${isEdit ? 'edit' : 'add'}-price`, name: 'price', inputType: 'number', step: '0.01', min: '0', required: true },
        { type: 'input', label: 'Cost', id: `${isEdit ? 'edit' : 'add'}-cost-price`, name: 'cost_price', inputType: 'number', step: '0.01', min: '0' },
        { type: 'input', label: 'Compare Price', id: `${isEdit ? 'edit' : 'add'}-compare-price`, name: 'compare_price', inputType: 'number', step: '0.01', min: '0' },
        { type: 'input', label: 'Inventory Quantity *', id: `${isEdit ? 'edit' : 'add'}-inventory`, name: 'inventory_quantity', inputType: 'number', min: '0', required: true },
        { type: 'input', label: 'Low Stock Threshold', id: `${isEdit ? 'edit' : 'add'}-low-stock`, name: 'low_stock_threshold', inputType: 'number', min: '0', value: '10' },
        { type: 'input', label: 'Weight (oz)', id: `${isEdit ? 'edit' : 'add'}-weight`, name: 'weight', inputType: 'number', step: '0.01', min: '0' }
    );

    // Add health categories for add modal only
    if (!isEdit) {
        fields.push({ type: 'input', label: 'Health Categories (comma-separated)', id: 'add-health-categories', name: 'health_categories', inputType: 'text', placeholder: 'e.g., immune support, digestive health' });
    }

    // Create form sections for better organization
    const basicInfoSection = document.createElement('div');
    basicInfoSection.style.marginBottom = '2rem';
    basicInfoSection.style.paddingBottom = '1.5rem';
    basicInfoSection.style.borderBottom = '1px solid var(--gray-200)';

    const sectionTitle1 = document.createElement('h3');
    sectionTitle1.textContent = 'Basic Information';
    sectionTitle1.style.fontSize = '1.1rem';
    sectionTitle1.style.fontWeight = '600';
    sectionTitle1.style.color = 'var(--primary-green)';
    sectionTitle1.style.marginBottom = '1.5rem'; // Increased spacing below section title
    basicInfoSection.appendChild(sectionTitle1);

    const pricingSection = document.createElement('div');
    pricingSection.style.marginBottom = '2.5rem'; // Increased spacing
    pricingSection.style.paddingBottom = '2rem'; // Increased spacing
    pricingSection.style.borderBottom = '1px solid var(--gray-200)';

    const sectionTitle2 = document.createElement('h3');
    sectionTitle2.textContent = 'Pricing & Inventory';
    sectionTitle2.style.fontSize = '1.1rem';
    sectionTitle2.style.fontWeight = '600';
    sectionTitle2.style.color = 'var(--primary-green)';
    sectionTitle2.style.marginBottom = '1.5rem'; // Increased spacing below section title
    pricingSection.appendChild(sectionTitle2);

    const additionalSection = document.createElement('div');
    additionalSection.style.marginBottom = '2rem';

    // Create form fields with better spacing
    let currentRow = null;
    fields.forEach((field) => {
        const isBasicInfo = field.name === 'sku' || field.name === 'name' ||
            field.name === 'short_description' || field.name === 'long_description' ||
            field.name === 'health_categories';
        const isPricing = field.name === 'price' || field.name === 'compare_price' || field.name === 'cost_price' ||
            field.name === 'inventory_quantity' || field.name === 'low_stock_threshold' ||
            field.name === 'brand_id' || field.name === 'category_id' ||
            field.name === 'weight';
        const isRowField = field.name === 'price' || field.name === 'cost_price' || field.name === 'compare_price' ||
            (field.label.includes('Brand') || field.label.includes('Category')) ||
            (field.label.includes('Inventory') || field.label.includes('Low Stock'));

        // Determine which section this field belongs to
        let targetSection = additionalSection;
        if (isBasicInfo) targetSection = basicInfoSection;
        else if (isPricing) targetSection = pricingSection;

        if (isRowField && (!currentRow || currentRow.children.length >= 2)) {
            currentRow = document.createElement('div');
            currentRow.className = 'form-row';
            currentRow.style.gap = '1.5rem'; // Increased gap between columns
            targetSection.appendChild(currentRow);
        }

        const formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        formGroup.style.marginBottom = '1.75rem'; // Increased spacing between fields
        formGroup.style.display = 'flex';
        formGroup.style.flexDirection = 'column';
        formGroup.style.width = '100%';

        const label = document.createElement('label');
        label.setAttribute('for', field.id);
        label.textContent = field.label;
        label.style.display = 'block';
        label.style.marginBottom = '0.75rem';
        label.style.fontWeight = '500';
        label.style.color = 'var(--gray-700)';
        label.style.fontSize = '0.875rem';
        label.style.width = '100%';
        formGroup.appendChild(label);

        if (field.type === 'input') {
            const input = document.createElement('input');
            input.setAttribute('type', field.inputType);
            input.id = field.id;
            input.setAttribute('name', field.name);
            if (field.required) input.setAttribute('required', '');
            if (field.step) input.setAttribute('step', field.step);
            if (field.min) input.setAttribute('min', field.min);
            if (field.value) input.setAttribute('value', field.value);
            if (field.placeholder) input.setAttribute('placeholder', field.placeholder);
            formGroup.appendChild(input);
        } else if (field.type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.id = field.id;
            textarea.setAttribute('name', field.name);
            if (field.rows) textarea.setAttribute('rows', field.rows.toString());
            formGroup.appendChild(textarea);

            if (field.name === 'long_description') {
                const hint = document.createElement('div');
                hint.textContent = 'Plain text only — headings and paragraphs are formatted automatically on the storefront.';
                hint.style.fontSize = '0.8rem';
                hint.style.color = 'var(--gray-500)';
                hint.style.marginTop = '0.35rem';
                formGroup.appendChild(hint);

                const previewLabel = document.createElement('div');
                previewLabel.textContent = 'Storefront preview';
                previewLabel.style.fontSize = '0.8rem';
                previewLabel.style.color = 'var(--gray-500)';
                previewLabel.style.marginTop = '0.75rem';
                formGroup.appendChild(previewLabel);

                const preview = document.createElement('div');
                preview.id = `${field.id}-preview`;
                preview.className = 'product-description-content';
                preview.style.marginTop = '0.35rem';
                preview.style.padding = '1rem';
                preview.style.border = '1px solid var(--gray-200)';
                preview.style.borderRadius = 'var(--radius-md)';
                preview.style.background = '#fff';
                preview.style.maxHeight = '320px';
                preview.style.overflowY = 'auto';
                formGroup.appendChild(preview);

                const syncPreview = () => {
                    const raw = textarea.value || '';
                    if (typeof HMDescriptionHtml !== 'undefined') {
                        preview.innerHTML = HMDescriptionHtml.formatLongDescriptionForDisplay(raw);
                    } else {
                        preview.textContent = raw;
                    }
                };
                textarea.setAttribute('placeholder', 'Describe the product in plain text. Use blank lines between paragraphs.');
                textarea.addEventListener('input', syncPreview);
                textarea._hmSyncLongDescPreview = syncPreview;
            }
        } else if (field.type === 'select') {
            const selectWrapper = document.createElement('div');
            selectWrapper.style.display = 'flex';
            selectWrapper.style.gap = '0.5rem';
            selectWrapper.style.alignItems = 'flex-end';

            const select = document.createElement('select');
            select.id = field.id;
            select.setAttribute('name', field.name);
            if (field.required) select.setAttribute('required', '');
            select.style.flex = '1';

            field.options.forEach(option => {
                const optionEl = document.createElement('option');
                optionEl.setAttribute('value', option.value);
                optionEl.textContent = option.text;
                select.appendChild(optionEl);
            });
            selectWrapper.appendChild(select);

            // Add link button to brands/categories section if this is the brand/category field in edit mode
            if (field.hasLink && (field.id === 'edit-brand' || field.id === 'edit-category' || field.id === 'add-brand' || field.id === 'add-category')) {
                const linkBtn = document.createElement('button');
                linkBtn.type = 'button';
                linkBtn.className = 'btn btn-secondary btn-sm';
                linkBtn.style.whiteSpace = 'nowrap';
                const sectionName = field.linkSection === 'brands' ? 'Brands' : 'Categories';
                linkBtn.innerHTML = `<i class="fas fa-external-link-alt"></i> Manage ${sectionName}`;
                linkBtn.onclick = function () {
                    // Close modal and navigate to section
                    const modal = this.closest('.modal');
                    if (modal) {
                        modal.remove();
                    }
                    // Navigate to section
                    if (window.adminApp) {
                        window.adminApp.showSection(field.linkSection);
                    }
                };
                selectWrapper.appendChild(linkBtn);
            }

            formGroup.appendChild(selectWrapper);
        }

        if (isRowField && currentRow) {
            currentRow.appendChild(formGroup);
        } else {
            targetSection.appendChild(formGroup);
        }
    });

    // Add sections to form
    form.appendChild(basicInfoSection);
    form.appendChild(pricingSection);

    if (additionalSection.children.length > 0) {
        form.appendChild(additionalSection);
    }

    // Add image upload section
    const imageSection = document.createElement('div');
    imageSection.style.marginBottom = '2.5rem';
    imageSection.style.paddingBottom = '2rem';
    imageSection.style.borderBottom = '1px solid var(--gray-200)';

    const sectionTitleImages = document.createElement('h3');
    sectionTitleImages.textContent = 'Website photos';
    sectionTitleImages.style.fontSize = '1.1rem';
    sectionTitleImages.style.fontWeight = '600';
    sectionTitleImages.style.color = 'var(--primary-green)';
    sectionTitleImages.style.marginBottom = '0.5rem';
    imageSection.appendChild(sectionTitleImages);

    const imageReorderHint = document.createElement('p');
    imageReorderHint.className = 'hm-product-image-reorder-hint';
    imageReorderHint.textContent = 'Drag photos to reorder. Order is saved when you save the product; the primary image is marked separately.';
    imageReorderHint.style.margin = '0 0 1.25rem';
    imageReorderHint.style.fontSize = '0.8rem';
    imageReorderHint.style.color = 'var(--gray-500)';
    imageReorderHint.style.lineHeight = '1.45';
    imageSection.appendChild(imageReorderHint);

    if (!document.getElementById('hm-product-image-drag-styles')) {
        const dragStyles = document.createElement('style');
        dragStyles.id = 'hm-product-image-drag-styles';
        dragStyles.textContent = `
            .hm-product-image-card--dragging {
                opacity: 0.55;
                border-color: var(--primary-green) !important;
                box-shadow: 0 8px 24px rgba(4, 120, 87, 0.18);
            }
            .hm-product-image-card--drag-over {
                border-color: var(--primary-green) !important;
                box-shadow: inset 0 0 0 2px var(--primary-green);
            }
            .hm-product-image-drag-handle:active {
                cursor: grabbing;
            }
        `;
        document.head.appendChild(dragStyles);
    }

    const imageUploadContainer = document.createElement('div');
    imageUploadContainer.id = `${isEdit ? 'edit' : 'add'}-image-upload-container`;
    imageUploadContainer.style.marginBottom = '1rem';

    // Unified input container with both file and URL support
    const unifiedInputGroup = document.createElement('div');
    unifiedInputGroup.className = 'form-group';
    unifiedInputGroup.style.marginBottom = '1rem';

    const inputLabel = document.createElement('label');
    inputLabel.textContent = 'Add website photos (upload files or paste URL)';
    inputLabel.style.display = 'block';
    inputLabel.style.marginBottom = '0.75rem';
    inputLabel.style.fontWeight = '500';
    inputLabel.style.color = 'var(--gray-700)';
    inputLabel.style.fontSize = '0.875rem';
    unifiedInputGroup.appendChild(inputLabel);

    // Container for the unified input
    const inputContainer = document.createElement('div');
    inputContainer.style.display = 'flex';
    inputContainer.style.gap = '0.5rem';
    inputContainer.style.alignItems = 'stretch';
    inputContainer.style.position = 'relative';

    // Wrapper for input and browse button (to create integrated look)
    const inputWrapper = document.createElement('div');
    inputWrapper.style.display = 'flex';
    inputWrapper.style.flex = '1';
    inputWrapper.style.position = 'relative';
    inputWrapper.style.alignItems = 'stretch';

    // Text input that accepts both URLs and triggers file selection
    const unifiedInput = document.createElement('input');
    unifiedInput.setAttribute('type', 'text');
    unifiedInput.id = `${isEdit ? 'edit' : 'add'}-product-images-unified`;
    unifiedInput.setAttribute('name', 'product_image_url_draft');
    unifiedInput.setAttribute('autocomplete', 'off');
    unifiedInput.setAttribute('placeholder', 'Paste image URL or click "Browse" to upload files');
    unifiedInput.className = 'form-input';
    unifiedInput.style.flex = '1';
    unifiedInput.style.borderTopRightRadius = '0';
    unifiedInput.style.borderBottomRightRadius = '0';
    unifiedInput.style.borderRight = 'none';
    unifiedInput.style.marginBottom = '0';
    inputLabel.setAttribute('for', unifiedInput.id);

    // Hidden file input
    const fileInput = document.createElement('input');
    fileInput.setAttribute('type', 'file');
    fileInput.setAttribute('accept', 'image/*');
    fileInput.setAttribute('multiple', 'multiple');
    fileInput.id = `${isEdit ? 'edit' : 'add'}-product-images-file`;
    fileInput.setAttribute('name', 'product_images');
    fileInput.style.display = 'none';

    // Browse button - integrated with input field, styled as primary button
    const browseBtn = document.createElement('button');
    browseBtn.setAttribute('type', 'button');
    browseBtn.textContent = 'Browse';
    browseBtn.className = 'btn btn-primary';
    browseBtn.style.borderTopLeftRadius = '0';
    browseBtn.style.borderBottomLeftRadius = '0';
    browseBtn.style.borderLeft = '1px solid var(--primary-green)';
    browseBtn.style.padding = '0.75rem 1.5rem';
    browseBtn.style.fontSize = '0.875rem';
    browseBtn.style.fontWeight = '500';
    browseBtn.style.whiteSpace = 'nowrap';
    browseBtn.style.minWidth = 'auto';
    browseBtn.style.marginBottom = '0';
    browseBtn.onclick = function () {
        fileInput.click();
    };

    // Assemble the input wrapper
    inputWrapper.appendChild(unifiedInput);
    inputWrapper.appendChild(browseBtn);

    // Assemble the container
    inputContainer.appendChild(inputWrapper);
    unifiedInputGroup.appendChild(inputContainer);
    unifiedInputGroup.appendChild(fileInput);

    // Image preview container
    const previewContainer = document.createElement('div');
    previewContainer.id = `${isEdit ? 'edit' : 'add'}-image-preview-container`;
    previewContainer.style.display = 'grid';
    previewContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(180px, 1fr))';
    previewContainer.style.gap = '1rem';
    previewContainer.style.marginTop = '1rem';

    imageUploadContainer.appendChild(unifiedInputGroup);
    imageSection.appendChild(imageUploadContainer);
    imageSection.appendChild(previewContainer);

    // Store selected images
    const selectedImages = [];

    // Helper function to add image
    function addImage(imageUrl, file = null, alt = '') {
        const imageData = {
            url: imageUrl,
            file: file,
            alt: alt || (file ? file.name.replace(/\.[^/.]+$/, '') : ''),
            isPrimary: selectedImages.length === 0
        };
        selectedImages.push(imageData);
        updateImagePreview();
        unifiedInput.value = ''; // Clear input after adding
        fileInput.value = ''; // Clear file input
    }

    // File input change handler - upload files to server
    fileInput.addEventListener('change', async function (e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const app = window.adminApp;
        if (!app || !app.authToken) {
            app.showNotification('Please log in to upload images', 'error');
            return;
        }

        // Show loading state on browse button
        const originalBrowseBtnText = browseBtn.textContent;
        browseBtn.disabled = true;
        browseBtn.textContent = 'Uploading...';

        try {
            // Upload each file
            for (const file of files) {
                if (!file.type.startsWith('image/')) {
                    app.showNotification(`${file.name} is not an image file - skipped.`, 'error');
                    continue;
                }

                const formData = new FormData();
                formData.append('image', file);

                const response = await fetch(`${app.apiBaseUrl}/admin/products/upload-image`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${app.authToken}`
                    },
                    body: formData
                });

                if (response.ok) {
                    const result = await response.json();
                    // Use the server URL instead of data URL
                    addImage(result.url, null, file.name.replace(/\.[^/.]+$/, ''));
                } else {
                    const error = await response.json();
                    console.error('Failed to upload image:', error);
                    app.showNotification(`Failed to upload ${file.name}: ${error.error || 'Unknown error'}`, 'error');
                }
            }
        } catch (error) {
            console.error('Error uploading images:', error);
            app.showNotification('Error uploading images. Please try again.', 'error');
        } finally {
            // Reset button state
            browseBtn.disabled = false;
            browseBtn.textContent = originalBrowseBtnText;
            fileInput.value = ''; // Clear file input
        }
    });

    // Unified input handlers
    // Handle Enter key or Add button click
    function handleAddInput() {
        const value = unifiedInput.value.trim();
        if (!value) return;

        // Check if it's a URL
        if (isValidImageUrl(value) || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:image/')) {
            addImage(value);
        } else {
            // If not a valid URL, try to trigger file selection
            window.adminApp.showNotification(
                'Enter a valid image URL (http:// or https://) or use Browse to select files.',
                'error'
            );
        }
    }

    unifiedInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddInput();
        }
    });

    // Add button removed - users can press Enter or paste URLs (which auto-add)

    // Handle paste events for URLs
    unifiedInput.addEventListener('paste', function () {
        setTimeout(() => {
            const pastedValue = unifiedInput.value.trim();
            if (isValidImageUrl(pastedValue) || pastedValue.startsWith('http://') || pastedValue.startsWith('https://')) {
                // Auto-add if it looks like a valid URL
                setTimeout(() => {
                    if (unifiedInput.value.trim() === pastedValue) {
                        handleAddInput();
                    }
                }, 100);
            }
        }, 10);
    });

    // Update image preview
    let dragImageIndex = null;

    function moveSelectedImage(fromIndex, toIndex) {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
        if (fromIndex >= selectedImages.length || toIndex >= selectedImages.length) return;
        const [moved] = selectedImages.splice(fromIndex, 1);
        selectedImages.splice(toIndex, 0, moved);
        updateImagePreview();
    }

    function updateImagePreview() {
        previewContainer.innerHTML = '';
        const canReorder = selectedImages.length > 1;
        previewContainer.classList.toggle('hm-product-image-grid--reorderable', canReorder);

        if (!selectedImages.length) {
            const empty = document.createElement('div');
            empty.className = 'hm-product-image-empty';
            empty.setAttribute('aria-hidden', 'true');
            empty.style.minHeight = '140px';
            empty.style.border = '2px dashed var(--gray-300)';
            empty.style.borderRadius = 'var(--border-radius)';
            empty.style.backgroundColor = 'var(--gray-50)';
            previewContainer.appendChild(empty);
            return;
        }

        selectedImages.forEach((imageData, index) => {
            const imageCard = document.createElement('div');
            imageCard.className = 'hm-product-image-card';
            imageCard.dataset.imageIndex = String(index);
            imageCard.style.position = 'relative';
            imageCard.style.border = '2px solid var(--gray-300)';
            imageCard.style.borderRadius = 'var(--border-radius)';
            imageCard.style.padding = '0.5rem';
            imageCard.style.backgroundColor = 'var(--gray-50)';
            imageCard.style.minWidth = '0';
            imageCard.style.boxSizing = 'border-box';
            imageCard.style.overflow = 'hidden';
            imageCard.style.transition = 'border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease';

            if (canReorder) {
                const dragHandle = document.createElement('button');
                dragHandle.type = 'button';
                dragHandle.className = 'hm-product-image-drag-handle';
                dragHandle.draggable = true;
                dragHandle.title = 'Drag to reorder';
                dragHandle.setAttribute('aria-label', `Drag image ${index + 1} to reorder`);
                dragHandle.innerHTML = '<i class="fas fa-grip-vertical" aria-hidden="true"></i>';
                dragHandle.style.display = 'flex';
                dragHandle.style.alignItems = 'center';
                dragHandle.style.justifyContent = 'center';
                dragHandle.style.position = 'absolute';
                dragHandle.style.top = '0.5rem';
                dragHandle.style.left = '0.5rem';
                dragHandle.style.zIndex = '2';
                dragHandle.style.width = '2rem';
                dragHandle.style.height = '2rem';
                dragHandle.style.padding = '0';
                dragHandle.style.border = '1px solid var(--gray-300)';
                dragHandle.style.borderRadius = 'var(--border-radius)';
                dragHandle.style.background = 'rgba(255,255,255,0.95)';
                dragHandle.style.color = 'var(--gray-600)';
                dragHandle.style.cursor = 'grab';

                dragHandle.addEventListener('dragstart', (e) => {
                    dragImageIndex = index;
                    imageCard.classList.add('hm-product-image-card--dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(index));
                    if (e.dataTransfer.setDragImage) {
                        e.dataTransfer.setDragImage(imageCard, 24, 24);
                    }
                });

                dragHandle.addEventListener('dragend', () => {
                    dragImageIndex = null;
                    previewContainer.querySelectorAll('.hm-product-image-card').forEach((card) => {
                        card.classList.remove('hm-product-image-card--dragging', 'hm-product-image-card--drag-over');
                    });
                });

                imageCard.addEventListener('dragover', (e) => {
                    if (dragImageIndex === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragImageIndex !== index) {
                        imageCard.classList.add('hm-product-image-card--drag-over');
                    }
                });

                imageCard.addEventListener('dragleave', () => {
                    imageCard.classList.remove('hm-product-image-card--drag-over');
                });

                imageCard.addEventListener('drop', (e) => {
                    e.preventDefault();
                    imageCard.classList.remove('hm-product-image-card--drag-over');
                    const fromIndex = dragImageIndex;
                    if (fromIndex === null || fromIndex === index) return;
                    moveSelectedImage(fromIndex, index);
                });

                imageCard.appendChild(dragHandle);
            }

            const img = document.createElement('img');
            img.src = imageData.url;
            img.style.width = '100%';
            img.style.height = '150px';
            img.style.objectFit = 'cover';
            img.style.borderRadius = 'var(--border-radius)';
            img.style.marginBottom = '0.5rem';
            img.addEventListener('error', () => {
                img.style.display = 'none';
            });

            const primaryBadge = document.createElement('div');
            if (imageData.isPrimary) {
                primaryBadge.textContent = 'Primary';
                primaryBadge.style.position = 'absolute';
                primaryBadge.style.top = '0.5rem';
                primaryBadge.style.right = '0.5rem';
                primaryBadge.style.backgroundColor = 'var(--primary-green)';
                primaryBadge.style.color = 'white';
                primaryBadge.style.padding = '0.25rem 0.5rem';
                primaryBadge.style.borderRadius = 'var(--border-radius)';
                primaryBadge.style.fontSize = '0.75rem';
                primaryBadge.style.fontWeight = '600';
            }

            const buttonRow = document.createElement('div');
            buttonRow.style.display = 'flex';
            buttonRow.style.flexDirection = 'column';
            buttonRow.style.gap = '0.5rem';
            buttonRow.style.marginTop = '0.5rem';
            buttonRow.style.width = '100%';
            buttonRow.style.minWidth = '0';

            if (!imageData.isPrimary) {
                const setPrimaryBtn = document.createElement('button');
                setPrimaryBtn.setAttribute('type', 'button');
                setPrimaryBtn.textContent = 'Set Primary';
                setPrimaryBtn.className = 'btn btn-sm btn-secondary';
                setPrimaryBtn.style.width = '100%';
                setPrimaryBtn.style.boxSizing = 'border-box';
                setPrimaryBtn.style.fontSize = '0.75rem';
                setPrimaryBtn.onclick = function () {
                    selectedImages.forEach(img => img.isPrimary = false);
                    imageData.isPrimary = true;
                    updateImagePreview();
                };
                buttonRow.appendChild(setPrimaryBtn);
            } else {
                // Reserve the same vertical space as "Set Primary" so Remove lines up with other cards
                const primarySlot = document.createElement('button');
                primarySlot.setAttribute('type', 'button');
                primarySlot.className = 'btn btn-sm btn-secondary';
                primarySlot.textContent = 'Set Primary';
                primarySlot.disabled = true;
                primarySlot.setAttribute('aria-hidden', 'true');
                primarySlot.tabIndex = -1;
                primarySlot.style.visibility = 'hidden';
                primarySlot.style.width = '100%';
                primarySlot.style.boxSizing = 'border-box';
                primarySlot.style.fontSize = '0.75rem';
                primarySlot.style.pointerEvents = 'none';
                primarySlot.style.margin = '0';
                buttonRow.appendChild(primarySlot);
            }

            const removeBtn = document.createElement('button');
            removeBtn.setAttribute('type', 'button');
            removeBtn.textContent = 'Remove';
            removeBtn.className = 'btn btn-sm btn-danger';
            removeBtn.style.width = '100%';
            removeBtn.style.boxSizing = 'border-box';
            removeBtn.style.fontSize = '0.75rem';
            removeBtn.onclick = function () {
                selectedImages.splice(index, 1);
                if (selectedImages.length > 0 && imageData.isPrimary) {
                    selectedImages[0].isPrimary = true;
                }
                updateImagePreview();
            };
            buttonRow.appendChild(removeBtn);

            imageCard.appendChild(img);
            if (imageData.isPrimary) {
                imageCard.appendChild(primaryBadge);
            }
            imageCard.appendChild(buttonRow);
            previewContainer.appendChild(imageCard);
        });
    }

    // Helper function to validate image URL
    function isValidImageUrl(url) {
        try {
            const urlObj = new URL(url);
            return /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(urlObj.pathname) ||
                url.startsWith('data:image/');
        } catch {
            return false;
        }
    }

    // Store images array on form element for later retrieval
    form.selectedImages = selectedImages;

    // Helper function to get images from form
    form.getImages = function () {
        return this.selectedImages.map(img => ({
            url: img.url,
            alt: img.alt || '',
            is_primary: img.isPrimary
        }));
    };

    // Store update function on form for external access
    form.updateImagePreview = updateImagePreview;

    form.appendChild(imageSection);

    // Cannabis / hemp - Certificate of Analysis (COA)
    const cannabisSection = document.createElement('div');
    cannabisSection.style.marginBottom = '2.5rem';
    cannabisSection.style.paddingBottom = '2rem';
    cannabisSection.style.borderBottom = '1px solid var(--gray-200)';

    const sectionTitleCoa = document.createElement('h3');
    sectionTitleCoa.textContent = 'Cannabis / hemp (COA)';
    sectionTitleCoa.style.fontSize = '1.1rem';
    sectionTitleCoa.style.fontWeight = '600';
    sectionTitleCoa.style.color = 'var(--primary-green)';
    sectionTitleCoa.style.marginBottom = '0.75rem';
    cannabisSection.appendChild(sectionTitleCoa);

    const coaHelp = document.createElement('p');
    coaHelp.textContent = 'Mark products that are hemp or cannabis-derived and link the current Certificate of Analysis (PDF).';
    coaHelp.style.fontSize = '0.875rem';
    coaHelp.style.color = 'var(--gray-600)';
    coaHelp.style.marginBottom = '1.25rem';
    coaHelp.style.lineHeight = '1.5';
    cannabisSection.appendChild(coaHelp);

    const cannabisCheckGroup = document.createElement('div');
    cannabisCheckGroup.className = 'form-group';
    cannabisCheckGroup.style.marginBottom = '1.25rem';
    const cannabisLabel = document.createElement('label');
    cannabisLabel.style.display = 'flex';
    cannabisLabel.style.alignItems = 'center';
    cannabisLabel.style.cursor = 'pointer';
    cannabisLabel.style.fontWeight = '500';
    const cannabisCb = document.createElement('input');
    cannabisCb.type = 'checkbox';
    cannabisCb.id = `${isEdit ? 'edit' : 'add'}-is-cannabis`;
    cannabisCb.name = 'is_cannabis';
    cannabisCb.style.marginRight = '0.75rem';
    cannabisCb.style.width = '1.25rem';
    cannabisCb.style.height = '1.25rem';
    cannabisLabel.appendChild(cannabisCb);
    cannabisLabel.appendChild(document.createTextNode(' Cannabis / hemp product (requires COA)'));
    cannabisCheckGroup.appendChild(cannabisLabel);
    cannabisSection.appendChild(cannabisCheckGroup);

    const coaUrlGroup = document.createElement('div');
    coaUrlGroup.className = 'form-group';
    coaUrlGroup.style.marginBottom = '1.25rem';
    const coaUrlLabel = document.createElement('label');
    coaUrlLabel.setAttribute('for', `${isEdit ? 'edit' : 'add'}-coa-url`);
    coaUrlLabel.textContent = 'COA document URL (PDF)';
    coaUrlLabel.style.display = 'block';
    coaUrlLabel.style.marginBottom = '0.5rem';
    coaUrlLabel.style.fontWeight = '500';
    const coaUrlInput = document.createElement('input');
    coaUrlInput.type = 'text';
    coaUrlInput.id = `${isEdit ? 'edit' : 'add'}-coa-url`;
    coaUrlInput.name = 'coa_url';
    coaUrlInput.placeholder = 'Set automatically after upload, or paste https://... or /uploads/coa/...';
    coaUrlInput.className = 'form-input';
    coaUrlGroup.appendChild(coaUrlLabel);
    coaUrlGroup.appendChild(coaUrlInput);
    cannabisSection.appendChild(coaUrlGroup);

    const coaUploadGroup = document.createElement('div');
    coaUploadGroup.className = 'form-group';
    coaUploadGroup.style.marginBottom = '1.25rem';
    const uploadLabel = document.createElement('label');
    uploadLabel.setAttribute('for', `${isEdit ? 'edit' : 'add'}-coa-file`);
    uploadLabel.textContent = 'Upload COA (PDF, max 15MB)';
    uploadLabel.style.display = 'block';
    uploadLabel.style.marginBottom = '0.5rem';
    uploadLabel.style.fontWeight = '500';
    const coaFileInput = document.createElement('input');
    coaFileInput.type = 'file';
    coaFileInput.accept = '.pdf,application/pdf';
    coaFileInput.id = `${isEdit ? 'edit' : 'add'}-coa-file`;
    coaFileInput.setAttribute('name', 'coa_file');
    coaFileInput.className = 'form-input';
    coaFileInput.style.padding = '0.35rem 0';
    const coaUploadStatus = document.createElement('p');
    coaUploadStatus.id = `${isEdit ? 'edit' : 'add'}-coa-upload-status`;
    coaUploadStatus.style.fontSize = '0.8125rem';
    coaUploadStatus.style.color = 'var(--gray-600)';
    coaUploadStatus.style.marginTop = '0.5rem';
    coaUploadStatus.style.marginBottom = '0';
    coaUploadStatus.textContent = '';

    coaFileInput.addEventListener('change', async function handleCoaFile() {
        const file = coaFileInput.files && coaFileInput.files[0];
        if (!file) return;
        coaUploadStatus.textContent = '';
        coaUploadStatus.style.color = 'var(--gray-600)';
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            coaUploadStatus.textContent = 'Please choose a .pdf file.';
            coaUploadStatus.style.color = '#b91c1c';
            coaFileInput.value = '';
            return;
        }
        const app = window.adminApp;
        if (!app || !app.authToken) {
            coaUploadStatus.textContent = 'Please log in to upload.';
            coaUploadStatus.style.color = '#b91c1c';
            return;
        }
        coaUploadStatus.textContent = 'Uploading...';
        try {
            const fd = new FormData();
            fd.append('coa', file);
            const response = await fetch(`${app.apiBaseUrl}/admin/products/upload-coa`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${app.authToken}`
                },
                body: fd
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok && data.url) {
                coaUrlInput.value = data.url;
                const dateEl = document.getElementById(`${isEdit ? 'edit' : 'add'}-coa-updated-at`);
                if (dateEl && !dateEl.value) {
                    dateEl.value = new Date().toISOString().slice(0, 10);
                }
                coaUploadStatus.textContent = 'Uploaded - URL filled below. Save the product to keep changes.';
                coaUploadStatus.style.color = 'var(--primary-green, #059669)';
            } else {
                coaUploadStatus.textContent = data.error || 'Upload failed.';
                coaUploadStatus.style.color = '#b91c1c';
            }
        } catch (err) {
            console.error('COA upload error:', err);
            coaUploadStatus.textContent = 'Upload failed. Check your connection and try again.';
            coaUploadStatus.style.color = '#b91c1c';
        } finally {
            coaFileInput.value = '';
        }
    });

    coaUploadGroup.appendChild(uploadLabel);
    coaUploadGroup.appendChild(coaFileInput);
    coaUploadGroup.appendChild(coaUploadStatus);
    cannabisSection.appendChild(coaUploadGroup);

    const coaDateGroup = document.createElement('div');
    coaDateGroup.className = 'form-group';
    coaDateGroup.style.marginBottom = '0';
    const coaDateLabel = document.createElement('label');
    coaDateLabel.setAttribute('for', `${isEdit ? 'edit' : 'add'}-coa-updated-at`);
    coaDateLabel.textContent = 'COA date (batch / as-of)';
    coaDateLabel.style.display = 'block';
    coaDateLabel.style.marginBottom = '0.5rem';
    coaDateLabel.style.fontWeight = '500';
    const coaDateInput = document.createElement('input');
    coaDateInput.type = 'date';
    coaDateInput.id = `${isEdit ? 'edit' : 'add'}-coa-updated-at`;
    coaDateInput.name = 'coa_updated_at';
    coaDateInput.className = 'form-input';
    coaDateGroup.appendChild(coaDateLabel);
    coaDateGroup.appendChild(coaDateInput);
    cannabisSection.appendChild(coaDateGroup);

    form.appendChild(cannabisSection);

    // Variants & option matrix editor
    if (window.HMProductVariantsEditor) {
        window.HMProductVariantsEditor.mountVariantEditor(form, isEdit ? 'edit' : 'add');
    }

    if (window.HMProductSkuField) {
        window.HMProductSkuField.enhanceProductForm(form, isEdit ? 'edit' : 'add', modal);
    }

    // Add status section
    const statusSection = document.createElement('div');
    statusSection.style.marginBottom = '2.5rem'; // Increased spacing
    statusSection.style.paddingBottom = '2rem'; // Increased spacing
    statusSection.style.borderBottom = '1px solid var(--gray-200)';

    const sectionTitle3 = document.createElement('h3');
    sectionTitle3.textContent = 'Status & Settings';
    sectionTitle3.style.fontSize = '1.1rem';
    sectionTitle3.style.fontWeight = '600';
    sectionTitle3.style.color = 'var(--primary-green)';
    sectionTitle3.style.marginBottom = '1.5rem'; // Increased spacing below section title
    statusSection.appendChild(sectionTitle3);

    const checkboxRow = document.createElement('div');
    checkboxRow.className = 'form-row';
    checkboxRow.style.gap = '1.5rem'; // Increased gap between columns

    const activeGroup = document.createElement('div');
    activeGroup.className = 'form-group';
    activeGroup.style.marginBottom = '0';
    const activeLabel = document.createElement('label');
    activeLabel.style.display = 'flex';
    activeLabel.style.alignItems = 'center';
    activeLabel.style.cursor = 'pointer';
    activeLabel.style.fontWeight = '500';
    const activeCheckbox = document.createElement('input');
    activeCheckbox.setAttribute('type', 'checkbox');
    activeCheckbox.id = `${isEdit ? 'edit' : 'add'}-is-active`;
    activeCheckbox.setAttribute('name', 'is_active');
    activeCheckbox.checked = true;
    activeCheckbox.style.marginRight = '0.75rem';
    activeCheckbox.style.width = '1.25rem';
    activeCheckbox.style.height = '1.25rem';
    activeLabel.appendChild(activeCheckbox);
    activeLabel.appendChild(document.createTextNode(' Active on POS register'));
    activeGroup.appendChild(activeLabel);

    const featuredGroup = document.createElement('div');
    featuredGroup.className = 'form-group';
    featuredGroup.style.marginBottom = '0';
    const featuredLabel = document.createElement('label');
    featuredLabel.style.display = 'flex';
    featuredLabel.style.alignItems = 'center';
    featuredLabel.style.cursor = 'pointer';
    featuredLabel.style.fontWeight = '500';
    const featuredCheckbox = document.createElement('input');
    featuredCheckbox.setAttribute('type', 'checkbox');
    featuredCheckbox.id = `${isEdit ? 'edit' : 'add'}-is-featured`;
    featuredCheckbox.setAttribute('name', 'is_featured');
    featuredCheckbox.style.marginRight = '0.75rem';
    featuredCheckbox.style.width = '1.25rem';
    featuredCheckbox.style.height = '1.25rem';
    featuredLabel.appendChild(featuredCheckbox);
    featuredLabel.appendChild(document.createTextNode(' Featured Product'));
    featuredGroup.appendChild(featuredLabel);

    const webGroup = document.createElement('div');
    webGroup.className = 'form-group';
    webGroup.style.marginBottom = '0';
    const webLabel = document.createElement('label');
    webLabel.style.display = 'flex';
    webLabel.style.alignItems = 'center';
    webLabel.style.cursor = 'pointer';
    webLabel.style.fontWeight = '500';
    const webCheckbox = document.createElement('input');
    webCheckbox.setAttribute('type', 'checkbox');
    webCheckbox.id = `${isEdit ? 'edit' : 'add'}-show-on-web`;
    webCheckbox.setAttribute('name', 'show_on_web');
    webCheckbox.checked = true;
    webCheckbox.style.marginRight = '0.75rem';
    webCheckbox.style.width = '1.25rem';
    webCheckbox.style.height = '1.25rem';
    webLabel.appendChild(webCheckbox);
    webLabel.appendChild(document.createTextNode(' Show on website'));
    webGroup.appendChild(webLabel);

    checkboxRow.appendChild(activeGroup);
    checkboxRow.appendChild(featuredGroup);
    checkboxRow.appendChild(webGroup);
    statusSection.appendChild(checkboxRow);
    form.appendChild(statusSection);

    // Form actions
    const actions = document.createElement('div');
    actions.className = 'form-actions';
    actions.style.marginTop = '2.5rem';
    actions.style.paddingTop = '1.5rem';
    actions.style.borderTop = '2px solid var(--gray-200)';

    const cancelBtn = document.createElement('button');
    cancelBtn.setAttribute('type', 'button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn btn-danger';
    cancelBtn.style.padding = '0.875rem 1.75rem';
    cancelBtn.style.fontSize = '0.9375rem';
    cancelBtn.onclick = function () { this.closest('.modal').remove(); };

    const submitBtn = document.createElement('button');
    submitBtn.setAttribute('type', 'submit');
    submitBtn.textContent = isEdit ? 'Update Product' : 'Add Product';
    submitBtn.className = 'btn btn-primary';
    submitBtn.style.padding = '0.875rem 1.75rem';
    submitBtn.style.fontSize = '0.9375rem';

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    form.appendChild(actions);

    body.appendChild(form);
    modalContent.appendChild(header);
    modalContent.appendChild(body);
    modal.appendChild(modalContent);

    return modal;
}

// Global function to refresh brand dropdown (can be called from anywhere)
async function refreshBrandDropdown() {
    const brandSelect = document.getElementById('edit-brand') || document.getElementById('add-brand');
    if (!brandSelect) return;

    try {
        const app = window.adminApp;
        if (!app) return;

        // Fetch brands from API (use admin endpoint for consistency)
        const response = await fetch(`${app.apiBaseUrl}/admin/brands`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });

        if (response.ok) {
            const brands = await response.json();
            const currentValue = brandSelect.value; // Preserve current selection

            // Clear existing options
            brandSelect.innerHTML = '<option value="">Select Brand</option>';

            // Add brands to dropdown
            brands.forEach(brand => {
                const option = document.createElement('option');
                option.value = brand.id;
                option.textContent = brand.name;
                brandSelect.appendChild(option);
            });

            // Restore previous selection if it still exists
            if (currentValue) {
                brandSelect.value = currentValue;
            }
        } else {
            brandSelect.innerHTML = '<option value="">Failed to load brands</option>';
        }
    } catch (error) {
        const brandSelect = document.getElementById('edit-brand') || document.getElementById('add-brand');
        if (brandSelect) {
            brandSelect.innerHTML = '<option value="">Error loading brands</option>';
        }
        console.error('Error loading brands:', error);
    }
}

// Global function to refresh category dropdown (can be called from anywhere)
async function refreshCategoryDropdown() {
    const categorySelect = document.getElementById('edit-category') || document.getElementById('add-category');
    if (!categorySelect) return;

    try {
        const app = window.adminApp;
        if (!app) return;

        // Fetch categories from API (use admin endpoint)
        const response = await fetch(`${app.apiBaseUrl}/admin/categories`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });

        if (response.ok) {
            const categories = await response.json();
            const currentValue = categorySelect.value; // Preserve current selection

            // Clear existing options
            categorySelect.innerHTML = '<option value="">Select Category</option>';

            // Add categories to dropdown
            categories.forEach(category => {
                const option = document.createElement('option');
                option.value = category.id;
                option.textContent = category.name;
                categorySelect.appendChild(option);
            });

            // Restore previous selection if it still exists
            if (currentValue) {
                categorySelect.value = currentValue;
            }
        } else {
            categorySelect.innerHTML = '<option value="">Failed to load categories</option>';
        }
    } catch (error) {
        const categorySelect = document.getElementById('edit-category') || document.getElementById('add-category');
        if (categorySelect) {
            categorySelect.innerHTML = '<option value="">Error loading categories</option>';
        }
        console.error('Error loading categories:', error);
    }
}

async function loadBrandsForEdit() {
    await refreshBrandDropdown();
}

async function loadCategoriesForEdit() {
    await refreshCategoryDropdown();
}

function editProduct(productId) {
    // Create and show product editing modal using safe helper
    const modal = createProductModal('Edit Product', 'edit-product-form', true);

    document.body.appendChild(modal);
    modal.style.display = 'block';

    // Add Escape key support
    addEscapeKeySupport(modal);

    // Load brands and categories for the dropdowns
    loadBrandsForEdit();
    loadCategoriesForEdit();

    // Load existing product data
    loadProductForEdit(productId);

    // Handle form submission — keep modal open when save fails so data and errors remain visible
    const form = document.getElementById('edit-product-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ok = await updateProduct(productId, new FormData(e.target), e.target);
        if (ok) {
            modal.remove();
        }
    });
}


function isDeprecatedPlaceholderImageUrl(url) {
    const u = String(url || '').trim();
    if (!u) return true;
    if (u === '/images/products/advanced-blood-pressure-support-id1233-hmherbs-primary.jpg') return true;
    if (u === '/images/products/nature-s-puls-probiotic-mega.jpg') return true;
    return /\/advanced-blood-pressure-support-id\d+-hmherbs-primary\.(jpe?g|webp|png)$/i.test(u);
}

async function loadProductForEdit(productId) {
    try {
        const app = window.adminApp;
        const response = await fetch(`${app.apiBaseUrl}/admin/products/${productId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });

        if (response.ok) {
            const product = await response.json();
            const editForm = document.getElementById('edit-product-form');

            // Populate form fields
            document.getElementById('edit-sku').value = product.sku || '';
            document.getElementById('edit-name').value = product.name || '';
            document.getElementById('edit-short-description').value = product.short_description || '';
            const longDescEl = document.getElementById('edit-long-description');
            if (longDescEl) {
                const storedLong = product.long_description || '';
                longDescEl.value = typeof HMDescriptionHtml !== 'undefined'
                    ? HMDescriptionHtml.htmlToPlainText(storedLong)
                    : storedLong;
                if (typeof longDescEl._hmSyncLongDescPreview === 'function') {
                    longDescEl._hmSyncLongDescPreview();
                }
            }
            document.getElementById('edit-price').value = product.price || '';
            const costEl = document.getElementById('edit-cost-price');
            if (costEl) costEl.value = product.cost_price != null ? product.cost_price : '';
            document.getElementById('edit-compare-price').value = product.compare_price || '';
            document.getElementById('edit-inventory').value = product.inventory_quantity || '';
            document.getElementById('edit-low-stock').value = product.low_stock_threshold || '';
            document.getElementById('edit-weight').value = product.weight || '';
            document.getElementById('edit-is-active').checked = product.is_active;
            // Handle both boolean and numeric values (1/0 from database)
            const isFeatured = product.is_featured === true ||
                product.is_featured === 1 ||
                product.is_featured === '1' ||
                product.is_featured === 'true';
            document.getElementById('edit-is-featured').checked = isFeatured;
            const showOnWebEl = document.getElementById('edit-show-on-web');
            if (showOnWebEl) {
                const showOnWeb = product.show_on_web === true ||
                    product.show_on_web === 1 ||
                    product.show_on_web === '1' ||
                    product.show_on_web === 'true' ||
                    product.show_on_web == null;
                showOnWebEl.checked = showOnWeb;
            }

            const editCannabis = document.getElementById('edit-is-cannabis');
            if (editCannabis) {
                editCannabis.checked = product.is_cannabis === true ||
                    product.is_cannabis === 1 ||
                    product.is_cannabis === '1' ||
                    product.is_cannabis === 'true';
            }
            const editCoaUrl = document.getElementById('edit-coa-url');
            if (editCoaUrl) editCoaUrl.value = product.coa_url || '';
            const editCoaDate = document.getElementById('edit-coa-updated-at');
            if (editCoaDate && product.coa_updated_at) {
                const raw = product.coa_updated_at;
                const ymd = typeof raw === 'string' ? raw.slice(0, 10) : '';
                editCoaDate.value = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : '';
            }

            // Set brand and category if available
            const brandSelect = document.getElementById('edit-brand');
            if (brandSelect && product.brand_id) {
                // Wait a bit for brands to load, then set the value
                setTimeout(() => {
                    brandSelect.value = product.brand_id;
                }, 100);
            }

            const categorySelect = document.getElementById('edit-category');
            if (categorySelect && product.category_id) {
                // Wait a bit for categories to load, then set the value
                setTimeout(() => {
                    categorySelect.value = product.category_id;
                }, 150);
            }

            // Load existing images if available
            if (editForm && editForm.selectedImages) {
                editForm.selectedImages.length = 0;
                if (product.images && Array.isArray(product.images) && product.images.length > 0) {
                    product.images
                        .slice()
                        .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
                        .forEach((img, index) => {
                            if (!img.image_url || isDeprecatedPlaceholderImageUrl(img.image_url)) return;
                            editForm.selectedImages.push({
                                url: img.image_url,
                                alt: img.alt_text || '',
                                isPrimary: img.is_primary === 1 || img.is_primary === true || index === 0,
                                file: null,
                            });
                        });
                }
                if (editForm.updateImagePreview) {
                    editForm.updateImagePreview();
                }
            }

            if (editForm?._hmVariantEditor) {
                editForm._hmVariantEditor.load(product);
            }
        } else {
            window.adminApp.showNotification('Failed to load product data', 'error');
        }
    } catch (error) {
        window.adminApp.showNotification('Error loading product: ' + error.message, 'error');
    }
}

/**
 * Prefer a clear server error message (including validation details list).
 */
function formatAdminProductError(payload, fallback = 'Something went wrong while saving the product.') {
    if (!payload || typeof payload !== 'object') return fallback;
    const parts = [];
    if (payload.error) parts.push(String(payload.error));
    if (Array.isArray(payload.details) && payload.details.length) {
        const detailLines = payload.details.map((d) => {
            if (typeof d === 'string') return d;
            const field = d.field || d.path || d.param || '';
            const msg = d.message || d.msg || JSON.stringify(d);
            return field ? `${field}: ${msg}` : msg;
        });
        parts.push(detailLines.join('\n'));
    } else if (Array.isArray(payload.errors) && payload.errors.length) {
        parts.push(payload.errors.map((e) => (typeof e === 'string' ? e : e.msg || e.message || '')).filter(Boolean).join('\n'));
    } else if (payload.message && payload.message !== payload.error) {
        parts.push(String(payload.message));
    }
    const text = parts.filter(Boolean).join('\n').trim();
    return text || fallback;
}

/**
 * Sticky error banner inside the product modal form (stays until dismissed or next save).
 */
function showProductFormError(formElement, message) {
    if (!formElement) return;
    let banner = formElement.querySelector('.product-form-error-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.className = 'product-form-error-banner';
        banner.setAttribute('role', 'alert');
        banner.style.cssText =
            'background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:0.85rem 1rem;border-radius:8px;margin:0 0 1.25rem 0;display:flex;gap:0.75rem;align-items:flex-start;';
        formElement.insertBefore(banner, formElement.firstChild);
    }
    banner.textContent = '';
    const icon = document.createElement('i');
    icon.className = 'fas fa-exclamation-circle';
    icon.style.marginTop = '0.15rem';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('div');
    text.style.flex = '1';
    text.style.whiteSpace = 'pre-wrap';
    text.style.lineHeight = '1.45';
    text.style.fontSize = '0.95rem';
    text.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss error');
    close.textContent = '×';
    close.style.cssText =
        'background:transparent;border:none;color:#991b1b;font-size:1.35rem;line-height:1;cursor:pointer;padding:0 0.2rem;';
    close.addEventListener('click', () => clearProductFormError(formElement));
    banner.appendChild(icon);
    banner.appendChild(text);
    banner.appendChild(close);
    try {
        banner.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_) {
        /* ignore */
    }
}

function clearProductFormError(formElement) {
    if (!formElement) return;
    const banner = formElement.querySelector('.product-form-error-banner');
    if (banner) banner.remove();
}

async function updateProduct(productId, formData, formElement) {
    clearProductFormError(formElement);
    const submitBtn = formElement && formElement.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.hmOriginalLabel = submitBtn.textContent;
        submitBtn.textContent = 'Saving…';
    }
    try {
        const productData = {};
        for (let [key, value] of formData.entries()) {
            if (key === 'is_active' || key === 'is_featured' || key === 'is_cannabis' || key === 'show_on_web') {
                productData[key] = true; // Checkbox was checked
            } else if (key === 'brand_id' || key === 'category_id') {
                // Convert brand_id and category_id to integer if it's a valid number
                productData[key] = value ? parseInt(value) : null;
            } else {
                productData[key] = value;
            }
        }

        // Handle unchecked checkboxes
        if (!formData.has('is_active')) productData.is_active = false;
        if (!formData.has('is_featured')) productData.is_featured = false;
        if (!formData.has('is_cannabis')) productData.is_cannabis = false;
        if (!formData.has('show_on_web')) productData.show_on_web = false;

        if (productData.long_description != null && typeof HMDescriptionHtml !== 'undefined') {
            productData.long_description = HMDescriptionHtml.prepareLongDescriptionForSave(productData.long_description);
        }

        // Log featured status for debugging
        console.log('ðŸ“ Product update data:', {
            productId: productId,
            is_featured: productData.is_featured,
            is_featured_type: typeof productData.is_featured,
            formDataHasFeatured: formData.has('is_featured'),
            checkboxValue: formData.get('is_featured')
        });

        // Get images from form element
        if (formElement && typeof formElement.getImages === 'function') {
            const images = formElement.getImages();
            // All images should now be URLs (files are uploaded before being added)
            productData.images = images.filter(img => {
                // Skip any remaining data URLs (shouldn't happen, but just in case)
                if (img.url && img.url.startsWith('data:image/')) {
                    console.warn('Skipping data URL image. Files should be uploaded first.');
                    return false;
                }
                return true; // Keep URL-based images
            });
        }

        if (window.HMProductVariantsEditor) {
            window.HMProductVariantsEditor.attachVariantPayload(productData, formElement);
        }

        const app = window.adminApp;
        const response = await fetch(`${app.apiBaseUrl}/admin/products/${productId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            },
            body: JSON.stringify(productData)
        });

        if (response.ok) {
            window.adminApp.showNotification('Product updated successfully!', 'success');
            // Refresh the products list
            if (window.adminApp && typeof window.adminApp.loadProducts === 'function') {
                window.adminApp.loadProducts();
            }
            return true;
        }

        let errorPayload = {};
        try {
            errorPayload = await response.json();
        } catch (_) {
            errorPayload = { error: `Save failed (HTTP ${response.status})` };
        }
        const errMsg = formatAdminProductError(errorPayload, 'Failed to update product.');
        showProductFormError(formElement, errMsg);
        window.adminApp.showNotification('Could not update product. See the error in the form.', 'error', { duration: 20000 });
        return false;
    } catch (error) {
        const errMsg = 'Error updating product: ' + (error.message || String(error));
        showProductFormError(formElement, errMsg);
        window.adminApp.showNotification(errMsg, 'error', { duration: 20000 });
        return false;
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            if (submitBtn.dataset.hmOriginalLabel) {
                submitBtn.textContent = submitBtn.dataset.hmOriginalLabel;
            }
        }
    }
}

function showAddProduct() {
    // Create and show add product modal using safe helper
    const modal = createProductModal('Add New Product', 'add-product-form', false);

    document.body.appendChild(modal);
    modal.style.display = 'block';

    // Add Escape key support
    addEscapeKeySupport(modal);

    // Load real brands and categories from the API so submitted IDs are valid.
    loadBrandsForEdit();
    loadCategoriesForEdit();

    // Handle form submission — keep modal open on errors so work is not lost
    const form = document.getElementById('add-product-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ok = await createProduct(new FormData(e.target), e.target);
        if (ok) {
            modal.remove();
        }
    });
}

async function createProduct(formData, formElement) {
    clearProductFormError(formElement);
    const submitBtn = formElement && formElement.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.hmOriginalLabel = submitBtn.textContent;
        submitBtn.textContent = 'Creating…';
    }
    try {
        const productData = {};
        for (let [key, value] of formData.entries()) {
            if (key === 'is_active' || key === 'is_featured' || key === 'is_cannabis' || key === 'show_on_web') {
                productData[key] = true; // Checkbox was checked
            } else if (key === 'brand_id' || key === 'category_id') {
                productData[key] = value ? parseInt(value, 10) : null;
            } else if (key === 'health_categories') {
                // Convert comma-separated string to array
                productData[key] = value.split(',').map(cat => cat.trim()).filter(cat => cat);
            } else {
                productData[key] = value;
            }
        }

        // Handle unchecked checkboxes
        if (!formData.has('is_active')) productData.is_active = false;
        if (!formData.has('is_featured')) productData.is_featured = false;
        if (!formData.has('is_cannabis')) productData.is_cannabis = false;
        if (!formData.has('show_on_web')) productData.show_on_web = false;

        if (productData.long_description != null && typeof HMDescriptionHtml !== 'undefined') {
            productData.long_description = HMDescriptionHtml.prepareLongDescriptionForSave(productData.long_description);
        }

        // Get images from form element
        if (formElement && typeof formElement.getImages === 'function') {
            const images = formElement.getImages();
            // All images should now be URLs (files are uploaded before being added)
            productData.images = images.filter(img => {
                // Skip any remaining data URLs (shouldn't happen, but just in case)
                if (img.url && img.url.startsWith('data:image/')) {
                    console.warn('Skipping data URL image. Files should be uploaded first.');
                    return false;
                }
                return true; // Keep URL-based images
            });
        } else {
            productData.images = [];
        }

        if (window.HMProductVariantsEditor) {
            window.HMProductVariantsEditor.attachVariantPayload(productData, formElement);
        }

        const app = window.adminApp;
        const response = await fetch(`${app.apiBaseUrl}/admin/products`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            },
            body: JSON.stringify(productData)
        });

        if (response.ok) {
            window.adminApp.showNotification('Product created successfully!', 'success');
            // Refresh the products list
            if (window.adminApp && typeof window.adminApp.loadProducts === 'function') {
                window.adminApp.loadProducts();
            }
            return true;
        }

        let errorPayload = {};
        try {
            errorPayload = await response.json();
        } catch (_) {
            errorPayload = { error: `Save failed (HTTP ${response.status})` };
        }
        const errMsg = formatAdminProductError(errorPayload, 'Failed to create product.');
        showProductFormError(formElement, errMsg);
        window.adminApp.showNotification('Could not create product. See the error in the form.', 'error', { duration: 20000 });
        return false;
    } catch (error) {
        const errMsg = 'Error creating product: ' + (error.message || String(error));
        showProductFormError(formElement, errMsg);
        window.adminApp.showNotification(errMsg, 'error', { duration: 20000 });
        return false;
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            if (submitBtn.dataset.hmOriginalLabel) {
                submitBtn.textContent = submitBtn.dataset.hmOriginalLabel;
            }
        }
    }
}

function logout() {
    window.adminApp.logout();
}

// Helper functions for action buttons
function viewOrder(orderId) {
    if (window.adminApp && typeof window.adminApp.showOrderDetail === 'function') {
        window.adminApp.showOrderDetail(orderId);
    }
}

function editEDSABooking(bookingId) {
    if (window.adminApp && typeof window.adminApp.openEdsaBookingModal === 'function') {
        window.adminApp.openEdsaBookingModal(bookingId);
    }
}

// Brand Management Functions
function createBrandModal(title, formId, isEdit = false) {
    const modal = document.createElement('div');
    modal.className = 'modal';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.maxWidth = '850px'; // Wider for brand form
    modalContent.style.maxHeight = '95vh'; // Allow more vertical space

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';

    const titleEl = document.createElement('h2');
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = HM_CLOSE_ICON_SVG;
    closeBtn.onclick = function () { this.closest('.modal').remove(); };

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.padding = '2.5rem'; // Increased padding

    const form = document.createElement('form');
    form.id = formId;

    // Basic Information Section
    const basicSection = document.createElement('div');
    basicSection.style.marginBottom = '2.5rem'; // Increased spacing
    basicSection.style.paddingBottom = '2rem'; // Increased spacing
    basicSection.style.borderBottom = '1px solid var(--gray-200)';

    const sectionTitle1 = document.createElement('h3');
    sectionTitle1.textContent = 'Basic Information';
    sectionTitle1.style.fontSize = '1.1rem';
    sectionTitle1.style.fontWeight = '600';
    sectionTitle1.style.color = 'var(--primary-green)';
    sectionTitle1.style.marginBottom = '1.5rem'; // Increased spacing below section title
    basicSection.appendChild(sectionTitle1);

    // Form fields
    const fields = [
        { type: 'input', label: 'Brand Name *', id: `${isEdit ? 'edit' : 'add'}-brand-name`, name: 'name', inputType: 'text', required: true },
        { type: 'textarea', label: 'Description', id: `${isEdit ? 'edit' : 'add'}-brand-description`, name: 'description', rows: 4 }
    ];

    fields.forEach(field => {
        const formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        formGroup.style.marginBottom = '1.75rem'; // Increased spacing between fields
        formGroup.style.display = 'flex';
        formGroup.style.flexDirection = 'column';
        formGroup.style.width = '100%';

        const label = document.createElement('label');
        label.setAttribute('for', field.id);
        label.textContent = field.label;
        label.style.display = 'block';
        label.style.marginBottom = '0.75rem';
        label.style.fontWeight = '500';
        label.style.color = 'var(--gray-700)';
        label.style.fontSize = '0.875rem';
        label.style.width = '100%';
        formGroup.appendChild(label);

        if (field.type === 'input') {
            const input = document.createElement('input');
            input.setAttribute('type', field.inputType);
            input.id = field.id;
            input.setAttribute('name', field.name);
            if (field.required) input.setAttribute('required', '');
            if (field.placeholder) input.setAttribute('placeholder', field.placeholder);
            formGroup.appendChild(input);
        } else if (field.type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.id = field.id;
            textarea.setAttribute('name', field.name);
            if (field.rows) textarea.setAttribute('rows', field.rows.toString());
            formGroup.appendChild(textarea);
        }

        basicSection.appendChild(formGroup);
    });

    // Links Section
    const linksSection = document.createElement('div');
    linksSection.style.marginBottom = '2.5rem'; // Increased spacing
    linksSection.style.paddingBottom = '2rem'; // Increased spacing
    linksSection.style.borderBottom = '1px solid var(--gray-200)';

    const sectionTitle2 = document.createElement('h3');
    sectionTitle2.textContent = 'Links & Media';
    sectionTitle2.style.fontSize = '1.1rem';
    sectionTitle2.style.fontWeight = '600';
    sectionTitle2.style.color = 'var(--primary-green)';
    sectionTitle2.style.marginBottom = '1.5rem'; // Increased spacing below section title
    linksSection.appendChild(sectionTitle2);

    // Logo upload section
    const logoSection = document.createElement('div');
    logoSection.className = 'form-group';
    logoSection.style.marginBottom = '1.75rem';
    logoSection.style.display = 'flex';
    logoSection.style.flexDirection = 'column';
    logoSection.style.width = '100%';

    const logoLabel = document.createElement('label');
    logoLabel.setAttribute('for', `${isEdit ? 'edit' : 'add'}-brand-logo-file`);
    logoLabel.textContent = 'Brand Logo';
    logoLabel.style.display = 'block';
    logoLabel.style.marginBottom = '0.75rem';
    logoLabel.style.fontWeight = '500';
    logoLabel.style.color = 'var(--gray-700)';
    logoLabel.style.fontSize = '0.875rem';
    logoLabel.style.width = '100%';
    logoSection.appendChild(logoLabel);

    // File upload input
    const fileInput = document.createElement('input');
    fileInput.setAttribute('type', 'file');
    fileInput.id = `${isEdit ? 'edit' : 'add'}-brand-logo-file`;
    fileInput.setAttribute('name', 'logo_file');
    fileInput.setAttribute('accept', 'image/jpeg,image/jpg,image/png,image/gif,image/webp,image/avif');
    fileInput.style.width = '100%';
    fileInput.style.padding = '0.75rem';
    fileInput.style.border = '1px solid var(--gray-300)';
    fileInput.style.borderRadius = 'var(--radius-md)';
    fileInput.style.fontSize = '0.875rem';
    logoSection.appendChild(fileInput);

    const urlFieldLabel = document.createElement('label');
    urlFieldLabel.setAttribute('for', `${isEdit ? 'edit' : 'add'}-brand-logo`);
    urlFieldLabel.textContent = 'Or enter logo URL';
    urlFieldLabel.style.display = 'block';
    urlFieldLabel.style.marginTop = '0.75rem';
    urlFieldLabel.style.marginBottom = '0.35rem';
    urlFieldLabel.style.fontWeight = '500';
    urlFieldLabel.style.color = 'var(--gray-700)';
    urlFieldLabel.style.fontSize = '0.875rem';
    logoSection.appendChild(urlFieldLabel);

    // URL input (fallback)
    const urlInput = document.createElement('input');
    urlInput.setAttribute('type', 'url');
    urlInput.id = `${isEdit ? 'edit' : 'add'}-brand-logo`;
    urlInput.setAttribute('name', 'logo_url');
    urlInput.setAttribute('placeholder', 'Or enter logo URL (https://example.com/logo.png)');
    urlInput.style.width = '100%';
    urlInput.style.marginTop = '0.5rem';
    urlInput.style.padding = '0.75rem';
    urlInput.style.border = '1px solid var(--gray-300)';
    urlInput.style.borderRadius = 'var(--radius-md)';
    urlInput.style.fontSize = '0.875rem';
    logoSection.appendChild(urlInput);

    // Image preview
    const previewContainer = document.createElement('div');
    previewContainer.id = `${isEdit ? 'edit' : 'add'}-brand-logo-preview`;
    previewContainer.style.marginTop = '1rem';
    previewContainer.style.display = 'none';
    previewContainer.style.textAlign = 'center';
    const previewImg = document.createElement('img');
    previewImg.style.maxWidth = '200px';
    previewImg.style.maxHeight = '200px';
    previewImg.style.border = '1px solid var(--gray-300)';
    previewImg.style.borderRadius = 'var(--radius-md)';
    previewImg.style.padding = '0.5rem';
    previewImg.style.backgroundColor = 'var(--gray-50)';
    previewContainer.appendChild(previewImg);
    logoSection.appendChild(previewContainer);

    // File input change handler
    fileInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) {
            // Clear URL input when file is selected
            urlInput.value = '';

            // Show preview
            const reader = new FileReader();
            reader.onload = function (e) {
                previewImg.src = e.target.result;
                previewContainer.style.display = 'block';
            };
            reader.readAsDataURL(file);
        } else {
            previewContainer.style.display = 'none';
        }
    });

    // URL input change handler
    urlInput.addEventListener('input', function (e) {
        if (e.target.value) {
            // Clear file input when URL is entered
            fileInput.value = '';
            previewImg.src = e.target.value;
            previewContainer.style.display = 'block';
        } else {
            previewContainer.style.display = 'none';
        }
    });

    linksSection.appendChild(logoSection);

    const urlFields = [
        { type: 'input', label: 'Website URL', id: `${isEdit ? 'edit' : 'add'}-brand-website`, name: 'website_url', inputType: 'url', placeholder: 'https://example.com' }
    ];

    urlFields.forEach(field => {
        const formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        formGroup.style.marginBottom = '1.75rem'; // Increased spacing between fields
        formGroup.style.display = 'flex';
        formGroup.style.flexDirection = 'column';
        formGroup.style.width = '100%';

        const label = document.createElement('label');
        label.setAttribute('for', field.id);
        label.textContent = field.label;
        label.style.display = 'block';
        label.style.marginBottom = '0.75rem';
        label.style.fontWeight = '500';
        label.style.color = 'var(--gray-700)';
        label.style.fontSize = '0.875rem';
        label.style.width = '100%';
        formGroup.appendChild(label);

        const input = document.createElement('input');
        input.setAttribute('type', field.inputType);
        input.id = field.id;
        input.setAttribute('name', field.name);
        if (field.placeholder) input.setAttribute('placeholder', field.placeholder);
        formGroup.appendChild(input);

        linksSection.appendChild(formGroup);
    });

    // Status Section
    const statusSection = document.createElement('div');
    statusSection.style.marginBottom = '2rem';

    const sectionTitle3 = document.createElement('h3');
    sectionTitle3.textContent = 'Status';
    sectionTitle3.style.fontSize = '1.1rem';
    sectionTitle3.style.fontWeight = '600';
    sectionTitle3.style.color = 'var(--primary-green)';
    sectionTitle3.style.marginBottom = '1.5rem'; // Increased spacing below section title
    statusSection.appendChild(sectionTitle3);

    const activeGroup = document.createElement('div');
    activeGroup.className = 'form-group';
    activeGroup.style.marginBottom = '0';
    const activeLabel = document.createElement('label');
    activeLabel.style.display = 'flex';
    activeLabel.style.alignItems = 'center';
    activeLabel.style.cursor = 'pointer';
    activeLabel.style.fontWeight = '500';
    const activeCheckbox = document.createElement('input');
    activeCheckbox.setAttribute('type', 'checkbox');
    activeCheckbox.id = `${isEdit ? 'edit' : 'add'}-brand-is-active`;
    activeCheckbox.setAttribute('name', 'is_active');
    activeCheckbox.checked = true;
    activeCheckbox.style.marginRight = '0.75rem';
    activeCheckbox.style.width = '1.25rem';
    activeCheckbox.style.height = '1.25rem';
    activeLabel.appendChild(activeCheckbox);
    activeLabel.appendChild(document.createTextNode(' Active Brand'));
    activeGroup.appendChild(activeLabel);
    statusSection.appendChild(activeGroup);

    form.appendChild(basicSection);
    form.appendChild(linksSection);
    form.appendChild(statusSection);

    // Form actions
    const actions = document.createElement('div');
    actions.className = 'form-actions';
    actions.style.marginTop = '2.5rem';
    actions.style.paddingTop = '1.5rem';
    actions.style.borderTop = '2px solid var(--gray-200)';

    const cancelBtn = document.createElement('button');
    cancelBtn.setAttribute('type', 'button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn btn-danger';
    cancelBtn.style.padding = '0.875rem 1.75rem';
    cancelBtn.style.fontSize = '0.9375rem';
    cancelBtn.onclick = function () { this.closest('.modal').remove(); };

    const submitBtn = document.createElement('button');
    submitBtn.setAttribute('type', 'submit');
    submitBtn.textContent = isEdit ? 'Update Brand' : 'Add Brand';
    submitBtn.className = 'btn btn-primary';
    submitBtn.style.padding = '0.875rem 1.75rem';
    submitBtn.style.fontSize = '0.9375rem';

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    form.appendChild(actions);

    body.appendChild(form);
    modalContent.appendChild(header);
    modalContent.appendChild(body);
    modal.appendChild(modalContent);

    return modal;
}

function showAddBrand() {
    const modal = createBrandModal('Add New Brand', 'add-brand-form', false);
    document.body.appendChild(modal);
    modal.style.display = 'block';

    // Add Escape key support
    addEscapeKeySupport(modal);

    document.getElementById('add-brand-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createBrand(new FormData(e.target));
        modal.remove();
    });
}
// Make globally accessible
window.showAddBrand = showAddBrand;

function editBrand(brandId) {
    const modal = createBrandModal('Edit Brand', 'edit-brand-form', true);
    document.body.appendChild(modal);
    modal.style.display = 'block';

    // Add Escape key support
    addEscapeKeySupport(modal);

    loadBrandForEdit(brandId);

    document.getElementById('edit-brand-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateBrand(brandId, new FormData(e.target));
        modal.remove();
    });
}

async function loadBrandForEdit(brandId) {
    try {
        const app = window.adminApp;
        const response = await fetch(`${app.apiBaseUrl}/admin/brands/${brandId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });

        if (response.ok) {
            const brand = await response.json();

            document.getElementById('edit-brand-name').value = brand.name || '';
            document.getElementById('edit-brand-description').value = brand.description || '';
            document.getElementById('edit-brand-logo').value = brand.logo_url || '';
            document.getElementById('edit-brand-website').value = brand.website_url || '';
            document.getElementById('edit-brand-is-active').checked = brand.is_active !== false;

            // Show preview if logo URL exists
            const previewContainer = document.getElementById('edit-brand-logo-preview');
            const previewImg = previewContainer?.querySelector('img');
            if (brand.logo_url && previewImg) {
                previewImg.src = brand.logo_url;
                previewContainer.style.display = 'block';
            }
        } else {
            window.adminApp.showNotification('Failed to load brand data', 'error');
        }
    } catch (error) {
        window.adminApp.showNotification('Error loading brand: ' + error.message, 'error');
    }
}

async function createBrand(formData) {
    try {
        const app = window.adminApp;
        let logoUrl = null;

        // Handle file upload if a file is selected
        const logoFile = formData.get('logo_file');
        if (logoFile && logoFile.size > 0) {
            try {
                const uploadFormData = new FormData();
                uploadFormData.append('logo', logoFile);

                const uploadResponse = await fetch(`${app.apiBaseUrl}/admin/brands/upload-logo`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    },
                    body: uploadFormData
                });

                if (uploadResponse.ok) {
                    const uploadResult = await uploadResponse.json();
                    logoUrl = uploadResult.url;
                } else {
                    const error = await uploadResponse.json();
                    throw new Error(error.error || 'Failed to upload logo');
                }
            } catch (uploadError) {
                window.adminApp.showNotification('Failed to upload logo: ' + uploadError.message, 'error');
                return;
            }
        } else {
            // Use URL if provided
            logoUrl = formData.get('logo_url') || null;
        }

        const brandData = {};
        for (let [key, value] of formData.entries()) {
            if (key === 'is_active') {
                brandData[key] = true;
            } else if (key !== 'logo_file' && key !== 'logo_url') {
                brandData[key] = value || null;
            }
        }

        // Set logo URL
        brandData.logo_url = logoUrl;

        if (!formData.has('is_active')) brandData.is_active = false;

        const response = await fetch(`${app.apiBaseUrl}/admin/brands`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            },
            body: JSON.stringify(brandData)
        });

        if (response.ok) {
            window.adminApp.showNotification('Brand created successfully!', 'success');
            // Refresh the brands list and dropdown
            if (window.adminApp && typeof window.adminApp.loadBrands === 'function') {
                await window.adminApp.loadBrands();
            }
            // Refresh brand dropdown in edit modal if it exists
            refreshBrandDropdown();
        } else {
            const error = await response.json();
            window.adminApp.showNotification('Failed to create brand: ' + error.error, 'error');
        }
    } catch (error) {
        window.adminApp.showNotification('Error creating brand: ' + error.message, 'error');
    }
}

async function updateBrand(brandId, formData) {
    try {
        const app = window.adminApp;
        let logoUrl = null;

        // Handle file upload if a file is selected
        const logoFile = formData.get('logo_file');
        if (logoFile && logoFile.size > 0) {
            try {
                const uploadFormData = new FormData();
                uploadFormData.append('logo', logoFile);

                const uploadResponse = await fetch(`${app.apiBaseUrl}/admin/brands/upload-logo`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    },
                    body: uploadFormData
                });

                if (uploadResponse.ok) {
                    const uploadResult = await uploadResponse.json();
                    logoUrl = uploadResult.url;
                } else {
                    const error = await uploadResponse.json();
                    throw new Error(error.error || 'Failed to upload logo');
                }
            } catch (uploadError) {
                window.adminApp.showNotification('Failed to upload logo: ' + uploadError.message, 'error');
                return;
            }
        } else {
            // Use URL if provided, otherwise keep existing
            logoUrl = formData.get('logo_url') || null;
        }

        const brandData = {};
        for (let [key, value] of formData.entries()) {
            if (key === 'is_active') {
                brandData[key] = true;
            } else if (key !== 'logo_file' && key !== 'logo_url') {
                brandData[key] = value || null;
            }
        }

        // Set logo URL (only update if a new value is provided)
        if (logoUrl !== null) {
            brandData.logo_url = logoUrl;
        }

        if (!formData.has('is_active')) brandData.is_active = false;

        const response = await fetch(`${app.apiBaseUrl}/admin/brands/${brandId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            },
            body: JSON.stringify(brandData)
        });

        if (response.ok) {
            window.adminApp.showNotification('Brand updated successfully!', 'success');
            // Refresh the brands list and dropdown
            if (window.adminApp && typeof window.adminApp.loadBrands === 'function') {
                await window.adminApp.loadBrands();
            }
            // Refresh brand dropdown in edit modal if it exists
            refreshBrandDropdown();
        } else {
            const error = await response.json();
            window.adminApp.showNotification('Failed to update brand: ' + error.error, 'error');
        }
    } catch (error) {
        window.adminApp.showNotification('Error updating brand: ' + error.message, 'error');
    }
}

async function deleteBrand(brandId, brandName) {
    const app = window.adminApp;
    let name = brandName;
    if (!name) {
        const id = Number(brandId);
        const found = (app.allBrands || []).find((b) => Number(b.id) === id);
        name = found?.name || `Brand #${brandId}`;
    }
    const ok = await app.showAdminConfirm({
        title: 'Delete this brand?',
        message: `Remove "${name}" from the catalog? This cannot be undone.`,
        confirmLabel: 'Delete brand',
        cancelLabel: 'Cancel',
        danger: true,
    });
    if (!ok) return;

    try {
        const response = await fetch(`${app.apiBaseUrl}/admin/brands/${brandId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });

        if (response.ok) {
            window.adminApp.showNotification('Brand deleted successfully!', 'success');
            // Refresh the brands list and dropdown
            if (window.adminApp && typeof window.adminApp.loadBrands === 'function') {
                await window.adminApp.loadBrands();
            }
            // Refresh brand dropdown in edit modal if it exists
            refreshBrandDropdown();
        } else {
            const error = await response.json();
            window.adminApp.showNotification('Failed to delete brand: ' + (error.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        window.adminApp.showNotification('Error deleting brand: ' + error.message, 'error');
    }
}

// Category Management Functions
function createCategoryModal(title, formId, isEdit = false) {
    const modal = document.createElement('div');
    modal.className = 'modal';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.maxWidth = '850px'; // Wider for brand form
    modalContent.style.maxHeight = '95vh'; // Allow more vertical space

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';

    const titleEl = document.createElement('h2');
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = HM_CLOSE_ICON_SVG;
    closeBtn.onclick = function () { this.closest('.modal').remove(); };

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.padding = '2.5rem'; // Increased padding

    const form = document.createElement('form');
    form.id = formId;

    // Basic Information Section
    const basicSection = document.createElement('div');
    basicSection.style.marginBottom = '2.5rem'; // Increased spacing
    basicSection.style.paddingBottom = '2rem'; // Increased spacing
    basicSection.style.borderBottom = '1px solid var(--gray-200)';

    const sectionTitle1 = document.createElement('h3');
    sectionTitle1.textContent = 'Basic Information';
    sectionTitle1.style.fontSize = '1.1rem';
    sectionTitle1.style.fontWeight = '600';
    sectionTitle1.style.color = 'var(--primary-green)';
    sectionTitle1.style.marginBottom = '1.5rem'; // Increased spacing below section title
    basicSection.appendChild(sectionTitle1);

    const basicFields = [
        { type: 'input', label: 'Category Name *', id: `${isEdit ? 'edit' : 'add'}-category-name`, name: 'name', inputType: 'text', required: true },
        { type: 'textarea', label: 'Description', id: `${isEdit ? 'edit' : 'add'}-category-description`, name: 'description', rows: 4 }
    ];

    basicFields.forEach(field => {
        const formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        formGroup.style.marginBottom = '1.75rem'; // Increased spacing between fields
        formGroup.style.display = 'flex';
        formGroup.style.flexDirection = 'column';
        formGroup.style.width = '100%';

        const label = document.createElement('label');
        label.setAttribute('for', field.id);
        label.textContent = field.label;
        label.style.display = 'block';
        label.style.marginBottom = '0.75rem';
        label.style.fontWeight = '500';
        label.style.color = 'var(--gray-700)';
        label.style.fontSize = '0.875rem';
        label.style.width = '100%';
        formGroup.appendChild(label);

        if (field.type === 'input') {
            const input = document.createElement('input');
            input.setAttribute('type', field.inputType);
            input.id = field.id;
            input.setAttribute('name', field.name);
            if (field.required) input.setAttribute('required', '');
            if (field.placeholder) input.setAttribute('placeholder', field.placeholder);
            if (field.value) input.setAttribute('value', field.value);
            formGroup.appendChild(input);
        } else if (field.type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.id = field.id;
            textarea.setAttribute('name', field.name);
            if (field.rows) textarea.setAttribute('rows', field.rows.toString());
            formGroup.appendChild(textarea);
        }

        basicSection.appendChild(formGroup);
    });

    // Organization Section
    const orgSection = document.createElement('div');
    orgSection.style.marginBottom = '2.5rem'; // Increased spacing
    orgSection.style.paddingBottom = '2rem'; // Increased spacing
    orgSection.style.borderBottom = '1px solid var(--gray-200)';

    const sectionTitle2 = document.createElement('h3');
    sectionTitle2.textContent = 'Organization';
    sectionTitle2.style.fontSize = '1.1rem';
    sectionTitle2.style.fontWeight = '600';
    sectionTitle2.style.color = 'var(--primary-green)';
    sectionTitle2.style.marginBottom = '1.5rem'; // Increased spacing below section title
    orgSection.appendChild(sectionTitle2);

    const orgRow = document.createElement('div');
    orgRow.className = 'form-row';
    orgRow.style.gap = '1.5rem'; // Increased gap between columns

    const parentGroup = document.createElement('div');
    parentGroup.className = 'form-group';
    parentGroup.style.marginBottom = '0';
    parentGroup.style.display = 'flex';
    parentGroup.style.flexDirection = 'column';
    parentGroup.style.width = '100%';
    const parentLabel = document.createElement('label');
    parentLabel.setAttribute('for', `${isEdit ? 'edit' : 'add'}-category-parent`);
    parentLabel.textContent = 'Parent Category';
    parentLabel.style.display = 'block';
    parentLabel.style.marginBottom = '0.75rem';
    parentLabel.style.fontWeight = '500';
    parentLabel.style.color = 'var(--gray-700)';
    parentLabel.style.fontSize = '0.875rem';
    parentGroup.appendChild(parentLabel);
    const parentSelect = document.createElement('select');
    parentSelect.id = `${isEdit ? 'edit' : 'add'}-category-parent`;
    parentSelect.setAttribute('name', 'parent_id');
    parentSelect.style.width = '100%';
    const noneOption = document.createElement('option');
    noneOption.setAttribute('value', '');
    noneOption.textContent = 'None (Top Level)';
    parentSelect.appendChild(noneOption);
    parentGroup.appendChild(parentSelect);
    orgRow.appendChild(parentGroup);

    const sortGroup = document.createElement('div');
    sortGroup.className = 'form-group';
    sortGroup.style.marginBottom = '0';
    sortGroup.style.display = 'flex';
    sortGroup.style.flexDirection = 'column';
    sortGroup.style.width = '100%';
    const sortLabel = document.createElement('label');
    sortLabel.setAttribute('for', `${isEdit ? 'edit' : 'add'}-category-sort`);
    sortLabel.textContent = 'Sort Order';
    sortLabel.style.display = 'block';
    sortLabel.style.marginBottom = '0.75rem';
    sortLabel.style.fontWeight = '500';
    sortLabel.style.color = 'var(--gray-700)';
    sortLabel.style.fontSize = '0.875rem';
    sortGroup.appendChild(sortLabel);
    const sortInput = document.createElement('input');
    sortInput.setAttribute('type', 'number');
    sortInput.id = `${isEdit ? 'edit' : 'add'}-category-sort`;
    sortInput.setAttribute('name', 'sort_order');
    sortInput.setAttribute('value', '0');
    sortInput.style.width = '100%';
    sortGroup.appendChild(sortInput);
    orgRow.appendChild(sortGroup);

    orgSection.appendChild(orgRow);
    form.appendChild(basicSection);
    form.appendChild(orgSection);

    // Media Section
    const mediaSection = document.createElement('div');
    mediaSection.style.marginBottom = '2.5rem'; // Increased spacing
    mediaSection.style.paddingBottom = '2rem'; // Increased spacing
    mediaSection.style.borderBottom = '1px solid var(--gray-200)';

    const sectionTitle3 = document.createElement('h3');
    sectionTitle3.textContent = 'Media';
    sectionTitle3.style.fontSize = '1.1rem';
    sectionTitle3.style.fontWeight = '600';
    sectionTitle3.style.color = 'var(--primary-green)';
    sectionTitle3.style.marginBottom = '1.5rem'; // Increased spacing below section title
    mediaSection.appendChild(sectionTitle3);

    const imageGroup = document.createElement('div');
    imageGroup.className = 'form-group';
    imageGroup.style.marginBottom = '0';
    imageGroup.style.display = 'flex';
    imageGroup.style.flexDirection = 'column';
    imageGroup.style.width = '100%';
    const imageLabel = document.createElement('label');
    imageLabel.setAttribute('for', `${isEdit ? 'edit' : 'add'}-category-image`);
    imageLabel.textContent = 'Image URL';
    imageLabel.style.display = 'block';
    imageLabel.style.marginBottom = '0.75rem';
    imageLabel.style.fontWeight = '500';
    imageLabel.style.color = 'var(--gray-700)';
    imageLabel.style.fontSize = '0.875rem';
    imageLabel.style.width = '100%';
    imageGroup.appendChild(imageLabel);
    const imageInput = document.createElement('input');
    imageInput.setAttribute('type', 'url');
    imageInput.id = `${isEdit ? 'edit' : 'add'}-category-image`;
    imageInput.setAttribute('name', 'image_url');
    imageInput.setAttribute('placeholder', 'https://example.com/image.png');
    imageInput.style.width = '100%';
    imageGroup.appendChild(imageInput);
    mediaSection.appendChild(imageGroup);
    form.appendChild(mediaSection);

    // Status Section
    const statusSection = document.createElement('div');
    statusSection.style.marginBottom = '2rem';

    const sectionTitle4 = document.createElement('h3');
    sectionTitle4.textContent = 'Status';
    sectionTitle4.style.fontSize = '1.1rem';
    sectionTitle4.style.fontWeight = '600';
    sectionTitle4.style.color = 'var(--primary-green)';
    sectionTitle4.style.marginBottom = '1.5rem'; // Increased spacing below section title
    statusSection.appendChild(sectionTitle4);

    const activeGroup = document.createElement('div');
    activeGroup.className = 'form-group';
    activeGroup.style.marginBottom = '0';
    const activeLabel = document.createElement('label');
    activeLabel.style.display = 'flex';
    activeLabel.style.alignItems = 'center';
    activeLabel.style.cursor = 'pointer';
    activeLabel.style.fontWeight = '500';
    const activeCheckbox = document.createElement('input');
    activeCheckbox.setAttribute('type', 'checkbox');
    activeCheckbox.id = `${isEdit ? 'edit' : 'add'}-category-is-active`;
    activeCheckbox.setAttribute('name', 'is_active');
    activeCheckbox.checked = true;
    activeCheckbox.style.marginRight = '0.75rem';
    activeCheckbox.style.width = '1.25rem';
    activeCheckbox.style.height = '1.25rem';
    activeLabel.appendChild(activeCheckbox);
    activeLabel.appendChild(document.createTextNode(' Active Category'));
    activeGroup.appendChild(activeLabel);
    statusSection.appendChild(activeGroup);
    form.appendChild(statusSection);

    // Form actions
    const actions = document.createElement('div');
    actions.className = 'form-actions';
    actions.style.marginTop = '2.5rem';
    actions.style.paddingTop = '1.5rem';
    actions.style.borderTop = '2px solid var(--gray-200)';

    const cancelBtn = document.createElement('button');
    cancelBtn.setAttribute('type', 'button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn btn-danger';
    cancelBtn.style.padding = '0.875rem 1.75rem';
    cancelBtn.style.fontSize = '0.9375rem';
    cancelBtn.onclick = function () { this.closest('.modal').remove(); };

    const submitBtn = document.createElement('button');
    submitBtn.setAttribute('type', 'submit');
    submitBtn.textContent = isEdit ? 'Update Category' : 'Add Category';
    submitBtn.className = 'btn btn-primary';
    submitBtn.style.padding = '0.875rem 1.75rem';
    submitBtn.style.fontSize = '0.9375rem';

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    form.appendChild(actions);

    body.appendChild(form);
    modalContent.appendChild(header);
    modalContent.appendChild(body);
    modal.appendChild(modalContent);

    return modal;
}

function showAddCategory() {
    const modal = createCategoryModal('Add New Category', 'add-category-form', false);
    document.body.appendChild(modal);
    modal.style.display = 'block';

    // Add Escape key support
    addEscapeKeySupport(modal);

    // Load categories for parent dropdown
    loadCategoriesForParentDropdown('add-category-parent');

    document.getElementById('add-category-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createCategory(new FormData(e.target));
        modal.remove();
    });
}
// Make globally accessible
window.showAddCategory = showAddCategory;

function editCategory(categoryId) {
    const modal = createCategoryModal('Edit Category', 'edit-category-form', true);
    document.body.appendChild(modal);
    modal.style.display = 'block';

    // Add Escape key support
    addEscapeKeySupport(modal);

    // Load categories for parent dropdown (excluding current category)
    loadCategoriesForParentDropdown('edit-category-parent', categoryId);

    loadCategoryForEdit(categoryId);

    document.getElementById('edit-category-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateCategory(categoryId, new FormData(e.target));
        modal.remove();
    });
}

async function loadCategoriesForParentDropdown(selectId, excludeId = null) {
    try {
        const app = window.adminApp;
        const select = document.getElementById(selectId);
        if (!select) return;

        const response = await fetch(`${app.apiBaseUrl}/admin/categories`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });

        if (response.ok) {
            const categories = await response.json();
            const currentValue = select.value;

            // Clear existing options except the first "None" option
            select.innerHTML = '<option value="">None (Top Level)</option>';

            // Add categories to dropdown (excluding the current category if editing)
            categories.forEach(category => {
                if (excludeId && category.id === excludeId) return; // Don't allow self as parent
                const option = document.createElement('option');
                option.value = category.id;
                option.textContent = category.name;
                select.appendChild(option);
            });

            if (currentValue) {
                select.value = currentValue;
            }
        }
    } catch (error) {
        console.error('Error loading categories for parent dropdown:', error);
    }
}

async function loadCategoryForEdit(categoryId) {
    try {
        const app = window.adminApp;
        const response = await fetch(`${app.apiBaseUrl}/admin/categories/${categoryId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });

        if (response.ok) {
            const category = await response.json();

            document.getElementById('edit-category-name').value = category.name || '';
            document.getElementById('edit-category-description').value = category.description || '';
            document.getElementById('edit-category-image').value = category.image_url || '';
            document.getElementById('edit-category-parent').value = category.parent_id || '';
            document.getElementById('edit-category-sort').value = category.sort_order || 0;
            document.getElementById('edit-category-is-active').checked = category.is_active !== false;
        } else {
            window.adminApp.showNotification('Failed to load category data', 'error');
        }
    } catch (error) {
        window.adminApp.showNotification('Error loading category: ' + error.message, 'error');
    }
}

async function createCategory(formData) {
    try {
        const categoryData = {};
        for (let [key, value] of formData.entries()) {
            if (key === 'is_active') {
                categoryData[key] = true;
            } else if (key === 'parent_id' && !value) {
                categoryData[key] = null;
            } else if (key === 'sort_order') {
                categoryData[key] = parseInt(value) || 0;
            } else {
                categoryData[key] = value || null;
            }
        }

        if (!formData.has('is_active')) categoryData.is_active = false;

        const app = window.adminApp;
        const response = await fetch(`${app.apiBaseUrl}/admin/categories`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            },
            body: JSON.stringify(categoryData)
        });

        if (response.ok) {
            window.adminApp.showNotification('Category created successfully!', 'success');
            // Refresh the categories list and dropdown
            if (window.adminApp && typeof window.adminApp.loadCategories === 'function') {
                await window.adminApp.loadCategories();
            }
            // Refresh category dropdown in edit modal if it exists
            refreshCategoryDropdown();
        } else {
            const error = await response.json();
            window.adminApp.showNotification('Failed to create category: ' + error.error, 'error');
        }
    } catch (error) {
        window.adminApp.showNotification('Error creating category: ' + error.message, 'error');
    }
}

async function updateCategory(categoryId, formData) {
    try {
        const categoryData = {};
        for (let [key, value] of formData.entries()) {
            if (key === 'is_active') {
                categoryData[key] = true;
            } else if (key === 'parent_id' && !value) {
                categoryData[key] = null;
            } else if (key === 'sort_order') {
                categoryData[key] = parseInt(value) || 0;
            } else {
                categoryData[key] = value || null;
            }
        }

        if (!formData.has('is_active')) categoryData.is_active = false;

        const app = window.adminApp;
        const response = await fetch(`${app.apiBaseUrl}/admin/categories/${categoryId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            },
            body: JSON.stringify(categoryData)
        });

        if (response.ok) {
            window.adminApp.showNotification('Category updated successfully!', 'success');
            // Refresh the categories list and dropdown
            if (window.adminApp && typeof window.adminApp.loadCategories === 'function') {
                await window.adminApp.loadCategories();
            }
            // Refresh category dropdown in edit modal if it exists
            refreshCategoryDropdown();
        } else {
            const error = await response.json();
            window.adminApp.showNotification('Failed to update category: ' + error.error, 'error');
        }
    } catch (error) {
        window.adminApp.showNotification('Error updating category: ' + error.message, 'error');
    }
}

async function deleteCategory(categoryId, categoryName) {
    const app = window.adminApp;
    let name = categoryName;
    if (!name) {
        const id = Number(categoryId);
        const found = (app.allCategories || []).find((c) => Number(c.id) === id);
        name = found?.name || `Category #${categoryId}`;
    }
    const okCat = await app.showAdminConfirm({
        title: 'Delete this category?',
        message: `Remove "${name}"? This cannot be undone.`,
        confirmLabel: 'Delete category',
        cancelLabel: 'Cancel',
        danger: true,
    });
    if (!okCat) return;

    try {
        const response = await fetch(`${app.apiBaseUrl}/admin/categories/${categoryId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });

        if (response.ok) {
            window.adminApp.showNotification('Category deleted successfully!', 'success');
            // Refresh the categories list and dropdown
            if (window.adminApp && typeof window.adminApp.loadCategories === 'function') {
                await window.adminApp.loadCategories();
            }
            // Refresh category dropdown in edit modal if it exists
            refreshCategoryDropdown();
        } else {
            const error = await response.json();
            window.adminApp.showNotification('Failed to delete category: ' + (error.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        window.adminApp.showNotification('Error deleting category: ' + error.message, 'error');
    }
}

async function deleteProduct(productId, productName) {
    const app = window.adminApp;
    let name = productName;
    if (!name) {
        const id = Number(productId);
        const found = (app.allProducts || []).find((p) => Number(p.id) === id);
        name = found?.name || `Product #${productId}`;
    }
    const okDel = await app.showAdminConfirm({
        title: 'Delete this product?',
        message: `Remove "${name}" from the catalog? This cannot be undone.`,
        confirmLabel: 'Delete product',
        cancelLabel: 'Cancel',
        danger: true,
    });
    if (!okDel) return;

    try {
        const response = await fetch(`${app.apiBaseUrl}/admin/products/${productId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });

        if (response.ok) {
            window.adminApp.showNotification('Product deleted successfully!', 'success');
            // Refresh the products list
            if (window.adminApp && typeof window.adminApp.loadProducts === 'function') {
                await window.adminApp.loadProducts();
            }
        } else {
            const error = await response.json();
            window.adminApp.showNotification('Failed to delete product: ' + (error.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        window.adminApp.showNotification('Error deleting product: ' + error.message, 'error');
    }
}


// Make functions globally accessible
window.showAddBrand = showAddBrand;
window.editBrand = editBrand;
window.deleteBrand = deleteBrand;
window.showAddCategory = showAddCategory;
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.deleteProduct = deleteProduct;
window.editProduct = editProduct;
window.showAddProduct = showAddProduct;
window.matchProductsToBrands = matchProductsToBrands;

async function matchProductsToCategories() {
    const app = window.adminApp;
    const btn = document.getElementById('matchCategoriesBtn');

    if (!app || !app.authToken) {
        app.showNotification('Please log in to match products to categories', 'error');
        return;
    }

    const go = await app.showAdminConfirm({
        title: 'Match products to categories?',
        message:
            'H&M Herbs will match catalog products to categories using names and descriptions. Many rows may be updated. Continue?',
        confirmLabel: 'Run match',
        cancelLabel: 'Cancel',
    });
    if (!go) return;

    try {
        // Disable button and show loading
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Matching...';
        }

        app.showNotification('Matching products to categories...', 'info');

        const response = await app.apiRequest('/admin/products/match-categories', {
            method: 'POST'
        });

        if (response && response.success) {
            const results = response.results;
            let message = `Matching complete! `;
            message += `Matched: ${results.matched}, Updated: ${results.updated}`;
            if (results.notMatched > 0) {
                message += `, Not matched: ${results.notMatched}`;
            }

            app.showNotification(message, 'success');

            // Log category assignments to console
            if (results.categoryAssignments && Object.keys(results.categoryAssignments).length > 0) {
                console.log('ðŸ“‹ Category Assignments:');
                Object.entries(results.categoryAssignments).forEach(([category, count]) => {
                    console.log(`   ${category}: ${count} products`);
                });
            }

            // Reload products to show updated category associations
            setTimeout(() => {
                app.loadProducts();
            }, 1000);

            // Show details if there are unmatched products
            if (results.notMatchedProducts && results.notMatchedProducts.length > 0) {
                console.log('Products that could not be matched:', results.notMatchedProducts);
            }
        } else {
            app.showNotification(response?.error || 'Failed to match products to categories', 'error');
        }
    } catch (error) {
        console.error('Match products to categories error:', error);
        app.showNotification('Error matching products to categories: ' + error.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-tags"></i> Match Products to Categories';
        }
    }
}

window.matchProductsToCategories = matchProductsToCategories;
window.importProducts = importProducts;
window.downloadProductCatalogBackup = downloadProductCatalogBackup;
window.downloadProductImportTemplate = downloadProductImportTemplate;
window.logout = logout;
window.viewOrder = viewOrder;
window.editEDSABooking = editEDSABooking;

// Initialize the admin app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.adminApp = new AdminApp();
    window.adminApp._ensureAdminPortals();

    const marketingHubForm = document.getElementById('marketing-hub-form');
    if (marketingHubForm && window.adminApp) {
        marketingHubForm.addEventListener('submit', (ev) => window.adminApp.saveMarketingHub(ev));
    }
    document.querySelectorAll('[data-admin-nav="pos-equipment"]').forEach((link) => {
        link.addEventListener('click', (ev) => {
            ev.preventDefault();
            window.adminApp.showSection('pos').then(() => {
                document.querySelector('[data-pos-tab="equipment"]')?.click();
            });
        });
    });
    const adminTeamForm = document.getElementById('admin-team-create-form');
    if (adminTeamForm && window.adminApp) {
        adminTeamForm.addEventListener('submit', (ev) => window.adminApp.handleCreateTeamMember(ev));
    }
    const adminTeamRefresh = document.getElementById('admin-team-refresh-btn');
    if (adminTeamRefresh && window.adminApp) {
        adminTeamRefresh.addEventListener('click', () => window.adminApp.loadAdminTeam());
    }
    const registerOnlyForm = document.getElementById('register-only-create-form');
    if (registerOnlyForm && window.adminApp) {
        registerOnlyForm.addEventListener('submit', (ev) => window.adminApp.handleCreateRegisterOnlyEmployee(ev));
    }
    const employeeDiscountForm = document.getElementById('employee-discount-settings-form');
    if (employeeDiscountForm && window.adminApp) {
        employeeDiscountForm.addEventListener('submit', (ev) => window.adminApp.saveEmployeeDiscountSettings(ev));
    }
    const employeeDiscountReloadBtn = document.getElementById('employee-discount-reload-btn');
    if (employeeDiscountReloadBtn && window.adminApp) {
        employeeDiscountReloadBtn.addEventListener('click', () => window.adminApp.loadEmployeeDiscountSettings());
    }
    const inventorySettingsForm = document.getElementById('inventory-settings-form');
    if (inventorySettingsForm && window.adminApp) {
        inventorySettingsForm.addEventListener('submit', (ev) => window.adminApp.saveInventorySettings(ev));
    }
    const inventorySettingsReloadBtn = document.getElementById('inventory-settings-reload-btn');
    if (inventorySettingsReloadBtn && window.adminApp) {
        inventorySettingsReloadBtn.addEventListener('click', () => window.adminApp.loadStoreInfoSettings());
    }
    const posLicenseForm = document.getElementById('pos-license-form');
    if (posLicenseForm && window.adminApp) {
        posLicenseForm.addEventListener('submit', (ev) => window.adminApp.savePosLicense(ev));
        const stationsInput = posLicenseForm.querySelector('[name="licensedStationCount"]');
        if (stationsInput) {
            stationsInput.addEventListener('input', (e) => {
                const licenseSummary = document.getElementById('pos-license-summary');
                const gbMatch = licenseSummary?.textContent?.match(/([\d.]+) GB/);
                const gb = gbMatch ? Number(gbMatch[1]) : 0;
                window.adminApp._updatePosLicensePricingHint(e.target.value, { failoverGbUsed: gb });
            });
        }
    }
    const posLicenseReloadBtn = document.getElementById('pos-license-reload-btn');
    if (posLicenseReloadBtn && window.adminApp) {
        posLicenseReloadBtn.addEventListener('click', () => window.adminApp.loadPosLicense());
    }
    const posLicenseBillingRunBtn = document.getElementById('pos-license-billing-run-btn');
    if (posLicenseBillingRunBtn && window.adminApp) {
        posLicenseBillingRunBtn.addEventListener('click', () => window.adminApp.runPosBillingTest());
    }
    const posLicenseWaiveForm = document.getElementById('pos-license-waive-form');
    if (posLicenseWaiveForm && window.adminApp) {
        posLicenseWaiveForm.addEventListener('submit', (ev) => window.adminApp.waivePosPastDue(ev));
    }
    const posSupportReloadBtn = document.getElementById('pos-support-reload-btn');
    if (posSupportReloadBtn && window.adminApp) {
        posSupportReloadBtn.addEventListener('click', () => window.adminApp.loadPosSupport());
    }
    const posSupportConnectClose = document.getElementById('pos-support-connect-close');
    if (posSupportConnectClose && window.adminApp) {
        posSupportConnectClose.addEventListener('click', () => window.adminApp.closePosSupportConnectModal());
    }
    const posSupportCopyId = document.getElementById('pos-support-copy-id');
    if (posSupportCopyId) {
        posSupportCopyId.addEventListener('click', () => {
            const el = document.getElementById('pos-support-rd-id');
            if (el?.value) navigator.clipboard?.writeText(el.value);
        });
    }
    const posSupportCopyPassword = document.getElementById('pos-support-copy-password');
    if (posSupportCopyPassword) {
        posSupportCopyPassword.addEventListener('click', () => {
            const el = document.getElementById('pos-support-rd-password');
            if (el?.value) navigator.clipboard?.writeText(el.value);
        });
    }
    const posSupportTogglePassword = document.getElementById('pos-support-toggle-password');
    if (posSupportTogglePassword) {
        posSupportTogglePassword.addEventListener('click', () => {
            const el = document.getElementById('pos-support-rd-password');
            if (!el) return;
            el.type = el.type === 'password' ? 'text' : 'password';
            posSupportTogglePassword.textContent = el.type === 'password' ? 'Show' : 'Hide';
        });
    }
    const posSupportOpenRustdesk = document.getElementById('pos-support-open-rustdesk');
    if (posSupportOpenRustdesk && window.adminApp) {
        posSupportOpenRustdesk.addEventListener('click', () => {
            const uri = window.adminApp._posSupportConnectUri;
            if (uri) {
                window.location.href = uri;
            } else {
                const id = document.getElementById('pos-support-rd-id')?.value;
                if (id) window.location.href = `rustdesk://${id}`;
            }
        });
    }
    const posSettingsForm = document.getElementById('pos-settings-form');
    if (posSettingsForm && window.adminApp) {
        posSettingsForm.addEventListener('submit', (ev) => window.adminApp.savePosSettings(ev));
    }
    const posSettingsReloadBtn = document.getElementById('pos-settings-reload-btn');
    if (posSettingsReloadBtn && window.adminApp) {
        posSettingsReloadBtn.addEventListener('click', () => window.adminApp.loadPosSettings());
    }
    const posStoreBaseSaveBtn = document.getElementById('pos-store-base-url-save-btn');
    if (posStoreBaseSaveBtn && window.adminApp) {
        posStoreBaseSaveBtn.addEventListener('click', () => window.adminApp.savePosStoreBaseUrl());
    }
    const posStoreBaseCopyBtn = document.getElementById('pos-store-base-url-copy-btn');
    if (posStoreBaseCopyBtn && window.adminApp) {
        posStoreBaseCopyBtn.addEventListener('click', () => window.adminApp.copyPosStoreBaseUrl());
    }
    const posDeviceCreateBtn = document.getElementById('pos-device-create-btn');
    if (posDeviceCreateBtn && window.adminApp) {
        posDeviceCreateBtn.addEventListener('click', () => window.adminApp.createPosDevice());
    }
    const posDisplayAdForm = document.getElementById('pos-display-ad-form');
    if (posDisplayAdForm && window.adminApp) {
        posDisplayAdForm.addEventListener('submit', (ev) => window.adminApp.savePosDisplayAd(ev));
    }
    const storeInfoForm = document.getElementById('store-info-settings-form');
    if (storeInfoForm && window.adminApp) {
        storeInfoForm.addEventListener('submit', (ev) => window.adminApp.saveStoreInfoSettings(ev));
    }
    const storeInfoReloadBtn = document.getElementById('store-info-reload-btn');
    if (storeInfoReloadBtn && window.adminApp) {
        storeInfoReloadBtn.addEventListener('click', () => window.adminApp.loadStoreInfoSettings());
    }
    const storeHoursSyncGoogleBtn = document.getElementById('store-hours-sync-google-btn');
    if (storeHoursSyncGoogleBtn && window.adminApp) {
        storeHoursSyncGoogleBtn.addEventListener('click', () => window.adminApp.syncStoreHoursToGoogleBusiness());
    }
    const gbpConnectBtn = document.getElementById('gbp-connect-btn');
    if (gbpConnectBtn && window.adminApp) {
        gbpConnectBtn.addEventListener('click', () => window.adminApp.connectGoogleBusiness());
    }
    const gbpDisconnectBtn = document.getElementById('gbp-disconnect-btn');
    if (gbpDisconnectBtn && window.adminApp) {
        gbpDisconnectBtn.addEventListener('click', () => window.adminApp.disconnectGoogleBusiness());
    }
    const gbpSaveLocationBtn = document.getElementById('gbp-save-location-btn');
    if (gbpSaveLocationBtn && window.adminApp) {
        gbpSaveLocationBtn.addEventListener('click', () => window.adminApp.saveGoogleBusinessLocation());
    }
    const gcalConnectBtn = document.getElementById('gcal-connect-btn');
    if (gcalConnectBtn && window.adminApp) {
        gcalConnectBtn.addEventListener('click', () => window.adminApp.connectGoogleCalendar());
    }
    const gcalDisconnectBtn = document.getElementById('gcal-disconnect-btn');
    if (gcalDisconnectBtn && window.adminApp) {
        gcalDisconnectBtn.addEventListener('click', () => window.adminApp.disconnectGoogleCalendar());
    }
    const gcalSaveCalendarBtn = document.getElementById('gcal-save-calendar-btn');
    if (gcalSaveCalendarBtn && window.adminApp) {
        gcalSaveCalendarBtn.addEventListener('click', () => window.adminApp.saveGoogleCalendarSelection());
    }
    const gcalCalendarSelect = document.getElementById('gcal-calendar-select');
    if (gcalCalendarSelect && window.adminApp) {
        gcalCalendarSelect.addEventListener('change', () => {
            const manual = document.getElementById('gcal-calendar-manual');
            if (manual && gcalCalendarSelect.value) manual.value = gcalCalendarSelect.value;
        });
    }
    const promoPresetSelect = document.getElementById('promo-preset');
    if (promoPresetSelect && window.adminApp) {
        promoPresetSelect.addEventListener('change', () => window.adminApp._togglePromoCustomColors());
    }
    const promoIconUploadBtn = document.getElementById('promo-icon-upload-btn');
    if (promoIconUploadBtn && window.adminApp) {
        promoIconUploadBtn.addEventListener('click', () => window.adminApp.uploadPromoBannerIcon());
    }
    const promoIconClearBtn = document.getElementById('promo-icon-clear-btn');
    if (promoIconClearBtn && window.adminApp) {
        promoIconClearBtn.addEventListener('click', () => window.adminApp.clearPromoBannerUploadedIcon());
    }
    const promoBannerSaveBtn = document.getElementById('promo-banner-save-btn');
    if (promoBannerSaveBtn && window.adminApp) {
        promoBannerSaveBtn.addEventListener('click', () => window.adminApp.savePromoBannerSettings());
    }
    if (window.adminApp) {
        window.adminApp.bindPromoProductLinkSearch();
    }
    const holidayTemplateType = document.getElementById('holiday-template-type');
    if (holidayTemplateType && window.adminApp) {
        holidayTemplateType.addEventListener('change', () => window.adminApp._toggleCustomHolidayFields());
    }
    const holidayCustomStatus = document.getElementById('holiday-custom-status');
    if (holidayCustomStatus && window.adminApp) {
        holidayCustomStatus.addEventListener('change', () => window.adminApp._toggleCustomHolidayTimeRange());
    }
    const holidayAddBtn = document.getElementById('holiday-add-btn');
    if (holidayAddBtn && window.adminApp) {
        holidayAddBtn.addEventListener('click', () => window.adminApp.addHolidayFromSelection());
    }
    const holidayList = document.getElementById('holiday-list');
    if (holidayList && window.adminApp) {
        holidayList.addEventListener('click', (ev) => {
            const target = ev.target;
            if (!(target instanceof Element)) return;
            const revertBtn = target.closest('[data-holiday-revert]');
            if (revertBtn) {
                const revertIdx = Number(revertBtn.getAttribute('data-holiday-revert'));
                if (Number.isFinite(revertIdx)) window.adminApp.revertHolidayToDefaultAt(revertIdx);
                return;
            }
            const btn = target.closest('[data-holiday-remove]');
            if (!btn) return;
            const idx = Number(btn.getAttribute('data-holiday-remove'));
            if (Number.isFinite(idx)) window.adminApp.removeHolidayAt(idx);
        });
    }
    const integrationLogsRefreshBtn = document.getElementById('integration-logs-refresh-btn');
    if (integrationLogsRefreshBtn && window.adminApp) {
        integrationLogsRefreshBtn.addEventListener('click', () => window.adminApp.loadIntegrationLogs());
    }
    const integrationLogsClearBtn = document.getElementById('integration-logs-clear-btn');
    if (integrationLogsClearBtn && window.adminApp) {
        integrationLogsClearBtn.addEventListener('click', () => window.adminApp.clearIntegrationLogs());
    }
    const devToolsBackupBtn = document.getElementById('dev-tools-backup-btn');
    if (devToolsBackupBtn && window.adminApp) {
        devToolsBackupBtn.addEventListener('click', () => window.adminApp.downloadDatabaseBackup());
    }
    const devToolsRunMigrationsBtn = document.getElementById('dev-tools-run-migrations-btn');
    if (devToolsRunMigrationsBtn && window.adminApp) {
        devToolsRunMigrationsBtn.addEventListener('click', () => window.adminApp.runPendingMigrations());
    }
    const devIntegrationsForm = document.getElementById('dev-integrations-form');
    if (devIntegrationsForm && window.adminApp) {
        devIntegrationsForm.addEventListener('submit', (ev) => window.adminApp.saveIntegrationCredentials(ev));
    }
    const devIntegrationsTestBtn = document.getElementById('dev-integrations-test-btn');
    if (devIntegrationsTestBtn && window.adminApp) {
        devIntegrationsTestBtn.addEventListener('click', () => window.adminApp.testIntegrationCredentials());
    }
    ['cred_epi_deployment_mode', 'cred_nmi_deployment_mode', 'cred_mxmerchant_deployment_mode', 'cred_mxmerchant_auth_method'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && window.adminApp) {
            el.addEventListener('change', () => window.adminApp._syncIntegrationCredentialVisibility());
        }
    });
    document.querySelectorAll('#dev-integrations-form [data-cred-website-radio], #dev-integrations-form [data-cred-pos-radio]').forEach((radio) => {
        if (radio.dataset.credRadioWired) return;
        radio.dataset.credRadioWired = '1';
        radio.addEventListener('change', () => {
            if (window.adminApp) window.adminApp._syncIntegrationCredentialVisibility();
        });
    });
    const promoForm = document.getElementById('promo-editor-form');
    if (promoForm && window.adminApp) {
        window.adminApp.initPromoProductPickers();
        window.adminApp.initPromoDatetimeUi();
        window.adminApp._promoFillDatetimePartsFromHidden('starts');
        window.adminApp._promoFillDatetimePartsFromHidden('ends');
        promoForm.addEventListener('submit', (ev) => window.adminApp.submitPromoForm(ev));
    }
    const promoResetBtn = document.getElementById('promo-editor-reset-btn');
    if (promoResetBtn && window.adminApp) {
        promoResetBtn.addEventListener('click', () => window.adminApp.resetPromoEditor());
    }
    const promoScopeSel = document.getElementById('promo-form-scope');
    if (promoScopeSel && window.adminApp) {
        promoScopeSel.addEventListener('change', () => window.adminApp._togglePromoScopeHints());
    }

    const promoEditorOpenNewBtn = document.getElementById('promo-editor-open-new-btn');
    if (promoEditorOpenNewBtn && window.adminApp) {
        promoEditorOpenNewBtn.addEventListener('click', () => {
            window.adminApp.resetPromoEditor();
            window.adminApp.openPromoEditorModal();
        });
    }
    const promoEditorModalClose = document.getElementById('promo-editor-modal-close');
    if (promoEditorModalClose && window.adminApp) {
        promoEditorModalClose.addEventListener('click', () => window.adminApp.closePromoEditorModal());
    }
    const promoEditorModalBackdrop = document.getElementById('promo-editor-modal-backdrop');
    if (promoEditorModalBackdrop && window.adminApp) {
        promoEditorModalBackdrop.addEventListener('click', () => window.adminApp.closePromoEditorModal());
    }
    document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        const m = document.getElementById('promo-editor-modal');
        if (!m || m.hidden || !window.adminApp) return;
        if (document.querySelector('.admin-branded-dialog-overlay')) return;

        const app = window.adminApp;
        const linkRes = document.getElementById('promo-product-link-results');
        if (
            linkRes &&
            !linkRes.hasAttribute('hidden') &&
            String(linkRes.style.display || '') !== 'none'
        ) {
            app._promoProductLinkHidePanel();
            ev.preventDefault();
            return;
        }
        let closedPanel = false;
        for (const k of app._promoAllProdSearchKinds()) {
            const res = app._promoProdPickerElements(k)?.res;
            if (res && !res.hidden) {
                app._promoHideProdResults(k);
                closedPanel = true;
            }
        }
        if (closedPanel) {
            ev.preventDefault();
            return;
        }
        app.closePromoEditorModal();
        ev.preventDefault();
    });

    const promotionsTableBody = document.getElementById('promotions-table-body');
    if (promotionsTableBody && window.adminApp) {
        promotionsTableBody.addEventListener('click', (ev) => {
            const target = ev.target;
            if (!(target instanceof Element)) return;
            const editBtn = target.closest('[data-promo-edit]');
            if (editBtn) {
                const id = Number(editBtn.getAttribute('data-promo-edit'));
                if (!window.adminApp) return;
                window.adminApp
                    .apiRequest(`/admin/promotions/${id}`)
                    .then((row) => {
                        if (row && row.id) window.adminApp.fillPromoEditor(row);
                    })
                    .catch(() => window.adminApp.showToast('Could not load promotion for editing.', 'error'));
                return;
            }
            const delBtn = target.closest('[data-promo-delete]');
            if (delBtn && window.adminApp) {
                const id = Number(delBtn.getAttribute('data-promo-delete'));
                window.adminApp.deletePromoById(id);
            }
        });
    }

    // Sidebar toggle functionality (desktop and mobile)
    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    const mobileToggle = document.getElementById('mobileSidebarToggle');
    const sidebar = document.getElementById('adminSidebar');
    const mainContent = document.querySelector('.main-content');

    if (sidebar && mainContent) {
        // Helper: keeps body class in sync with sidebar state so the toggle
        // button can be repositioned via CSS (fallback when :has() is unavailable).
        const syncSidebarState = () => {
            const isCollapsed = sidebar.classList.contains('collapsed');
            document.body.classList.toggle('sidebar-is-collapsed', isCollapsed);
            const icon = document.getElementById('sidebarToggleIcon');
            if (icon) icon.className = isCollapsed ? 'fas fa-bars' : 'fas fa-times';
        };

        // Desktop sidebar toggle
        if (sidebarToggleBtn) {
            sidebarToggleBtn.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
                mainContent.classList.toggle('sidebar-collapsed');
                syncSidebarState();
                localStorage.setItem('adminSidebarCollapsed', sidebar.classList.contains('collapsed'));
            });

            // Restore sidebar state
            const wasCollapsed = localStorage.getItem('adminSidebarCollapsed') === 'true';
            if (wasCollapsed) {
                sidebar.classList.add('collapsed');
                mainContent.classList.add('sidebar-collapsed');
            }
            syncSidebarState();
        }

        // Mobile sidebar toggle functionality
        if (mobileToggle) {
            // Show/hide toggle based on screen size
            function updateMobileToggle() {
                if (window.innerWidth <= 768) {
                    mobileToggle.style.display = 'block';
                    if (sidebarToggleBtn) sidebarToggleBtn.style.display = 'none';
                } else {
                    mobileToggle.style.display = 'none';
                    sidebar.classList.remove('show');
                    if (sidebarToggleBtn) sidebarToggleBtn.style.display = 'block';
                }
            }

            // Initial check
            updateMobileToggle();

            // Update on resize
            window.addEventListener('resize', updateMobileToggle);

            // Toggle sidebar
            mobileToggle.addEventListener('click', () => {
                sidebar.classList.toggle('show');
                const isOpen = sidebar.classList.contains('show');
                mobileToggle.setAttribute('aria-expanded', isOpen);
            });

            // Close sidebar when clicking outside
            document.addEventListener('click', (e) => {
                if (window.innerWidth <= 768 && sidebar.classList.contains('show')) {
                    if (!sidebar.contains(e.target) && !mobileToggle.contains(e.target)) {
                        sidebar.classList.remove('show');
                        mobileToggle.setAttribute('aria-expanded', 'false');
                    }
                }
            });

            // Close sidebar when clicking a nav link on mobile
            const navLinks = sidebar.querySelectorAll('.nav-link');
            navLinks.forEach(link => {
                link.addEventListener('click', () => {
                    if (window.innerWidth <= 768) {
                        sidebar.classList.remove('show');
                        mobileToggle.setAttribute('aria-expanded', 'false');
                    }
                });
            });
        }
    }
});
