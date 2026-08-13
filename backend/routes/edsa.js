// EDSA (Electro Dermal Stress Analysis) Service Routes
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const {
    edsaBookingValidation,
    edsaCustomerEmailValidation,
    edsaCustomerRescheduleValidation
} = require('../middleware/validation');
const googleCalendar = require('../services/google-calendar');
const { isUsPhoneDisplay } = require('../utils/usPhoneDisplay');
const {
    sendBookingReceivedEmail,
    sendBookingReceivedStoreEmail,
    sendAppointmentCancelledEmail,
    sendAppointmentCancelledStoreEmail,
    sendAppointmentRescheduledEmail,
    sendAppointmentRescheduledStoreEmail
} = require('../services/edsaAppointmentEmail');
const {
    isStoreDateTimeInFuture,
    normalizeDateYmd,
    getStoreTodayYmd,
    STORE_TIMEZONE
} = require('../utils/storeTimezone');
const {
    applyPastTimeFilter,
    isDateBeforeStoreToday,
    isDateBlocked,
    slotsForBlockedDay
} = require('../utils/edsaAvailability');
const { listBlockedDates, blockedDateSet } = require('../services/edsaBlockedDates');
const { nmiSale, nmiVoid } = require('../services/nmiGateway');
const nmiVaultCards = require('../services/nmiVaultCards');
const {
    getNmiPrivateApiKey,
    getNmiPublicTokenizationKey,
    getNmiCollectJsUrl,
    isNmiSandboxHint,
    isNmiWalletsDisabled
} = require('../utils/nmiEnv');
const { withTimeout } = require('../utils/withTimeout');

function isEdsaPaymentConfigured() {
    return Boolean(getNmiPrivateApiKey() && getNmiPublicTokenizationKey());
}

async function getAuthenticatedUserFromRequest(req) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token || !process.env.JWT_SECRET) return null;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = Number(decoded?.userId ?? decoded?.id ?? decoded?.sub);
        if (!Number.isInteger(userId) || userId <= 0) return null;

        const [rows] = await req.pool.execute(
            'SELECT id, email, first_name, last_name, phone FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
            [userId]
        );
        return rows[0] || null;
    } catch {
        return null;
    }
}

async function getEdsaServicePrice(pool) {
    const [settings] = await pool.execute(
        `SELECT value FROM settings WHERE key_name = 'edsa_service_price' LIMIT 1`
    );
    const price = parseFloat(settings[0]?.value || 75.0);
    return Number.isFinite(price) && price >= 0 ? price : 75.0;
}

function finalizeSlotAvailability(dateYmd, slots, blockedSet) {
    if (isDateBlocked(dateYmd, blockedSet)) {
        return slotsForBlockedDay(slots);
    }
    return applyPastTimeFilter(dateYmd, slots);
}

/** HH:MM times held by paid, confirmed website bookings only (unpaid attempts do not reserve slots). */
async function getActiveBookedTimesForDate(pool, dateStr, excludeBookingId = null) {
    const excludeId = Number(excludeBookingId);
    const hasExclude = Number.isFinite(excludeId) && excludeId > 0;
    const excludeSql = hasExclude ? ' AND id <> ?' : '';
    const params = hasExclude ? [dateStr, excludeId] : [dateStr];

    const [rows] = await pool.execute(
        `SELECT preferred_time AS slot_time
           FROM edsa_bookings
          WHERE preferred_date = ?
            AND status = 'confirmed'${excludeSql}`,
        params
    );
    const times = new Set();
    for (const row of rows) {
        if (row.slot_time) {
            times.add(String(row.slot_time).slice(0, 5));
        }
    }
    return times;
}

function formatBookingRow(booking) {
    const requestType = booking.customer_request_type || 'none';
    const canChange = ['pending', 'confirmed'].includes(booking.status);
    return {
        bookingId: booking.id,
        firstName: booking.first_name,
        lastName: booking.last_name,
        email: booking.email,
        phone: booking.phone,
        preferredDate: normalizeDateYmd(booking.preferred_date) || booking.preferred_date,
        preferredTime: String(booking.preferred_time || '').slice(0, 5),
        status: booking.status,
        notes: booking.notes,
        createdAt: booking.created_at,
        location: '1140 Battlefield Pkwy, Fort Oglethorpe, GA 30742',
        customerRequestType: requestType,
        customerRequestNotes: booking.customer_request_notes || null,
        requestedDate: booking.requested_date || null,
        requestedTime: booking.requested_time
            ? String(booking.requested_time).slice(0, 5)
            : null,
        customerRequestAt: booking.customer_request_at || null,
        canChange,
        hasPendingRequest: false,
    };
}

async function loadBookingForCustomer(pool, bookingId, email) {
    const id = Number(bookingId);
    const normalizedEmail = String(email || '')
        .trim()
        .toLowerCase();
    if (!Number.isFinite(id) || id < 1 || !normalizedEmail) {
        return null;
    }

    const [rows] = await pool.execute(
        `SELECT id, first_name, last_name, email, phone,
                preferred_date, preferred_time, status, notes, created_at,
                google_calendar_event_id,
                customer_request_type, customer_request_notes,
                requested_date, requested_time, customer_request_at
           FROM edsa_bookings WHERE id = ? LIMIT 1`,
        [id]
    );
    if (!rows.length) return null;
    const booking = rows[0];
    if (String(booking.email || '').trim().toLowerCase() !== normalizedEmail) {
        return null;
    }
    return booking;
}

async function loadBookingRowById(pool, bookingId) {
    const id = Number(bookingId);
    if (!Number.isFinite(id) || id < 1) return null;
    const [rows] = await pool.execute(
        `SELECT id, first_name, last_name, email, phone,
                preferred_date, preferred_time, status, notes, google_calendar_event_id
           FROM edsa_bookings WHERE id = ? LIMIT 1`,
        [id]
    );
    return rows.length ? rows[0] : null;
}

async function isSlotAvailable(pool, dateStr, timeHm, excludeBookingId = null) {
    const dateYmd = normalizeDateYmd(dateStr);
    const normalizedTime = String(timeHm).slice(0, 5);

    if (!dateYmd || isDateBeforeStoreToday(dateYmd)) {
        return false;
    }

    const blocked = await blockedDateSet(pool, dateYmd, dateYmd);
    if (isDateBlocked(dateYmd, blocked)) {
        return false;
    }

    if (!isStoreDateTimeInFuture(dateYmd, normalizedTime)) {
        return false;
    }

    const dbBooked = await getActiveBookedTimesForDate(pool, dateYmd, excludeBookingId);
    if (dbBooked.has(normalizedTime)) {
        return false;
    }

    await googleCalendar.ensureInitialized(pool);
    if (googleCalendar.isAvailable()) {
        try {
            const slots = await withTimeout(
                googleCalendar.getAvailableSlots(dateYmd, pool),
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
    if (!eventId) return;
    try {
        await googleCalendar.ensureInitialized(pool);
        if (googleCalendar.isAvailable()) {
            await googleCalendar.deleteEvent(eventId, pool);
        }
    } catch (err) {
        logger.warn('Could not delete calendar event:', err.message);
    }
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

function isEdsaBookingFinalized(row) {
    if (!row) return false;
    if (String(row.status || '').toLowerCase() !== 'confirmed') return false;
    const pay = String(row.payment_status || 'paid').toLowerCase();
    return pay === 'paid';
}

async function finalizeEdsaBookingAfterInsert(pool, bookingId, payload) {
    const {
        firstName,
        lastName,
        email,
        phone,
        preferredDate,
        preferredTime,
        notes
    } = payload;

    try {
        await googleCalendar.ensureInitialized(pool);
        if (googleCalendar.isAvailable()) {
            const calendarEvent = await withTimeout(
                googleCalendar.createEvent(
                    {
                        firstName,
                        lastName,
                        email,
                        phone,
                        preferredDate,
                        preferredTime,
                        notes: notes || null,
                        bookingId
                    },
                    pool
                ),
                12000,
                'Google Calendar create event'
            );

            if (calendarEvent?.eventId) {
                try {
                    await pool.execute(
                        'UPDATE edsa_bookings SET google_calendar_event_id = ? WHERE id = ?',
                        [calendarEvent.eventId, bookingId]
                    );
                } catch (dbError) {
                    logger.warn(
                        'Could not store calendar event ID (column may not exist):',
                        dbError.message
                    );
                }
            }
        }
    } catch (calendarError) {
        logger.error('Google Calendar sync error (booking still saved):', calendarError);
    }

    try {
        await withTimeout(
            sendEdsaBookingConfirmations(bookingId, {
                firstName,
                lastName,
                email,
                phone,
                preferredDate,
                preferredTime,
                notes: notes || null
            }),
            15000,
            'EDSA confirmation email'
        );
    } catch (emailErr) {
        logger.error('EDSA booking notification email error (booking saved):', emailErr);
    }
}

async function sendEdsaBookingConfirmations(bookingId, emailFields) {
    const emailPayload = {
        bookingId,
        firstName: emailFields.firstName,
        lastName: emailFields.lastName,
        email: emailFields.email,
        phone: emailFields.phone,
        preferredDate: emailFields.preferredDate,
        preferredTime: emailFields.preferredTime
    };
    try {
        await Promise.all([
            sendBookingReceivedEmail(emailPayload),
            sendBookingReceivedStoreEmail(emailPayload)
        ]);
    } catch (emailErr) {
        logger.error('EDSA booking notification email error (booking saved):', emailErr);
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

// Get business hours for EDSA service
router.get('/hours', async (req, res) => {
    try {
        // Return default business hours
        res.json({
            hours: {
                monday: { open: '10:00', close: '17:00', closed: false },
                tuesday: { open: '10:00', close: '17:00', closed: false },
                wednesday: { open: '10:00', close: '17:00', closed: false },
                thursday: { open: '10:00', close: '17:00', closed: false },
                friday: { open: '10:00', close: '17:00', closed: false },
                saturday: { open: '10:00', close: '13:00', closed: false },
                sunday: { open: '00:00', close: '00:00', closed: true }
            }
        });
    } catch (error) {
        logger.error('EDSA hours fetch error:', error);
        // Return default hours even on error
        res.json({
            hours: {
                monday: { open: '10:00', close: '17:00', closed: false },
                tuesday: { open: '10:00', close: '17:00', closed: false },
                wednesday: { open: '10:00', close: '17:00', closed: false },
                thursday: { open: '10:00', close: '17:00', closed: false },
                friday: { open: '10:00', close: '17:00', closed: false },
                saturday: { open: '10:00', close: '13:00', closed: false },
                sunday: { open: '00:00', close: '00:00', closed: true }
            }
        });
    }
});

// Get EDSA service information
router.get('/info', async (req, res) => {
    try {
        const [settings] = await req.pool.execute(`
            SELECT key_name, value, description 
            FROM settings 
            WHERE key_name IN ('edsa_service_enabled', 'edsa_service_price', 'edsa_service_description')
        `);

        const serviceInfo = {};
        settings.forEach(setting => {
            serviceInfo[setting.key_name] = setting.value;
        });

        res.json({
            enabled: serviceInfo.edsa_service_enabled === 'true',
            price: parseFloat(serviceInfo.edsa_service_price || 75.00),
            description: serviceInfo.edsa_service_description || 'Electro Dermal Stress Analysis - A non-invasive health assessment technique'
        });
    } catch (error) {
        logger.error('EDSA info fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Booking context for calendar UI (store timezone, blocked dates, payment)
router.get('/booking-context', async (req, res) => {
    try {
        const from = normalizeDateYmd(req.query.from) || getStoreTodayYmd();
        const to = normalizeDateYmd(req.query.to) || from;
        const blocked = await listBlockedDates(req.pool, from, to);
        const price = await getEdsaServicePrice(req.pool);
        const paymentConfigured = isEdsaPaymentConfigured();
        const authUser = await getAuthenticatedUserFromRequest(req);
        let savedCards = [];
        if (authUser) {
            try {
                savedCards = await nmiVaultCards.listUserVaultCards(req.pool, authUser.id);
            } catch (cardErr) {
                logger.warn('EDSA booking-context saved cards:', cardErr.message);
            }
        }

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.json({
            storeTimezone: STORE_TIMEZONE,
            todayYmd: getStoreTodayYmd(),
            blockedDates: blocked.map((b) => b.date),
            price,
            paymentRequired: paymentConfigured,
            paymentEnabled: paymentConfigured,
            isLoggedIn: Boolean(authUser),
            savedCards,
            paymentConfig: paymentConfigured
                ? {
                      tokenizationKey: getNmiPublicTokenizationKey(),
                      collectJsUrl: getNmiCollectJsUrl(),
                      sandbox: isNmiSandboxHint(),
                      disableWallets: isNmiWalletsDisabled()
                  }
                : null
        });
    } catch (error) {
        logger.error('EDSA booking context error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get available time slots for a date
router.get('/available-slots', async (req, res) => {
    try {
        const { date, excludeBookingId } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date parameter is required (YYYY-MM-DD)' });
        }

        const dateYmd = normalizeDateYmd(date);
        if (!dateYmd) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        if (isDateBeforeStoreToday(dateYmd)) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
            return res.json({ slots: [] });
        }

        const blocked = await blockedDateSet(req.pool, dateYmd, dateYmd);
        if (isDateBlocked(dateYmd, blocked)) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
            return res.json({ slots: [] });
        }

        const dbBooked = await getActiveBookedTimesForDate(
            req.pool,
            dateYmd,
            excludeBookingId || null
        );

        await googleCalendar.ensureInitialized(req.pool);
        const slots = await googleCalendar.getAvailableSlots(dateYmd, req.pool);

        const merged = slots.map((slot) => ({
            ...slot,
            available:
                Boolean(slot.available) && !dbBooked.has(String(slot.time).slice(0, 5)),
        }));

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.json({
            slots: finalizeSlotAvailability(dateYmd, merged, blocked),
        });
    } catch (error) {
        logger.error('Available slots error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Book EDSA appointment
router.post('/book', edsaBookingValidation, async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            email,
            phone,
            preferredDate,
            preferredTime,
            alternativeDate,
            alternativeTime,
            notes,
            payment_token: paymentTokenRaw,
            savedCardId: savedCardIdRaw
        } = req.body;

        const paymentRequired = isEdsaPaymentConfigured();
        const payment_token = String(paymentTokenRaw || '').trim();
        const savedCardId =
            savedCardIdRaw != null && savedCardIdRaw !== '' ? Number(savedCardIdRaw) : null;
        const authUser = await getAuthenticatedUserFromRequest(req);

        if (paymentRequired) {
            const hasSavedCard = Number.isFinite(savedCardId) && savedCardId > 0;
            if (!payment_token && !hasSavedCard) {
                return res.status(400).json({
                    error: 'Payment is required to book your EDSA session.',
                    code: 'PAYMENT_REQUIRED'
                });
            }
            if (hasSavedCard && !authUser) {
                return res.status(401).json({
                    error: 'Sign in to use your saved payment method.',
                    code: 'AUTH_REQUIRED'
                });
            }
        }

        // Validate required fields
        if (!firstName || !lastName || !email || !phone || !preferredDate || !preferredTime) {
            return res.status(400).json({ 
                error: 'All required fields must be provided (firstName, lastName, email, phone, preferredDate, preferredTime)' 
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (!isUsPhoneDisplay(phone)) {
            return res.status(400).json({ error: 'Phone must be formatted as (555) 123-4567' });
        }

        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(preferredDate)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }

        // Validate time format (HH:MM)
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(preferredTime)) {
            return res.status(400).json({ error: 'Invalid time format. Use HH:MM' });
        }

        // Check if preferred date is in the future (store timezone: America/New_York)
        if (!isStoreDateTimeInFuture(preferredDate, preferredTime)) {
            return res.status(400).json({ error: 'Preferred date and time must be in the future' });
        }

        // Validate alternative date/time if provided
        if (alternativeDate && alternativeTime) {
            if (!dateRegex.test(alternativeDate) || !timeRegex.test(alternativeTime)) {
                return res.status(400).json({ error: 'Invalid alternative date or time format' });
            }

            if (!isStoreDateTimeInFuture(alternativeDate, alternativeTime)) {
                return res.status(400).json({ error: 'Alternative date and time must be in the future' });
            }
        }

        const normalizedTime = String(preferredTime).slice(0, 5);
        if (!(await isSlotAvailable(req.pool, preferredDate, normalizedTime))) {
            return res.status(409).json({
                error:
                    'That time is no longer available. Please choose another slot.',
                code: 'SLOT_TAKEN',
            });
        }

        const servicePrice = await getEdsaServicePrice(req.pool);
        const amountStr = servicePrice.toFixed(2);
        let paymentReference = null;
        let amountCharged = servicePrice;

        if (paymentRequired) {
            let pay;
            if (Number.isFinite(savedCardId) && savedCardId > 0) {
                pay = await nmiVaultCards.chargeVaultCard(
                    req.pool,
                    authUser.id,
                    savedCardId,
                    amountStr
                );
            } else {
                pay = await nmiSale({
                    securityKey: getNmiPrivateApiKey(),
                    amount: amountStr,
                    paymentToken: payment_token
                });
            }

            if (!pay.ok) {
                return res.status(402).json({
                    error: pay.responseText || 'Payment was declined. Your appointment was not booked.',
                    code: 'PAYMENT_FAILED'
                });
            }

            paymentReference = pay.transactionId || null;

            if (!(await isSlotAvailable(req.pool, preferredDate, normalizedTime))) {
                if (paymentReference) {
                    const voidResult = await nmiVoid({
                        securityKey: getNmiPrivateApiKey(),
                        transactionId: paymentReference
                    });
                    if (!voidResult.ok) {
                        logger.error('EDSA void failed after slot conflict', {
                            bookingAttempt: { preferredDate, normalizedTime, paymentReference },
                            voidResult
                        });
                        return res.status(409).json({
                            error:
                                'That time was just booked by someone else. Please contact the store — your payment may need a manual refund.',
                            code: 'SLOT_TAKEN'
                        });
                    }
                }
                return res.status(409).json({
                    error:
                        'That time was just booked by someone else. Your card was not charged — please choose another slot.',
                    code: 'SLOT_TAKEN'
                });
            }
        }

        const [result] = await req.pool.execute(`
            INSERT INTO edsa_bookings (
                user_id, first_name, last_name, email, phone,
                preferred_date, preferred_time, alternative_date, alternative_time, notes,
                status, confirmed_date, confirmed_time, payment_status, amount_charged, payment_reference
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            authUser?.id || null,
            firstName,
            lastName,
            email,
            phone,
            preferredDate,
            preferredTime,
            alternativeDate || null,
            alternativeTime || null,
            notes || null,
            'confirmed',
            preferredDate,
            normalizedTime,
            'paid',
            amountCharged,
            paymentReference
        ]);

        const bookingId = Number(result.insertId);

        const shouldFinalize = !paymentRequired || Boolean(paymentReference);

        res.status(201).json({
            message: 'EDSA appointment booking submitted successfully',
            bookingId: Number.isFinite(bookingId) ? bookingId : result.insertId,
            status: 'confirmed',
            paymentStatus: 'paid',
            amountCharged,
            firstName,
            lastName,
            email,
            preferredDate,
            preferredTime: normalizedTime,
            calendarEvent: {
                created: false,
                message: shouldFinalize
                    ? 'Calendar and confirmation emails are being sent'
                    : 'Calendar sync not available'
            }
        });

        if (shouldFinalize) {
            void finalizeEdsaBookingAfterInsert(req.pool, bookingId, {
                firstName,
                lastName,
                email,
                phone,
                preferredDate,
                preferredTime: normalizedTime,
                notes: notes || null
            });
        }
    } catch (error) {
        logger.error('EDSA booking error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user's EDSA bookings (requires authentication)
router.get('/bookings', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const [bookings] = await req.pool.execute(`
            SELECT 
                id, first_name, last_name, email, phone,
                preferred_date, preferred_time, alternative_date, alternative_time,
                status, notes, created_at
            FROM edsa_bookings 
            WHERE user_id = ?
            ORDER BY preferred_date DESC, preferred_time DESC
        `, [req.user.id]);

        res.json({ bookings });
    } catch (error) {
        logger.error('EDSA bookings fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Public booking summary for thank-you page (email must match booking)
router.get('/bookings/:id/confirmation-summary', async (req, res) => {
    try {
        const bookingId = Number(req.params.id);
        const email = String(req.query.email || '')
            .trim()
            .toLowerCase();
        if (!Number.isFinite(bookingId) || bookingId < 1 || !email) {
            return res.status(400).json({ error: 'booking id and email are required' });
        }

        const booking = await loadBookingForCustomer(req.pool, bookingId, email);
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        res.json(formatBookingRow(booking));
    } catch (error) {
        logger.error('EDSA confirmation summary error:', error);
        res.status(500).json({ error: 'Failed to load booking summary' });
    }
});

// Customer manage appointment (same verification as confirmation page)
router.get('/bookings/:id/manage', async (req, res) => {
    try {
        const booking = await loadBookingForCustomer(
            req.pool,
            req.params.id,
            req.query.email
        );
        if (!booking) {
            return res.status(404).json({ error: 'Appointment not found' });
        }
        res.json(formatBookingRow(booking));
    } catch (error) {
        logger.error('EDSA manage booking error:', error);
        res.status(500).json({ error: 'Failed to load appointment' });
    }
});

// Customer self-service cancel (immediate)
router.post('/bookings/:id/cancel-appointment', edsaCustomerEmailValidation, async (req, res) => {
    try {
        const bookingId = Number(req.params.id);
        const { email } = req.body;

        const booking = await loadBookingForCustomer(req.pool, bookingId, email);
        if (!booking) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        if (!['pending', 'confirmed'].includes(booking.status)) {
            return res.status(400).json({
                error: 'This appointment can no longer be cancelled online. Please call the store.',
            });
        }

        const prevPayload = bookingEmailPayload(booking);

        await req.pool.execute(
            `UPDATE edsa_bookings
                SET status = 'cancelled',
                    google_calendar_event_id = NULL,
                    customer_request_type = 'none',
                    customer_request_notes = NULL,
                    requested_date = NULL,
                    requested_time = NULL,
                    customer_request_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [bookingId]
        );

        if (booking.google_calendar_event_id) {
            await deleteBookingCalendarEvent(req.pool, booking.google_calendar_event_id);
        }

        try {
            await Promise.all([
                sendAppointmentCancelledEmail(prevPayload),
                sendAppointmentCancelledStoreEmail(prevPayload)
            ]);
        } catch (emailErr) {
            logger.error('EDSA cancellation email error (cancel saved):', emailErr);
        }

        res.json({
            message: 'Your appointment has been cancelled.',
            bookingId,
            status: 'cancelled',
        });
    } catch (error) {
        logger.error('EDSA customer cancel error:', error);
        res.status(500).json({ error: 'Failed to cancel appointment' });
    }
});

// Customer self-service reschedule (immediate when slot is available)
router.post('/bookings/:id/reschedule-appointment', edsaCustomerRescheduleValidation, async (req, res) => {
    try {
        const bookingId = Number(req.params.id);
        const { email, preferredDate, preferredTime, notes } = req.body;

        const booking = await loadBookingForCustomer(req.pool, bookingId, email);
        if (!booking) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        if (!['pending', 'confirmed'].includes(booking.status)) {
            return res.status(400).json({
                error: 'This appointment can no longer be changed online. Please call the store.',
            });
        }

        const normalizedTime = String(preferredTime).slice(0, 5);
        const dateYmd = normalizeDateYmd(preferredDate) || preferredDate;

        if (!isStoreDateTimeInFuture(dateYmd, normalizedTime)) {
            return res.status(400).json({ error: 'Please choose a date and time in the future.' });
        }

        const currentDate = normalizeDateYmd(booking.preferred_date);
        const currentTime = String(booking.preferred_time || '').slice(0, 5);
        if (currentDate === dateYmd && currentTime === normalizedTime) {
            return res.status(400).json({
                error: 'You are already booked for that date and time.',
            });
        }

        if (!(await isSlotAvailable(req.pool, dateYmd, normalizedTime, bookingId))) {
            return res.status(409).json({
                error: 'That time is no longer available. Please choose another slot.',
                code: 'SLOT_TAKEN',
            });
        }

        const previousDate = currentDate;
        const previousTime = currentTime;

        await req.pool.execute(
            `UPDATE edsa_bookings
                SET preferred_date = ?,
                    preferred_time = ?,
                    confirmed_date = ?,
                    confirmed_time = ?,
                    notes = COALESCE(?, notes),
                    customer_request_type = 'none',
                    customer_request_notes = NULL,
                    requested_date = NULL,
                    requested_time = NULL,
                    customer_request_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [dateYmd, normalizedTime, dateYmd, normalizedTime, notes || null, bookingId]
        );

        const updated = await loadBookingRowById(req.pool, bookingId);
        if (updated) {
            await syncBookingCalendarEvent(req.pool, updated);
        }

        const emailPayload = bookingEmailPayload(updated || booking);
        try {
            await Promise.all([
                sendAppointmentRescheduledEmail(emailPayload, previousDate, previousTime),
                sendAppointmentRescheduledStoreEmail(emailPayload, previousDate, previousTime)
            ]);
        } catch (emailErr) {
            logger.error('EDSA reschedule email error (reschedule saved):', emailErr);
        }

        res.json({
            message: 'Your appointment has been rescheduled.',
            bookingId,
            preferredDate: dateYmd,
            preferredTime: normalizedTime,
            booking: formatBookingRow(
                updated || {
                    ...booking,
                    preferred_date: dateYmd,
                    preferred_time: normalizedTime
                }
            ),
        });
    } catch (error) {
        logger.error('EDSA customer reschedule error:', error);
        res.status(500).json({ error: 'Failed to reschedule appointment' });
    }
});

// Get specific booking by ID
router.get('/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        const [bookings] = await req.pool.execute(`
            SELECT 
                id, first_name, last_name, email, phone,
                preferred_date, preferred_time, alternative_date, alternative_time,
                status, notes, created_at
            FROM edsa_bookings 
            WHERE id = ? ${userId ? 'AND user_id = ?' : ''}
        `, userId ? [id, userId] : [id]);

        if (bookings.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        res.json({ booking: bookings[0] });
    } catch (error) {
        logger.error('EDSA booking fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Cancel EDSA booking
router.put('/bookings/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        let query = 'UPDATE edsa_bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN (?, ?)';
        let params = ['cancelled', id, 'pending', 'confirmed'];

        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }

        const [result] = await req.pool.execute(query, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Booking not found or cannot be cancelled' });
        }

        // Delete calendar event if it exists
        try {
            const [booking] = await req.pool.execute(
                'SELECT google_calendar_event_id FROM edsa_bookings WHERE id = ?',
                [id]
            );
            
            if (booking.length > 0 && booking[0].google_calendar_event_id) {
                await googleCalendar.ensureInitialized(req.pool);
                if (googleCalendar.isAvailable()) {
                    await googleCalendar.deleteEvent(booking[0].google_calendar_event_id, req.pool);
                }
            }
        } catch (calendarError) {
            logger.warn('Could not delete calendar event:', calendarError);
        }

        res.json({ message: 'Booking cancelled successfully' });
    } catch (error) {
        logger.error('EDSA booking cancellation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create calendar event endpoint (admin/legacy — only for paid, confirmed bookings)
router.post('/create-calendar-event', async (req, res) => {
    try {
        const { bookingId, eventDetails } = req.body;

        if (!bookingId || !eventDetails) {
            return res.status(400).json({ error: 'bookingId and eventDetails are required' });
        }

        const [rows] = await req.pool.execute(
            `SELECT id, status, payment_status, google_calendar_event_id
               FROM edsa_bookings WHERE id = ? LIMIT 1`,
            [bookingId]
        );
        if (!rows.length) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        if (!isEdsaBookingFinalized(rows[0])) {
            return res.status(402).json({
                error: 'Calendar events are only created after payment is complete.',
                code: 'PAYMENT_REQUIRED'
            });
        }

        await googleCalendar.ensureInitialized(req.pool);
        const calendarEvent = await googleCalendar.createEvent(
            {
                ...eventDetails,
                bookingId,
            },
            req.pool
        );

        if (calendarEvent) {
            res.json({
                success: true,
                event: calendarEvent
            });
        } else {
            res.status(500).json({ error: 'Failed to create calendar event' });
        }
    } catch (error) {
        logger.error('Create calendar event error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
