/**
 * EDSA admin calendar (day / week / month) — extends AdminApp.
 */
(function () {
    const STORE_OPEN_HOUR = 10;
    const STORE_CLOSE_HOUR = 18;
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function ymdFromDate(d) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    function parseBookingYmd(booking) {
        const raw = booking.preferred_date;
        if (!raw) return '';
        if (typeof raw === 'string') return raw.slice(0, 10);
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return '';
        return ymdFromDate(d);
    }

    function parseBookingTimeHm(booking) {
        const t = booking.preferred_time;
        if (!t) return '10:00';
        return String(t).slice(0, 5);
    }

    function formatTimeDisplay(hm) {
        const [h, m] = String(hm).slice(0, 5).split(':').map(Number);
        if (!Number.isFinite(h)) return hm;
        const d = new Date();
        d.setHours(h, m || 0, 0, 0);
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    function startOfWeek(d) {
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        x.setDate(x.getDate() - x.getDay());
        return x;
    }

    function addDays(d, n) {
        const x = new Date(d);
        x.setDate(x.getDate() + n);
        return x;
    }

    function addMonths(d, n) {
        const x = new Date(d);
        x.setMonth(x.getMonth() + n);
        return x;
    }

    function sameYmd(a, b) {
        return ymdFromDate(a) === ymdFromDate(b);
    }

    function statusClass(status) {
        const s = String(status || '').toLowerCase();
        if (s === 'cancelled') return 'edsa-ev-cancelled';
        if (s === 'completed') return 'edsa-ev-completed';
        if (s === 'pending') return 'edsa-ev-pending';
        return 'edsa-ev-confirmed';
    }

    function calendarRange(cursor, view) {
        if (view === 'day') {
            const y = ymdFromDate(cursor);
            return { from: y, to: y };
        }
        if (view === 'week') {
            const start = startOfWeek(cursor);
            const end = addDays(start, 6);
            return { from: ymdFromDate(start), to: ymdFromDate(end) };
        }
        const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        const gridStart = startOfWeek(first);
        const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        const gridEnd = addDays(startOfWeek(last), 6);
        return { from: ymdFromDate(gridStart), to: ymdFromDate(gridEnd) };
    }

    function periodTitle(cursor, view) {
        if (view === 'day') {
            return cursor.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
            });
        }
        if (view === 'week') {
            const start = startOfWeek(cursor);
            const end = addDays(start, 6);
            const opts = { month: 'short', day: 'numeric' };
            const y =
                start.getFullYear() === end.getFullYear()
                    ? start.getFullYear()
                    : `${start.getFullYear()}–${end.getFullYear()}`;
            return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}, ${y}`;
        }
        return cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    function bookingsForYmd(bookings, ymd) {
        return bookings
            .filter((b) => parseBookingYmd(b) === ymd)
            .sort((a, b) => parseBookingTimeHm(a).localeCompare(parseBookingTimeHm(b)));
    }

    function renderEventChip(app, booking, compact) {
        const name = `${booking.first_name || ''} ${booking.last_name || ''}`.trim() || 'Guest';
        const time = formatTimeDisplay(parseBookingTimeHm(booking));
        const req = booking.customer_request_type && booking.customer_request_type !== 'none';
        const label = compact ? `${time} ${name.split(' ')[0]}` : `${time} — ${name}`;
        return `<button type="button" class="edsa-cal-event ${statusClass(booking.status)}${req ? ' edsa-ev-request' : ''}" data-edsa-id="${booking.id}" title="${app.escapeHtml(name)} · ${app.escapeHtml(booking.email || '')}">${app.escapeHtml(label)}</button>`;
    }

    const calendarMixin = {
        initEdsaCalendarState() {
            if (!this._edsaCalendarView) this._edsaCalendarView = 'month';
            if (!this._edsaCalendarCursor) this._edsaCalendarCursor = new Date();
            if (!this._edsaBookingsList) this._edsaBookingsList = [];
            if (!this._edsaBlockedDates) this._edsaBlockedDates = new Set();
            if (this._edsaBlockMode == null) this._edsaBlockMode = false;
        },

        getEdsaCalendarRange() {
            this.initEdsaCalendarState();
            return calendarRange(this._edsaCalendarCursor, this._edsaCalendarView);
        },

        renderEdsaCalendarShell() {
            this.initEdsaCalendarState();
            const title = periodTitle(this._edsaCalendarCursor, this._edsaCalendarView);
            const view = this._edsaCalendarView;
            return `
                <div class="edsa-cal" id="edsa-cal-root">
                    <div class="edsa-cal-toolbar">
                        <div class="edsa-cal-nav">
                            <button type="button" class="btn btn-sm btn-secondary" id="edsa-cal-today">Today</button>
                            <button type="button" class="btn btn-sm btn-secondary" id="edsa-cal-prev" aria-label="Previous"><i class="fas fa-chevron-left"></i></button>
                            <button type="button" class="btn btn-sm btn-secondary" id="edsa-cal-next" aria-label="Next"><i class="fas fa-chevron-right"></i></button>
                            <h2 class="edsa-cal-title" id="edsa-cal-title">${this.escapeHtml(title)}</h2>
                        </div>
                        <div class="edsa-cal-views" role="tablist" aria-label="Calendar view">
                            <button type="button" class="btn btn-sm ${view === 'day' ? 'btn-primary' : 'btn-secondary'}" data-edsa-view="day">Day</button>
                            <button type="button" class="btn btn-sm ${view === 'week' ? 'btn-primary' : 'btn-secondary'}" data-edsa-view="week">Week</button>
                            <button type="button" class="btn btn-sm ${view === 'month' ? 'btn-primary' : 'btn-secondary'}" data-edsa-view="month">Month</button>
                        </div>
                        <button type="button" class="btn btn-sm ${this._edsaBlockMode ? 'btn-primary' : 'btn-secondary'}" id="edsa-cal-block-mode">
                            ${this._edsaBlockMode ? 'Block mode on' : 'Block dates'}
                        </button>
                    </div>
                    <div class="edsa-cal-legend">
                        <span><i class="edsa-legend-dot edsa-ev-confirmed"></i> Confirmed</span>
                        <span><i class="edsa-legend-dot edsa-ev-pending"></i> Pending</span>
                        <span><i class="edsa-legend-dot edsa-ev-cancelled"></i> Cancelled</span>
                        <span><i class="edsa-legend-dot edsa-ev-request"></i> Customer request</span>
                        <span><i class="edsa-legend-dot edsa-ev-blocked"></i> Blocked day</span>
                    </div>
                    <div id="edsa-blocked-dates-panel" class="edsa-blocked-panel"></div>
                    <div id="edsa-cal-body" class="edsa-cal-body"></div>
                    <details class="edsa-cal-table-toggle">
                        <summary>All bookings (table)</summary>
                        <div id="edsa-cal-table-wrap"></div>
                    </details>
                </div>`;
        },

        renderEdsaCalendarBody() {
            const body = document.getElementById('edsa-cal-body');
            const titleEl = document.getElementById('edsa-cal-title');
            if (!body) return;
            this.initEdsaCalendarState();
            const bookings = this._edsaBookingsList || [];
            const view = this._edsaCalendarView;
            const cursor = this._edsaCalendarCursor;

            if (titleEl) {
                titleEl.textContent = periodTitle(cursor, view);
            }

            if (view === 'month') {
                body.innerHTML = this.renderEdsaMonthView(bookings, cursor);
            } else if (view === 'week') {
                body.innerHTML = this.renderEdsaWeekView(bookings, cursor);
            } else {
                body.innerHTML = this.renderEdsaDayView(bookings, cursor);
            }

            body.querySelectorAll('[data-edsa-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const id = Number(btn.getAttribute('data-edsa-id'));
                    if (Number.isFinite(id)) this.openEdsaBookingModal(id);
                });
            });

            const tableWrap = document.getElementById('edsa-cal-table-wrap');
            if (tableWrap) {
                tableWrap.innerHTML = this.renderEDSABookingsTable(bookings);
                this.bindEdsaBookingsTableActions(tableWrap);
            }

            document.querySelectorAll('[data-edsa-view]').forEach((btn) => {
                const v = btn.getAttribute('data-edsa-view');
                btn.className = `btn btn-sm ${v === view ? 'btn-primary' : 'btn-secondary'}`;
            });
        },

        renderEdsaMonthView(bookings, cursor) {
            const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
            const gridStart = startOfWeek(first);
            const today = new Date();
            let html = '<div class="edsa-month-grid">';
            html += WEEKDAYS.map((d) => `<div class="edsa-month-dow">${d}</div>`).join('');

            for (let i = 0; i < 42; i++) {
                const day = addDays(gridStart, i);
                const ymd = ymdFromDate(day);
                const inMonth = day.getMonth() === cursor.getMonth();
                const isToday = sameYmd(day, today);
                const dayBookings = bookingsForYmd(bookings, ymd);
                const isBlocked = this._edsaBlockedDates && this._edsaBlockedDates.has(ymd);
                const classes = [
                    'edsa-month-cell',
                    inMonth ? '' : 'edsa-month-other',
                    isToday ? 'edsa-month-today' : '',
                    isBlocked ? 'edsa-month-blocked' : '',
                ]
                    .filter(Boolean)
                    .join(' ');

                const events = dayBookings
                    .slice(0, 3)
                    .map((b) => renderEventChip(this, b, true))
                    .join('');
                const more =
                    dayBookings.length > 3
                        ? `<span class="edsa-month-more">+${dayBookings.length - 3} more</span>`
                        : '';

                html += `<div class="${classes}" data-edsa-day="${ymd}"${isBlocked ? ' title="Blocked from online booking"' : ''}>
                    <div class="edsa-month-num">${day.getDate()}${isBlocked ? ' <span class="edsa-blocked-mark">×</span>' : ''}</div>
                    <div class="edsa-month-events">${events}${more}</div>
                </div>`;
            }
            html += '</div>';
            return html;
        },

        renderEdsaWeekView(bookings, cursor) {
            const start = startOfWeek(cursor);
            const today = new Date();
            let html = '<div class="edsa-week-wrap"><div class="edsa-week-time-col"></div><div class="edsa-week-cols">';

            for (let d = 0; d < 7; d++) {
                const day = addDays(start, d);
                const ymd = ymdFromDate(day);
                const isToday = sameYmd(day, today);
                html += `<div class="edsa-week-col${isToday ? ' edsa-week-today' : ''}">
                    <div class="edsa-week-head">
                        <span class="edsa-week-dow">${WEEKDAYS[day.getDay()]}</span>
                        <span class="edsa-week-date">${day.getDate()}</span>
                    </div>
                    <div class="edsa-week-slots">`;

                for (let hour = STORE_OPEN_HOUR; hour < STORE_CLOSE_HOUR; hour++) {
                    const hm = `${pad2(hour)}:00`;
                    const slotBookings = bookingsForYmd(bookings, ymd).filter(
                        (b) => parseBookingTimeHm(b) === hm
                    );
                    html += `<div class="edsa-week-slot">
                        <span class="edsa-week-slot-time">${formatTimeDisplay(hm)}</span>
                        <div class="edsa-week-slot-events">`;
                    slotBookings.forEach((b) => {
                        html += renderEventChip(this, b, false);
                    });
                    html += `</div></div>`;
                }
                html += '</div></div>';
            }
            html += '</div></div>';
            return html;
        },

        renderEdsaDayView(bookings, cursor) {
            const ymd = ymdFromDate(cursor);
            const dayBookings = bookingsForYmd(bookings, ymd);
            const today = new Date();
            const isToday = sameYmd(cursor, today);

            let html = `<div class="edsa-day-view${isToday ? ' edsa-day-today' : ''}">`;
            if (dayBookings.length === 0) {
                html += '<p class="edsa-day-empty">No appointments scheduled for this day.</p>';
            } else {
                for (let hour = STORE_OPEN_HOUR; hour < STORE_CLOSE_HOUR; hour++) {
                    const hm = `${pad2(hour)}:00`;
                    const slotBookings = dayBookings.filter((b) => parseBookingTimeHm(b) === hm);
                    html += `<div class="edsa-day-row">
                        <div class="edsa-day-time">${formatTimeDisplay(hm)}</div>
                        <div class="edsa-day-events">`;
                    if (slotBookings.length === 0) {
                        html += '<span class="edsa-day-free">—</span>';
                    } else {
                        slotBookings.forEach((b) => {
                            html += renderEventChip(this, b, false);
                        });
                    }
                    html += '</div></div>';
                }
            }
            html += '</div>';
            return html;
        },

        bindEdsaCalendarControls() {
            const root = document.getElementById('edsa-cal-root');
            if (!root || root.dataset.bound === '1') return;
            root.dataset.bound = '1';

            document.getElementById('edsa-cal-today')?.addEventListener('click', () => {
                this._edsaCalendarCursor = new Date();
                this.refreshEdsaCalendar();
            });

            document.getElementById('edsa-cal-prev')?.addEventListener('click', () => {
                this.stepEdsaCalendar(-1);
            });

            document.getElementById('edsa-cal-next')?.addEventListener('click', () => {
                this.stepEdsaCalendar(1);
            });

            root.querySelectorAll('[data-edsa-view]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this._edsaCalendarView = btn.getAttribute('data-edsa-view') || 'month';
                    this.refreshEdsaCalendar();
                });
            });

            root.querySelector('#edsa-cal-body')?.addEventListener('click', (e) => {
                const cell = e.target.closest('[data-edsa-day]');
                if (!cell || e.target.closest('[data-edsa-id]')) return;
                const ymd = cell.getAttribute('data-edsa-day');
                if (!ymd) return;

                if (this._edsaBlockMode) {
                    void this.toggleEdsaBlockedDate(ymd);
                    return;
                }

                const [y, m, d] = ymd.split('-').map(Number);
                this._edsaCalendarCursor = new Date(y, m - 1, d);
                this._edsaCalendarView = 'day';
                this.renderEdsaCalendarBody();
                this.bindEdsaCalendarViewButtons();
            });

            document.getElementById('edsa-cal-block-mode')?.addEventListener('click', () => {
                this._edsaBlockMode = !this._edsaBlockMode;
                const btn = document.getElementById('edsa-cal-block-mode');
                if (btn) {
                    btn.textContent = this._edsaBlockMode ? 'Block mode on' : 'Block dates';
                    btn.className = `btn btn-sm ${this._edsaBlockMode ? 'btn-primary' : 'btn-secondary'}`;
                }
                this.renderEdsaBlockedDatesPanel();
            });
        },

        bindEdsaCalendarViewButtons() {
            document.querySelectorAll('[data-edsa-view]').forEach((btn) => {
                const v = btn.getAttribute('data-edsa-view');
                btn.className = `btn btn-sm ${v === this._edsaCalendarView ? 'btn-primary' : 'btn-secondary'}`;
            });
        },

        stepEdsaCalendar(direction) {
            const c = this._edsaCalendarCursor;
            if (this._edsaCalendarView === 'month') {
                this._edsaCalendarCursor = addMonths(c, direction);
            } else if (this._edsaCalendarView === 'week') {
                this._edsaCalendarCursor = addDays(c, direction * 7);
            } else {
                this._edsaCalendarCursor = addDays(c, direction);
            }
            this.refreshEdsaCalendar();
        },

        async refreshEdsaCalendar() {
            const container = document.getElementById('edsaBookingsTable');
            if (!container) return;
            const range = this.getEdsaCalendarRange();
            try {
                const [bookingsRes, blockedRes] = await Promise.all([
                    this.apiRequest(
                        `/admin/edsa/bookings?limit=500&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
                    ),
                    this.apiRequest(
                        `/admin/edsa/blocked-dates?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
                    )
                ]);
                if (bookingsRes?.bookings) {
                    this._edsaBookingsById = new Map(bookingsRes.bookings.map((b) => [Number(b.id), b]));
                    this._edsaBookingsList = bookingsRes.bookings;
                }
                const blocked = blockedRes?.blockedDates || [];
                this._edsaBlockedDates = new Set(blocked.map((b) => String(b.date || b.block_date || '').slice(0, 10)));
                this._edsaBlockedDatesList = blocked;
            } catch (e) {
                console.warn('EDSA calendar refresh:', e);
            }
            this.renderEdsaCalendarBody();
            this.renderEdsaBlockedDatesPanel();
            this.bindEdsaCalendarViewButtons();
        },

        renderEdsaBlockedDatesPanel() {
            const panel = document.getElementById('edsa-blocked-dates-panel');
            if (!panel) return;
            const blocked = this._edsaBlockedDatesList || [];
            if (!blocked.length) {
                panel.innerHTML = this._edsaBlockMode
                    ? '<p class="edsa-blocked-hint">Block mode is on — click a day on the calendar to block or unblock it from online booking.</p>'
                    : '';
                return;
            }
            const chips = blocked
                .map((b) => {
                    const date = String(b.date || b.block_date || '').slice(0, 10);
                    return `<button type="button" class="btn btn-sm btn-secondary edsa-blocked-chip" data-unblock-date="${this.escapeHtml(date)}">${this.escapeHtml(date)} ×</button>`;
                })
                .join('');
            panel.innerHTML = `<div class="edsa-blocked-wrap"><span class="edsa-blocked-label">Blocked dates:</span> ${chips}</div>`;
            panel.querySelectorAll('[data-unblock-date]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    void this.toggleEdsaBlockedDate(btn.getAttribute('data-unblock-date'), true);
                });
            });
        },

        async toggleEdsaBlockedDate(ymd, forceUnblock = false) {
            const date = String(ymd || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
            const isBlocked = this._edsaBlockedDates && this._edsaBlockedDates.has(date);
            try {
                if (isBlocked || forceUnblock) {
                    await this.apiRequest(`/admin/edsa/blocked-dates/${encodeURIComponent(date)}`, {
                        method: 'DELETE'
                    });
                    this.showToast(`${date} unblocked`, 'success');
                } else {
                    await this.apiRequest('/admin/edsa/blocked-dates', {
                        method: 'POST',
                        body: JSON.stringify({ date })
                    });
                    this.showToast(`${date} blocked from online booking`, 'success');
                }
            } catch (e) {
                this.showToast(e.message || 'Could not update blocked date', 'error');
                return;
            }
            await this.refreshEdsaCalendar();
        },
    };

    if (typeof AdminApp !== 'undefined') {
        Object.assign(AdminApp.prototype, calendarMixin);
    }
})();
