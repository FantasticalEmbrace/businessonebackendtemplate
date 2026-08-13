'use strict';

const logger = require('../utils/logger');
const { getStorefrontPublicBaseUrl, getAdminAppUrl } = require('../utils/storefrontUrl');
const { isSmtpConfigured } = require('../utils/smtpConfig');

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value || '');
    return d.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'America/New_York'
    });
}

function formatTime(value) {
    const raw = String(value || '').slice(0, 5);
    const [h, m] = raw.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return String(value || '');
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

async function getMailTransporter() {
    if (!isSmtpConfigured()) return null;
    const smtpHost = String(process.env.SMTP_HOST || process.env.EMAIL_HOST || '').trim();
    const smtpUser = String(process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
    const smtpPass = String(process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || '').trim();
    const smtpPort = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587) || 587;
    const nodemailer = require('nodemailer');
    // Gmail requires the authenticated account as the envelope sender; use a simple display name.
    const from = {
        name: 'HM Herbs',
        address: smtpUser
    };
    return {
        transporter: nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass }
        }),
        from,
        smtpUser
    };
}

function getStoreNotificationEmail() {
    const explicit = String(process.env.EDSA_NOTIFY_EMAIL || process.env.STORE_NOTIFY_EMAIL || '').trim();
    if (explicit) return explicit;
    return String(process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
}

async function sendEmail({ to, subject, html, text, logTag }) {
    try {
        const mail = await getMailTransporter();
        if (!mail) {
            logger.warn(`${logTag} skipped — SMTP not configured`, { to, subject });
            console.log(`\n📧 ${logTag} (set SMTP_* in backend/.env to send):`);
            console.log(`   To: ${to}`);
            console.log(`   Subject: ${subject}\n`);
            return false;
        }
        const storeReply = getStoreNotificationEmail();
        const info = await mail.transporter.sendMail({
            from: mail.from,
            to,
            replyTo: storeReply || mail.smtpUser,
            envelope: { from: mail.smtpUser, to },
            subject,
            html,
            text
        });
        logger.info(`${logTag} sent`, { to, messageId: info?.messageId || null });
        return true;
    } catch (error) {
        logger.error(`${logTag} failed`, { to, error: error.message, stack: error.stack });
        return false;
    }
}

function urls(bookingId, email) {
    const base = getStorefrontPublicBaseUrl();
    const q = `booking=${encodeURIComponent(String(bookingId))}&email=${encodeURIComponent(email)}`;
    return {
        confirmation: `${base}/edsa-confirmation.html?${q}`,
        manage: `${base}/edsa-manage-appointment.html?${q}`
    };
}

async function sendBookingReceivedEmail(booking) {
    const email = String(booking.email || '').trim();
    if (!email) return;
    const name = `${booking.firstName || ''}`.trim() || 'there';
    const links = urls(booking.bookingId, email);
    const dateText = formatDate(booking.preferredDate);
    const timeText = formatTime(booking.preferredTime);
    const subject = `H&M Herbs — EDSA appointment request #${booking.bookingId}`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">Your EDSA appointment request is received</h2>
            <p>Hello ${escapeHtml(name)},</p>
            <p>Thank you for booking with H&amp;M Herbs &amp; Vitamins. We have your request and will contact you if any changes are needed.</p>
            <p><strong>Confirmation #:</strong> ${escapeHtml(booking.bookingId)}<br>
               <strong>Date:</strong> ${escapeHtml(dateText)}<br>
               <strong>Time:</strong> ${escapeHtml(timeText)}<br>
               <strong>Location:</strong> 1140 Battlefield Pkwy, Fort Oglethorpe, GA 30742</p>
            <p>
              <a href="${escapeHtml(links.confirmation)}" style="background:#10b981;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;margin-right:8px;">View confirmation</a>
              <a href="${escapeHtml(links.manage)}" style="background:#fff;color:#10b981;padding:10px 20px;text-decoration:none;border-radius:5px;border:1px solid #10b981;display:inline-block;">Change or cancel</a>
            </p>
            <p style="font-size:13px;color:#6b7280;">Questions? Call us at (706) 861-9454.</p>
        </div>`;
    const text = [
        `Your EDSA appointment request is received.`,
        `Confirmation #: ${booking.bookingId}`,
        `Date: ${dateText}`,
        `Time: ${timeText}`,
        `View: ${links.confirmation}`,
        `Manage: ${links.manage}`
    ].join('\n');
    logger.info('EDSA booking email links', { confirmation: links.confirmation, manage: links.manage });
    await sendEmail({ to: email, subject, html, text, logTag: 'EDSA booking email' });
}

/** Notify store inbox when a customer books online. */
async function sendBookingReceivedStoreEmail(booking) {
    const storeEmail = getStoreNotificationEmail();
    if (!storeEmail) return;
    const customerName = [booking.firstName, booking.lastName].filter(Boolean).join(' ') || 'Customer';
    const when = `${formatDate(booking.preferredDate)} at ${formatTime(booking.preferredTime)}`;
    const subject = `[EDSA] New booking #${booking.bookingId} — ${customerName}`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">New EDSA appointment booked online</h2>
            <p><strong>#${escapeHtml(booking.bookingId)}</strong> — ${escapeHtml(customerName)}<br>
               ${escapeHtml(when)}<br>
               ${escapeHtml(booking.email)} · ${escapeHtml(booking.phone || '—')}</p>
            ${storeAdminLinkHtml(booking.bookingId)}
        </div>`;
    await sendEmail({ to: storeEmail, subject, html, text: subject, logTag: 'EDSA new-booking store notification' });
}

function changeRequestDetailsHtml(booking, requestType) {
    const label = requestType === 'cancel' ? 'cancellation' : 'reschedule';
    let extra = '';
    if (requestType === 'reschedule' && booking.requestedDate && booking.requestedTime) {
        extra = `<p><strong>Requested new time:</strong> ${escapeHtml(formatDate(booking.requestedDate))} at ${escapeHtml(formatTime(booking.requestedTime))}</p>`;
    }
    if (booking.notes) {
        extra += `<p><strong>Customer notes:</strong> ${escapeHtml(booking.notes)}</p>`;
    }
    return { label, extra };
}

function storeAdminLinkHtml(bookingId) {
    const base = getAdminAppUrl();
    const id = Number(bookingId);
    const query = Number.isFinite(id) && id > 0 ? `?booking=${id}` : '';
    const adminLink = `${base}${query}#edsa`;
    return `<p><a href="${escapeHtml(adminLink)}" style="background:#10b981;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;">Open admin — EDSA bookings</a></p>`;
}

/** Customer cancelled online — immediate confirmation. */
async function sendAppointmentCancelledEmail(booking) {
    const email = String(booking.email || '').trim();
    if (!email) return;
    const links = urls(booking.bookingId, email);
    const name = `${booking.firstName || ''}`.trim() || 'there';
    const when = `${formatDate(booking.preferredDate)} at ${formatTime(booking.preferredTime)}`;
    const subject = `H&M Herbs — EDSA appointment cancelled (#${booking.bookingId})`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">Your appointment is cancelled</h2>
            <p>Hello ${escapeHtml(name)},</p>
            <p>Confirmation #${escapeHtml(booking.bookingId)} for <strong>${escapeHtml(when)}</strong> has been cancelled as you requested.</p>
            <p>To book a new session, visit our website or call (706) 861-9454.</p>
            <p><a href="${escapeHtml(`${getStorefrontPublicBaseUrl()}/index.html`)}" style="background:#10b981;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;">Visit H&amp;M Herbs</a></p>
        </div>`;
    const text = [`Your EDSA appointment #${booking.bookingId} (${when}) is cancelled.`, `Book again: ${getStorefrontPublicBaseUrl()}`].join('\n');
    await sendEmail({ to: email, subject, html, text, logTag: 'EDSA cancellation email' });
}

async function sendAppointmentCancelledStoreEmail(booking) {
    const storeEmail = getStoreNotificationEmail();
    if (!storeEmail) return;
    const customerName = [booking.firstName, booking.lastName].filter(Boolean).join(' ') || 'Customer';
    const when = `${formatDate(booking.preferredDate)} at ${formatTime(booking.preferredTime)}`;
    const subject = `[EDSA] Cancelled #${booking.bookingId} — ${customerName}`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">EDSA appointment cancelled online</h2>
            <p><strong>#${escapeHtml(booking.bookingId)}</strong> — ${escapeHtml(customerName)}<br>
               ${escapeHtml(when)}<br>
               ${escapeHtml(booking.email)} · ${escapeHtml(booking.phone || '—')}</p>
            ${storeAdminLinkHtml(booking.bookingId)}
        </div>`;
    await sendEmail({ to: storeEmail, subject, html, text: subject, logTag: 'EDSA cancellation store notification' });
}

/** Customer rescheduled online — new time confirmed immediately. */
async function sendAppointmentRescheduledEmail(booking, previousDate, previousTime) {
    const email = String(booking.email || '').trim();
    if (!email) return;
    const links = urls(booking.bookingId, email);
    const name = `${booking.firstName || ''}`.trim() || 'there';
    const newWhen = `${formatDate(booking.preferredDate)} at ${formatTime(booking.preferredTime)}`;
    const oldWhen = `${formatDate(previousDate)} at ${formatTime(previousTime)}`;
    const subject = `H&M Herbs — EDSA appointment rescheduled (#${booking.bookingId})`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">Your appointment is rescheduled</h2>
            <p>Hello ${escapeHtml(name)},</p>
            <p>Confirmation #${escapeHtml(booking.bookingId)} is updated:</p>
            <p><strong>Previous:</strong> ${escapeHtml(oldWhen)}<br>
               <strong>New:</strong> ${escapeHtml(newWhen)}</p>
            <p><a href="${escapeHtml(links.confirmation)}" style="background:#10b981;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;margin-right:8px;">View confirmation</a>
               <a href="${escapeHtml(links.manage)}" style="color:#10b981;">Manage appointment</a></p>
        </div>`;
    const text = [`Appointment #${booking.bookingId} rescheduled.`, `Was: ${oldWhen}`, `Now: ${newWhen}`, links.confirmation].join('\n');
    await sendEmail({ to: email, subject, html, text, logTag: 'EDSA reschedule email' });
}

async function sendAppointmentRescheduledStoreEmail(booking, previousDate, previousTime) {
    const storeEmail = getStoreNotificationEmail();
    if (!storeEmail) return;
    const customerName = [booking.firstName, booking.lastName].filter(Boolean).join(' ') || 'Customer';
    const newWhen = `${formatDate(booking.preferredDate)} at ${formatTime(booking.preferredTime)}`;
    const oldWhen = `${formatDate(previousDate)} at ${formatTime(previousTime)}`;
    const subject = `[EDSA] Rescheduled #${booking.bookingId} — ${customerName}`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">EDSA appointment rescheduled online</h2>
            <p><strong>#${escapeHtml(booking.bookingId)}</strong> — ${escapeHtml(customerName)}<br>
               Was: ${escapeHtml(oldWhen)}<br>
               Now: <strong>${escapeHtml(newWhen)}</strong><br>
               ${escapeHtml(booking.email)} · ${escapeHtml(booking.phone || '—')}</p>
            ${storeAdminLinkHtml(booking.bookingId)}
        </div>`;
    await sendEmail({ to: storeEmail, subject, html, text: subject, logTag: 'EDSA reschedule store notification' });
}

async function sendChangeRequestReceivedEmail(booking, requestType) {
    const email = String(booking.email || '').trim();
    if (!email) return;
    const links = urls(booking.bookingId, email);
    const { label, extra } = changeRequestDetailsHtml(booking, requestType);
    const subject = `H&M Herbs — We received your ${label} request`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">We received your ${escapeHtml(label)} request</h2>
            <p>Confirmation #${escapeHtml(booking.bookingId)} for ${escapeHtml(formatDate(booking.preferredDate))} at ${escapeHtml(formatTime(booking.preferredTime))} is now in review.</p>
            ${extra}
            <p>Our team will confirm by email or phone shortly.</p>
            <p><a href="${escapeHtml(links.manage)}" style="background:#10b981;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;">Manage appointment</a></p>
        </div>`;
    const text = [
        `We received your ${label} request.`,
        `Confirmation #: ${booking.bookingId}`,
        `Current: ${formatDate(booking.preferredDate)} at ${formatTime(booking.preferredTime)}`,
        requestType === 'reschedule' && booking.requestedDate
            ? `Requested: ${formatDate(booking.requestedDate)} at ${formatTime(booking.requestedTime)}`
            : '',
        booking.notes ? `Notes: ${booking.notes}` : '',
        `Manage: ${links.manage}`
    ]
        .filter(Boolean)
        .join('\n');
    await sendEmail({ to: email, subject, html, text, logTag: 'EDSA change-request email' });
}

/** Notify store staff (hmherbs inbox) when a customer requests cancel/reschedule. */
async function sendChangeRequestStoreNotificationEmail(booking, requestType) {
    const storeEmail = getStoreNotificationEmail();
    if (!storeEmail) {
        logger.warn('EDSA store notification skipped — no EDSA_NOTIFY_EMAIL or SMTP_USER');
        return;
    }

    const customerName = [booking.firstName, booking.lastName].filter(Boolean).join(' ') || 'Customer';
    const { label, extra } = changeRequestDetailsHtml(booking, requestType);
    const adminLinkHtml = storeAdminLinkHtml(booking.bookingId);
    const adminLinkPlain = `${getAdminAppUrl()}?booking=${booking.bookingId}#edsa`;

    const subject = `[EDSA] ${label} request #${booking.bookingId} — ${customerName}`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">EDSA ${escapeHtml(label)} request</h2>
            <p><strong>Confirmation #:</strong> ${escapeHtml(booking.bookingId)}<br>
               <strong>Customer:</strong> ${escapeHtml(customerName)}<br>
               <strong>Email:</strong> ${escapeHtml(booking.email)}<br>
               <strong>Phone:</strong> ${escapeHtml(booking.phone || '—')}</p>
            <p><strong>Current appointment:</strong> ${escapeHtml(formatDate(booking.preferredDate))} at ${escapeHtml(formatTime(booking.preferredTime))}</p>
            ${extra}
            ${adminLinkHtml || '<p>Review this request in the admin panel under EDSA bookings.</p>'}
        </div>`;
    const text = [
        `EDSA ${label} request #${booking.bookingId}`,
        `Customer: ${customerName}`,
        `Email: ${booking.email}`,
        `Phone: ${booking.phone || '—'}`,
        `Current: ${formatDate(booking.preferredDate)} at ${formatTime(booking.preferredTime)}`,
        requestType === 'reschedule' && booking.requestedDate
            ? `Requested: ${formatDate(booking.requestedDate)} at ${formatTime(booking.requestedTime)}`
            : '',
        booking.notes ? `Notes: ${booking.notes}` : '',
        `Admin: ${adminLinkPlain}`
    ]
        .filter(Boolean)
        .join('\n');

    await sendEmail({
        to: storeEmail,
        subject,
        html,
        text,
        logTag: 'EDSA change-request store notification'
    });
}

async function sendAdminResolutionEmail(booking) {
    const email = String(booking.email || '').trim();
    if (!email) return;
    const links = urls(booking.bookingId, email);
    const status = String(booking.status || '').toLowerCase();
    const statusLabel = status === 'cancelled' ? 'cancelled' : status === 'confirmed' ? 'confirmed' : 'updated';
    const subject = `H&M Herbs — Appointment ${statusLabel} (#${booking.bookingId})`;
    const when = booking.confirmedDate && booking.confirmedTime
        ? `${formatDate(booking.confirmedDate)} at ${formatTime(booking.confirmedTime)}`
        : `${formatDate(booking.preferredDate)} at ${formatTime(booking.preferredTime)}`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">Your EDSA appointment was ${escapeHtml(statusLabel)}</h2>
            <p><strong>Confirmation #:</strong> ${escapeHtml(booking.bookingId)}<br>
               <strong>Appointment:</strong> ${escapeHtml(when)}</p>
            <p><a href="${escapeHtml(links.confirmation)}" style="background:#10b981;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;">View details</a></p>
        </div>`;
    const text = [
        `Your EDSA appointment was ${statusLabel}.`,
        `Confirmation #: ${booking.bookingId}`,
        `Appointment: ${when}`,
        `Details: ${links.confirmation}`
    ].join('\n');
    await sendEmail({ to: email, subject, html, text, logTag: 'EDSA admin-update email' });
}

/** Store staff cancelled an appointment — notify customer. */
async function sendStaffCancelledCustomerEmail(booking) {
    const email = String(booking.email || '').trim();
    if (!email) return;
    const name = `${booking.firstName || ''}`.trim() || 'there';
    const when = `${formatDate(booking.preferredDate)} at ${formatTime(booking.preferredTime)}`;
    const links = urls(booking.bookingId, email);
    const subject = `H&M Herbs — Your EDSA appointment was cancelled (#${booking.bookingId})`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">Your appointment was cancelled</h2>
            <p>Hello ${escapeHtml(name)},</p>
            <p>H&amp;M Herbs &amp; Vitamins has cancelled your EDSA session scheduled for <strong>${escapeHtml(when)}</strong> (confirmation #${escapeHtml(booking.bookingId)}).</p>
            <p>Questions or want to rebook? Call us at (706) 861-9454 or visit our website.</p>
            <p><a href="${escapeHtml(`${getStorefrontPublicBaseUrl()}/index.html`)}" style="background:#10b981;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;">Visit H&amp;M Herbs</a></p>
        </div>`;
    const text = [`Your EDSA appointment #${booking.bookingId} (${when}) was cancelled by our team.`, links.manage].join('\n');
    await sendEmail({ to: email, subject, html, text, logTag: 'EDSA staff-cancel customer email' });
}

/** Store staff changed date/time — notify customer. */
async function sendStaffRescheduledCustomerEmail(booking, previousDate, previousTime) {
    const email = String(booking.email || '').trim();
    if (!email) return;
    const name = `${booking.firstName || ''}`.trim() || 'there';
    const newWhen = `${formatDate(booking.preferredDate)} at ${formatTime(booking.preferredTime)}`;
    const oldWhen = `${formatDate(previousDate)} at ${formatTime(previousTime)}`;
    const links = urls(booking.bookingId, email);
    const subject = `H&M Herbs — Your EDSA appointment was updated (#${booking.bookingId})`;
    const html = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#111827;max-width:560px;">
            <h2 style="color:#10b981;margin:0 0 8px;">Your appointment time was updated</h2>
            <p>Hello ${escapeHtml(name)},</p>
            <p>Our team updated your EDSA appointment (confirmation #${escapeHtml(booking.bookingId)}):</p>
            <p><strong>Previous:</strong> ${escapeHtml(oldWhen)}<br>
               <strong>New:</strong> ${escapeHtml(newWhen)}</p>
            <p><a href="${escapeHtml(links.confirmation)}" style="background:#10b981;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;margin-right:8px;">View confirmation</a>
               <a href="${escapeHtml(links.manage)}" style="color:#10b981;">Manage appointment</a></p>
        </div>`;
    const text = [`Appointment #${booking.bookingId} updated by our team.`, `Was: ${oldWhen}`, `Now: ${newWhen}`].join('\n');
    await sendEmail({ to: email, subject, html, text, logTag: 'EDSA staff-reschedule customer email' });
}

module.exports = {
    sendBookingReceivedEmail,
    sendBookingReceivedStoreEmail,
    sendAppointmentCancelledEmail,
    sendAppointmentCancelledStoreEmail,
    sendAppointmentRescheduledEmail,
    sendAppointmentRescheduledStoreEmail,
    sendChangeRequestReceivedEmail,
    sendChangeRequestStoreNotificationEmail,
    sendAdminResolutionEmail,
    sendStaffCancelledCustomerEmail,
    sendStaffRescheduledCustomerEmail
};

