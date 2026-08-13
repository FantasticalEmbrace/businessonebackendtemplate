/**
 * Customer Authentication Manager
 * Handles user registration, login, logout, and profile management
 */

/**
 * Decode JWT payload (middle segment) without verifying the signature.
 * Used only to recover `userId` for the storefront header when localStorage
 * has a token but the user JSON is missing or corrupt (quota, Safari ITP, etc.).
 * API routes still validate the token server-side.
 */
function hmherbsDecodeJwtPayloadUnverified(token) {
    try {
        const parts = String(token).split('.');
        if (parts.length < 2) return null;
        let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = (4 - (b64.length % 4)) % 4;
        b64 += '='.repeat(pad);
        const raw = atob(b64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return null;
    }
}

/** Same rule as script.js / checkout.js: hit :3001 API when page is file: or loopback on another port. */
function hmHerbsCustomerBackendOrigin() {
    if (typeof window === 'undefined') return '';
    const explicit = String(
        typeof window.HMHERBS_API_ORIGIN !== 'undefined' && window.HMHERBS_API_ORIGIN
            ? window.HMHERBS_API_ORIGIN
            : ''
    )
        .trim()
        .replace(/\/+$/, '');
    if (explicit) return explicit;
    if (window.location.protocol === 'file:') {
        return 'http://localhost:3001';
    }
    const h = window.location.hostname;
    const isLoopback = h === 'localhost' || h === '127.0.0.1';
    if (isLoopback && window.location.port !== '3001') {
        return 'http://localhost:3001';
    }
    return '';
}

if (typeof window !== 'undefined') {
    window.hmHerbsStorefrontApiBase = hmHerbsCustomerBackendOrigin;
}

class CustomerAuth {
    constructor() {
        const origin = hmHerbsCustomerBackendOrigin();
        this.apiBaseUrl = origin ? `${origin}/api/auth` : '/api/auth';
        this.tokenKey = 'hmherbs_customer_token';
        this.userKey = 'hmherbs_customer_user';
        this.token = null;
        this.user = null;
        this._hydratingProfile = false;
        /** @type {string|null} */
        this._lastProfileDispatchKey = null;
        this.init();
        this._installLifecycleSync();
    }

    init() {
        this._installAuthHeaderSvgs();
        this.setupEventListeners();
        this.checkAuthStatus();
        this._initCheckoutPageIfNeeded();
        ['customer-login-modal', 'customer-register-modal', 'customer-forgot-password-modal'].forEach((id) => {
            this._ensureAuthModalOnTop(document.getElementById(id));
        });
        void this._setupGoogleSignIn();
        this._setupRegisterOptionalContact();
    }

    _registerOptionalContactHtml() {
        return (
            '<button type="button" class="register-optional-toggle" id="register-contact-toggle"' +
            ' aria-expanded="false" aria-controls="register-contact-panel">' +
            '<span class="register-optional-toggle-label">Add phone &amp; mailing address</span>' +
            '<span class="register-optional-toggle-hint">(optional)</span>' +
            '</button>' +
            '<div id="register-contact-panel" class="register-optional-panel" hidden>' +
            '<div class="form-group"><label for="register-phone">Phone</label>' +
            '<input type="tel" id="register-phone" class="form-input" data-phone-us placeholder="(555) 555-0100"' +
            ' maxlength="14" inputmode="numeric" autocomplete="tel"></div>' +
            '<p class="form-help register-address-intro">Start typing your street address for suggestions, or enter it manually.</p>' +
            '<div class="form-group"><label for="register-address-line1">Street address</label>' +
            '<input type="text" id="register-address-line1" class="form-input" placeholder="123 Main St"' +
            ' autocomplete="address-line1"></div>' +
            '<div class="form-group"><label for="register-address-line2">Apt / suite' +
            ' <span class="form-optional">(optional)</span></label>' +
            '<input type="text" id="register-address-line2" class="form-input" placeholder="Apt 4B"' +
            ' autocomplete="address-line2"></div>' +
            '<div class="form-row"><div class="form-group"><label for="register-address-city">City</label>' +
            '<input type="text" id="register-address-city" class="form-input" placeholder="City"' +
            ' autocomplete="address-level2"></div>' +
            '<div class="form-group"><label for="register-address-state">State</label>' +
            '<input type="text" id="register-address-state" class="form-input" placeholder="MS" maxlength="2"' +
            ' autocapitalize="characters" autocomplete="address-level1" aria-describedby="register-state-help">' +
            '<small id="register-state-help" class="form-help">2-letter code</small></div></div>' +
            '<div class="form-group"><label for="register-address-zip">ZIP code</label>' +
            '<input type="text" id="register-address-zip" class="form-input" placeholder="39401"' +
            ' inputmode="numeric" maxlength="10" autocomplete="postal-code"></div>' +
            '</div>'
        );
    }

    _setupRegisterOptionalContact() {
        document.querySelectorAll('#customer-register-form').forEach((form) => {
            if (form.querySelector('#register-optional-contact') || form.querySelector('#register-contact-toggle')) {
                return;
            }

            const dobGroup = form.querySelector('#register-date-of-birth')?.closest('.form-group');
            const legacyPhoneGroup = form.querySelector('#register-phone')?.closest('.form-group');
            const anchor = dobGroup?.nextElementSibling || legacyPhoneGroup || form.querySelector('.form-row');

            const wrap = document.createElement('div');
            wrap.className = 'register-optional-contact';
            wrap.id = 'register-optional-contact';
            wrap.innerHTML = this._registerOptionalContactHtml();

            if (legacyPhoneGroup && !legacyPhoneGroup.querySelector('#register-date-of-birth')) {
                const phoneInput = legacyPhoneGroup.querySelector('#register-phone');
                const panelPhone = wrap.querySelector('#register-phone');
                if (phoneInput && panelPhone) {
                    panelPhone.replaceWith(phoneInput);
                }
                legacyPhoneGroup.remove();
            }

            if (anchor) {
                anchor.insertAdjacentElement('afterend', wrap);
            } else if (dobGroup) {
                dobGroup.insertAdjacentElement('afterend', wrap);
            } else {
                form.appendChild(wrap);
            }

            const phoneFields = form.querySelectorAll('#register-phone');
            for (let i = 1; i < phoneFields.length; i++) {
                const extra = phoneFields[i];
                extra.closest('.form-group')?.remove() || extra.remove();
            }
        });
        if (window.HMHERBS_ADDRESS_AUTOCOMPLETE) {
            window.HMHERBS_ADDRESS_AUTOCOMPLETE.attachStandardForms();
        }
    }

    _toggleRegisterContactPanel(forceOpen) {
        const toggle = document.getElementById('register-contact-toggle');
        const panel = document.getElementById('register-contact-panel');
        if (!toggle || !panel) return;
        const open = typeof forceOpen === 'boolean'
            ? forceOpen
            : toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
    }

    _collapseRegisterContactPanel() {
        this._toggleRegisterContactPanel(false);
    }

    _readRegisterMailingAddress(form) {
        const line1 = form.querySelector('#register-address-line1')?.value.trim() || '';
        const line2 = form.querySelector('#register-address-line2')?.value.trim() || '';
        const city = form.querySelector('#register-address-city')?.value.trim() || '';
        const state = (form.querySelector('#register-address-state')?.value.trim() || '').toUpperCase();
        const postalCode = form.querySelector('#register-address-zip')?.value.trim() || '';
        const any = [line1, line2, city, state, postalCode].some(Boolean);
        if (!any) return undefined;
        return {
            addressLine1: line1,
            addressLine2: line2 || undefined,
            city,
            state,
            postalCode
        };
    }

    _validateRegisterMailingAddress(mailingAddress) {
        if (!mailingAddress) return '';
        const { addressLine1, city, state, postalCode } = mailingAddress;
        if (!addressLine1 || !city || !state || !postalCode) {
            return 'Mailing address requires street, city, state, and ZIP when any address field is filled.';
        }
        if (!/^[A-Z]{2}$/.test(state)) {
            return 'State must be a 2-letter code (e.g. MS).';
        }
        if (!/^\d{5}(-\d{4})?$/.test(postalCode)) {
            return 'ZIP code must be 5 digits or ZIP+4 (12345 or 12345-6789).';
        }
        return '';
    }

    _googleButtonSvg() {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';
    }

    _ensureOAuthStyles() {
        if (document.querySelector('link[data-hm-oauth-css]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'css/oauth-buttons.css';
        link.setAttribute('data-hm-oauth-css', '1');
        document.head.appendChild(link);
    }

    _wireGoogleButton(btn) {
        if (!btn || btn.dataset.oauthWired === '1') return;
        btn.dataset.oauthWired = '1';
        if (!btn.querySelector('svg')) {
            btn.insertAdjacentHTML('afterbegin', this._googleButtonSvg());
        }
        btn.addEventListener('click', () => this.startGoogleSignIn());
    }

    _ensureOAuthBlock(form, enabled) {
        if (!form) return;
        let block = form.querySelector('[data-oauth-block]');
        if (!block && enabled) {
            block = document.createElement('div');
            block.className = 'oauth-signin-block';
            block.setAttribute('data-oauth-block', '');
            block.innerHTML =
                '<button type="button" class="btn-google btn-google-oauth">Continue with Google</button>' +
                '<div class="auth-divider">or</div>';
            const first = form.firstElementChild;
            if (first) form.insertBefore(block, first);
            else form.appendChild(block);
        }
        if (!block) return;
        block.classList.toggle('hidden', !enabled);
        if (enabled) block.removeAttribute('hidden');
        else block.setAttribute('hidden', '');
        block.querySelectorAll('.btn-google-oauth').forEach((btn) => this._wireGoogleButton(btn));
    }

    async _setupGoogleSignIn() {
        this._ensureOAuthStyles();
        const origin = hmHerbsCustomerBackendOrigin();
        const statusUrl = origin ? `${origin}/api/auth/google/status` : '/api/auth/google/status';
        let enabled = false;
        try {
            const res = await fetch(statusUrl);
            if (res.ok) {
                const data = await res.json();
                enabled = Boolean(data?.google?.enabled);
            }
        } catch (_) {
            /* Google sign-in optional */
        }
        ['customer-login-form', 'customer-register-form'].forEach((formId) => {
            this._ensureOAuthBlock(document.getElementById(formId), enabled);
        });
        return enabled;
    }

    startGoogleSignIn() {
        const origin = hmHerbsCustomerBackendOrigin();
        const base = origin ? `${origin}/api/auth` : '/api/auth';
        const returnTo = `${window.location.pathname}${window.location.search}` || '/index.html';
        window.location.href = `${base}/google/start?returnTo=${encodeURIComponent(returnTo)}`;
    }

    /** Stroke SVGs for header auth — crisp at small sizes; matches cart icon approach. */
    _authHeaderSvgMarkup() {
        const stroke =
            'class="auth-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
        return {
            signIn: `<svg ${stroke}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17 15 12 10 7"/><path d="M15 12H3"/></svg>`,
            register: `<svg ${stroke}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>`,
            account: `<svg ${stroke}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
            signOut: `<svg ${stroke}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`
        };
    }

    /**
     * Replace Font Awesome <i> glyphs in header auth buttons with inline SVG.
     * FA webfont often fails on mobile / under performance CSS; cart already uses SVG.
     */
    _installAuthHeaderSvgs() {
        const markup = this._authHeaderSvgMarkup();
        const classToIcon = {
            'fa-sign-in-alt': 'signIn',
            'fa-right-to-bracket': 'signIn',
            'fa-user-plus': 'register',
            'fa-user-circle': 'account',
            'fa-sign-out-alt': 'signOut',
            'fa-right-from-bracket': 'signOut'
        };

        document.querySelectorAll('.customer-auth-container .auth-btn > i[class*="fa-"]').forEach((icon) => {
            if (icon.closest('.auth-btn')?.querySelector('.auth-icon-svg')) return;
            const faClass = Array.from(icon.classList).find((c) => classToIcon[c]);
            if (!faClass) return;
            const template = document.createElement('template');
            template.innerHTML = markup[classToIcon[faClass]].trim();
            const svg = template.content.firstElementChild;
            if (svg) icon.replaceWith(svg);
        });
    }

    /** On checkout.html, hydrate profile early so fields can prefill as soon as checkout.js runs. */
    _initCheckoutPageIfNeeded() {
        try {
            const path = (window.location.pathname || '').toLowerCase();
            if (!path.includes('checkout')) return;
            if (!this.getToken()) return;
            this.stashCheckoutCustomerSnapshot();
            queueMicrotask(() => {
                if (window.customerAuth !== this) return;
                void this.ensureProfileForCheckout().then((user) => {
                    if (user) this._dispatchProfileUpdated();
                });
            });
        } catch {
            /* ignore */
        }
    }

    /**
     * Re-hydrate from localStorage and refresh header UI.
     * Always read storage here so we stay correct after:
     * - bfcache restore (Back button) with a stale DOM snapshot
     * - another tab updating hmherbs_customer_* keys
     */
    _installLifecycleSync() {
        if (CustomerAuth._lifecycleSyncInstalled) return;
        CustomerAuth._lifecycleSyncInstalled = true;

        // Only `persisted` restores: a global pageshow handler was re-running
        // checkAuthStatus() after login and could see token in LS but a missing
        // / unreadable user blob — leaving isAuthenticated() false and the
        // header stuck on Sign In.
        window.addEventListener('pageshow', (ev) => {
            if (ev.persisted && window.customerAuth) window.customerAuth.checkAuthStatus();
        });

        window.addEventListener('storage', (ev) => {
            if (!window.customerAuth) return;
            if (ev.key === window.customerAuth.tokenKey || ev.key === window.customerAuth.userKey) {
                window.customerAuth.checkAuthStatus();
            }
        });
    }

    // Token Management
    getStoredToken() {
        try {
            return localStorage.getItem(this.tokenKey);
        } catch (error) {
            console.error('Error getting stored token:', error);
            return null;
        }
    }

    getStoredUser() {
        try {
            const userStr = localStorage.getItem(this.userKey);
            if (!userStr) return null;
            const parsed = JSON.parse(userStr);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
            return parsed;
        } catch (error) {
            console.error('Error getting stored user:', error);
            return null;
        }
    }

    setStoredToken(token) {
        try {
            if (token) {
                localStorage.setItem(this.tokenKey, token);
            } else {
                localStorage.removeItem(this.tokenKey);
            }
        } catch (error) {
            console.error('Error setting stored token:', error);
        }
    }

    /** Normalize auth/profile API payloads into a single storefront user shape. */
    _normalizeSessionUser(raw) {
        if (!raw || typeof raw !== 'object') return raw;
        let dob = raw.dateOfBirth ?? raw.date_of_birth;
        if (dob != null && typeof dob === 'object' && typeof dob.toISOString === 'function') {
            try {
                dob = dob.toISOString().slice(0, 10);
            } catch {
                dob = '';
            }
        } else if (dob != null && String(dob).trim() !== '') {
            dob = String(dob).slice(0, 10);
        } else {
            dob = '';
        }
        const cn = raw.customerNumber ?? raw.customer_number;
        return {
            id: raw.id,
            email: raw.email != null ? String(raw.email) : '',
            firstName: raw.firstName ?? raw.first_name ?? '',
            lastName: raw.lastName ?? raw.last_name ?? '',
            phone: raw.phone != null ? String(raw.phone) : '',
            dateOfBirth: dob,
            customerNumber: cn != null && String(cn).trim() !== '' ? String(cn) : null,
        };
    }

    /** Normalize a user from localStorage or memory while preserving `__fromJwt`. */
    _sessionUserFromStoredOrPartial(u) {
        if (!u || typeof u !== 'object') return u;
        const fromJwt = u.__fromJwt === true;
        const norm = this._normalizeSessionUser(u);
        if (!norm || typeof norm !== 'object') return u;
        return fromJwt ? { ...norm, __fromJwt: true } : norm;
    }

    // Strip to JSON-safe fields so BigInt / unexpected props cannot break persist.
    _userRecordForStorage(user) {
        if (!user || typeof user !== 'object') return null;
        const id = user.id;
        const norm = this._normalizeSessionUser(user);
        return {
            id: typeof id === 'bigint' ? id.toString() : norm.id,
            email: norm.email,
            firstName: norm.firstName,
            lastName: norm.lastName,
            phone: norm.phone,
            dateOfBirth: norm.dateOfBirth || '',
            customerNumber: norm.customerNumber,
        };
    }

    setStoredUser(user) {
        try {
            if (user) {
                const rec = this._userRecordForStorage(user);
                const json = JSON.stringify(rec, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
                localStorage.setItem(this.userKey, json);
            } else {
                localStorage.removeItem(this.userKey);
            }
            return true;
        } catch (error) {
            console.error('Error setting stored user:', error);
            return false;
        }
    }

    /** After login/register: write storage, then refresh UI without wiping in-memory user if read-back lags. */
    _persistNewSession() {
        const memToken = this.token && String(this.token).trim() ? this.token : null;
        const memUser = this.user && typeof this.user === 'object' && !Array.isArray(this.user) ? this.user : null;

        this.setStoredToken(this.token);
        this.setStoredUser(this.user);

        const rt = this.getStoredToken();
        const ru = this.getStoredUser();

        if (rt) {
            this.token = rt;
        } else if (memToken) {
            // setItem failed or read-back oddity — keep this tab signed in; header/API still work.
            this.token = memToken;
            this.user = memUser;
            console.warn('[customer-auth] Session token did not round-trip to localStorage; using in-memory session.');
        } else {
            this.token = null;
            this.user = null;
            this.updateUI();
            return;
        }

        if (ru && this._userRecordValid(ru)) {
            this.user = this._sessionUserFromStoredOrPartial(ru);
        } else if (memUser && this._userRecordValid(memUser)) {
            this.user = this._sessionUserFromStoredOrPartial(memUser);
            this.setStoredUser(this.user);
        } else if (rt) {
            const ph = this._placeholderUserFromToken(rt);
            if (ph) {
                this.user = ph;
                this.setStoredUser(this.user);
            }
        }
        this.updateUI();
        requestAnimationFrame(() => {
            if (window.customerAuth === this) this.updateUI();
        });
        this.stashCheckoutCustomerSnapshot();
        this._scheduleProfileHydrateIfNeeded();
    }

    _placeholderUserFromToken(tokenStr) {
        const pl = hmherbsDecodeJwtPayloadUnverified(tokenStr);
        if (!pl || typeof pl !== 'object') return null;
        const uid = pl.userId ?? pl.id ?? pl.sub;
        if (uid == null || uid === '') return null;
        return {
            id: uid,
            email: pl.email != null ? String(pl.email) : '',
            firstName: '',
            lastName: '',
            __fromJwt: true,
        };
    }

    /** Stored/API user object must identify the session for the header + isAuthenticated(). */
    _userRecordValid(u) {
        if (!u || typeof u !== 'object' || Array.isArray(u)) return false;
        if (u.__fromJwt === true) return true;
        const idOk = u.id != null && String(u.id).trim() !== '';
        const emailOk = String(u.email || '').trim() !== '';
        return idOk || emailOk;
    }

    _scheduleProfileHydrateIfNeeded() {
        if (!this.isAuthenticated() || !this.user) return;
        const need =
            this.user.__fromJwt === true ||
            !String(this.user.email || '').trim() ||
            !String(this.user.firstName || this.user.first_name || '').trim() ||
            !String(this.user.lastName || this.user.last_name || '').trim();
        if (!need) return;
        queueMicrotask(() => {
            if (window.customerAuth === this) this._hydrateUserProfileFromApi();
        });
    }

    async _hydrateUserProfileFromApi() {
        if (!this.token || !this.user || this._hydratingProfile) return;
        const hasEmail = String(this.user.email || '').trim();
        const hasFirst = String(this.user.firstName || this.user.first_name || '').trim();
        const hasLast = String(this.user.lastName || this.user.last_name || '').trim();
        if (this.user.__fromJwt !== true && hasEmail && hasFirst && hasLast) return;
        this._hydratingProfile = true;
        try {
            const apiRoot = this.apiBaseUrl.replace(/\/auth\/?$/, '');
            const res = await fetch(`${apiRoot}/user/profile`, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    Accept: 'application/json',
                },
            });
            if (!res.ok) return;
            const ct = res.headers.get('Content-Type') || '';
            const data = ct.includes('application/json') ? await res.json() : null;
            const u = data && (data.user || data);
            if (!u || typeof u !== 'object') return;
            const merged = {
                ...this._normalizeSessionUser(u),
                id: u.id != null ? u.id : this.user.id,
            };
            this.user = merged;
            this.setStoredUser(this.user);
            this.updateUI();
            this.stashCheckoutCustomerSnapshot();
            this._dispatchProfileUpdated();
        } catch {
            /* ignore */
        } finally {
            this._hydratingProfile = false;
        }
    }

    _profileDispatchFingerprint() {
        if (!this.user || typeof this.user !== 'object') return '';
        const u = this.user;
        return JSON.stringify({
            id: u.id,
            email: u.email,
            firstName: u.firstName ?? u.first_name,
            lastName: u.lastName ?? u.last_name,
            phone: u.phone,
        });
    }

    _dispatchProfileUpdated() {
        if (typeof window === 'undefined' || !this.user) return;
        const key = this._profileDispatchFingerprint();
        if (key && key === this._lastProfileDispatchKey) return;
        this._lastProfileDispatchKey = key;
        try {
            window.dispatchEvent(
                new CustomEvent('hmherbs:customer-profile-updated', {
                    detail: { user: { ...this.user } },
                })
            );
        } catch {
            /* ignore */
        }
    }

    _normalizeAuthResponsePayload(response) {
        if (!response || typeof response !== 'object') return response;
        const inner = response.data;
        if (inner && typeof inner === 'object' && (inner.token || inner.user || inner.accessToken)) {
            return inner;
        }
        return response;
    }

    // API Request Helper.
    //
    // Tolerant to non-JSON / empty responses (e.g. proxy error HTML). Surfaces
    // express-validator field-level details if the backend returns
    // `{ error: "Validation failed", details: [{ msg }] }`.
    async apiRequest(endpoint, options = {}) {
        const url = `${this.apiBaseUrl}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
        };

        if (this.token) {
            defaultOptions.headers['Authorization'] = `Bearer ${this.token}`;
        }

        const config = { ...defaultOptions, ...options };
        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }

        let response;
        try {
            response = await fetch(url, config);
        } catch (networkErr) {
            console.error('API network error:', networkErr);
            throw new Error('Could not reach the server. Please check your connection and try again.');
        }

        const contentType = response.headers.get('Content-Type') || '';
        let data = null;
        if (contentType.includes('application/json')) {
            try {
                data = await response.json();
            } catch (parseErr) {
                data = null;
            }
        } else {
            try {
                const text = await response.text();
                if (text) {
                    try { data = JSON.parse(text); } catch (e) { data = { error: text }; }
                }
            } catch (e) { /* ignore */ }
        }

        if (!response.ok) {
            const detailMsg = Array.isArray(data?.details) && data.details.length
                ? data.details.map((d) => d?.msg || d?.message).filter(Boolean).join(' • ')
                : '';
            const message =
                detailMsg ||
                data?.error ||
                data?.message ||
                `Request failed (${response.status})`;
            const err = new Error(message);
            err.status = response.status;
            err.body = data;
            throw err;
        }

        return data || {};
    }

    // Registration
    async register(userData) {
        try {
            const response = this._normalizeAuthResponsePayload(
                await this.apiRequest('/register', {
                    method: 'POST',
                    body: userData,
                })
            );

            const token = response.token || response.accessToken;
            const user = response.user || response.customer || response.profile;
            if (token && user) {
                this.token = token;
                this.user = this._normalizeSessionUser(user);
                this._persistNewSession();
                return { success: true, user: this.user };
            }

            throw new Error('Registration failed');
        } catch (error) {
            console.error('Registration error:', error);
            const m = (error && error.message) || '';
            const st = error && error.status;
            if (st === 400 && /already|exists|in use|duplicate/i.test(m)) {
                throw new Error(
                    'There is already an account with this email address. Try signing in, or use “Forgot password” if you need help.'
                );
            }
            throw error;
        }
    }

    // Login
    async login(email, password) {
        try {
            const response = this._normalizeAuthResponsePayload(
                await this.apiRequest('/login', {
                    method: 'POST',
                    body: { email, password },
                })
            );

            if (response && response.success === false) {
                const err = new Error(response.error || 'Login failed');
                err.status = 401;
                throw err;
            }

            const token = response.token || response.accessToken;
            const user = response.user || response.customer || response.profile;
            if (token && user) {
                this.token = token;
                this.user = this._normalizeSessionUser(user);
                this._persistNewSession();
                this._dispatchProfileUpdated();
                return { success: true, user: this.user };
            }

            throw new Error('Login failed');
        } catch (error) {
            const st = error && error.status;
            const msg = (error && error.message) || '';
            const isExpectedAuthFailure =
                st === 401 ||
                /google sign-in|invalid credentials|deactivated|already an account/i.test(msg);
            if (!isExpectedAuthFailure) {
                console.error('Login error:', error);
            }
            throw error;
        }
    }

    // Logout
    logout() {
        this.token = null;
        this.user = null;
        this.setStoredToken(null);
        this.setStoredUser(null);
        try {
            sessionStorage.removeItem('hmherbs_checkout_customer_snapshot');
        } catch {
            /* ignore */
        }
        this.checkAuthStatus();
    }

    // Check if user is authenticated
    isAuthenticated() {
        const t = this.token && String(this.token).trim();
        if (!t) return false;
        // For the storefront header, a token is enough to consider the user "signed in".
        // The API still validates tokens server-side; this prevents the UI getting
        // stuck on guest state when localStorage loses the user blob.
        return true;
    }

    // Get current user
    getCurrentUser() {
        return this.user;
    }

    // Get auth token
    getToken() {
        return this.token;
    }

    /** Save signed-in customer basics for checkout.html (read before API hydrate). */
    stashCheckoutCustomerSnapshot() {
        if (!this.getToken()) return;
        try {
            let user = this.getCurrentUser();
            if (!user || typeof user !== 'object') {
                user = this.getStoredUser();
            }
            if (!user || typeof user !== 'object') return;
            const norm = this._normalizeSessionUser(user);
            sessionStorage.setItem('hmherbs_checkout_customer_snapshot', JSON.stringify(norm));
        } catch {
            /* ignore */
        }
    }

    /**
     * Load full profile for checkout (waits for API when session user is incomplete).
     * @returns {Promise<object|null>}
     */
    async ensureProfileForCheckout() {
        const token = this.getToken() || this.getStoredToken();
        if (!token || !String(token).trim()) return null;
        if (!this.token) this.token = String(token).trim();
        this.checkAuthStatus();

        let user = this.getCurrentUser();
        const incomplete =
            !user ||
            user.__fromJwt === true ||
            !String(user.firstName || user.first_name || '').trim() ||
            !String(user.lastName || user.last_name || '').trim() ||
            !String(user.email || '').trim();

        if (incomplete) {
            await this._hydrateUserProfileFromApi();
            user = this.getCurrentUser();
        }

        if (user && typeof user === 'object') {
            this.stashCheckoutCustomerSnapshot();
        }
        return user && typeof user === 'object' ? user : null;
    }

    /** @returns {Promise<{addresses: Array}>} */
    async fetchUserAddressesForCheckout() {
        const token = this.getToken() || this.getStoredToken();
        if (!token) return { addresses: [] };
        const origin = hmHerbsCustomerBackendOrigin();
        const base = origin ? `${origin}/api` : '/api';
        try {
            const res = await fetch(`${base}/user/addresses`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                },
            });
            if (!res.ok) return { addresses: [] };
            const data = await res.json().catch(() => ({}));
            return { addresses: Array.isArray(data.addresses) ? data.addresses : [] };
        } catch {
            return { addresses: [] };
        }
    }

    // Check auth status and update UI.
    // Always run updateUI() so the header is in sync with current state on
    // every page load — even when logged out (clears any stale leftover from
    // a previous render) and even when logged in.
    //
    // If a token exists but the user JSON is missing or invalid, reuse the
    // in-memory `this.user` from the current tab (e.g. right after login) and
    // try to write it back to localStorage — otherwise isAuthenticated() stays
    // false and the header never leaves guest state.
    checkAuthStatus() {
        const st = this.getStoredToken();
        const su = this.getStoredUser();

        if (st && String(st).trim()) {
            this.token = st;
            let effectiveUser =
                su && typeof su === 'object' && !Array.isArray(su) ? su : null;
            if (effectiveUser && !this._userRecordValid(effectiveUser)) {
                effectiveUser = null;
            }
            if (
                !effectiveUser &&
                this.user &&
                this._userRecordValid(this.user)
            ) {
                this.setStoredUser(this.user);
                effectiveUser = this.getStoredUser();
                if (effectiveUser && !this._userRecordValid(effectiveUser)) {
                    effectiveUser = null;
                }
            }
            if (effectiveUser && typeof effectiveUser === 'object' && !Array.isArray(effectiveUser)) {
                this.user = this._sessionUserFromStoredOrPartial(effectiveUser);
            } else if (this.user && this._userRecordValid(this.user)) {
                this.token = st;
            } else {
                const ph = this._placeholderUserFromToken(st);
                if (ph) {
                    this.user = ph;
                    this.setStoredUser(this.user);
                } else {
                    // Keep the token and use a minimal placeholder so header can switch
                    // out of guest mode even if user JSON can't be recovered.
                    this.user = { id: 'token', email: '', firstName: '', lastName: '', __fromJwt: true };
                    this.setStoredUser(this.user);
                }
            }
        } else {
            // No token in storage: do NOT wipe a valid in-memory session from this tab.
            // _persistNewSession() can leave token only in memory when localStorage is
            // blocked, full, or failed to round-trip — then the next checkAuthStatus()
            // (e.g. right after login) would clear this.user and the header stayed on Sign In.
            const memTok = this.token && String(this.token).trim();
            const memOk = this._userRecordValid(this.user);
            if (memTok && memOk) {
                this.setStoredToken(this.token);
                this.setStoredUser(this.user);
            } else if (!memTok) {
                this.token = null;
                this.user = null;
            } else if (memTok && !memOk) {
                const ph = this._placeholderUserFromToken(memTok);
                if (ph) {
                    this.user = ph;
                    this.setStoredUser(this.user);
                } else {
                    this.token = null;
                    this.user = null;
                }
            }
        }

        const tok = this.token && String(this.token).trim();
        if (tok && !this._userRecordValid(this.user)) {
            const ph = this._placeholderUserFromToken(tok);
            if (ph) {
                this.user = ph;
                this.setStoredUser(this.user);
            } else {
                // Keep the token and use a minimal placeholder so UI stays signed in.
                this.user = { id: 'token', email: '', firstName: '', lastName: '', __fromJwt: true };
                this.setStoredUser(this.user);
            }
        }

        this.updateUI();
        this._scheduleProfileHydrateIfNeeded();
        if (
            this.user &&
            String(this.user.firstName || '').trim() &&
            String(this.user.lastName || '').trim() &&
            String(this.user.email || '').trim()
        ) {
            this._dispatchProfileUpdated();
        }
    }

    // Update UI based on auth status.
    //
    // Preferred: two sibling panels `#customer-auth-guest` and
    // `#customer-auth-user`. We toggle the HTML `hidden` attribute on the
    // *container* only. That removes the entire guest (or user) subtree from
    // layout so no amount of `.navbar .header-actions .auth-btn { display:flex }`
    // specificity on child buttons can keep Sign In visible while "logged in".
    //
    // Fallback (old markup): force display via inline !important.
    updateUI() {
        const guestPanel = document.getElementById('customer-auth-guest');
        const userPanel = document.getElementById('customer-auth-user');
        const userNameDisplay = document.getElementById('customer-name-display');

        if (guestPanel && userPanel) {
            const authed = this.isAuthenticated();
            // Before hiding a panel with aria-hidden, move focus out so the focused
            // control is never inside an aria-hidden subtree (Chrome a11y warning).
            if (authed) {
                this._moveFocusOutIfInside(guestPanel);
            } else {
                this._moveFocusOutIfInside(userPanel);
            }
            guestPanel.hidden = authed;
            userPanel.hidden = !authed;
            if (authed) {
                guestPanel.setAttribute('inert', '');
                userPanel.removeAttribute('inert');
            } else {
                userPanel.setAttribute('inert', '');
                guestPanel.removeAttribute('inert');
            }
            // Inline display beats global `.auth-btn { display:flex !important }` on
            // descendants and any stylesheet that ignores `hidden` on the parent row.
            if (authed) {
                guestPanel.style.setProperty('display', 'none', 'important');
                userPanel.style.setProperty('display', 'flex', 'important');
                guestPanel.setAttribute('aria-hidden', 'true');
                userPanel.removeAttribute('aria-hidden');
            } else {
                userPanel.style.setProperty('display', 'none', 'important');
                guestPanel.style.setProperty('display', 'flex', 'important');
                userPanel.setAttribute('aria-hidden', 'true');
                guestPanel.removeAttribute('aria-hidden');
            }
            const root = guestPanel.closest('.customer-auth-container');
            if (root) {
                root.classList.toggle('customer-auth--signed-in', authed);
                // Keep hit targets live even if a stylesheet/class briefly desyncs
                root.style.pointerEvents = authed ? 'auto' : '';
            }
            if (authed) {
                userPanel.style.pointerEvents = 'auto';
                guestPanel.style.pointerEvents = 'none';
            } else {
                userPanel.style.pointerEvents = 'none';
                guestPanel.style.pointerEvents = '';
            }
            if (userNameDisplay && this.user) {
                const first = this.user.firstName || this.user.first_name || '';
                const last = this.user.lastName || this.user.last_name || '';
                const name = `${first} ${last}`.trim();
                userNameDisplay.textContent = name || 'My Account';
            }
            this._installAuthHeaderSvgs();
            return;
        }

        const loginBtn = document.getElementById('customer-login-btn');
        const registerBtn = document.getElementById('customer-register-btn');
        const accountBtn = document.getElementById('customer-account-btn');

        if (this.isAuthenticated()) {
            if (loginBtn) {
                loginBtn.classList.add('hidden');
                loginBtn.style.setProperty('display', 'none', 'important');
            }
            if (registerBtn) {
                registerBtn.classList.add('hidden');
                registerBtn.style.setProperty('display', 'none', 'important');
            }
            if (accountBtn) {
                accountBtn.classList.remove('hidden');
                accountBtn.style.removeProperty('display');
                accountBtn.style.setProperty('display', 'flex', 'important');
            }
            if (userNameDisplay && this.user) {
                const first = this.user.firstName || this.user.first_name || '';
                const last = this.user.lastName || this.user.last_name || '';
                const name = `${first} ${last}`.trim();
                userNameDisplay.textContent = name || 'My Account';
            }
        } else {
            if (loginBtn) {
                loginBtn.classList.remove('hidden');
                loginBtn.style.removeProperty('display');
            }
            if (registerBtn) {
                registerBtn.classList.remove('hidden');
                registerBtn.style.removeProperty('display');
            }
            if (accountBtn) {
                accountBtn.classList.add('hidden');
                accountBtn.style.setProperty('display', 'none', 'important');
            }
        }

        const rootAuth =
            (loginBtn && loginBtn.closest('.customer-auth-container')) ||
            document.querySelector('.navbar .header-actions .customer-auth-container');
        if (rootAuth) rootAuth.classList.toggle('customer-auth--signed-in', this.isAuthenticated());
        this._installAuthHeaderSvgs();
    }

    /** Capture-phase delegation on each header toolbar (storefront pages). */
    _setupHeaderAuthClickDelegation() {
        document.querySelectorAll('.header-actions').forEach((toolbar) => {
            if (toolbar.dataset.hmAuthDelegation === '1') return;
            toolbar.dataset.hmAuthDelegation = '1';
            toolbar.addEventListener(
                'click',
                (e) => {
                    const logout = e.target.closest('#customer-logout-btn');
                    if (logout) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.handleLogout();
                        return;
                    }
                    const login = e.target.closest('#customer-login-btn');
                    if (login) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.openLoginModal();
                        return;
                    }
                    const register = e.target.closest('#customer-register-btn');
                    if (register) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.openRegisterModal();
                        return;
                    }
                    /* account link: allow default navigation to account.html */
                },
                true
            );
        });
    }

    // Setup event listeners
    setupEventListeners() {
        // Login form submission
        const loginForm = document.getElementById('customer-login-form');
        if (loginForm) {
            // Capture phase: run before document-level submit handlers (error-handling,
            // PWA) so login always runs and preventDefault stops native form submit.
            loginForm.addEventListener('submit', (e) => this.handleLogin(e), true);
        }

        // Register form submission
        const registerForm = document.getElementById('customer-register-form');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => this.handleRegister(e), true);
        }

        // Header toolbar: delegate clicks so labels/icons stay clickable even if
        // a panel overlay or flex squeeze misaligns individual listeners.
        this._setupHeaderAuthClickDelegation();

        // Direct listeners (kept for keyboard activation / redundancy)
        const logoutBtn = document.getElementById('customer-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleLogout();
            });
        }

        const loginBtn = document.getElementById('customer-login-btn');
        const registerBtn = document.getElementById('customer-register-btn');
        if (loginBtn) {
            loginBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openLoginModal();
            });
        }
        if (registerBtn) {
            registerBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openRegisterModal();
            });
        }

        // Modal close buttons
        const loginModal = document.getElementById('customer-login-modal');
        const registerModal = document.getElementById('customer-register-modal');

        if (loginModal) {
            const closeBtn = loginModal.querySelector('.auth-modal-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.closeLoginModal());
            }
            loginModal.addEventListener('click', (e) => {
                if (!e.target.closest('.auth-modal-content')) this.closeLoginModal();
            });
        }

        if (registerModal) {
            const closeBtn = registerModal.querySelector('.auth-modal-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.closeRegisterModal());
            }
            registerModal.addEventListener('click', (e) => {
                if (!e.target.closest('.auth-modal-content')) this.closeRegisterModal();
            });
            this._syncRegisterDobInputConstraints(registerModal);
        }

        // Esc key closes whichever auth modal is currently open. This guarantees
        // keyboard users always exit through the proper close path, which clears
        // the body scroll lock.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const loginOpen = loginModal && loginModal.classList.contains('show');
            const registerOpen = registerModal && registerModal.classList.contains('show');
            const forgotModalEl = document.getElementById('customer-forgot-password-modal');
            const forgotOpen = forgotModalEl && forgotModalEl.classList.contains('show');
            if (forgotOpen) this.closeForgotPasswordModal();
            if (loginOpen) this.closeLoginModal();
            if (registerOpen) this.closeRegisterModal();
        });

        // Switch between login and register
        const showRegisterLink = document.getElementById('show-register-link');
        const showLoginLink = document.getElementById('show-login-link');

        if (showRegisterLink) {
            showRegisterLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeLoginModal();
                this.openRegisterModal();
            });
        }

        if (showLoginLink) {
            showLoginLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeRegisterModal();
                this.openLoginModal();
            });
        }

        document.addEventListener('click', (e) => {
            const toggle = e.target.closest('#register-contact-toggle');
            if (!toggle) return;
            e.preventDefault();
            this._toggleRegisterContactPanel();
        });

        document.addEventListener('input', (e) => {
            if (e.target && e.target.id === 'register-address-state') {
                e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
            }
        });

        const forgotForm = document.getElementById('customer-forgot-password-form');
        if (forgotForm) {
            forgotForm.addEventListener('submit', (e) => this.handleForgotPassword(e), true);
        }
        const forgotLink = document.getElementById('customer-forgot-password-link');
        if (forgotLink) {
            forgotLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.openForgotPasswordModal();
            });
        }
        const forgotModal = document.getElementById('customer-forgot-password-modal');
        if (forgotModal) {
            const forgotClose = forgotModal.querySelector('.auth-modal-close');
            if (forgotClose) {
                forgotClose.addEventListener('click', () => this.closeForgotPasswordModal());
            }
            forgotModal.addEventListener('click', (e) => {
                if (!e.target.closest('.auth-modal-content')) {
                    this.closeForgotPasswordModal();
                }
            });
        }
        const forgotBackLogin = document.getElementById('forgot-password-back-to-login');
        if (forgotBackLogin) {
            forgotBackLogin.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeForgotPasswordModal();
                this.openLoginModal();
            });
        }
    }

    _highlightGoogleSignIn(form) {
        const btn = form && form.querySelector('.btn-google-oauth');
        if (!btn) return;
        btn.classList.add('btn-google-oauth--prompt');
        try {
            btn.focus({ preventScroll: true });
        } catch (_) {
            /* ignore */
        }
        window.setTimeout(() => btn.classList.remove('btn-google-oauth--prompt'), 5000);
    }

    // Show / hide an inline form error. The .auth-error div ships with the
    // global .hidden utility class which is `display: none !important;`, so
    // setting style.display alone never wins — toggle the class instead.
    _setAuthError(errorDiv, message) {
        if (!errorDiv) return;
        if (message) {
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
            errorDiv.style.display = '';
        } else {
            errorDiv.textContent = '';
            errorDiv.classList.add('hidden');
            errorDiv.style.display = '';
        }
    }

    async handleForgotPassword(e) {
        e.preventDefault();
        const form =
            e.currentTarget && e.currentTarget.tagName === 'FORM'
                ? e.currentTarget
                : (e.target && e.target.closest && e.target.closest('form')) || null;
        if (!form || form.id !== 'customer-forgot-password-form') return;
        const emailInput = document.getElementById('forgot-password-email');
        const email = emailInput ? emailInput.value.trim() : '';
        const errorDiv = document.getElementById('forgot-password-error');
        const submitBtn = document.getElementById('customer-forgot-password-submit');

        this._setAuthError(errorDiv, '');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending…';
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ email })
            });
            let data = {};
            try {
                data = await response.json();
            } catch {
                data = {};
            }
            if (!response.ok) {
                const msg =
                    (data && (data.error || data.message)) ||
                    (Array.isArray(data.details) && data.details[0] && data.details[0].message) ||
                    'Request failed';
                throw new Error(typeof msg === 'string' ? msg : 'Request failed');
            }
            this.showNotification(
                data.message || 'If that email is on file, we sent a reset link. Check your inbox.',
                'success',
                5000
            );
            this.closeForgotPasswordModal();
            form.reset();
        } catch (error) {
            const msg = (error && error.message) || 'Could not send reset email. Try again later.';
            this._setAuthError(errorDiv, msg);
            this.showNotification(msg, 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send reset link';
            }
        }
    }

    // Handle login form submission
    async handleLogin(e) {
        e.preventDefault();
        // submit event target can be the submit button in some browsers; listener
        // is on the form so currentTarget is always the form element.
        const form =
            e.currentTarget && e.currentTarget.tagName === 'FORM'
                ? e.currentTarget
                : (e.target && e.target.closest && e.target.closest('form')) || null;
        if (!form || form.id !== 'customer-login-form') return;
        const email = form.querySelector('#login-email').value.trim();
        const password = form.querySelector('#login-password').value;
        const errorDiv = form.querySelector('.auth-error');
        const submitBtn = form.querySelector('button[type="submit"]');

        this._setAuthError(errorDiv, '');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Signing in...';
        }

        try {
            await this.login(email, password);
            this.checkAuthStatus();
            this.closeLoginModal();
            this.showNotification('Login successful!', 'success');
            form.reset();
            this.updateUI();
            requestAnimationFrame(() => this.updateUI());
            setTimeout(() => this.updateUI(), 0);
        } catch (error) {
            const msg = (error && error.message) || 'Login failed. Please try again.';
            this._setAuthError(errorDiv, msg);
            this.showNotification(msg, 'error');
            if (/google sign-in/i.test(msg)) {
                void this._setupGoogleSignIn().then(() => {
                    this._highlightGoogleSignIn(form);
                });
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign In';
            }
        }
    }

    // Handle register form submission
    async handleRegister(e) {
        e.preventDefault();
        const form =
            e.currentTarget && e.currentTarget.tagName === 'FORM'
                ? e.currentTarget
                : (e.target && e.target.closest && e.target.closest('form')) || null;
        if (!form || form.id !== 'customer-register-form') return;
        const firstName = form.querySelector('#register-first-name').value.trim();
        const lastName = form.querySelector('#register-last-name').value.trim();
        const email = form.querySelector('#register-email').value.trim();
        const password = form.querySelector('#register-password').value;
        const confirmPassword = form.querySelector('#register-confirm-password').value;
        const phone = form.querySelector('#register-phone')?.value.trim() || '';
        const dateOfBirth = form.querySelector('#register-date-of-birth')?.value?.trim() || '';
        const errorDiv = form.querySelector('.auth-error');
        const submitBtn = form.querySelector('button[type="submit"]');

        this._setAuthError(errorDiv, '');

        if (password !== confirmPassword) {
            this._setAuthError(errorDiv, 'Passwords do not match.');
            return;
        }

        if (!dateOfBirth) {
            this._setAuthError(errorDiv, 'Date of birth is required.');
            return;
        }

        if (phone) {
            const P = window.HMHERBS_PHONE_US;
            const ok = P ? P.isValidDisplay(phone, false) : /^\(\d{3}\) \d{3}-\d{4}$/.test(phone);
            if (!ok) {
                this._setAuthError(errorDiv, 'Phone must be formatted as (555) 123-4567 or left blank.');
                return;
            }
        }

        const dobUtc = (() => {
            const p = dateOfBirth.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!p) return null;
            return new Date(Date.UTC(Number(p[1]), Number(p[2]) - 1, Number(p[3])));
        })();
        if (!dobUtc || Number.isNaN(dobUtc.getTime())) {
            this._setAuthError(errorDiv, 'Please enter a valid date of birth.');
            return;
        }
        const now = new Date();
        const minBirthDate = new Date(
            Date.UTC(now.getUTCFullYear() - 21, now.getUTCMonth(), now.getUTCDate())
        );
        if (dobUtc > minBirthDate) {
            this._setAuthError(errorDiv, 'You must be 21 or older to create an account.');
            return;
        }

        const mailingAddress = this._readRegisterMailingAddress(form);
        const mailingError = this._validateRegisterMailingAddress(mailingAddress);
        if (mailingError) {
            this._toggleRegisterContactPanel(true);
            this._setAuthError(errorDiv, mailingError);
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating account...';
        }

        try {
            await this.register({
                firstName,
                lastName,
                email,
                password,
                phone: phone || undefined,
                dateOfBirth,
                mailingAddress,
            });
            this.checkAuthStatus();
            this.closeRegisterModal();
            this.showNotification('Account created successfully!', 'success');
            form.reset();
            this.updateUI();
            requestAnimationFrame(() => this.updateUI());
            setTimeout(() => this.updateUI(), 0);
        } catch (error) {
            const msg = (error && error.message) || 'Registration failed. Please try again.';
            this._setAuthError(errorDiv, msg);
            this.showNotification(msg, 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Account';
            }
        }
    }

    // Handle logout
    handleLogout() {
        this.logout();
        this.showNotification('Logged out successfully', 'info');
        // Redirect to home if on account page
        if (window.location.pathname.includes('account.html')) {
            window.location.href = 'index.html';
        }
    }

    // Modal management
    // Lock/unlock page scroll while an auth modal is open. Uses a body class
    // (toggled based on whether ANY auth modal currently has .show) instead of
    // an inline style, so that closing one modal while another is opening
    // can't leave the page in a stuck "no-scroll" state.
    _syncAuthScrollLock() {
        const anyOpen = document.querySelector('.auth-modal.show') !== null;
        document.body.classList.toggle('auth-modal-open', anyOpen);
        // Defensive cleanup: clear any leftover inline overflow from older code.
        if (!anyOpen && document.body.style.overflow === 'hidden') {
            document.body.style.overflow = '';
        }
    }

    // If focus is inside `container`, blur and move to a page-level fallback so
    // ancestors can safely use aria-hidden / display:none (WAI-ARIA: focused
    // element must not be hidden from assistive tech).
    _moveFocusOutIfInside(container) {
        if (!container || !document.activeElement || !container.contains(document.activeElement)) {
            return;
        }
        try {
            document.activeElement.blur();
        } catch (e) {
            /* ignore */
        }
        const fallback = document.querySelector('main, [role="main"], body');
        if (fallback && typeof fallback.focus === 'function') {
            if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1');
            try {
                fallback.focus({ preventScroll: true });
            } catch (e) {
                /* ignore */
            }
        }
    }

    // Make a closed modal visible to AT but inert/hidden. Also moves focus out
    // of it first, so we never end up with `aria-hidden="true"` on an ancestor
    // of the focused element (Chrome warning: "Blocked aria-hidden on an
    // element because its descendant retained focus").
    _hideModalForA11y(modal) {
        if (!modal) return;
        this._moveFocusOutIfInside(modal);
        modal.setAttribute('aria-hidden', 'true');
        modal.setAttribute('inert', '');
    }

    _showModalForA11y(modal) {
        if (!modal) return;
        modal.removeAttribute('inert');
        modal.setAttribute('aria-hidden', 'false');
    }

    /** Move auth overlay to end of <body> so it stacks above header/cart/chrome. */
    _ensureAuthModalOnTop(modal) {
        if (!modal || !document.body) return;
        document.body.appendChild(modal);
    }

    _openAuthModal(modal) {
        if (!modal) return;
        this._ensureAuthModalOnTop(modal);
        modal.classList.add('show');
        this._showModalForA11y(modal);
        this._resetAuthModalScroll(modal);
        this._syncAuthScrollLock();
        window.HMPasswordToggle?.scan(modal);
    }

    /** Keep modal card scrolled to top (avoids focus/animation clipping header + Google button). */
    _resetAuthModalScroll(modal) {
        if (!modal) return;
        const content = modal.querySelector('.auth-modal-content');
        const body = modal.querySelector('.auth-modal-body');
        modal.scrollTop = 0;
        if (content) content.scrollTop = 0;
        if (body) body.scrollTop = 0;
        requestAnimationFrame(() => {
            modal.scrollTop = 0;
            if (content) content.scrollTop = 0;
            if (body) body.scrollTop = 0;
        });
    }

    _focusAuthModalEntry(modal) {
        if (!modal) return;
        const title = modal.querySelector('.auth-modal-header h2');
        const closeBtn = modal.querySelector('.auth-modal-close');
        const target = title || closeBtn;
        if (target && typeof target.focus === 'function') {
            target.setAttribute('tabindex', '-1');
            target.focus({ preventScroll: true });
        }
    }

    openForgotPasswordModal() {
        this.closeLoginModal();
        this.closeRegisterModal();
        const modal = document.getElementById('customer-forgot-password-modal');
        const loginEmail = document.getElementById('login-email');
        const forgotEmail = document.getElementById('forgot-password-email');
        if (forgotEmail && loginEmail && loginEmail.value) {
            forgotEmail.value = loginEmail.value.trim();
        }
        if (modal) {
            this._openAuthModal(modal);
            if (forgotEmail) forgotEmail.focus({ preventScroll: true });
        }
    }

    closeForgotPasswordModal() {
        const modal = document.getElementById('customer-forgot-password-modal');
        if (modal) {
            modal.classList.remove('show');
            this._hideModalForA11y(modal);
            const form = document.getElementById('customer-forgot-password-form');
            if (form) {
                form.reset();
                const errorDiv = document.getElementById('forgot-password-error');
                if (errorDiv) this._setAuthError(errorDiv, '');
            }
        }
        this._syncAuthScrollLock();
    }

    openLoginModal() {
        this.closeForgotPasswordModal();
        const modal = document.getElementById('customer-login-modal');
        if (modal) {
            this._openAuthModal(modal);
            void this._setupGoogleSignIn().then(() => {
                this._resetAuthModalScroll(modal);
            });
            this._focusAuthModalEntry(modal);
        }
    }

    closeLoginModal() {
        const modal = document.getElementById('customer-login-modal');
        if (modal) {
            modal.classList.remove('show');
            this._hideModalForA11y(modal);
            const form = modal.querySelector('#customer-login-form');
            if (form) {
                form.reset();
                const errorDiv = form.querySelector('.auth-error');
                if (errorDiv) {
                    errorDiv.textContent = '';
                    errorDiv.style.display = 'none';
                }
            }
        }
        this._syncAuthScrollLock();
    }

    /** Latest date someone can be born and still be 21+ today (UTC), for `<input type="date" max>`. */
    _maxDateOfBirthForAge21() {
        const d = new Date();
        d.setUTCFullYear(d.getUTCFullYear() - 21);
        return d.toISOString().slice(0, 10);
    }

    _syncRegisterDobInputConstraints(modal) {
        const root = modal || document;
        const el = root.querySelector && root.querySelector('#register-date-of-birth');
        if (!el) return;
        el.max = this._maxDateOfBirthForAge21();
        el.setAttribute('aria-required', 'true');
    }

    openRegisterModal() {
        this.closeForgotPasswordModal();
        this._setupRegisterOptionalContact();
        const modal = document.getElementById('customer-register-modal');
        if (modal) {
            this._syncRegisterDobInputConstraints(modal);
            this._openAuthModal(modal);
            void this._setupGoogleSignIn().then(() => {
                this._resetAuthModalScroll(modal);
            });
            this._focusAuthModalEntry(modal);
        }
    }

    closeRegisterModal() {
        const modal = document.getElementById('customer-register-modal');
        if (modal) {
            modal.classList.remove('show');
            this._hideModalForA11y(modal);
            const form = modal.querySelector('#customer-register-form');
            if (form) {
                form.reset();
                this._collapseRegisterContactPanel();
                const errorDiv = form.querySelector('.auth-error');
                if (errorDiv) {
                    errorDiv.textContent = '';
                    errorDiv.style.display = 'none';
                }
            }
        }
        this._syncAuthScrollLock();
    }

    // Show notification (never use blocking `alert()` for errors — the login
    // modal already shows the message in `.auth-error`, and alert() delays
    // `finally` from feeling responsive and traps the UI on "Signing in...").
    showNotification(message, type = 'info', durationMs = 3000) {
        if (typeof window.hmShowToast === 'function') {
            window.hmShowToast(message, type, { durationMs });
            return;
        }
        const app = window.hmHerbsApp || window.app;
        if (app && typeof app.showNotification === 'function') {
            app.showNotification(message, type, durationMs);
        } else if (window.showNotification && typeof window.showNotification === 'function') {
            window.showNotification(message, type);
        } else if (type === 'error') {
            console.error('[customer-auth]', message);
        } else {
            console.info('[customer-auth]', message);
        }
    }
}

// Initialize on DOM ready
function hmInitCustomerAuth() {
    window.customerAuth = new CustomerAuth();
    window.HMPasswordToggle?.scan(document);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hmInitCustomerAuth);
} else {
    hmInitCustomerAuth();
}

