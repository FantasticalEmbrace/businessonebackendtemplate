/**
 * Shop appointment calendar — same day/week/month grid as ecommerce admin Scheduling calendar.
 * POS uses viewOnly=true (no book / edit / block). Maps shop appointments into calendar chips.
 */
(function (global) {
    'use strict';

    const STORE_OPEN_HOUR = 8;
    const STORE_CLOSE_HOUR = 18;
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function ymdFromDate(d) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parseApptYmd(a) {
        const raw = a.preferred_date || a.date || a.startsAt || a.startAt || '';
        if (!raw) return '';
        if (typeof raw === 'string') return raw.slice(0, 10);
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return '';
        return ymdFromDate(d);
    }

    function parseApptHm(a) {
        const t =
            a.preferred_time ||
            a.startTime ||
            String(a.startsAt || a.startAt || a.start || '').slice(11, 16) ||
            '09:00';
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
        if (s === 'cancelled' || s === 'canceled' || s === 'no_show') return 'scheduling-ev-cancelled';
        if (s === 'completed' || s === 'done') return 'scheduling-ev-completed';
        if (s === 'pending') return 'scheduling-ev-pending';
        return 'scheduling-ev-confirmed';
    }

    function displayName(a) {
        if (a.first_name || a.last_name) {
            return `${a.first_name || ''} ${a.last_name || ''}`.trim() || 'Guest';
        }
        return String(a.customerName || a.customer_name || 'Customer').trim() || 'Customer';
    }

    /** Normalize shop appointment → calendar booking shape (Scheduling-compatible). */
    function toBookingShape(a) {
        const name = displayName(a);
        const parts = name.split(/\s+/);
        const bay = String(a.bay || '').trim();
        const vehicle = String(a.vehicle || '').trim();
        return {
            id: a.id,
            preferred_date: parseApptYmd(a),
            preferred_time: parseApptHm(a),
            first_name: parts[0] || name,
            last_name: parts.slice(1).join(' '),
            status: a.status || 'scheduled',
            email: a.email || '',
            vehicle,
            bay,
            jobType: a.jobType || a.job_type || '',
            customer_request_type: 'none',
            _raw: a
        };
    }

    function bookingsForYmd(bookings, ymd) {
        return bookings
            .filter((b) => parseApptYmd(b) === ymd)
            .sort((a, b) => parseApptHm(a).localeCompare(parseApptHm(b)));
    }

    function periodTitle(cursor, view) {
        if (view === 'day') {
            return cursor.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
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

    function renderEventChip(booking, compact, viewOnly) {
        const name = displayName(booking);
        const time = formatTimeDisplay(parseApptHm(booking));
        const bay = String(booking.bay || '').trim();
        const vehicle = String(booking.vehicle || '').trim();
        const label = compact
            ? `${time} ${name.split(' ')[0]}${bay ? ` · ${bay}` : ''}`
            : `${time} — ${name}${vehicle ? ` · ${vehicle}` : ''}${bay ? ` · ${bay}` : ''}`;
        const tag = viewOnly ? 'span' : 'button';
        const typeAttr = viewOnly ? '' : ' type="button"';
        return `<${tag}${typeAttr} class="scheduling-cal-event ${statusClass(booking.status)}${
            viewOnly ? ' is-readonly' : ''
        }" data-shop-cal-id="${esc(String(booking.id))}" title="${esc(label)}">${esc(label)}</${tag}>`;
    }

    function ShopCalendarWidget(opts) {
        this.rootId = opts.rootId || 'shop-cal-root';
        this.mountEl = opts.mountEl || null;
        this.viewOnly = opts.viewOnly !== false;
        this.onSelectDay = opts.onSelectDay || null;
        this.onEventClick = opts.onEventClick || null;
        this.onRangeChange = opts.onRangeChange || null;
        this._view = opts.view || 'month';
        this._cursor = opts.cursor ? new Date(opts.cursor) : new Date();
        this._bookings = [];
        this._bound = false;
    }

    ShopCalendarWidget.prototype.setAppointments = function (list) {
        this._bookings = (list || []).map(toBookingShape);
        this.renderBody();
    };

    ShopCalendarWidget.prototype.getRange = function () {
        const cursor = this._cursor;
        const view = this._view;
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
    };

    ShopCalendarWidget.prototype.renderShell = function () {
        const title = periodTitle(this._cursor, this._view);
        const view = this._view;
        const viewOnly = this.viewOnly;
        return `
            <div class="scheduling-cal shop-cal b1-shop-cal" id="${esc(this.rootId)}" data-shop-cal-view-only="${
            viewOnly ? '1' : '0'
        }">
                <div class="scheduling-cal-toolbar">
                    <div class="scheduling-cal-nav">
                        <button type="button" class="btn btn-sm btn-secondary" data-shop-cal-today>Today</button>
                        <button type="button" class="btn btn-sm btn-secondary" data-shop-cal-prev aria-label="Previous">‹</button>
                        <button type="button" class="btn btn-sm btn-secondary" data-shop-cal-next aria-label="Next">›</button>
                        <h2 class="scheduling-cal-title" data-shop-cal-title>${esc(title)}</h2>
                    </div>
                    <div class="scheduling-cal-views" role="tablist" aria-label="Calendar view">
                        <button type="button" class="btn btn-sm ${
                            view === 'day' ? 'btn-primary' : 'btn-secondary'
                        }" data-shop-cal-view="day">Day</button>
                        <button type="button" class="btn btn-sm ${
                            view === 'week' ? 'btn-primary' : 'btn-secondary'
                        }" data-shop-cal-view="week">Week</button>
                        <button type="button" class="btn btn-sm ${
                            view === 'month' ? 'btn-primary' : 'btn-secondary'
                        }" data-shop-cal-view="month">Month</button>
                    </div>
                </div>
                <div class="scheduling-cal-legend">
                    <span><i class="scheduling-legend-dot scheduling-ev-confirmed"></i> Scheduled</span>
                    <span><i class="scheduling-legend-dot scheduling-ev-pending"></i> Pending</span>
                    <span><i class="scheduling-legend-dot scheduling-ev-completed"></i> Completed</span>
                    <span><i class="scheduling-legend-dot scheduling-ev-cancelled"></i> Cancelled</span>
                </div>
                <div class="scheduling-cal-body" data-shop-cal-body></div>
            </div>`;
    };

    ShopCalendarWidget.prototype.mount = function (el) {
        const mount = el || this.mountEl;
        if (!mount) return;
        this.mountEl = mount;
        mount.innerHTML = this.renderShell();
        this._bound = false;
        this.bindControls();
        this.renderBody();
    };

    ShopCalendarWidget.prototype.renderMonth = function (bookings, cursor) {
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
            const classes = [
                'scheduling-month-cell',
                inMonth ? '' : 'scheduling-month-other',
                isToday ? 'scheduling-month-today' : ''
            ]
                .filter(Boolean)
                .join(' ');
            const events = dayBookings
                .slice(0, 3)
                .map((b) => renderEventChip(b, true, this.viewOnly))
                .join('');
            const more =
                dayBookings.length > 3
                    ? `<span class="scheduling-month-more">+${dayBookings.length - 3} more</span>`
                    : '';
            html += `<div class="${classes}" data-shop-cal-day="${ymd}">
                <div class="scheduling-month-num">${day.getDate()}</div>
                <div class="scheduling-month-events">${events}${more}</div>
            </div>`;
        }
        html += '</div>';
        return html;
    };

    ShopCalendarWidget.prototype.renderWeek = function (bookings, cursor) {
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
                const slotBookings = bookingsForYmd(bookings, ymd).filter((b) => parseApptHm(b) === hm);
                html += `<div class="scheduling-week-slot">
                    <span class="scheduling-week-slot-time">${formatTimeDisplay(hm)}</span>
                    <div class="scheduling-week-slot-events">`;
                slotBookings.forEach((b) => {
                    html += renderEventChip(b, false, this.viewOnly);
                });
                html += `</div></div>`;
            }
            html += '</div></div>';
        }
        html += '</div></div>';
        return html;
    };

    ShopCalendarWidget.prototype.renderDay = function (bookings, cursor) {
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
                const slotBookings = dayBookings.filter((b) => parseApptHm(b) === hm);
                html += `<div class="scheduling-day-row">
                    <div class="scheduling-day-time">${formatTimeDisplay(hm)}</div>
                    <div class="scheduling-day-events">`;
                if (slotBookings.length === 0) {
                    html += '<span class="scheduling-day-free">—</span>';
                } else {
                    slotBookings.forEach((b) => {
                        html += renderEventChip(b, false, this.viewOnly);
                    });
                }
                html += '</div></div>';
            }
        }
        html += '</div>';
        return html;
    };

    ShopCalendarWidget.prototype.renderBody = function () {
        const root = this.mountEl?.querySelector(`#${this.rootId}`) || document.getElementById(this.rootId);
        if (!root) return;
        const body = root.querySelector('[data-shop-cal-body]');
        const titleEl = root.querySelector('[data-shop-cal-title]');
        if (titleEl) titleEl.textContent = periodTitle(this._cursor, this._view);
        if (!body) return;
        const bookings = this._bookings;
        if (this._view === 'month') body.innerHTML = this.renderMonth(bookings, this._cursor);
        else if (this._view === 'week') body.innerHTML = this.renderWeek(bookings, this._cursor);
        else body.innerHTML = this.renderDay(bookings, this._cursor);

        root.querySelectorAll('[data-shop-cal-view]').forEach((btn) => {
            const v = btn.getAttribute('data-shop-cal-view');
            btn.className = `btn btn-sm ${v === this._view ? 'btn-primary' : 'btn-secondary'}`;
        });

        if (!this.viewOnly && this.onEventClick) {
            body.querySelectorAll('[data-shop-cal-id]').forEach((el) => {
                el.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const id = el.getAttribute('data-shop-cal-id');
                    const hit = this._bookings.find((b) => String(b.id) === String(id));
                    if (hit) this.onEventClick(hit._raw || hit);
                });
            });
        }
    };

    ShopCalendarWidget.prototype.bindControls = function () {
        const root = this.mountEl?.querySelector(`#${this.rootId}`) || document.getElementById(this.rootId);
        if (!root || root.dataset.shopCalBound === '1') return;
        root.dataset.shopCalBound = '1';
        this._bound = true;

        root.querySelector('[data-shop-cal-today]')?.addEventListener('click', () => {
            this._cursor = new Date();
            this.renderBody();
            this._notifyDay();
        });
        root.querySelector('[data-shop-cal-prev]')?.addEventListener('click', () => {
            this.step(-1);
        });
        root.querySelector('[data-shop-cal-next]')?.addEventListener('click', () => {
            this.step(1);
        });
        root.querySelectorAll('[data-shop-cal-view]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._view = btn.getAttribute('data-shop-cal-view') || 'month';
                this.renderBody();
                this._notifyDay();
            });
        });
        root.querySelector('[data-shop-cal-body]')?.addEventListener('click', (e) => {
            const cell = e.target.closest('[data-shop-cal-day]');
            if (!cell || e.target.closest('[data-shop-cal-id]')) return;
            const ymd = cell.getAttribute('data-shop-cal-day');
            if (!ymd) return;
            const [y, m, d] = ymd.split('-').map(Number);
            this._cursor = new Date(y, m - 1, d);
            this._view = 'day';
            this.renderBody();
            this._notifyDay();
        });
    };

    ShopCalendarWidget.prototype.step = function (direction) {
        const c = this._cursor;
        if (this._view === 'month') this._cursor = addMonths(c, direction);
        else if (this._view === 'week') this._cursor = addDays(c, direction * 7);
        else this._cursor = addDays(c, direction);
        this.renderBody();
        this._notifyDay();
    };

    ShopCalendarWidget.prototype._notifyDay = function () {
        if (typeof this.onSelectDay === 'function') {
            this.onSelectDay(ymdFromDate(this._cursor));
        }
        if (typeof this.onRangeChange === 'function') {
            this.onRangeChange(this.getRange());
        }
    };

    ShopCalendarWidget.prototype.setCursorYmd = function (ymd) {
        const [y, m, d] = String(ymd || '').split('-').map(Number);
        if (!y || !m || !d) return;
        this._cursor = new Date(y, m - 1, d);
        this.renderBody();
    };

    global.ShopCalendarWidget = ShopCalendarWidget;
    global.ShopCalendarHelpers = {
        toBookingShape,
        ymdFromDate,
        parseApptYmd,
        parseApptHm,
        formatTimeDisplay,
        esc
    };
})(typeof window !== 'undefined' ? window : globalThis);
