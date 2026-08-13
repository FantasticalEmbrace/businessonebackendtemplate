// EDSA Booking System — calendar modal, slot availability, confirmation redirect

const EDSA_NATIVE_FETCH = (() => {
    const native = window.__nativeFetch;
    return native ? native.bind(window) : fetch.bind(window);
})();

class EDSABookingSystem {
    static modalReady = false;
    static MODAL_VERSION = 4;

    constructor() {
        this.apiBaseUrl = this.getApiBaseUrl();
        this.availableSlots = [];
        this.selectedDate = null;
        this.selectedTime = null;
        this._listenersBound = false;
        this._displayYear = null;
        this._displayMonth = null;
        this.blockedDates = new Set();
        this.storeTodayYmd = null;
        this.storeTimezone = 'America/New_York';
        this.servicePrice = 75;
        this.paymentRequired = false;
        this.nmiEnabled = false;
        this.nmiScriptReady = false;
        this._pendingBookingData = null;
        this._step = 'schedule';
        this.savedCards = [];
        this.selectedSavedCardId = null;
        this._paymentConfig = null;
        this._scrollLocked = false;
        this._lockedScrollY = 0;
        this.businessHours = {
            start: '10:00',
            end: '17:00',
            days: [1, 2, 3, 4, 5],
            slotDuration: 60
        };
        this.init();
    }

    hmHerbsApiOrigin() {
        if (typeof window.hmHerbsStorefrontApiBase === 'function') {
            return window.hmHerbsStorefrontApiBase();
        }
        const explicit = String(window.HMHERBS_API_ORIGIN || '').trim().replace(/\/+$/, '');
        if (explicit) return explicit;
        if (window.location.protocol === 'file:') return 'http://127.0.0.1:3001';
        const h = window.location.hostname;
        if ((h === 'localhost' || h === '127.0.0.1') && window.location.port && window.location.port !== '3001') {
            return 'http://127.0.0.1:3001';
        }
        if (window.location.protocol.startsWith('http')) {
            return window.location.origin;
        }
        return '';
    }

    getApiBaseUrl() {
        const origin = this.hmHerbsApiOrigin();
        return origin ? `${origin}/api/edsa` : '/api/edsa';
    }

    getCustomerAuthHeaders(extra = {}) {
        const headers = { Accept: 'application/json', ...extra };
        const customerToken = localStorage.getItem('hmherbs_customer_token');
        if (customerToken) headers.Authorization = `Bearer ${customerToken}`;
        return headers;
    }

    isCustomerLoggedIn() {
        return Boolean(localStorage.getItem('hmherbs_customer_token'));
    }

    formatLocalDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    formatYmdFromParts(year, monthIndex, day) {
        return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    ymdFromDate(date) {
        return this.formatYmdFromParts(date.getFullYear(), date.getMonth(), date.getDate());
    }

    isPastStoreDate(ymd) {
        const today = this.storeTodayYmd || this.ymdFromDate(new Date());
        return String(ymd).slice(0, 10) < today;
    }

    isBlockedDate(ymd) {
        return this.blockedDates.has(String(ymd).slice(0, 10));
    }

    isSlotStillBookable(dateYmd, timeHm) {
        if (!dateYmd || !timeHm) return false;
        if (this.isPastStoreDate(dateYmd) || this.isBlockedDate(dateYmd)) return false;
        const today = this.storeTodayYmd || this.ymdFromDate(new Date());
        if (dateYmd > today) return true;
        const nowParts = new Intl.DateTimeFormat('en-US', {
            timeZone: this.storeTimezone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(new Date());
        const partMap = Object.fromEntries(nowParts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
        const nowHm = `${String(partMap.hour).padStart(2, '0')}:${String(partMap.minute).padStart(2, '0')}`;
        return String(timeHm).slice(0, 5) > nowHm;
    }

    monthRangeYmd(year, month) {
        const first = this.formatYmdFromParts(year, month, 1);
        const lastDay = new Date(year, month + 1, 0).getDate();
        const last = this.formatYmdFromParts(year, month, lastDay);
        return { from: first, to: last };
    }

    init() {
        this.loadBusinessHours();
    }

    setupModal() {
        const existing = document.getElementById('edsa-booking-modal');
        const version = existing?.getAttribute('data-edsa-modal-version');
        const isCurrentModal =
            existing &&
            version === String(EDSABookingSystem.MODAL_VERSION) &&
            existing.querySelector('#edsa-step-schedule');

        if (isCurrentModal) {
            EDSABookingSystem.modalReady = true;
            return;
        }

        if (existing) {
            existing.remove();
            this._listenersBound = false;
        }

        const prevIcon =
            '<svg class="edsa-calendar-nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';
        const nextIcon =
            '<svg class="edsa-calendar-nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>';

        const modalHTML = `
            <div id="edsa-booking-modal" class="edsa-modal" data-edsa-modal-version="${EDSABookingSystem.MODAL_VERSION}" aria-hidden="true" role="dialog" aria-labelledby="edsa-modal-title">
                <div class="edsa-modal-overlay"></div>
                <div class="edsa-modal-content">
                    <div class="edsa-modal-header">
                        <h2 id="edsa-modal-title">Book Your EDSA Session</h2>
                        <button type="button" class="edsa-modal-close" aria-label="Close booking modal">
                            <svg class="cart-close-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>
                        </button>
                    </div>
                    <div class="edsa-modal-body">
                        <div id="edsa-form-message" class="edsa-form-message" role="alert" hidden></div>
                        <div class="edsa-step-indicator" id="edsa-step-indicator" aria-hidden="true">
                            <span class="edsa-step-dot active" data-step="schedule">1</span>
                            <span class="edsa-step-line"></span>
                            <span class="edsa-step-dot" data-step="details">2</span>
                            <span class="edsa-step-line" id="edsa-step-payment-line"></span>
                            <span class="edsa-step-dot" data-step="payment" id="edsa-step-payment-dot">3</span>
                        </div>
                        <div class="edsa-booking-container">
                            <div id="edsa-step-schedule" class="edsa-step-panel">
                                <div class="edsa-calendar-section">
                                    <div class="edsa-calendar-header">
                                        <button type="button" class="edsa-calendar-nav" id="prev-month" aria-label="Previous month">${prevIcon}</button>
                                        <h3 id="calendar-month-year"></h3>
                                        <button type="button" class="edsa-calendar-nav" id="next-month" aria-label="Next month">${nextIcon}</button>
                                    </div>
                                    <div class="edsa-calendar-grid" id="calendar-grid"></div>
                                    <div class="edsa-time-slots" id="time-slots"></div>
                                </div>
                                <div class="edsa-step-actions">
                                    <button type="button" class="btn btn-secondary" id="edsa-cancel-btn">Cancel</button>
                                    <button type="button" class="btn btn-primary" id="edsa-schedule-continue" disabled>Continue</button>
                                </div>
                            </div>
                            <div id="edsa-step-details" class="edsa-step-panel" hidden>
                                <p class="edsa-selected-summary" id="edsa-selected-summary"></p>
                                <form id="edsa-booking-form" novalidate>
                                    <div class="form-group">
                                        <label for="edsa-first-name">First Name *</label>
                                        <input type="text" id="edsa-first-name" name="firstName" required autocomplete="given-name">
                                    </div>
                                    <div class="form-group">
                                        <label for="edsa-last-name">Last Name *</label>
                                        <input type="text" id="edsa-last-name" name="lastName" required autocomplete="family-name">
                                    </div>
                                    <div class="form-group">
                                        <label for="edsa-email">Email *</label>
                                        <input type="email" id="edsa-email" name="email" required autocomplete="email">
                                    </div>
                                    <div class="form-group">
                                        <label for="edsa-phone">Phone *</label>
                                        <input type="tel" id="edsa-phone" name="phone" required autocomplete="tel"
                                            placeholder="(555) 555-0100" maxlength="14" inputmode="numeric">
                                    </div>
                                    <div class="form-group">
                                        <label for="edsa-notes">Additional Notes</label>
                                        <textarea id="edsa-notes" name="notes" rows="2" autocomplete="off"></textarea>
                                    </div>
                                    <div class="edsa-step-actions">
                                        <button type="button" class="btn btn-secondary" id="edsa-details-back">Back</button>
                                        <button type="submit" class="btn btn-primary" id="edsa-details-continue">Continue</button>
                                    </div>
                                </form>
                            </div>
                            <div id="edsa-step-payment" class="edsa-step-panel" hidden>
                                <p class="edsa-selected-summary" id="edsa-payment-summary"></p>
                                <div class="edsa-payment-section" id="edsa-payment-section">
                                    <div class="edsa-payment-summary">
                                        <span class="edsa-payment-label">Session fee</span>
                                        <span class="edsa-payment-amount" id="edsa-payment-amount">$75.00</span>
                                    </div>
                                    <p class="edsa-payment-note">You chose your appointment time on step 1. Your card is charged here — the calendar invite is sent only after payment succeeds.</p>
                                    <p id="edsa-payment-signin-hint" class="edsa-payment-signin-hint" hidden>
                                        Have an account with a saved card?
                                        <button type="button" class="edsa-link-btn" id="edsa-payment-signin-btn">Sign in</button>
                                        to use it instead of re-entering your card.
                                    </p>
                                    <div id="edsa-saved-cards-block" class="edsa-saved-cards-block" hidden>
                                        <label for="edsa-saved-card-select" class="form-label">Payment method</label>
                                        <select id="edsa-saved-card-select" class="form-select">
                                            <option value="">Use a new card</option>
                                        </select>
                                    </div>
                                    <div id="edsa-nmi-collect-fields" class="edsa-nmi-collect" style="display: none;">
                                        <div class="form-group">
                                            <span id="edsa-ccnumber-label" class="form-label">Card number *</span>
                                            <div id="edsa-ccnumber" class="nmi-field-host" role="group" aria-labelledby="edsa-ccnumber-label"></div>
                                        </div>
                                        <div class="form-row">
                                            <div class="form-group">
                                                <span id="edsa-ccexp-label" class="form-label">Expiration *</span>
                                                <div id="edsa-ccexp" class="nmi-field-host" role="group" aria-labelledby="edsa-ccexp-label"></div>
                                            </div>
                                            <div class="form-group">
                                                <span id="edsa-cvv-label" class="form-label">CVV *</span>
                                                <div id="edsa-cvv" class="nmi-field-host" role="group" aria-labelledby="edsa-cvv-label"></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="edsa-step-actions">
                                    <button type="button" class="btn btn-secondary" id="edsa-payment-back">Back</button>
                                    <button type="button" class="btn btn-primary" id="edsa-pay-btn">Pay &amp; Book Appointment</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        if (window.HMHERBS_PHONE_US) {
            const modal = document.getElementById('edsa-booking-modal');
            if (modal) HMHERBS_PHONE_US.init(modal);
        }
        EDSABookingSystem.modalReady = true;
    }

    mountBookingModal() {
        const modal = document.getElementById('edsa-booking-modal');
        if (!modal) return null;

        document.body.appendChild(modal);

        modal.scrollTop = 0;
        const panel = modal.querySelector('.edsa-modal-content');
        const body = modal.querySelector('.edsa-modal-body');
        if (panel) panel.scrollTop = 0;
        if (body) body.scrollTop = 0;

        return modal;
    }

    fixFormAttributes() {
        const form = document.getElementById('edsa-booking-form');
        if (!form) return;
        form.removeAttribute('method');
        form.removeAttribute('action');
        form.setAttribute('novalidate', '');
    }

    ensureEventListeners() {
        if (this._listenersBound) return;

        const modal = document.getElementById('edsa-booking-modal');
        if (!modal) return;

        const closeBtn = modal.querySelector('.edsa-modal-close');
        const overlay = modal.querySelector('.edsa-modal-overlay');
        const cancelBtn = document.getElementById('edsa-cancel-btn');
        const form = document.getElementById('edsa-booking-form');
        const prevMonth = document.getElementById('prev-month');
        const nextMonth = document.getElementById('next-month');
        const bookBtn = document.getElementById('edsa-book-btn');
        const scheduleContinue = document.getElementById('edsa-schedule-continue');
        const detailsBack = document.getElementById('edsa-details-back');
        const paymentBack = document.getElementById('edsa-payment-back');
        const payBtn = document.getElementById('edsa-pay-btn');
        const savedCardSelect = document.getElementById('edsa-saved-card-select');

        [closeBtn, overlay, cancelBtn].forEach((el) => {
            if (el) el.addEventListener('click', () => this.closeModal());
        });

        if (prevMonth) prevMonth.addEventListener('click', () => this.navigateMonth(-1));
        if (nextMonth) nextMonth.addEventListener('click', () => this.navigateMonth(1));

        if (scheduleContinue) {
            scheduleContinue.addEventListener('click', () => this.goToDetailsStep());
        }
        if (detailsBack) detailsBack.addEventListener('click', () => this.showStep('schedule'));
        if (paymentBack) paymentBack.addEventListener('click', () => this.showStep('details'));
        if (payBtn) payBtn.addEventListener('click', () => this.handlePaymentSubmit());

        if (savedCardSelect) {
            savedCardSelect.addEventListener('change', async () => {
                this.selectedSavedCardId = savedCardSelect.value ? Number(savedCardSelect.value) : null;
                const collect = document.getElementById('edsa-nmi-collect-fields');
                if (collect) {
                    const useNew = !this.selectedSavedCardId;
                    collect.style.display = useNew ? 'block' : 'none';
                    collect.style.opacity = '1';
                }
                if (!this.selectedSavedCardId && this._paymentConfig) {
                    await this.initNmiPayment(this._paymentConfig);
                }
            });
        }

        if (bookBtn) {
            bookBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openModal();
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('show')) {
                this.closeModal();
            }
        });

        document.addEventListener('hmherbs:customer-profile-updated', () => {
            if (this._step === 'payment') {
                void this.loadBookingContext(this._displayYear, this._displayMonth).then(() => {
                    this.renderSavedCardsSelect();
                    this.updatePaymentSignInHint();
                    if (!this.selectedSavedCardId && this._paymentConfig) {
                        void this.initNmiPayment(this._paymentConfig);
                    }
                });
            }
        });

        const signInBtn = document.getElementById('edsa-payment-signin-btn');
        if (signInBtn) {
            signInBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (window.customerAuth?.openLoginModal) {
                    window.customerAuth.openLoginModal();
                } else {
                    this.showFormMessage('Please sign in from the site menu, then return to payment.', 'warning');
                }
            });
        }

        this._listenersBound = true;
    }

    lockPageScroll() {
        if (this._scrollLocked) return;
        this._scrollLocked = true;
        this._lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
        document.documentElement.classList.add('edsa-modal-open');
        document.body.classList.add('edsa-modal-open');
        document.body.style.position = 'fixed';
        document.body.style.top = `-${this._lockedScrollY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
    }

    unlockPageScroll() {
        if (!this._scrollLocked) return;
        const restoreY = this._lockedScrollY || 0;
        this._scrollLocked = false;
        this._lockedScrollY = 0;
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        document.documentElement.classList.remove('edsa-modal-open');
        document.body.classList.remove('edsa-modal-open');
        window.scrollTo(0, restoreY);
    }

    showFormMessage(message, type = 'error') {
        const box = document.getElementById('edsa-form-message');
        if (box) {
            box.hidden = false;
            box.className = `edsa-form-message edsa-form-message-${type}`;
            box.textContent = message;
        }
        if (typeof window.showEdsToast === 'function') {
            window.showEdsToast(message, type);
        }
    }

    clearFormMessage() {
        const box = document.getElementById('edsa-form-message');
        if (box) {
            box.hidden = true;
            box.textContent = '';
        }
    }

    async refreshBookingContextForSubmit() {
        if (window.location.protocol === 'file:') return true;

        try {
            await Promise.race([
                this.loadBookingContext(this._displayYear, this._displayMonth),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('context_timeout')), 10000)
                )
            ]);
            return true;
        } catch (error) {
            console.error('EDSA booking context refresh failed:', error);
            this.showFormMessage(
                'Could not reach the booking server. Please try again in a moment.',
                'error'
            );
            return false;
        }
    }

    async loadBookingContext(year, month) {
        if (window.location.protocol === 'file:') return;

        const range =
            year != null && month != null
                ? this.monthRangeYmd(year, month)
                : this.monthRangeYmd(new Date().getFullYear(), new Date().getMonth());

        try {
            const nativeFetch = window.__nativeFetch || window.fetch;
            const url = `${this.apiBaseUrl}/booking-context?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&_=${Date.now()}`;
            const response = await nativeFetch(url, {
                cache: 'no-store',
                headers: this.getCustomerAuthHeaders()
            });
            if (!response.ok) return;

            const data = await response.json();
            if (data.todayYmd) this.storeTodayYmd = data.todayYmd;
            if (data.storeTimezone) this.storeTimezone = data.storeTimezone;
            if (Number.isFinite(Number(data.price))) this.servicePrice = Number(data.price);
            this.paymentRequired = Boolean(data.paymentRequired);
            this.blockedDates = new Set((data.blockedDates || []).map((d) => String(d).slice(0, 10)));
            this.savedCards = Array.isArray(data.savedCards) ? data.savedCards : [];
            if (data.paymentConfig) this._paymentConfig = data.paymentConfig;

            const amountEl = document.getElementById('edsa-payment-amount');
            if (amountEl) amountEl.textContent = `$${this.servicePrice.toFixed(2)}`;

            const payDot = document.getElementById('edsa-step-payment-dot');
            const payLine = document.getElementById('edsa-step-payment-line');
            if (payDot) payDot.hidden = !this.paymentRequired;
            if (payLine) payLine.hidden = !this.paymentRequired;

            this.renderSavedCardsSelect();
            this.updatePaymentSignInHint();
        } catch {
            /* keep defaults */
        }
    }

    updatePaymentSignInHint() {
        const hint = document.getElementById('edsa-payment-signin-hint');
        if (!hint) return;
        const show = this.paymentRequired && !this.isCustomerLoggedIn() && !this.savedCards.length;
        hint.hidden = !show;
    }

    renderSavedCardsSelect() {
        const block = document.getElementById('edsa-saved-cards-block');
        const select = document.getElementById('edsa-saved-card-select');
        if (!block || !select) return;

        if (!this.savedCards.length) {
            block.hidden = true;
            this.selectedSavedCardId = null;
            this.updatePaymentSignInHint();
            return;
        }

        block.hidden = false;
        this.updatePaymentSignInHint();
        select.innerHTML =
            '<option value="">Use a new card</option>' +
            this.savedCards
                .map(
                    (c) =>
                        `<option value="${c.id}"${c.isDefault ? ' selected' : ''}>${(c.brand || 'Card').toUpperCase()} •••• ${c.last4}</option>`
                )
                .join('');

        const defaultCard = this.savedCards.find((c) => c.isDefault) || this.savedCards[0];
        this.selectedSavedCardId = defaultCard ? defaultCard.id : null;
        if (defaultCard) select.value = String(defaultCard.id);
    }

    formatSelectedAppointmentSummary() {
        if (!this.selectedDate || !this.selectedTime) return '';
        const dateStr = this.selectedDate.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
        return `${dateStr} at ${this.formatTime(this.selectedTime)}`;
    }

    updateSelectedSummary() {
        const summary = this.formatSelectedAppointmentSummary();
        const detailsEl = document.getElementById('edsa-selected-summary');
        const paymentEl = document.getElementById('edsa-payment-summary');
        if (detailsEl) detailsEl.textContent = summary ? `Selected: ${summary}` : '';
        if (paymentEl) paymentEl.textContent = summary ? `Appointment: ${summary}` : '';
    }

    showStep(step) {
        this._step = step;
        const schedule = document.getElementById('edsa-step-schedule');
        const details = document.getElementById('edsa-step-details');
        const payment = document.getElementById('edsa-step-payment');
        if (schedule) schedule.hidden = step !== 'schedule';
        if (details) details.hidden = step !== 'details';
        if (payment) payment.hidden = step !== 'payment';

        document.querySelectorAll('#edsa-step-indicator .edsa-step-dot').forEach((dot) => {
            const dotStep = dot.getAttribute('data-step');
            if (dotStep === 'payment' && !this.paymentRequired) return;
            dot.classList.toggle('active', dotStep === step);
            dot.classList.toggle('completed', this.isStepBefore(dotStep, step));
        });

        const title = document.getElementById('edsa-modal-title');
        if (title) {
            if (step === 'schedule') title.textContent = 'Choose your EDSA date & time';
            else if (step === 'details') title.textContent = 'Your contact information';
            else title.textContent = 'Payment';
        }

        this.clearFormMessage();
        this.updateSelectedSummary();
        this.updateScheduleContinueButton();
    }

    isStepBefore(a, b) {
        const order = this.paymentRequired
            ? ['schedule', 'details', 'payment']
            : ['schedule', 'details'];
        return order.indexOf(a) < order.indexOf(b);
    }

    updateScheduleContinueButton() {
        const btn = document.getElementById('edsa-schedule-continue');
        if (btn) btn.disabled = !(this.selectedDate && this.selectedTime);
    }

    prefillFromLoggedInUser() {
        const auth = window.customerAuth;
        const user = auth?.user;
        if (!user) return;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el && val && !String(el.value || '').trim()) el.value = val;
        };

        setVal('edsa-first-name', user.firstName || user.first_name);
        setVal('edsa-last-name', user.lastName || user.last_name);
        setVal('edsa-email', user.email);
        setVal('edsa-phone', user.phone);
    }

    goToDetailsStep() {
        if (!this.selectedDate || !this.selectedTime) {
            this.showFormMessage('Please select a date and time for your appointment.', 'warning');
            return;
        }
        this.prefillFromLoggedInUser();
        this.showStep('details');
        const detailsBtn = document.getElementById('edsa-details-continue');
        if (detailsBtn) {
            detailsBtn.textContent = this.paymentRequired ? 'Continue to payment' : 'Book Appointment';
        }
    }

    async goToPaymentStep(bookingData) {
        this._pendingBookingData = bookingData;
        this.showStep('payment');
        this.resetSubmitButton();

        try {
            await this.loadBookingContext(this._displayYear, this._displayMonth);
            this.renderSavedCardsSelect();
            this.updatePaymentSignInHint();

            const collect = document.getElementById('edsa-nmi-collect-fields');
            if (this.selectedSavedCardId && collect) {
                collect.style.display = 'none';
            } else if (collect && this.paymentRequired) {
                collect.style.display = 'block';
            }

            if (this.paymentRequired && this._paymentConfig && !this.selectedSavedCardId) {
                await this.initNmiPayment(this._paymentConfig);
            } else if (this.paymentRequired && !this._paymentConfig) {
                this.showFormMessage(
                    'Payment is not available right now. Please call the store to complete your booking.',
                    'warning'
                );
            }
        } catch (err) {
            console.error('EDSA payment step error:', err);
            this.showFormMessage(
                'Could not load payment options. Please try again or call the store.',
                'error'
            );
        }
    }

    collectBookingDataFromForm(form) {
        const formData = new FormData(form);
        return {
            firstName: formData.get('firstName'),
            lastName: formData.get('lastName'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            preferredDate: this.formatLocalDate(this.selectedDate),
            preferredTime: this.selectedTime,
            notes: formData.get('notes') || ''
        };
    }

    getNmiPaymentAmountString() {
        const price = Number(this.servicePrice);
        return Number.isFinite(price) && price >= 0 ? price.toFixed(2) : '75.00';
    }

    buildNmiCollectConfigureOptions() {
        const fieldCss = {
            border: 'none',
            outline: 'none',
            margin: '0',
            padding: '10px 12px',
            'font-size': '16px',
            height: '44px',
            width: '100%',
            'background-color': 'transparent',
            color: '#374151'
        };
        return {
            variant: 'inline',
            styleSniffer: false,
            customCss: fieldCss,
            focusCss: fieldCss,
            invalidCss: { color: '#dc2626' },
            callback: (response) => {
                void this.onNmiPaymentToken(response);
            },
            fields: {
                ccnumber: { selector: '#edsa-ccnumber', placeholder: 'Card number' },
                ccexp: { selector: '#edsa-ccexp', placeholder: 'MM / YY' },
                cvv: { selector: '#edsa-cvv', placeholder: 'CVV' }
            },
            country: 'US',
            currency: 'USD',
            price: this.getNmiPaymentAmountString()
        };
    }

    async initNmiPayment(cfg) {
        if (!cfg?.tokenizationKey) return;
        if (document.getElementById('edsa-nmi-collect-script')) {
            if (typeof window.CollectJS !== 'undefined') {
                this.nmiEnabled = true;
                this.nmiScriptReady = true;
                const block = document.getElementById('edsa-nmi-collect-fields');
                if (block) block.style.display = 'block';
                window.CollectJS.configure(this.buildNmiCollectConfigureOptions());
            }
            return;
        }

        this.nmiEnabled = true;
        const block = document.getElementById('edsa-nmi-collect-fields');
        if (block) block.style.display = 'block';

        const url = cfg.collectJsUrl || 'https://secure.nmi.com/token/Collect.js';
        const script = document.createElement('script');
        script.id = 'edsa-nmi-collect-script';
        script.src = url;
        script.async = true;
        script.setAttribute('data-tokenization-key', cfg.tokenizationKey);
        script.setAttribute('data-country', 'US');
        script.setAttribute('data-currency', 'USD');
        script.setAttribute('data-price', this.getNmiPaymentAmountString());
        // Card-only: omit wallet selectors so Collect.js does not init Apple Pay / Google Pay.
        script.onload = () => {
            if (typeof window.CollectJS === 'undefined') return;
            try {
                const maybePromise = window.CollectJS.configure(this.buildNmiCollectConfigureOptions());
                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then(() => {
                        this.nmiScriptReady = true;
                    }).catch(() => {
                        this.nmiEnabled = false;
                    });
                } else {
                    this.nmiScriptReady = true;
                }
            } catch {
                this.nmiEnabled = false;
            }
        };
        document.head.appendChild(script);
    }

    async onNmiPaymentToken(response) {
        if (!response?.token) {
            const msg =
                (response && (response.error || response.message)) ||
                'Could not process card. Check the details and try again.';
            this.showFormMessage(typeof msg === 'string' ? msg : 'Card tokenization failed', 'error');
            this.resetSubmitButton();
            return;
        }

        if (!this._pendingBookingData) {
            this.showFormMessage('Booking details were lost. Please try again.', 'error');
            this.resetSubmitButton();
            return;
        }

        try {
            await this.submitBooking({
                ...this._pendingBookingData,
                payment_token: response.token
            });
        } finally {
            this._pendingBookingData = null;
        }
    }

    resetSubmitButton() {
        const detailsBtn = document.getElementById('edsa-details-continue');
        const payBtn = document.getElementById('edsa-pay-btn');
        if (detailsBtn && !this._redirecting) {
            detailsBtn.disabled = false;
            detailsBtn.textContent = this.paymentRequired ? 'Continue to payment' : 'Book Appointment';
        }
        if (payBtn && !this._redirecting) {
            payBtn.disabled = false;
            payBtn.textContent = 'Pay & Book Appointment';
        }
    }

    async loadBusinessHours() {
        if (window.location.protocol === 'file:') return;

        try {
            const nativeFetch = window.__nativeFetch || window.fetch;
            const response = await nativeFetch(`${this.apiBaseUrl}/hours`).catch(() => null);
            if (response && response.ok) {
                const data = await response.json();
                if (data.hours) {
                    this.businessHours = { ...this.businessHours, ...data.hours };
                }
            }
        } catch {
            /* use defaults */
        }
    }

    async loadAvailableSlots(date) {
        const dateStr = this.formatLocalDate(date);

        if (window.location.protocol === 'file:') {
            this.availableSlots = this.generateTimeSlots(date);
            return;
        }

        const url = `${this.apiBaseUrl}/available-slots?date=${encodeURIComponent(dateStr)}&_=${Date.now()}`;

        try {
            const nativeFetch = window.__nativeFetch || window.fetch;
            const response = await nativeFetch(url, {
                cache: 'no-store',
                headers: { Accept: 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                this.availableSlots = data.slots || [];
            } else {
                this.availableSlots = this.generateTimeSlots(date);
            }
        } catch (error) {
            if (window.location.protocol !== 'file:') {
                console.warn('Could not load available slots:', error);
            }
            this.availableSlots = this.generateTimeSlots(date);
        }
    }

    generateTimeSlots(date) {
        const slots = [];
        const dayOfWeek = date.getDay();

        if (!this.businessHours.days.includes(dayOfWeek)) {
            return [];
        }

        const [startHour, startMin] = this.businessHours.start.split(':').map(Number);
        const [endHour, endMin] = this.businessHours.end.split(':').map(Number);
        const duration = this.businessHours.slotDuration;

        let currentHour = startHour;
        let currentMin = startMin;

        while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
            const timeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;
            const dateYmd = this.ymdFromDate(date);
            slots.push({
                time: timeStr,
                available: this.isSlotStillBookable(dateYmd, timeStr)
            });
            currentMin += duration;
            if (currentMin >= 60) {
                currentMin = 0;
                currentHour++;
            }
        }

        return slots;
    }

    renderCalendar(year, month) {
        const calendarGrid = document.getElementById('calendar-grid');
        const monthYear = document.getElementById('calendar-month-year');
        if (!calendarGrid || !monthYear) return;

        this._displayYear = year;
        this._displayMonth = month;

        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        monthYear.textContent = `${monthNames[month]} ${year}`;

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayYmd = this.storeTodayYmd || this.ymdFromDate(new Date());

        calendarGrid.innerHTML = '';

        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((day) => {
            const header = document.createElement('div');
            header.className = 'calendar-day-header';
            header.textContent = day;
            calendarGrid.appendChild(header);
        });

        for (let i = 0; i < firstDay; i++) {
            const empty = document.createElement('div');
            empty.className = 'calendar-day empty';
            calendarGrid.appendChild(empty);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day';
            dayCell.textContent = String(day);

            const cellDate = new Date(year, month, day);
            const cellYmd = this.formatYmdFromParts(year, month, day);

            if (this.isPastStoreDate(cellYmd) || this.isBlockedDate(cellYmd)) {
                dayCell.classList.add('disabled');
                if (this.isBlockedDate(cellYmd)) {
                    dayCell.classList.add('blocked');
                    dayCell.title = 'Not available for booking';
                }
            } else {
                dayCell.addEventListener('click', () => this.selectDate(cellDate));
                if (cellYmd === todayYmd) {
                    dayCell.classList.add('today');
                }
            }

            if (this.selectedDate && this.ymdFromDate(this.selectedDate) === cellYmd) {
                dayCell.classList.add('selected');
            }

            calendarGrid.appendChild(dayCell);
        }
    }

    async selectDate(date) {
        this.selectedDate = new Date(date);
        this.selectedTime = null;
        this.clearFormMessage();

        this.renderCalendar(this.selectedDate.getFullYear(), this.selectedDate.getMonth());
        await this.loadAvailableSlots(this.selectedDate);
        this.renderTimeSlots();
        this.updateScheduleContinueButton();
    }

    renderTimeSlots() {
        const timeSlotsContainer = document.getElementById('time-slots');
        if (!timeSlotsContainer) return;

        if (!this.selectedDate) {
            timeSlotsContainer.innerHTML = '<p class="no-date-selected">Please select a date first</p>';
            return;
        }

        if (this.availableSlots.length === 0) {
            timeSlotsContainer.innerHTML = '<p class="no-slots">No time slots for this date</p>';
            return;
        }

        timeSlotsContainer.innerHTML = '<h4>Available Times</h4><div class="time-slots-grid"></div>';
        const grid = timeSlotsContainer.querySelector('.time-slots-grid');

        this.availableSlots.forEach((slot) => {
            const dateYmd = this.selectedDate ? this.ymdFromDate(this.selectedDate) : null;
            const bookable = slot.available && this.isSlotStillBookable(dateYmd, slot.time);
            const slotBtn = document.createElement('button');
            slotBtn.type = 'button';
            slotBtn.className = 'time-slot-btn';
            slotBtn.textContent = this.formatTime(slot.time);
            slotBtn.disabled = !bookable;

            if (!bookable) {
                slotBtn.classList.add('unavailable');
            } else {
                slotBtn.addEventListener('click', () => this.selectTime(slot.time));
            }

            if (this.selectedTime === slot.time) {
                slotBtn.classList.add('selected');
            }

            grid.appendChild(slotBtn);
        });
    }

    selectTime(time) {
        this.selectedTime = time;
        this.clearFormMessage();
        this.renderTimeSlots();
        this.updateScheduleContinueButton();
    }

    formatTime(timeStr) {
        const [hours, minutes] = timeStr.split(':');
        const hour = parseInt(hours, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minutes} ${ampm}`;
    }

    navigateMonth(direction) {
        let year = this._displayYear;
        let month = this._displayMonth;
        if (year == null || month == null) {
            const now = new Date();
            year = now.getFullYear();
            month = now.getMonth();
        }
        const d = new Date(year, month + direction, 1);
        void this.loadBookingContext(d.getFullYear(), d.getMonth());
        this.renderCalendar(d.getFullYear(), d.getMonth());
    }

    confirmationPageOrigin() {
        const apiOrigin = this.hmHerbsApiOrigin();
        const pageOrigin = window.location.origin;
        if (apiOrigin && apiOrigin !== pageOrigin) {
            return apiOrigin;
        }
        return pageOrigin || apiOrigin || '';
    }

    buildConfirmationUrl({ bookingId, email, preferredDate, preferredTime, firstName, lastName }) {
        const params = new URLSearchParams();
        if (bookingId != null && bookingId !== '') params.set('booking', String(bookingId));
        if (email) params.set('email', String(email).trim());
        if (preferredDate) params.set('date', preferredDate);
        if (preferredTime) params.set('time', preferredTime);
        if (firstName) params.set('firstName', firstName);
        if (lastName) params.set('lastName', lastName);

        const origin = this.confirmationPageOrigin() || window.location.origin;
        const base = origin.endsWith('/') ? origin : `${origin}/`;
        return `${base}edsa-confirmation.html?${params.toString()}`;
    }

    redirectToConfirmation(details) {
        const href = this.buildConfirmationUrl(details);
        this._redirecting = true;

        const modal = document.getElementById('edsa-booking-modal');
        if (modal) {
            modal.classList.remove('show');
            modal.setAttribute('aria-hidden', 'true');
        }
        this.unlockPageScroll();

        window.location.replace(href);
        setTimeout(() => {
            if (!/\/edsa-confirmation\.html/i.test(window.location.pathname)) {
                window.location.href = href;
            }
        }, 150);
    }

    async submitBooking(bookingData) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);

        try {
            const response = await EDSA_NATIVE_FETCH(`${this.apiBaseUrl}/book`, {
                method: 'POST',
                headers: this.getCustomerAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(bookingData),
                signal: controller.signal
            });

            let result = {};
            try {
                result = await response.json();
            } catch {
                result = {};
            }

            const booked =
                response.status === 201 ||
                (response.ok && (result.bookingId != null || result.message));

            if (booked) {
                this._redirecting = true;
                this.redirectToConfirmation({
                    bookingId: result.bookingId,
                    email: bookingData.email,
                    preferredDate: result.preferredDate || bookingData.preferredDate,
                    preferredTime: result.preferredTime || bookingData.preferredTime,
                    firstName: bookingData.firstName,
                    lastName: bookingData.lastName
                });
                return;
            }

            const msg = result.error || 'Failed to book appointment. Please try again.';
            this.showFormMessage(msg, response.status === 409 || response.status === 402 ? 'warning' : 'error');
        } catch (error) {
            console.error('Booking error:', error);
            const msg =
                error?.name === 'AbortError'
                    ? 'Booking is taking too long. Please try again or call the store.'
                    : 'An error occurred while booking. Please try again.';
            this.showFormMessage(msg, 'error');
        } finally {
            clearTimeout(timeoutId);
            if (!this._redirecting) {
                this.resetSubmitButton();
            }
        }
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.clearFormMessage();

        const form =
            (e.target && e.target.id === 'edsa-booking-form' ? e.target : null) ||
            (e.currentTarget && e.currentTarget.id === 'edsa-booking-form' ? e.currentTarget : null) ||
            document.getElementById('edsa-booking-form');
        if (!form) return;

        if (window.location.protocol === 'file:') {
            this.showFormMessage(
                'Booking requires the web server. Start the backend, then open http://localhost:3001/index.html',
                'warning'
            );
            return;
        }

        if (!this.selectedDate || !this.selectedTime) {
            this.showFormMessage('Please select a date and time for your appointment.', 'warning');
            return;
        }

        const dateYmd = this.formatLocalDate(this.selectedDate);
        if (!this.isSlotStillBookable(dateYmd, this.selectedTime)) {
            this.showFormMessage('That time is no longer available. Please choose another slot.', 'warning');
            await this.loadAvailableSlots(this.selectedDate);
            this.renderTimeSlots();
            return;
        }

        const formData = new FormData(form);
        const phoneRaw = String(formData.get('phone') || '').trim();
        if (!window.HMHERBS_PHONE_US || !HMHERBS_PHONE_US.isValidDisplay(phoneRaw, false)) {
            this.showFormMessage('Please enter a valid phone in the format (555) 555-0100.', 'warning');
            return;
        }

        const bookingData = this.collectBookingDataFromForm(form);

        const detailsBtn = document.getElementById('edsa-details-continue');
        if (detailsBtn) {
            detailsBtn.disabled = true;
            detailsBtn.textContent = 'Please wait...';
        }

        try {
            if (!(await this.refreshBookingContextForSubmit())) {
                return;
            }

            if (this.paymentRequired) {
                await this.goToPaymentStep(bookingData);
                return;
            }

            await this.submitBooking(bookingData);
        } catch (error) {
            console.error('EDSA form submit error:', error);
            this.showFormMessage('Something went wrong. Please try again.', 'error');
        } finally {
            if (!this._redirecting && this._step !== 'payment') {
                this.resetSubmitButton();
            }
        }
    }

    async handlePaymentSubmit() {
        this.clearFormMessage();

        if (!this._pendingBookingData) {
            this.showFormMessage('Booking details were lost. Please go back and try again.', 'error');
            return;
        }

        const payBtn = document.getElementById('edsa-pay-btn');
        if (payBtn) {
            payBtn.disabled = true;
            payBtn.textContent = 'Processing payment...';
        }

        if (this.selectedSavedCardId) {
            try {
                await this.submitBooking({
                    ...this._pendingBookingData,
                    savedCardId: this.selectedSavedCardId
                });
            } finally {
                this._pendingBookingData = null;
            }
            return;
        }

        if (!this.nmiEnabled || !this.nmiScriptReady || typeof window.CollectJS === 'undefined') {
            this.showFormMessage(
                'Secure card fields are not ready yet. Please wait a moment and try again.',
                'warning'
            );
            this.resetSubmitButton();
            return;
        }

        try {
            window.CollectJS.startPaymentRequest();
        } catch (error) {
            console.error('NMI startPaymentRequest error:', error);
            this.showFormMessage(error.message || 'Could not start payment', 'error');
            this.resetSubmitButton();
        }
    }

    openModal() {
        this.setupModal();
        this.ensureEventListeners();
        const modal = this.mountBookingModal();
        if (!modal) return;

        this.fixFormAttributes();
        this.clearFormMessage();
        this.lockPageScroll();

        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');

        const now = new Date();
        this.selectedDate = null;
        this.selectedTime = null;
        this.availableSlots = [];
        this._pendingBookingData = null;
        this._step = 'schedule';
        this.selectedSavedCardId = null;
        this.showStep('schedule');
        void this.loadBookingContext(now.getFullYear(), now.getMonth()).then(() => {
            this.renderCalendar(now.getFullYear(), now.getMonth());
        });
        this.renderCalendar(now.getFullYear(), now.getMonth());

        const timeSlotsContainer = document.getElementById('time-slots');
        if (timeSlotsContainer) {
            timeSlotsContainer.innerHTML = '<p class="no-date-selected">Please select a date first</p>';
        }
        this.updateScheduleContinueButton();
    }

    closeModal() {
        const modal = document.getElementById('edsa-booking-modal');
        if (!modal) return;

        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        this.unlockPageScroll();

        const form = document.getElementById('edsa-booking-form');
        if (form) form.reset();

        this.selectedDate = null;
        this.selectedTime = null;
        this._pendingBookingData = null;
        this._step = 'schedule';
        this.clearFormMessage();
    }
}

let edsaBookingSystem;

function openEDSABooking(e) {
    if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
    }
    if (!edsaBookingSystem) {
        edsaBookingSystem = new EDSABookingSystem();
    }
    edsaBookingSystem.setupModal();
    edsaBookingSystem.openModal();
}

function handleEdsBookingFormSubmit(e) {
    const form = e.target;
    if (!form || form.id !== 'edsa-booking-form') return;

    e.preventDefault();
    e.stopImmediatePropagation();

    if (!edsaBookingSystem) {
        edsaBookingSystem = new EDSABookingSystem();
    }
    edsaBookingSystem.handleFormSubmit(e);
}

function initEdsBooking() {
    if (!edsaBookingSystem) {
        edsaBookingSystem = new EDSABookingSystem();
    }
}

if (!window.__edsaBookingSubmitCaptureBound) {
    window.__edsaBookingSubmitCaptureBound = true;
    document.addEventListener('submit', handleEdsBookingFormSubmit, true);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEdsBooking);
} else {
    initEdsBooking();
}

window.openEDSABooking = openEDSABooking;
