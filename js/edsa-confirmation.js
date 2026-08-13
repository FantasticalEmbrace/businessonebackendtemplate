// EDSA appointment thank-you page

function hmHerbsApiOrigin() {
    const explicit = String(window.HMHERBS_API_ORIGIN || '').trim().replace(/\/+$/, '');
    if (explicit) return explicit;
    if (window.location.protocol === 'file:') return 'http://127.0.0.1:3001';
    const h = window.location.hostname;
    if ((h === 'localhost' || h === '127.0.0.1') && window.location.port && window.location.port !== '3001') {
        return `http://127.0.0.1:3001`;
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
    const raw = String(ymd).trim();
    const dateOnly = raw.includes('T') ? raw.slice(0, 10) : raw.slice(0, 10);
    const parts = dateOnly.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return String(ymd);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    if (Number.isNaN(d.getTime())) return String(ymd);
    return d.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
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

function manageAppointmentUrl(data) {
    const params = new URLSearchParams();
    params.set('booking', String(data.bookingId || ''));
    if (data.email) params.set('email', String(data.email).trim());
    return `edsa-manage-appointment.html?${params.toString()}`;
}

function getQueryParams() {
    const p = new URLSearchParams(window.location.search);
    return {
        bookingId: p.get('booking') || p.get('bookingId') || '',
        email: p.get('email') || '',
        preferredDate: p.get('date') || '',
        preferredTime: p.get('time') || '',
        firstName: p.get('firstName') || '',
        lastName: p.get('lastName') || ''
    };
}

function renderConfirmation(root, data) {
    const name = [data.firstName, data.lastName].filter(Boolean).join(' ') || 'Guest';
    const mapsUrl =
        'https://maps.google.com/?q=1140+Battlefield+Pkwy,+Fort+Oglethorpe,+GA+30742';
    const location = data.location || '1140 Battlefield Pkwy, Fort Oglethorpe, GA 30742';
    const pendingRequest = '';

    root.innerHTML = `
        <div class="confirmation-icon" aria-hidden="true">
            <i class="fas fa-check"></i>
        </div>
        <h1>Your EDSA appointment is booked</h1>
        <p class="confirmation-lead">
            Thank you, <strong>${escapeHtml(name)}</strong>. We have received your request for an
            Electro Dermal Stress Analysis session. A confirmation will be sent to
            <strong>${escapeHtml(data.email)}</strong> when available.
        </p>
        ${pendingRequest}
        <div class="confirmation-details">
            <dl>
                <dt>Confirmation #</dt>
                <dd>${escapeHtml(data.bookingId)}</dd>
                <dt>Date</dt>
                <dd>${escapeHtml(formatDateYmd(data.preferredDate))}</dd>
                <dt>Time</dt>
                <dd>${escapeHtml(formatTimeHm(data.preferredTime))}</dd>
                <dt>Location</dt>
                <dd><a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(location)}</a></dd>
            </dl>
        </div>
        <p class="confirmation-lead">
            Please arrive a few minutes early. Need to change your plans? You can cancel or reschedule online when another time is open.
        </p>
        <div class="confirmation-actions">
            <a href="${escapeHtml(manageAppointmentUrl(data))}" class="btn btn-primary">Change or cancel appointment</a>
            <a href="index.html" class="btn btn-secondary">Back to home</a>
        </div>`;
}

function renderError(root, message) {
    root.innerHTML = `
        <div class="confirmation-icon" aria-hidden="true"><i class="fas fa-exclamation-circle"></i></div>
        <h1>Appointment confirmation</h1>
        <p class="confirmation-lead confirmation-error">${escapeHtml(message)}</p>
        <div class="confirmation-actions">
            <a href="index.html" class="btn btn-primary">Back to home</a>
        </div>`;
}

async function initEdsConfirmation() {
    const root = document.getElementById('confirmation-root');
    if (!root) return;

    const q = getQueryParams();
    const bookingId = String(q.bookingId || '').trim();
    const email = String(q.email || '').trim();

    if (!bookingId) {
        renderError(
            root,
            'Missing appointment information. If you just booked, try again from your confirmation email.'
        );
        return;
    }

    if (email) {
        try {
            const res = await fetch(
                `${edsaApiBase()}/bookings/${encodeURIComponent(bookingId)}/confirmation-summary?email=${encodeURIComponent(email)}`,
                { headers: { Accept: 'application/json' } }
            );
            if (res.ok) {
                const data = await res.json();
                renderConfirmation(root, data);
                return;
            }
        } catch (e) {
            console.warn('Could not load EDSA booking summary:', e);
        }
    }

    if (q.preferredDate && q.preferredTime) {
        renderConfirmation(root, {
            bookingId,
            email: email || 'your email',
            firstName: q.firstName,
            lastName: q.lastName,
            preferredDate: q.preferredDate,
            preferredTime: q.preferredTime
        });
        return;
    }

    renderError(
        root,
        'We could not load this appointment. Use the link from your confirmation email or contact the store.'
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEdsConfirmation);
} else {
    initEdsConfirmation();
}
