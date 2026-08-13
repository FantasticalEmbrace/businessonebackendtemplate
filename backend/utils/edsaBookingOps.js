'use strict';

const logger = require('./logger');
const googleCalendar = require('../services/google-calendar');
const { normalizeDateYmd } = require('./storeTimezone');
const { withTimeout } = require('./withTimeout');

/** HH:MM times held by paid, confirmed website bookings only. */
async function getActiveBookedTimesForDate(pool, dateStr, excludeBookingId = null) {
    const excludeId = Number(excludeBookingId);
    const hasExclude = Number.isFinite(excludeId) && excludeId > 0;
    const excludeSql = hasExclude ? ' AND id <> ?' : '';
    const paramsA = hasExclude ? [dateStr, excludeId] : [dateStr];

    const [rows] = await pool.execute(
        `SELECT preferred_time AS slot_time
           FROM edsa_bookings
          WHERE preferred_date = ?
            AND status = 'confirmed'${excludeSql}`,
        paramsA
    );
    const times = new Set();
    for (const row of rows) {
        if (row.slot_time) {
            times.add(String(row.slot_time).slice(0, 5));
        }
    }
    return times;
}

async function loadBookingRowById(pool, bookingId) {
    const id = Number(bookingId);
    if (!Number.isFinite(id) || id < 1) return null;
    const [rows] = await pool.execute(
        `SELECT id, first_name, last_name, email, phone,
                preferred_date, preferred_time, status, notes, admin_notes,
                google_calendar_event_id, confirmed_date, confirmed_time, payment_status
           FROM edsa_bookings WHERE id = ? LIMIT 1`,
        [id]
    );
    return rows.length ? rows[0] : null;
}

async function isSlotAvailable(pool, dateStr, timeHm, excludeBookingId = null) {
    const normalizedTime = String(timeHm).slice(0, 5);
    const dbBooked = await getActiveBookedTimesForDate(pool, dateStr, excludeBookingId);
    if (dbBooked.has(normalizedTime)) {
        return false;
    }

    await googleCalendar.ensureInitialized(pool);
    if (googleCalendar.isAvailable()) {
        try {
            const slots = await withTimeout(
                googleCalendar.getAvailableSlots(dateStr, pool),
                8000,
                'Google Calendar slot check'
            );
            const match = slots.find((s) => s.time === normalizedTime);
            if (match && !match.available) {
                return false;
            }
        } catch (err) {
            logger.warn('EDSA slot check: Google Calendar unavailable, using database only', {
                error: err.message
            });
        }
    }
    return true;
}

async function deleteBookingCalendarEvent(pool, eventId) {
    if (!eventId) return false;
    try {
        await googleCalendar.ensureInitialized(pool);
        if (googleCalendar.isAvailable()) {
            return Boolean(await googleCalendar.deleteEvent(eventId, pool));
        }
    } catch (err) {
        logger.warn('Could not delete calendar event:', err.message);
    }
    return false;
}

async function clearBookingCalendarLink(pool, bookingId) {
    const id = Number(bookingId);
    if (!Number.isFinite(id) || id < 1) return;
    await pool.execute(
        'UPDATE edsa_bookings SET google_calendar_event_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id]
    );
}

function isEdsaBookingFinalized(row) {
    if (!row) return false;
    if (String(row.status || '').toLowerCase() !== 'confirmed') return false;
    const pay = String(row.payment_status || 'paid').toLowerCase();
    return pay === 'paid';
}

async function syncBookingCalendarEvent(pool, row) {
    if (!isEdsaBookingFinalized(row)) {
        return;
    }

    const bookingId = row.id;
    const payload = {
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
        preferredDate: normalizeDateYmd(row.preferred_date) || row.preferred_date,
        preferredTime: String(row.preferred_time || '').slice(0, 5),
        notes: row.notes,
        bookingId
    };

    await googleCalendar.ensureInitialized(pool);
    if (!googleCalendar.isAvailable()) return;

    try {
        if (row.google_calendar_event_id) {
            await googleCalendar.updateEvent(row.google_calendar_event_id, payload, pool);
            return;
        }
        const created = await googleCalendar.createEvent(payload, pool);
        if (created?.eventId) {
            await pool.execute(
                'UPDATE edsa_bookings SET google_calendar_event_id = ? WHERE id = ?',
                [created.eventId, bookingId]
            );
        }
    } catch (err) {
        logger.error('Google Calendar sync error:', err.message);
    }
}

function bookingEmailPayload(row) {
    return {
        bookingId: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
        preferredDate: normalizeDateYmd(row.preferred_date) || row.preferred_date,
        preferredTime: String(row.preferred_time || '').slice(0, 5),
        notes: row.notes
    };
}

function appointmentSnapshot(row) {
    return {
        date: normalizeDateYmd(row.preferred_date) || String(row.preferred_date || '').slice(0, 10),
        time: String(row.preferred_time || '').slice(0, 5)
    };
}

module.exports = {
    getActiveBookedTimesForDate,
    loadBookingRowById,
    isSlotAvailable,
    deleteBookingCalendarEvent,
    clearBookingCalendarLink,
    syncBookingCalendarEvent,
    isEdsaBookingFinalized,
    bookingEmailPayload,
    appointmentSnapshot,
    normalizeDateYmd
};
