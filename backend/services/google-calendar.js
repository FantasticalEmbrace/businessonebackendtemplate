const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { isSmtpConfigured } = require('../utils/smtpConfig');
const GoogleCalendarOAuthService = require('./google-calendar-oauth');
const {
    buildStoreCalendarDateTime,
    buildStoreCalendarEnd,
    getStoreDayBoundsRfc3339,
    eventStartToStoreTimeHm,
    normalizeDateYmd,
    normalizeTimeHm,
} = require('../utils/storeTimezone');

class GoogleCalendarService {
    constructor() {
        this.calendar = null;
        this.calendarId = 'primary';
        this.initialized = false;
        this.authMode = null;
        this._initPool = null;
    }

    resetClient() {
        this.calendar = null;
        this.calendarId = 'primary';
        this.initialized = false;
        this.authMode = null;
        this._initPool = null;
    }

    async _tryServiceAccount() {
        const credentialsPath =
            process.env.GOOGLE_CREDENTIALS_PATH ||
            path.join(__dirname, '../config/google-credentials.json');

        if (!fs.existsSync(credentialsPath)) {
            return false;
        }

        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/calendar'],
        });

        this.calendar = google.calendar({ version: 'v3', auth });
        this.calendarId =
            process.env.GOOGLE_CALENDAR_ID || process.env.HMHERBS_CALENDAR_ID || 'primary';
        this.initialized = true;
        this.authMode = 'service_account';
        logger.info('[integration][google-calendar] Initialized via service account file');
        return true;
    }

    async ensureInitialized(pool) {
        if (this.initialized && this._initPool === pool) {
            return this.initialized;
        }

        this.resetClient();

        if (pool && (await GoogleCalendarOAuthService.isConfigured(pool))) {
            try {
                const { auth, calendarId } = await GoogleCalendarOAuthService.getAuthenticatedClient(
                    pool,
                    null
                );
                this.calendar = google.calendar({ version: 'v3', auth });
                this.calendarId = calendarId;
                this.initialized = true;
                this.authMode = 'oauth';
                this._initPool = pool;
                logger.info('[integration][google-calendar] Initialized via OAuth', {
                    calendarId: this.calendarId,
                });
                return true;
            } catch (err) {
                logger.warn('[integration][google-calendar] OAuth init failed', {
                    error: err.message,
                });
            }
        }

        return this._tryServiceAccount();
    }

    isAvailable() {
        return this.initialized && this.calendar !== null;
    }

    /**
     * Store calendar only — no customer guest emails from Google.
     * Branded SMTP handles customer confirmation/cancellation when configured.
     * Calendar guest invites are a fallback only when SMTP is not set up.
     */
    calendarEventOptions(customerEmail) {
        const email = String(customerEmail || '').trim();
        const useCalendarInvite = email && !isSmtpConfigured();
        return {
            attendees: useCalendarInvite ? [{ email, responseStatus: 'needsAction' }] : [],
            guestsCanInviteOthers: false,
            guestsCanModify: false,
            guestsCanSeeOtherGuests: false,
            reminders: {
                useDefault: false,
                overrides: [{ method: 'popup', minutes: 60 }],
            },
        };
    }

    calendarSendUpdates(customerEmail) {
        const email = String(customerEmail || '').trim();
        return email && !isSmtpConfigured() ? 'externalOnly' : 'none';
    }

    async stripEventAttendees(eventId) {
        if (!this.isAvailable() || !eventId || !isSmtpConfigured()) return;
        try {
            await this.calendar.events.patch({
                calendarId: this.calendarId,
                eventId,
                resource: {
                    attendees: [],
                    ...this.calendarEventOptions(),
                },
                sendUpdates: 'none',
            });
        } catch (err) {
            logger.warn('[integration][google-calendar] Could not strip attendees before delete', {
                eventId,
                error: err.message,
            });
        }
    }

    async createEvent(bookingData, pool) {
        if (pool) await this.ensureInitialized(pool);
        if (!this.isAvailable()) {
            logger.warn('[integration][google-calendar] Not initialized. Skipping event creation.');
            return null;
        }

        try {
            const {
                firstName,
                lastName,
                email,
                phone,
                preferredDate,
                preferredTime,
                notes,
                bookingId,
            } = bookingData;

            const event = {
                summary: `EDSA Session - ${firstName} ${lastName}`,
                description: this.buildEventDescription({
                    firstName,
                    lastName,
                    email,
                    phone,
                    notes,
                    bookingId,
                }),
                start: buildStoreCalendarDateTime(preferredDate, preferredTime),
                end: buildStoreCalendarEnd(preferredDate, preferredTime, 1),
                location: '1140 Battlefield Pkwy, Fort Oglethorpe, GA 30742',
                colorId: '10',
                ...this.calendarEventOptions(email),
            };

            const response = await this.calendar.events.insert({
                calendarId: this.calendarId,
                resource: event,
                sendUpdates: this.calendarSendUpdates(email),
            });

            logger.info('[integration][google-calendar] Event created', { eventId: response.data.id });

            return {
                eventId: response.data.id,
                htmlLink: response.data.htmlLink,
                hangoutLink: response.data.hangoutLink,
            };
        } catch (error) {
            logger.error('[integration][google-calendar] Create event error', { error: error.message });
            return null;
        }
    }

    async updateEvent(eventId, bookingData, pool) {
        if (pool) await this.ensureInitialized(pool);
        if (!this.isAvailable() || !eventId) return null;

        try {
            const { firstName, lastName, email, phone, preferredDate, preferredTime, notes } =
                bookingData;

            const event = {
                summary: `EDSA Session - ${firstName} ${lastName}`,
                description: this.buildEventDescription({
                    firstName,
                    lastName,
                    email,
                    phone,
                    notes,
                }),
                start: buildStoreCalendarDateTime(preferredDate, preferredTime),
                end: buildStoreCalendarEnd(preferredDate, preferredTime, 1),
                ...this.calendarEventOptions(email),
            };

            const response = await this.calendar.events.update({
                calendarId: this.calendarId,
                eventId,
                resource: event,
                sendUpdates: this.calendarSendUpdates(email),
            });

            return response.data;
        } catch (error) {
            logger.error('[integration][google-calendar] Update event error', { error: error.message });
            return null;
        }
    }

    async deleteEvent(eventId, pool) {
        if (pool) await this.ensureInitialized(pool);
        if (!this.isAvailable() || !eventId) return false;

        try {
            let customerEmail = '';
            if (!isSmtpConfigured()) {
                try {
                    const existing = await this.calendar.events.get({
                        calendarId: this.calendarId,
                        eventId,
                    });
                    const guests = existing?.data?.attendees || [];
                    const guest = guests.find((a) => a.email && !a.organizer && !a.self);
                    customerEmail = guest?.email || '';
                } catch (_) {
                    /* use sendUpdates none if event cannot be read */
                }
            } else {
                await this.stripEventAttendees(eventId);
            }
            await this.calendar.events.delete({
                calendarId: this.calendarId,
                eventId,
                sendUpdates: this.calendarSendUpdates(customerEmail),
            });
            return true;
        } catch (error) {
            const msg = String(error.message || '');
            if (error.code === 404 || error.code === 410 || /not found|deleted/i.test(msg)) {
                return true;
            }
            logger.error('[integration][google-calendar] Delete event error', { error: error.message });
            return false;
        }
    }

    isEdsaCalendarEvent(event) {
        const summary = String(event?.summary || '');
        const desc = String(event?.description || '');
        return (
            /edsa/i.test(summary) ||
            /electro dermal/i.test(desc) ||
            /booking\s*id\s*:/i.test(desc)
        );
    }

    parseBookingIdFromEvent(event) {
        const m = String(event?.description || '').match(/Booking\s*ID:\s*(\d+)/i);
        const id = m ? Number(m[1]) : NaN;
        return Number.isFinite(id) && id > 0 ? id : null;
    }

    /** Bookings + calendar events for a day — cancelled slots must not block availability. */
    async loadEdsaSlotBlockingContext(pool, dayYmd) {
        const activeEventIds = new Set();
        const cancelledEventIds = new Set();
        const activeBookedTimes = new Set();
        const bookingStatusById = new Map();

        if (!pool) {
            return { activeEventIds, cancelledEventIds, activeBookedTimes, bookingStatusById };
        }

        try {
            const [rows] = await pool.execute(
                `SELECT id, status, preferred_time, google_calendar_event_id
                   FROM edsa_bookings
                  WHERE preferred_date = ?`,
                [dayYmd]
            );

            for (const row of rows) {
                bookingStatusById.set(row.id, row.status);
                const timeHm = row.preferred_time
                    ? String(row.preferred_time).slice(0, 5)
                    : null;
                const eventId = row.google_calendar_event_id;

                if (['pending', 'confirmed'].includes(row.status)) {
                    if (timeHm) activeBookedTimes.add(timeHm);
                    if (eventId) activeEventIds.add(eventId);
                } else if (['cancelled', 'completed'].includes(row.status) && eventId) {
                    cancelledEventIds.add(eventId);
                }
            }
        } catch (err) {
            logger.warn('[integration][google-calendar] Could not load EDSA slot context', {
                error: err.message,
            });
        }

        return { activeEventIds, cancelledEventIds, activeBookedTimes, bookingStatusById };
    }

    calendarEventBlocksSlot(event, ctx) {
        const eventId = event?.id;
        if (eventId && ctx.cancelledEventIds.has(eventId)) {
            return false;
        }

        const bookingId = this.parseBookingIdFromEvent(event);
        if (bookingId != null && ctx.bookingStatusById.has(bookingId)) {
            return ['pending', 'confirmed'].includes(ctx.bookingStatusById.get(bookingId));
        }

        if (eventId && ctx.activeEventIds.has(eventId)) {
            return true;
        }

        if (this.isEdsaCalendarEvent(event)) {
            return false;
        }

        return Boolean(eventId);
    }

    async getAvailableSlots(date, pool) {
        if (pool) await this.ensureInitialized(pool);
        if (!this.isAvailable()) {
            return this.generateDefaultSlots();
        }

        try {
            const dayYmd = normalizeDateYmd(date) || normalizeDateYmd(new Date());
            const { timeMin, timeMax } = getStoreDayBoundsRfc3339(dayYmd);

            const response = await this.calendar.events.list({
                calendarId: this.calendarId,
                timeMin,
                timeMax,
                singleEvents: true,
                orderBy: 'startTime',
            });

            const existingEvents = response.data.items || [];
            const ctx = await this.loadEdsaSlotBlockingContext(pool, dayYmd);

            const bookedSlots = [];
            for (const event of existingEvents) {
                if (!this.calendarEventBlocksSlot(event, ctx)) {
                    continue;
                }
                const hm = eventStartToStoreTimeHm(event.start);
                if (hm) {
                    bookedSlots.push(hm);
                }
            }

            const allSlots = this.generateDefaultSlots();

            return allSlots.map((slot) => ({
                time: slot.time,
                available:
                    !bookedSlots.includes(slot.time) &&
                    !ctx.activeBookedTimes.has(slot.time),
            }));
        } catch (error) {
            logger.error('[integration][google-calendar] Available slots error', {
                error: error.message,
            });
            return this.generateDefaultSlots();
        }
    }

    generateDefaultSlots() {
        const slots = [];
        for (let hour = 10; hour < 18; hour++) {
            slots.push({
                time: `${String(hour).padStart(2, '0')}:00`,
                available: true,
            });
        }
        return slots;
    }

    buildEventDescription({ firstName, lastName, email, phone, notes, bookingId }) {
        let description = `EDSA (Electro Dermal Stress Analysis) Appointment\n\n`;
        description += `Client: ${firstName} ${lastName}\n`;
        description += `Email: ${email}\n`;
        description += `Phone: ${phone}\n`;

        if (bookingId) {
            description += `Booking ID: ${bookingId}\n`;
        }

        if (notes) {
            description += `\nNotes: ${notes}\n`;
        }

        description += `\n---\n`;
        description += `Created automatically from the HM Herbs website booking system.`;

        return description;
    }
}

module.exports = new GoogleCalendarService();
