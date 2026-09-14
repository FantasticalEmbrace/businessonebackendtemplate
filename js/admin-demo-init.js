/**
 * Business One merchant admin demo — patches AdminApp when served via business-one-webpage
 * at /merchant-admin/admin.html?demo=1 (npm run dev).
 * Renamed from merchant-admin-demo-bridge.js — SiteGround WAF blocks filenames containing "bridge".
 */
(function () {
    if (typeof AdminApp === 'undefined') return;

    const DEMO_LOGO_URL = '/images/business-one/logo-big.png?v=50';
    const proto = AdminApp.prototype;
    const origGetApiBaseUrl = proto.getApiBaseUrl;
    const origApiRequest = proto.apiRequest;
    const origInit = proto.init;
    const origLogout = proto.logout;

    proto.getApiBaseUrl = function () {
        const host = window.location.hostname;
        const port = window.location.port;
        if (
            (host === 'localhost' || host === '127.0.0.1') &&
            port === String(window.__BO_DEV_PORT__ || '8080')
        ) {
            return `${window.location.origin.replace(/\/+$/, '')}/api`;
        }
        const meta = document.querySelector('meta[name="business-one-api-origin"]');
        const billing = meta?.getAttribute('content')?.trim();
        if (billing) {
            return `${billing.replace(/\/+$/, '')}/api`;
        }
        return origGetApiBaseUrl.call(this);
    };

    proto.tryDemoFromUrl = async function () {
        const params = new URLSearchParams(window.location.search);
        if (params.get('demo') !== '1') return false;
        const vertical = String(params.get('vertical') || localStorage.getItem('adminDemoVertical') || 'retail').toLowerCase().trim();
        this.demoMode = true;
        this.demoVertical = vertical;
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/demo/auth/bootstrap`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Demo-Vertical': vertical
                }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'Admin demo bootstrap failed');
            }
            this.authToken = data.token;
            localStorage.setItem('adminToken', this.authToken);
            localStorage.setItem('adminDemoMode', '1');
            localStorage.setItem('adminDemoVertical', vertical);
            this.currentUser = data.admin;
            this.allowedSections = data.allowedSections ?? null;
            this.defaultSection = data.defaultSection || 'dashboard';
            this.canManageStoreHours = false;
            this.canManageStoreHoursDelegation = false;
            window.history.replaceState({}, document.title, window.location.pathname);
            this.showDemoBanner(data.storeName);
            if (typeof this.showToast === 'function') {
                this.showToast('Admin demo — sample data only', 'success');
            }
            return true;
        } catch (error) {
            console.warn('Admin demo bootstrap:', error.message);
            window.history.replaceState({}, document.title, window.location.pathname);
            const loginError = document.getElementById('loginError');
            if (loginError) {
                loginError.textContent = error.message || 'Could not start admin demo.';
                loginError.style.display = 'block';
            }
            return false;
        }
    };

    proto.showDemoBanner = function (storeName) {
        if (!this.demoMode) return;
        let banner = document.getElementById('adminDemoBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'adminDemoBanner';
            banner.className = 'admin-demo-banner';
            banner.style.cssText =
                'position:sticky;top:0;z-index:9999;padding:0.55rem 1rem;background:#fef3c7;color:#92400e;text-align:center;font-weight:600;font-size:0.92rem;border-bottom:1px solid #fcd34d;';
            banner.setAttribute('role', 'status');
            document.body.prepend(banner);
        }
        const label = storeName || this.currentUser?.storeName || 'Demo store';
        banner.textContent = `Business One admin demo — ${label}. Sample data only; nothing is saved.`;
        this.applyDemoPresentation(label);
    };

    proto.applyDemoPresentation = function (storeName) {
        if (!this.demoMode) return;
        const shopName = storeName || this.currentUser?.storeName || 'Demo store';
        const vertical = String(this.demoVertical || 'retail').toLowerCase();
        const primary = vertical.split(/[,+|]/)[0] || 'retail';
        document.title = `Business One Admin — ${shopName} (demo)`;

        this.renderDemoBrandBlock(document.querySelector('.sidebar-logo'), shopName, DEMO_LOGO_URL);

        const loginLogo = document.querySelector('.login-logo');
        if (loginLogo) {
            loginLogo.innerHTML =
                `<img src="${DEMO_LOGO_URL}" alt="Business One" class="admin-demo-logo b1-logo-full">` +
                `<strong>Business One Admin</strong>` +
                `<span class="admin-demo-store-name">${this.escapeHtml(shopName)}</span>`;
            loginLogo.style.flexDirection = 'column';
        }
        const loginSubtitle = document.querySelector('.login-subtitle');
        if (loginSubtitle) {
            loginSubtitle.textContent = 'Sales demo — opened from the Business One POS demo.';
        }

        const homeLink = document.querySelector('.sidebar-nav a[href="index.html"]');
        if (homeLink) {
            homeLink.href = '/pos-demo.html';
            homeLink.innerHTML = '<i class="fas fa-home"></i> Back to POS demo';
        }

        const catalogSection = document.querySelector('[data-section="products"]')?.closest('.nav-section');
        const catalogTitle = catalogSection?.querySelector('.nav-section-title');
        if (catalogTitle) {
            if (vertical === 'retail') catalogTitle.textContent = 'Catalog';
            else if (vertical === 'upholstery' || primary === 'upholstery') catalogTitle.textContent = 'Materials & labor';
            else if (primary === 'tire') catalogTitle.textContent = 'Tires & labor';
            else if (vertical.indexOf('tire') >= 0 && vertical.indexOf('auto') >= 0) catalogTitle.textContent = 'Parts, tires & labor';
            else catalogTitle.textContent = 'Parts & labor';
        }

        const productsLink = document.querySelector('[data-section="products"]');
        if (productsLink) {
            const label =
                vertical === 'retail'
                    ? 'Products'
                    : vertical === 'upholstery' || primary === 'upholstery'
                      ? 'Materials & SKUs'
                      : primary === 'tire'
                        ? 'Tires & SKUs'
                        : 'Parts & SKUs';
            productsLink.innerHTML = `<i class="fas fa-boxes"></i> ${label}`;
        }

        const ordersLink = document.querySelector('[data-section="orders"]');
        if (ordersLink) {
            const label =
                vertical === 'retail'
                    ? 'Orders'
                    : vertical === 'upholstery' || primary === 'upholstery'
                      ? 'Deposits & payments'
                      : 'Repair orders';
            ordersLink.innerHTML = `<span class="nav-link-icon" aria-hidden="true">&#128722;</span> ${label}`;
        }

        document.body.classList.add('admin-demo-mode', `admin-demo-${primary}`);
        if (vertical.indexOf(',') >= 0) document.body.classList.add('admin-demo-combined');
    };

    proto.renderDemoBrandBlock = function (container, shopName, logoUrl) {
        if (!container) return;
        container.className = 'sidebar-logo admin-demo-brand';
        container.innerHTML =
            `<img src="${logoUrl}" alt="Business One" class="admin-demo-logo b1-logo-full">` +
            `<span class="admin-demo-store-name">${this.escapeHtml(shopName)}</span>`;
        container.style.visibility = 'visible';
    };

    proto.applyDemoDashboardCards = function (response) {
        if (!this.demoMode || !response) return;
        if (response.products?.stat_title) {
            const title = document.querySelector('#dashboard .stat-card .stat-title');
            if (title) title.textContent = response.products.stat_title;
        }
        const orderCard = document.getElementById('totalOrders')?.closest('.stat-card');
        if (orderCard) {
            const orderTitle = orderCard.querySelector('.stat-title');
            const orderHint = orderCard.querySelector('.stat-change');
            if (response.orders?.stat_title && orderTitle) orderTitle.textContent = response.orders.stat_title;
            if (response.orders?.stat_hint && orderHint) orderHint.textContent = response.orders.stat_hint;
        }
        const metricCard = document.getElementById('totalBookings')?.closest('.stat-card');
        const metricValue = document.getElementById('totalBookings');
        if (metricCard && response.demoMetric) {
            const m = response.demoMetric;
            const titleEl = metricCard.querySelector('.stat-title');
            const hintEl = metricCard.querySelector('.stat-change');
            const iconEl = metricCard.querySelector('.stat-icon i');
            if (titleEl) titleEl.textContent = m.title;
            if (hintEl) hintEl.textContent = m.hint;
            if (iconEl) iconEl.className = `fas ${m.icon || 'fa-chart-line'}`;
            if (metricValue) metricValue.textContent = m.value;
            metricCard.classList.remove('hidden');
        } else if (metricCard) {
            metricCard.classList.remove('hidden');
        }
    };

    proto.apiRequest = async function (endpoint, options = {}) {
        let path = endpoint;
        if (this.demoMode && path.startsWith('/admin/')) {
            path = `/admin/demo${path.slice('/admin'.length)}`;
        }
        return origApiRequest.call(this, path, options);
    };

    proto.init = async function () {
        this.demoMode = localStorage.getItem('adminDemoMode') === '1';
        this.demoVertical = localStorage.getItem('adminDemoVertical') || 'retail';

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

        const demoOk = await this.tryDemoFromUrl();
        if (demoOk) {
            try {
                await this.loadDashboard();
            } catch (error) {
                console.error('Failed to load dashboard in demo mode:', error);
                this.logout();
            }
            this.setupEventListeners();
            return;
        }

        this.setupEventListeners();

        if (this.authToken) {
            if (this.demoMode && this.authToken === 'demo-admin-token') {
                try {
                    const sessionOk = await this.loadSession();
                    if (sessionOk) {
                        await this.loadDashboard();
                        this.showDemoBanner();
                        return;
                    }
                } catch (error) {
                    console.error('Failed to restore admin demo session:', error);
                    this.logout();
                }
            }
            try {
                const sessionOk = await this.loadSession();
                if (!sessionOk) {
                    this.logout();
                    return;
                }
                await this.loadDashboard();
                if (this.demoMode) {
                    this.applyDemoPresentation(this.currentUser?.storeName);
                }
            } catch (error) {
                if (
                    error.message === 'Authentication required' ||
                    error.message.includes('Invalid admin token') ||
                    error.message.includes('403')
                ) {
                    this.logout();
                } else {
                    console.error('Failed to load dashboard:', error);
                    this.logout();
                }
            }
        }

        void this.setupGoogleSignIn();
    };

    proto.logout = function (...args) {
        localStorage.removeItem('adminDemoMode');
        localStorage.removeItem('adminDemoVertical');
        if (this.demoMode) {
            this.demoMode = false;
            this.demoVertical = 'retail';
            document.getElementById('adminDemoBanner')?.remove();
            document.body.classList.remove('admin-demo-mode');
        }
        return origLogout.apply(this, args);
    };

    const origLoadDashboardStats = proto.loadDashboardStats;
    proto.loadDashboardStats = async function (...args) {
        await origLoadDashboardStats.apply(this, args);
        if (this.demoMode) {
            try {
                const response = await this.apiRequest('/admin/dashboard/stats');
                if (response) this.applyDemoDashboardCards(response);
            } catch {
                /* ignore */
            }
        }
    };
})();
