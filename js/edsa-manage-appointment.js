// Customer self-service cancel / reschedule (immediate, based on availability)

function hmHerbsApiOrigin() {
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

function edsaApiBase() {
    const origin = hmHerbsApiOrigin();
    return origin ? `${origin}/api/edsa` : '/api/edsa';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

function formatDateYmd(ymd) {
    if (!ymd) return '—';
    const clean = String(ymd).trim().slice(0, 10);
    const parts = clean.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return String(ymd);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    if (Number.isNaN(d.getTime())) return String(ymd);
    return d.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function formatTimeHm(hm) {
    if (!hm) return '—';
    const [h, m] = String(hm).split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return String(hm);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatLocalDateYmd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getQueryParams() {
    const p = new URLSearchParams(window.location.search);
    return {
        bookingId: p.get('booking') || p.get('bookingId') || '',
        email: p.get('email') || '',
    };
}

function showSiteMessage(message, type = 'error') {
    const box = document.getElementById('manage-form-message');
    if (box) {
        box.hidden = false;
        box.className = `edsa-form-message edsa-form-message-${type}`;
        box.textContent = message;
    }
    if (typeof window.showEdsToast === 'function') {
        window.showEdsToast(message, type);
    } else if (window.hmHerbsApp && typeof window.hmHerbsApp.showNotification === 'function') {
        const notifyType = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
        window.hmHerbsApp.showNotification(message, notifyType);
    }
}

function clearSiteMessage() {
    const box = document.getElementById('manage-form-message');
    if (box) {
        box.hidden = true;
        box.textContent = '';
    }
}

const STORE_PHONE_DIGITS = '7068619454';
const STORE_PHONE_TEL = '+17068619454';

function storePhoneDisplay() {
    if (window.HMHERBS_PHONE_US && typeof HMHERBS_PHONE_US.formatDigitsToDisplay === 'function') {
        return HMHERBS_PHONE_US.formatDigitsToDisplay(STORE_PHONE_DIGITS);
    }
    return '(706) 861-9454';
}

const CLOSE_ICON_SVG =
    '<svg class="cart-close-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>';

let callStoreModalReady = false;

function ensureCallStoreModal() {
    if (callStoreModalReady || document.getElementById('call-store-modal')) {
        callStoreModalReady = true;
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'call-store-modal';
    modal.className = 'edsa-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'call-store-title');
    modal.innerHTML = `
        <div class="edsa-modal-overlay" data-call-store-close></div>
        <div class="edsa-modal-content call-store-modal-content">
            <div class="edsa-modal-header">
                <h2 id="call-store-title">Call the Store</h2>
                <button type="button" class="edsa-modal-close" data-call-store-close aria-label="Close">
                    ${CLOSE_ICON_SVG}
                </button>
            </div>
            <div class="edsa-modal-body call-store-modal-body">
                <p class="call-store-lead">H&amp;M Herbs &amp; Vitamins</p>
                <a href="tel:${STORE_PHONE_TEL}" class="call-store-phone-btn">
                    <i class="fas fa-phone" aria-hidden="true"></i>
                    <span>${storePhoneDisplay()}</span>
                </a>
                <p class="call-store-hours" data-store-hours-placeholder>Mon–Fri 10:00 AM – 5:00 PM<br>Saturday 10:00 AM – 1:00 PM</p>
                <button type="button" class="btn btn-secondary call-store-close-btn" data-call-store-close>Close</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-call-store-close]').forEach((el) => {
        el.addEventListener('click', closeCallStoreModal);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('show')) closeCallStoreModal();
    });
    callStoreModalReady = true;
}

function openCallStoreModal() {
    ensureCallStoreModal();
    const modal = document.getElementById('call-store-modal');
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeCallStoreModal() {
    const modal = document.getElementById('call-store-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function wireCallStoreButtons(root) {
    root.querySelectorAll('[data-call-store]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openCallStoreModal();
        });
    });
}

function renderLookupForm(root) {
    root.innerHTML = `
        <h1>Manage your EDSA appointment</h1>
        <p class="manage-lead">Enter your confirmation number and the email used when you booked.</p>
        <form id="manage-lookup-form" class="manage-form" novalidate>
            <div id="manage-form-message" class="edsa-form-message" role="alert" hidden></div>
            <div class="form-group">
                <label for="lookup-booking-id">Confirmation #</label>
                <input type="text" id="lookup-booking-id" name="bookingId" required inputmode="numeric" autocomplete="off">
            </div>
            <div class="form-group">
                <label for="lookup-email">Email</label>
                <input type="email" id="lookup-email" name="email" required autocomplete="email">
            </div>
            <div class="manage-actions">
                <button type="submit" class="btn btn-primary">Find appointment</button>
                <button type="button" class="btn btn-secondary" data-call-store>Call the Store</button>
                <a href="index.html" class="btn btn-outline-secondary">Back to home</a>
            </div>
        </form>`;

    wireCallStoreButtons(root);
    document.getElementById('manage-lookup-form').addEventListener('submit', (e) => {
        e.preventDefault();
        clearSiteMessage();
        const bookingId = String(new FormData(e.target).get('bookingId') || '').trim();
        const email = String(new FormData(e.target).get('email') || '').trim();
        if (!bookingId || !email) {
            showSiteMessage('Please enter your confirmation number and email.', 'warning');
            return;
        }
        window.location.href = `edsa-manage-appointment.html?booking=${encodeURIComponent(bookingId)}&email=${encodeURIComponent(email)}`;
    });
}

function statusBanner(data) {
    if (data.status === 'cancelled') {
        return `<div class="status-banner status-banner-info">This appointment has been cancelled.</div>`;
    }
    if (data.status === 'completed') {
        return `<div class="status-banner status-banner-info">This appointment is marked completed.</div>`;
    }
    return '';
}

class ManageAppointmentUI {
    constructor(root, data) {
        this.root = root;
        this.data = data;
        this.availableSlots = [];
        this.selectedDate = null;
        this.selectedTime = null;
    }

    async loadSlotsForDate(dateYmd) {
        const url = `${edsaApiBase()}/available-slots?date=${encodeURIComponent(dateYmd)}&excludeBookingId=${encodeURIComponent(this.data.bookingId)}&_=${Date.now()}`;
        try {
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (res.ok) {
                const json = await res.json();
                this.availableSlots = json.slots || [];
            } else {
                this.availableSlots = [];
            }
        } catch {
            this.availableSlots = [];
        }
    }

    renderTimeSlots() {
        const container = document.getElementById('manage-time-slots');
        if (!container) return;

        if (!this.selectedDate) {
            container.innerHTML = '<p class="no-date-selected">Choose a date to see available times.</p>';
            return;
        }

        const available = this.availableSlots.filter((s) => s.available);
        if (!available.length) {
            container.innerHTML = '<p class="no-slots">No open times on this date. Try another day.</p>';
            return;
        }

        container.innerHTML = '<div class="time-slots-grid manage-slots-grid"></div>';
        const grid = container.querySelector('.manage-slots-grid');

        available.forEach((slot) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'time-slot-btn';
            btn.textContent = formatTimeHm(slot.time);
            if (this.selectedTime === slot.time) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                this.selectedTime = slot.time;
                this.renderTimeSlots();
            });
            grid.appendChild(btn);
        });
    }

    render() {
        const name = [this.data.firstName, this.data.lastName].filter(Boolean).join(' ');
        const canChange = this.data.canChange && this.data.status !== 'cancelled';

        this.root.innerHTML = `
            <h1>Manage your appointment</h1>
            <p class="manage-lead">${escapeHtml(name)} — confirmation #${escapeHtml(this.data.bookingId)}</p>
            ${statusBanner(this.data)}
            <div class="manage-details">
                <dl>
                    <dt>Current date</dt>
                    <dd>${escapeHtml(formatDateYmd(this.data.preferredDate))}</dd>
                    <dt>Current time</dt>
                    <dd>${escapeHtml(formatTimeHm(this.data.preferredTime))}</dd>
                    <dt>Status</dt>
                    <dd>${escapeHtml(this.data.status)}</dd>
                </dl>
            </div>
            ${
                canChange
                    ? `<div id="manage-form-message" class="edsa-form-message" role="alert" hidden></div>
            <p class="manage-lead" style="text-align:left;margin-bottom:1rem;">
                Pick a new date and time below, or cancel your appointment. Changes apply immediately when a slot is open.
            </p>
            <div class="request-type-group" role="radiogroup" aria-labelledby="action-type-heading">
                <span id="action-type-heading" class="request-type-heading">What would you like to do?</span>
                <div class="request-type-choices">
                    <label class="request-type-card">
                        <input type="radio" name="actionType" value="reschedule" checked>
                        <span class="request-type-card-text">
                            <span class="request-type-card-title">Reschedule</span>
                            <span class="request-type-card-desc">Move to another open time</span>
                        </span>
                    </label>
                    <label class="request-type-card">
                        <input type="radio" name="actionType" value="cancel">
                        <span class="request-type-card-text">
                            <span class="request-type-card-title">Cancel appointment</span>
                            <span class="request-type-card-desc">Free up your time slot</span>
                        </span>
                    </label>
                </div>
            </div>
            <div id="reschedule-panel">
                <div class="form-group">
                    <label for="new-date">New date</label>
                    <input type="date" id="new-date" name="newDate">
                </div>
                <div id="manage-time-slots" class="manage-time-slots-wrap">
                    <p class="no-date-selected">Choose a date to see available times.</p>
                </div>
                <div class="form-group">
                    <label for="reschedule-notes">Notes (optional)</label>
                    <textarea id="reschedule-notes" rows="2" placeholder="Anything we should know"></textarea>
                </div>
                <div class="manage-actions">
                    <button type="button" class="btn btn-primary" id="reschedule-btn">Confirm new time</button>
                </div>
            </div>
            <div id="cancel-panel" hidden>
                <p class="manage-lead" style="text-align:left;color:#991b1b;">
                    This will cancel your EDSA session and remove it from our calendar.
                </p>
                <div class="manage-actions">
                    <button type="button" class="btn btn-danger" id="cancel-btn">Cancel my appointment</button>
                </div>
            </div>
            <div class="manage-actions" style="margin-top:1.5rem;">
                <button type="button" class="btn btn-secondary" data-call-store>Call the Store</button>
                <a href="edsa-confirmation.html?booking=${encodeURIComponent(this.data.bookingId)}&email=${encodeURIComponent(this.data.email)}" class="btn btn-outline-secondary">View confirmation</a>
                <a href="index.html" class="btn btn-outline-secondary">Back to home</a>
            </div>`
                    : `<div class="manage-actions">
                <a href="index.html" class="btn btn-primary">Back to home</a>
                <button type="button" class="btn btn-secondary" data-call-store>Call the Store</button>
            </div>`
            }`;

        wireCallStoreButtons(this.root);
        if (!canChange) return;

        const reschedulePanel = document.getElementById('reschedule-panel');
        const cancelPanel = document.getElementById('cancel-panel');
        const dateInput = document.getElementById('new-date');

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateInput.min = formatLocalDateYmd(tomorrow);

        this.root.querySelectorAll('input[name="actionType"]').forEach((radio) => {
            radio.addEventListener('change', () => {
                const isReschedule = this.root.querySelector('input[name="actionType"]:checked')?.value === 'reschedule';
                reschedulePanel.hidden = !isReschedule;
                cancelPanel.hidden = isReschedule;
                clearSiteMessage();
            });
        });

        dateInput.addEventListener('change', async () => {
            const val = dateInput.value;
            if (!val) return;
            this.selectedDate = val;
            this.selectedTime = null;
            const container = document.getElementById('manage-time-slots');
            if (container) container.innerHTML = '<p class="no-date-selected">Loading times…</p>';
            await this.loadSlotsForDate(val);
            this.renderTimeSlots();
        });

        document.getElementById('reschedule-btn').addEventListener('click', () => this.submitReschedule());
        document.getElementById('cancel-btn').addEventListener('click', () => this.submitCancel());
    }

    async submitReschedule() {
        clearSiteMessage();
        if (!this.selectedDate || !this.selectedTime) {
            showSiteMessage('Please choose a new date and an available time.', 'warning');
            return;
        }

        const confirmed =
            typeof window.showEdsConfirm === 'function'
                ? await window.showEdsConfirm({
                      title: 'Reschedule appointment?',
                      message: `Move your session to ${formatDateYmd(this.selectedDate)} at ${formatTimeHm(this.selectedTime)}? We'll update your confirmation and calendar right away.`,
                      confirmLabel: 'Yes, reschedule',
                      cancelLabel: 'Go back',
                      destructive: false,
                  })
                : true;
        if (!confirmed) {
            return;
        }

        const btn = document.getElementById('reschedule-btn');
        btn.disabled = true;
        btn.textContent = 'Updating…';

        try {
            const res = await fetch(
                `${edsaApiBase()}/bookings/${encodeURIComponent(this.data.bookingId)}/reschedule-appointment`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        email: this.data.email,
                        preferredDate: this.selectedDate,
                        preferredTime: this.selectedTime,
                        notes: document.getElementById('reschedule-notes')?.value || '',
                    }),
                }
            );
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                showSiteMessage(body.message || 'Appointment rescheduled.', 'success');
                const params = new URLSearchParams({
                    booking: String(this.data.bookingId),
                    email: this.data.email,
                });
                setTimeout(() => {
                    window.location.href = `edsa-confirmation.html?${params.toString()}`;
                }, 1200);
                return;
            }
            showSiteMessage(body.error || 'Could not reschedule. Try another time.', 'error');
        } catch (err) {
            console.error(err);
            showSiteMessage('Network error. Please try again.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Confirm new time';
        }
    }

    async submitCancel() {
        const confirmed =
            typeof window.showEdsConfirm === 'function'
                ? await window.showEdsConfirm({
                      title: 'Cancel appointment?',
                      message:
                          'This will cancel your EDSA session and remove it from our calendar. You can book a new time anytime.',
                      confirmLabel: 'Yes, cancel appointment',
                      cancelLabel: 'Keep appointment',
                      destructive: true,
                  })
                : false;
        if (!confirmed) {
            return;
        }
        clearSiteMessage();
        const btn = document.getElementById('cancel-btn');
        btn.disabled = true;
        btn.textContent = 'Cancelling…';

        try {
            const res = await fetch(
                `${edsaApiBase()}/bookings/${encodeURIComponent(this.data.bookingId)}/cancel-appointment`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ email: this.data.email }),
                }
            );
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                showSiteMessage(body.message || 'Appointment cancelled.', 'success');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 1500);
                return;
            }
            showSiteMessage(body.error || 'Could not cancel appointment.', 'error');
        } catch (err) {
            console.error(err);
            showSiteMessage('Network error. Please try again.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Cancel my appointment';
        }
    }
}

async function initManageAppointment() {
    ensureCallStoreModal();
    const root = document.getElementById('manage-root');
    if (!root) return;

    const q = getQueryParams();
    const bookingId = String(q.bookingId || '').trim();
    const email = String(q.email || '').trim();

    if (!bookingId || !email) {
        renderLookupForm(root);
        return;
    }

    try {
        const res = await fetch(
            `${edsaApiBase()}/bookings/${encodeURIComponent(bookingId)}/manage?email=${encodeURIComponent(email)}`,
            { headers: { Accept: 'application/json' } }
        );
        if (!res.ok) {
            renderLookupForm(root);
            showSiteMessage('We could not find that appointment. Check your confirmation # and email.', 'error');
            return;
        }
        const data = await res.json();
        const ui = new ManageAppointmentUI(root, data);
        ui.render();
    } catch (e) {
        console.error(e);
        root.innerHTML = `<h1>Manage appointment</h1>
            <p class="manage-lead">Unable to load your appointment. Please try again or call the store.</p>
            <div class="manage-actions"><a href="index.html" class="btn btn-primary">Back to home</a></div>`;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initManageAppointment);
} else {
    initManageAppointment();
}
