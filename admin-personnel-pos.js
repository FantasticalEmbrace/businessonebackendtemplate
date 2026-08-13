/**
 * Admin Personnel — shifts, timesheets, reports
 */
(function () {
    'use strict';

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function fmtMoney(n) {
        return '$' + (Number(n) || 0).toFixed(2);
    }

    function fmtDt(d) {
        if (!d) return '—';
        try {
            return new Date(d).toLocaleString();
        } catch {
            return '—';
        }
    }

    async function api(path, opts) {
        return window.adminApp.apiRequest('/admin/personnel' + path, opts);
    }

    async function loadShiftEmployeeSelect() {
        const sel = document.getElementById('pos-shift-employee');
        if (!sel) return;
        try {
            const res = await api('/employees');
            const rows = res.employees || [];
            sel.innerHTML = rows
                .filter((e) => e.isActive)
                .map(
                    (e) =>
                        `<option value="${e.id}">${esc(e.employeeCode)} — ${esc(e.firstName)} ${esc(e.lastName)}</option>`
                )
                .join('');
        } catch {
            sel.innerHTML = '';
        }
    }

    async function loadTimesheets() {
        const mount = document.getElementById('pos-timesheets-list');
        if (!mount) return;
        const from = document.getElementById('pos-report-from')?.value;
        const to = document.getElementById('pos-report-to')?.value;
        mount.innerHTML = '<p class="form-help">Loading…</p>';
        try {
            const qs = new URLSearchParams();
            if (from) qs.set('from', from);
            if (to) qs.set('to', to + 'T23:59:59');
            const res = await api('/timesheets?' + qs.toString());
            const rows = res.entries || [];
            mount.innerHTML = rows.length
                ? `<table class="table"><thead><tr><th>Employee</th><th>Clock in</th><th>Clock out</th><th>Source</th></tr></thead><tbody>${rows
                      .map(
                          (t) => `<tr>
                        <td>${esc(t.employee_code)} — ${esc(t.first_name)} ${esc(t.last_name)}</td>
                        <td>${fmtDt(t.clock_in)}</td>
                        <td>${fmtDt(t.clock_out)}</td>
                        <td>${esc(t.source)}</td>
                    </tr>`
                      )
                      .join('')}</tbody></table>`
                : '<p style="color:var(--gray-500);">No entries in range.</p>';
        } catch (err) {
            mount.innerHTML = `<p style="color:var(--error);">${esc(err.message)}</p>`;
        }
    }

    async function loadShiftSessions() {
        const mount = document.getElementById('pos-shift-sessions-list');
        if (!mount) return;
        const from = document.getElementById('pos-report-from')?.value;
        const to = document.getElementById('pos-report-to')?.value;
        mount.innerHTML = '<p class="form-help">Loading…</p>';
        try {
            const qs = new URLSearchParams();
            if (from) qs.set('from', from);
            if (to) qs.set('to', to + 'T23:59:59');
            const res = await api('/shift-sessions?' + qs.toString());
            const rows = res.sessions || [];
            mount.innerHTML = rows.length
                ? `<table class="table"><thead><tr><th>Employee</th><th>Opened</th><th>Closed</th><th>Cash</th><th>Over/short</th><th></th></tr></thead><tbody>${rows
                      .map(
                          (s) => `<tr>
                        <td>${esc(s.employee_code)} — ${esc(s.first_name)} ${esc(s.last_name)}</td>
                        <td>${fmtDt(s.opened_at)}</td>
                        <td>${fmtDt(s.closed_at)}</td>
                        <td>${fmtMoney(s.cash_sales_total)}</td>
                        <td>${s.over_short_amount != null ? fmtMoney(s.over_short_amount) : '—'}</td>
                        <td><button type="button" class="btn btn-sm btn-secondary" data-shift-z-report="${s.id}">Print end-of-shift summary</button></td>
                    </tr>`
                      )
                      .join('')}</tbody></table>`
                : '<p style="color:var(--gray-500);">No shift sessions.</p>';
            mount.querySelectorAll('[data-shift-z-report]').forEach((btn) => {
                btn.addEventListener('click', () => printShiftReport(btn.getAttribute('data-shift-z-report')));
            });
        } catch (err) {
            mount.innerHTML = `<p style="color:var(--error);">${esc(err.message)}</p>`;
        }
    }

    async function printShiftReport(id) {
        try {
            const report = await api('/reports/shift/' + id);
            const s = report.shift;
            const isClosed = s.status !== 'open';
            const heading = isClosed ? 'End-of-shift summary' : 'Current shift summary';
            const statusLine = isClosed
                ? 'Shift closed — final totals'
                : 'Shift still open — totals may change';
            const w = window.open('', '_blank');
            if (!w) {
                window.adminApp?.showToast('Allow popups to print the sales summary.', 'error');
                return;
            }
            w.document.write(`<!DOCTYPE html><html><head><title>${heading}</title></head><body style="font-family:system-ui;padding:24px">
                <h1>${heading}</h1>
                <p><strong>${statusLine}</strong></p>
                <p><strong>${esc(s.first_name)} ${esc(s.last_name)}</strong> (${esc(s.employee_code)})</p>
                <p>Opened: ${fmtDt(s.opened_at)}<br>Closed: ${fmtDt(s.closed_at)}</p>
                <p>Opening cash: ${fmtMoney(s.opening_cash)}<br>Expected: ${fmtMoney(report.expectedCash)}<br>Closing: ${fmtMoney(s.closing_cash)}<br>Over/short: ${fmtMoney(s.over_short_amount)}</p>
                <p>Cash sales: ${fmtMoney(s.cash_sales_total)} | Card: ${fmtMoney(s.card_sales_total)} | Check: ${fmtMoney(s.check_sales_total)}</p>
                <h2>Sales</h2><ul>${(report.sales || []).map((o) => `<li>${esc(o.order_number)} — ${fmtMoney(o.total_amount)} (${esc(o.payment_method)})</li>`).join('')}</ul>
                <script>window.onload=function(){window.print();}</script></body></html>`);
            w.document.close();
        } catch (err) {
            window.adminApp.showToast(err.message || 'Report failed', 'error');
        }
    }

    async function loadDaySummary() {
        const mount = document.getElementById('pos-day-summary-output');
        const dateEl = document.getElementById('pos-day-summary-date');
        if (!mount) return;
        const date = dateEl?.value || new Date().toISOString().slice(0, 10);
        mount.innerHTML = '<p class="form-help">Loading…</p>';
        try {
            const res = await api('/reports/day?date=' + encodeURIComponent(date));
            const r = res.report || {};
            const t = r.totals || {};
            mount.innerHTML = `<div style="font-size:0.92rem;line-height:1.6">
                <p style="margin:0 0 0.5rem;"><strong>Daily sales summary — ${esc(r.date || date)}</strong></p>
                <p style="margin:0;">Paid orders: ${t.orderCount || 0} · Total sales: ${fmtMoney(t.totalSales)}</p>
                <p style="margin:0.35rem 0 0;color:var(--gray-600);">Cash ${fmtMoney(t.cashTotal)} · Card ${fmtMoney(t.cardTotal)} · Check ${fmtMoney(t.checkTotal)}</p>
                ${r.openShiftCount > 0 ? `<p style="margin:0.5rem 0 0;color:#b45309;">${r.openShiftCount} shift(s) still open</p>` : ''}
            </div>`;
        } catch (err) {
            mount.innerHTML = `<p style="color:var(--error);">${esc(err.message)}</p>`;
        }
    }

    async function sendTestDailySalesEmail() {
        const dateEl = document.getElementById('pos-day-summary-date');
        const date = dateEl?.value || undefined;
        try {
            const res = await api('/reports/send-daily-sales', {
                method: 'POST',
                body: JSON.stringify(date ? { date } : {}),
            });
            window.adminApp.showToast(`Daily sales email sent to ${res.to || 'recipient'}`, 'success');
        } catch (err) {
            window.adminApp.showToast(err.message || 'Email not sent', 'error');
        }
    }

    async function loadScheduledShifts() {
        const mount = document.getElementById('pos-scheduled-shifts-list');
        if (!mount) return;
        mount.innerHTML = '<p class="form-help">Loading…</p>';
        try {
            const res = await api('/shifts/scheduled');
            const rows = res.shifts || [];
            mount.innerHTML = rows.length
                ? `<table class="table"><thead><tr><th>Employee</th><th>Start</th><th>End</th><th>Notes</th></tr></thead><tbody>${rows
                      .map(
                          (s) => `<tr>
                        <td>${esc(s.employee_code)} — ${esc(s.first_name)} ${esc(s.last_name)}</td>
                        <td>${fmtDt(s.starts_at)}</td>
                        <td>${fmtDt(s.ends_at)}</td>
                        <td>${esc(s.notes || '')}</td>
                    </tr>`
                      )
                      .join('')}</tbody></table>`
                : '<p style="color:var(--gray-500);">No scheduled shifts.</p>';
        } catch (err) {
            mount.innerHTML = `<p style="color:var(--error);">${esc(err.message)}</p>`;
        }
    }

    let personnelTabsBound = false;

    function bindPersonnelTabs() {
        if (personnelTabsBound) return;
        personnelTabsBound = true;

        document.querySelectorAll('[data-personnel-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-personnel-tab');
                document.querySelectorAll('[data-personnel-tab]').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('[data-personnel-panel]').forEach((p) => {
                    p.style.display = p.getAttribute('data-personnel-panel') === tab ? '' : 'none';
                });
                if (tab === 'timesheets') loadTimesheets();
                if (tab === 'shifts') {
                    loadShiftEmployeeSelect();
                    loadScheduledShifts();
                    loadShiftSessions();
                }
            });
        });

        const shiftForm = document.getElementById('pos-schedule-shift-form');
        if (shiftForm && !shiftForm.dataset.bound) {
            shiftForm.dataset.bound = '1';
            shiftForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fd = new FormData(shiftForm);
                try {
                    await api('/shifts/scheduled', {
                        method: 'POST',
                        body: JSON.stringify({
                            employeeId: Number(fd.get('employeeId')),
                            startsAt: fd.get('startsAt'),
                            endsAt: fd.get('endsAt'),
                            notes: fd.get('notes'),
                        }),
                    });
                    window.adminApp.showToast('Shift scheduled', 'success');
                    loadScheduledShifts();
                } catch (err) {
                    window.adminApp.showToast(err.message || 'Failed', 'error');
                }
            });
        }

        document.getElementById('pos-reports-refresh')?.addEventListener('click', () => {
            loadTimesheets();
            loadShiftSessions();
        });
        document.getElementById('pos-shift-sessions-refresh')?.addEventListener('click', loadShiftSessions);
        document.getElementById('pos-timesheets-refresh')?.addEventListener('click', loadTimesheets);
        document.getElementById('pos-day-summary-btn')?.addEventListener('click', loadDaySummary);
        document.getElementById('pos-send-daily-sales-btn')?.addEventListener('click', sendTestDailySalesEmail);
    }

    window.AdminPersonnelPos = {
        init() {
            bindPersonnelTabs();
            const today = new Date();
            const weekAgo = new Date(Date.now() - 7 * 86400000);
            const fromEl = document.getElementById('pos-report-from');
            const toEl = document.getElementById('pos-report-to');
            const dayEl = document.getElementById('pos-day-summary-date');
            if (fromEl && !fromEl.value) fromEl.value = weekAgo.toISOString().slice(0, 10);
            if (toEl && !toEl.value) toEl.value = today.toISOString().slice(0, 10);
            if (dayEl && !dayEl.value) dayEl.value = today.toISOString().slice(0, 10);
        },
        loadTimesheets,
        loadShiftSessions,
        loadScheduledShifts,
        loadShiftEmployeeSelect,
    };
})();
