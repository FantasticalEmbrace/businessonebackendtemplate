/**
 * Scheduling admin calendar (day / week / month) — extends AdminApp.
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
        if (s === 'cancelled') return 'scheduling-ev-cancelled';
        if (s === 'completed') return 'scheduling-ev-completed';
        if (s === 'pending') return 'scheduling-ev-pending';
        return 'scheduling-ev-confirmed';
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
        return `<button type="button" class="scheduling-cal-event ${statusClass(booking.status)}${req ? ' scheduling-ev-request' : ''}" data-scheduling-id="${booking.id}" title="${app.escapeHtml(name)} · ${app.escapeHtml(booking.email || '')}">${app.escapeHtml(label)}</button>`;
    }

    const calendarMixin = {
        initSchedulingCalendarState() {
            if (!this._schedulingCalendarView) this._schedulingCalendarView = 'month';
            if (!this._schedulingCalendarCursor) this._schedulingCalendarCursor = new Date();
            if (!this._schedulingBookingsList) this._schedulingBookingsList = [];
            if (!this._schedulingBlockedDates) this._schedulingBlockedDates = new Set();
            if (this._schedulingBlockMode == null) this._schedulingBlockMode = false;
        },

        getSchedulingCalendarRange() {
            this.initSchedulingCalendarState();
            return calendarRange(this._schedulingCalendarCursor, this._schedulingCalendarView);
        },

        renderSchedulingCalendarShell() {
            this.initSchedulingCalendarState();
            const title = periodTitle(this._schedulingCalendarCursor, this._schedulingCalendarView);
            const view = this._schedulingCalendarView;
            return `
                <div class="scheduling-cal" id="scheduling-cal-root">
                    <div class="scheduling-cal-toolbar">
                        <div class="scheduling-cal-nav">
                            <button type="button" class="btn btn-sm btn-secondary" id="scheduling-cal-today">Today</button>
                            <button type="button" class="btn btn-sm btn-secondary" id="scheduling-cal-prev" aria-label="Previous"><i class="fas fa-chevron-left"></i></button>
                            <button type="button" class="btn btn-sm btn-secondary" id="scheduling-cal-next" aria-label="Next"><i class="fas fa-chevron-right"></i></button>
                            <h2 class="scheduling-cal-title" id="scheduling-cal-title">${this.escapeHtml(title)}</h2>
                        </div>
                        <div class="scheduling-cal-views" role="tablist" aria-label="Calendar view">
                            <button type="button" class="btn btn-sm ${view === 'day' ? 'btn-primary' : 'btn-secondary'}" data-scheduling-view="day">Day</button>
                            <button type="button" class="btn btn-sm ${view === 'week' ? 'btn-primary' : 'btn-secondary'}" data-scheduling-view="week">Week</button>
                            <button type="button" class="btn btn-sm ${view === 'month' ? 'btn-primary' : 'btn-secondary'}" data-scheduling-view="month">Month</button>
                        </div>
                        <button type="button" class="btn btn-sm ${this._schedulingBlockMode ? 'btn-primary' : 'btn-secondary'}" id="scheduling-cal-block-mode">
                            ${this._schedulingBlockMode ? 'Block mode on' : 'Block dates'}
                        </button>
                    </div>
                    <div class="scheduling-cal-legend">
                        <span><i class="scheduling-legend-dot scheduling-ev-confirmed"></i> Confirmed</span>
                        <span><i class="scheduling-legend-dot scheduling-ev-pending"></i> Pending</span>
                        <span><i class="scheduling-legend-dot scheduling-ev-cancelled"></i> Cancelled</span>
                        <span><i class="scheduling-legend-dot scheduling-ev-request"></i> Customer request</span>
                        <span><i class="scheduling-legend-dot scheduling-ev-blocked"></i> Blocked day</span>
                    </div>
                    <div id="scheduling-blocked-dates-panel" class="scheduling-blocked-panel"></div>
                    <div id="scheduling-cal-body" class="scheduling-cal-body"></div>
                    <details class="scheduling-cal-table-toggle">
                        <summary>All bookings (table)</summary>
                        <div id="scheduling-cal-table-wrap"></div>
                    </details>
                </div>`;
        },

        renderSchedulingCalendarBody() {
            const body = document.getElementById('scheduling-cal-body');
            const titleEl = document.getElementById('scheduling-cal-title');
            if (!body) return;
            this.initSchedulingCalendarState();
            const bookings = this._schedulingBookingsList || [];
            const view = this._schedulingCalendarView;
            const cursor = this._schedulingCalendarCursor;

            if (titleEl) {
                titleEl.textContent = periodTitle(cursor, view);
            }

            if (view === 'month') {
                body.innerHTML = this.renderSchedulingMonthView(bookings, cursor);
            } else if (view === 'week') {
                body.innerHTML = this.renderSchedulingWeekView(bookings, cursor);
            } else {
                body.innerHTML = this.renderSchedulingDayView(bookings, cursor);
            }

            body.querySelectorAll('[data-scheduling-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const id = Number(btn.getAttribute('data-scheduling-id'));
                    if (Number.isFinite(id)) this.openSchedulingBookingModal(id);
                });
            });

            const tableWrap = document.getElementById('scheduling-cal-table-wrap');
            if (tableWrap) {
                tableWrap.innerHTML = this.renderSchedulingBookingsTable(bookings);
                this.bindSchedulingBookingsTableActions(tableWrap);
            }

            document.querySelectorAll('[data-scheduling-view]').forEach((btn) => {
                const v = btn.getAttribute('data-scheduling-view');
                btn.className = `btn btn-sm ${v === view ? 'btn-primary' : 'btn-secondary'}`;
            });
        },

        renderSchedulingMonthView(bookings, cursor) {
            const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
            const gridStart = startOfWeek(first);
            const today = new Date();
            let html = '<div class="scheduling-month-grid">';
            html += WEEKDAYS.map((d) => `<div class="scheduling-month-dow">${d}</div>`).join('');

            for (let i = 0; i < 42; i++) {
                const day = addDays(gridStart, i);
                const ymd = ymdFromDate(day);
                const inMonth = day.getMonth() === cursor.getMonth();
                const isToday = sameYmd(day, today);
                const dayBookings = bookingsForYmd(bookings, ymd);
                const isBlocked = this._schedulingBlockedDates && this._schedulingBlockedDates.has(ymd);
                const classes = [
                    'scheduling-month-cell',
                    inMonth ? '' : 'scheduling-month-other',
                    isToday ? 'scheduling-month-today' : '',
                    isBlocked ? 'scheduling-month-blocked' : '',
                ]
                    .filter(Boolean)
                    .join(' ');

                const events = dayBookings
                    .slice(0, 3)
                    .map((b) => renderEventChip(this, b, true))
                    .join('');
                const more =
                    dayBookings.length > 3
                        ? `<span class="scheduling-month-more">+${dayBookings.length - 3} more</span>`
                        : '';

                html += `<div class="${classes}" data-scheduling-day="${ymd}"${isBlocked ? ' title="Blocked from online booking"' : ''}>
                    <div class="scheduling-month-num">${day.getDate()}${isBlocked ? ' <span class="scheduling-blocked-mark">×</span>' : ''}</div>
                    <div class="scheduling-month-events">${events}${more}</div>
                </div>`;
            }
            html += '</div>';
            return html;
        },

        renderSchedulingWeekView(bookings, cursor) {
            const start = startOfWeek(cursor);
            const today = new Date();
            let html = '<div class="scheduling-week-wrap"><div class="scheduling-week-time-col"></div><div class="scheduling-week-cols">';

            for (let d = 0; d < 7; d++) {
                const day = addDays(start, d);
                const ymd = ymdFromDate(day);
                const isToday = sameYmd(day, today);
                html += `<div class="scheduling-week-col${isToday ? ' scheduling-week-today' : ''}">
                    <div class="scheduling-week-head">
                        <span class="scheduling-week-dow">${WEEKDAYS[day.getDay()]}</span>
                        <span class="scheduling-week-date">${day.getDate()}</span>
                    </div>
                    <div class="scheduling-week-slots">`;

                for (let hour = STORE_OPEN_HOUR; hour < STORE_CLOSE_HOUR; hour++) {
                    const hm = `${pad2(hour)}:00`;
                    const slotBookings = bookingsForYmd(bookings, ymd).filter(
                        (b) => parseBookingTimeHm(b) === hm
                    );
                    html += `<div class="scheduling-week-slot">
                        <span class="scheduling-week-slot-time">${formatTimeDisplay(hm)}</span>
                        <div class="scheduling-week-slot-events">`;
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

        renderSchedulingDayView(bookings, cursor) {
            const ymd = ymdFromDate(cursor);
            const dayBookings = bookingsForYmd(bookings, ymd);
            const today = new Date();
            const isToday = sameYmd(cursor, today);

            let html = `<div class="scheduling-day-view${isToday ? ' scheduling-day-today' : ''}">`;
            if (dayBookings.length === 0) {
                html += '<p class="scheduling-day-empty">No appointments scheduled for this day.</p>';
            } else {
                for (let hour = STORE_OPEN_HOUR; hour < STORE_CLOSE_HOUR; hour++) {
                    const hm = `${pad2(hour)}:00`;
                    const slotBookings = dayBookings.filter((b) => parseBookingTimeHm(b) === hm);
                    html += `<div class="scheduling-day-row">
                        <div class="scheduling-day-time">${formatTimeDisplay(hm)}</div>
                        <div class="scheduling-day-events">`;
                    if (slotBookings.length === 0) {
                        html += '<span class="scheduling-day-free">—</span>';
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

        bindSchedulingCalendarControls() {
            const root = document.getElementById('scheduling-cal-root');
            if (!root || root.dataset.bound === '1') return;
            root.dataset.bound = '1';

            document.getElementById('scheduling-cal-today')?.addEventListener('click', () => {
                this._schedulingCalendarCursor = new Date();
                this.refreshSchedulingCalendar();
            });

            document.getElementById('scheduling-cal-prev')?.addEventListener('click', () => {
                this.stepSchedulingCalendar(-1);
            });

            document.getElementById('scheduling-cal-next')?.addEventListener('click', () => {
                this.stepSchedulingCalendar(1);
            });

            root.querySelectorAll('[data-scheduling-view]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this._schedulingCalendarView = btn.getAttribute('data-scheduling-view') || 'month';
                    this.refreshSchedulingCalendar();
                });
            });

            root.querySelector('#scheduling-cal-body')?.addEventListener('click', (e) => {
                const cell = e.target.closest('[data-scheduling-day]');
                if (!cell || e.target.closest('[data-scheduling-id]')) return;
                const ymd = cell.getAttribute('data-scheduling-day');
                if (!ymd) return;

                if (this._schedulingBlockMode) {
                    void this.toggleSchedulingBlockedDate(ymd);
                    return;
                }

                const [y, m, d] = ymd.split('-').map(Number);
                this._schedulingCalendarCursor = new Date(y, m - 1, d);
                this._schedulingCalendarView = 'day';
                this.renderSchedulingCalendarBody();
                this.bindSchedulingCalendarViewButtons();
            });

            document.getElementById('scheduling-cal-block-mode')?.addEventListener('click', () => {
                this._schedulingBlockMode = !this._schedulingBlockMode;
                const btn = document.getElementById('scheduling-cal-block-mode');
                if (btn) {
                    btn.textContent = this._schedulingBlockMode ? 'Block mode on' : 'Block dates';
                    btn.className = `btn btn-sm ${this._schedulingBlockMode ? 'btn-primary' : 'btn-secondary'}`;
                }
                this.renderSchedulingBlockedDatesPanel();
            });
        },

        bindSchedulingCalendarViewButtons() {
            document.querySelectorAll('[data-scheduling-view]').forEach((btn) => {
                const v = btn.getAttribute('data-scheduling-view');
                btn.className = `btn btn-sm ${v === this._schedulingCalendarView ? 'btn-primary' : 'btn-secondary'}`;
            });
        },

        stepSchedulingCalendar(direction) {
            const c = this._schedulingCalendarCursor;
            if (this._schedulingCalendarView === 'month') {
                this._schedulingCalendarCursor = addMonths(c, direction);
            } else if (this._schedulingCalendarView === 'week') {
                this._schedulingCalendarCursor = addDays(c, direction * 7);
            } else {
                this._schedulingCalendarCursor = addDays(c, direction);
            }
            this.refreshSchedulingCalendar();
        },

        async refreshSchedulingCalendar() {
            const container = document.getElementById('schedulingBookingsTable');
            if (!container) return;
            const range = this.getSchedulingCalendarRange();
            try {
                const [bookingsRes, blockedRes] = await Promise.all([
                    this.apiRequest(
                        `/admin/scheduling/bookings?limit=500&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
                    ),
                    this.apiRequest(
                        `/admin/scheduling/blocked-dates?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
                    )
                ]);
                if (bookingsRes?.bookings) {
                    this._schedulingBookingsById = new Map(bookingsRes.bookings.map((b) => [Number(b.id), b]));
                    this._schedulingBookingsList = bookingsRes.bookings;
                }
                const blocked = blockedRes?.blockedDates || [];
                this._schedulingBlockedDates = new Set(blocked.map((b) => String(b.date || b.block_date || '').slice(0, 10)));
                this._schedulingBlockedDatesList = blocked;
            } catch (e) {
                console.warn('Scheduling calendar refresh:', e);
            }
            this.renderSchedulingCalendarBody();
            this.renderSchedulingBlockedDatesPanel();
            this.bindSchedulingCalendarViewButtons();
        },

        renderSchedulingBlockedDatesPanel() {
            const panel = document.getElementById('scheduling-blocked-dates-panel');
            if (!panel) return;
            const blocked = this._schedulingBlockedDatesList || [];
            if (!blocked.length) {
                panel.innerHTML = this._schedulingBlockMode
                    ? '<p class="scheduling-blocked-hint">Block mode is on — click a day on the calendar to block or unblock it from online booking.</p>'
                    : '';
                return;
            }
            const chips = blocked
                .map((b) => {
                    const date = String(b.date || b.block_date || '').slice(0, 10);
                    return `<button type="button" class="btn btn-sm btn-secondary scheduling-blocked-chip" data-unblock-date="${this.escapeHtml(date)}">${this.escapeHtml(date)} ×</button>`;
                })
                .join('');
            panel.innerHTML = `<div class="scheduling-blocked-wrap"><span class="scheduling-blocked-label">Blocked dates:</span> ${chips}</div>`;
            panel.querySelectorAll('[data-unblock-date]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    void this.toggleSchedulingBlockedDate(btn.getAttribute('data-unblock-date'), true);
                });
            });
        },

        async toggleSchedulingBlockedDate(ymd, forceUnblock = false) {
            const date = String(ymd || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
            const isBlocked = this._schedulingBlockedDates && this._schedulingBlockedDates.has(date);
            try {
                if (isBlocked || forceUnblock) {
                    await this.apiRequest(`/admin/scheduling/blocked-dates/${encodeURIComponent(date)}`, {
                        method: 'DELETE'
                    });
                    this.showToast(`${date} unblocked`, 'success');
                } else {
                    await this.apiRequest('/admin/scheduling/blocked-dates', {
                        method: 'POST',
                        body: JSON.stringify({ date })
                    });
                    this.showToast(`${date} blocked from online booking`, 'success');
                }
            } catch (e) {
                this.showToast(e.message || 'Could not update blocked date', 'error');
                return;
            }
            await this.refreshSchedulingCalendar();
        },
    };

    if (typeof AdminApp !== 'undefined') {
        Object.assign(AdminApp.prototype, calendarMixin);
    }
})();
