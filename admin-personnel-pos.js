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
    let reportsTabsBound = false;
    let bizReportCache = null;

    function money(n) {
        return fmtMoney(n);
    }

    function num(n) {
        return String(Number(n) || 0);
    }

    function fmtDay(d) {
        if (!d) return '—';
        try {
            return new Date(d).toLocaleDateString();
        } catch {
            return String(d).slice(0, 10);
        }
    }

    function setBizPreset(days) {
        const toEl = document.getElementById('biz-report-to');
        const fromEl = document.getElementById('biz-report-from');
        if (!toEl || !fromEl) return;
        const to = new Date();
        const from = new Date(Date.now() - (Math.max(1, days) - 1) * 86400000);
        toEl.value = to.toISOString().slice(0, 10);
        fromEl.value = from.toISOString().slice(0, 10);
    }

    function renderBizStat(title, value, hint) {
        return `<div class="stat-card">
            <div class="stat-header">
                <div class="stat-title">${esc(title)}</div>
            </div>
            <div class="stat-value">${esc(value)}</div>
            ${hint ? `<div class="stat-change">${esc(hint)}</div>` : ''}
        </div>`;
    }

    function selectedBizReportType() {
        return String(document.getElementById('biz-report-type')?.value || '').trim();
    }

    function setBizSectionVisible(id, visible) {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    }

    function renderBusinessReportView() {
        const status = document.getElementById('biz-report-status');
        const summary = document.getElementById('biz-report-summary');
        const empty = document.getElementById('biz-report-empty');
        const dailyMount = document.getElementById('biz-report-daily');
        const membersMount = document.getElementById('biz-report-members');
        const productsMount = document.getElementById('biz-report-products');
        if (!summary) return;

        const type = selectedBizReportType();
        const r = bizReportCache || {};
        const m = r.members || {};
        const rw = r.rewards || {};
        const o = r.orders || {};
        const g = r.giftCards || {};
        const c = r.catalog || {};
        const t = r.totals || {};
        const rangeLabel = r.range ? `${r.range.from} → ${r.range.to}` : '';

        if (status && bizReportCache) {
            status.textContent = rangeLabel
                ? `Showing ${rangeLabel}. Store totals: ${num(t.customers)} customers · ${money(t.outstandingCashCredit)} store credit outstanding · ${num(t.newsletterSubscribers)} newsletter.`
                : 'Report loaded.';
        }

        summary.innerHTML = '';
        if (dailyMount) dailyMount.innerHTML = '';
        if (membersMount) membersMount.innerHTML = '';
        if (productsMount) productsMount.innerHTML = '';
        setBizSectionVisible('biz-report-section-daily', false);
        setBizSectionVisible('biz-report-section-members', false);
        setBizSectionVisible('biz-report-section-products', false);

        if (!type) {
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        if (!bizReportCache) {
            summary.innerHTML =
                '<p class="form-help" style="margin:0;">Run report to load data for the selected date range.</p>';
            return;
        }

        const statsByType = {
            'new-members': [renderBizStat('New members', num(m.newAccounts), 'Accounts created in range')],
            newsletter: [
                renderBizStat('Newsletter signups', num(m.newNewsletterSubscribers), 'Email list in range'),
            ],
            rewards: [
                renderBizStat(
                    'Rewards earned',
                    money(rw.cashEarned),
                    `${num(rw.earnEvents)} earn events · cash store credit`
                ),
                renderBizStat('Rewards redeemed', money(rw.cashRedeemed), `${num(rw.redeemEvents)} redemptions`),
            ],
            'paid-orders': [
                renderBizStat('Paid orders', num(o.paidOrders), `${money(o.revenue)} revenue`),
                renderBizStat('Avg order value', money(o.avgOrderValue), `${num(o.uniqueBuyers)} unique buyers`),
            ],
            buyers: [
                renderBizStat('First-time buyers', num(o.firstTimeBuyers), `${num(o.returningBuyers)} returning`),
                renderBizStat('Returning buyers', num(o.returningBuyers), `${num(o.uniqueBuyers)} unique buyers`),
            ],
            channel: [
                renderBizStat(
                    'Online / in-store',
                    `${num(o.onlineOrders)} / ${num(o.inStoreOrders)}`,
                    `${money(o.onlineRevenue)} online · ${money(o.inStoreRevenue)} in-store`
                ),
            ],
            'gift-cards': [
                renderBizStat('Gift cards issued', num(g.issued), `${money(g.activeBalanceIssued)} active balance`),
            ],
            catalog: [
                renderBizStat('Products added', num(c.productsAdded), `${num(t.lowStockNow)} low stock now`),
            ],
            daily: [],
            'top-products': [],
        };

        summary.innerHTML = (statsByType[type] || []).join('');

        if (type === 'daily' && dailyMount) {
            setBizSectionVisible('biz-report-section-daily', true);
            const daily = r.daily || [];
            dailyMount.innerHTML = daily.length
                ? `<table class="table"><thead><tr><th>Day</th><th>New members</th><th>Rewards earned</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>${daily
                      .map(
                          (d) => `<tr>
                        <td>${esc(d.day)}</td>
                        <td>${num(d.newAccounts)}</td>
                        <td>${money(d.rewardsCashEarned)}</td>
                        <td>${num(d.paidOrders)}</td>
                        <td>${money(d.revenue)}</td>
                    </tr>`
                      )
                      .join('')}</tbody></table>`
                : '<p style="color:var(--gray-500);padding:0.75rem;">No daily activity in this range.</p>';
        }

        if (type === 'new-members' && membersMount) {
            setBizSectionVisible('biz-report-section-members', true);
            const members = r.recentMembers || [];
            membersMount.innerHTML = members.length
                ? `<table class="table"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Tier</th></tr></thead><tbody>${members
                      .map(
                          (u) => `<tr>
                        <td>${esc(u.name)}</td>
                        <td>${esc(u.email)}</td>
                        <td>${esc(fmtDay(u.createdAt))}</td>
                        <td>${esc(u.tier || '—')}</td>
                    </tr>`
                      )
                      .join('')}</tbody></table>`
                : '<p style="color:var(--gray-500);padding:0.75rem;">No new members in this range.</p>';
        }

        if (type === 'top-products' && productsMount) {
            setBizSectionVisible('biz-report-section-products', true);
            const products = r.topProducts || [];
            productsMount.innerHTML = products.length
                ? `<table class="table"><thead><tr><th>Product</th><th>SKU</th><th>Units</th><th>Revenue</th></tr></thead><tbody>${products
                      .map(
                          (p) => `<tr>
                        <td>${esc(p.name)}</td>
                        <td>${esc(p.sku || '—')}</td>
                        <td>${num(p.unitsSold)}</td>
                        <td>${money(p.revenue)}</td>
                    </tr>`
                      )
                      .join('')}</tbody></table>`
                : '<p style="color:var(--gray-500);padding:0.75rem;">No paid product sales in this range.</p>';
        }
    }

    async function loadBusinessReport() {
        const status = document.getElementById('biz-report-status');
        const summary = document.getElementById('biz-report-summary');
        if (!summary) return;

        const from = document.getElementById('biz-report-from')?.value;
        const to = document.getElementById('biz-report-to')?.value;
        if (status) status.textContent = 'Loading…';

        try {
            const qs = new URLSearchParams();
            if (from) qs.set('from', from);
            if (to) qs.set('to', to);
            const res = await window.adminApp.apiRequest('/admin/reports/business?' + qs.toString());
            bizReportCache = res.report || {};
            renderBusinessReportView();
        } catch (err) {
            bizReportCache = null;
            if (status) status.textContent = err.message || 'Failed to load business report';
            summary.innerHTML = `<p style="color:var(--error);">${esc(err.message || 'Failed to load')}</p>`;
            setBizSectionVisible('biz-report-section-daily', false);
            setBizSectionVisible('biz-report-section-members', false);
            setBizSectionVisible('biz-report-section-products', false);
            const empty = document.getElementById('biz-report-empty');
            if (empty) empty.style.display = 'none';
        }
    }

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

        document.getElementById('pos-timesheets-refresh')?.addEventListener('click', loadTimesheets);
    }

    function bindReportsTabs() {
        if (reportsTabsBound) return;
        reportsTabsBound = true;

        document.querySelectorAll('[data-reports-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-reports-tab');
                document.querySelectorAll('[data-reports-tab]').forEach((b) => {
                    b.classList.remove('active');
                    b.setAttribute('aria-selected', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-selected', 'true');
                document.querySelectorAll('[data-reports-panel]').forEach((p) => {
                    p.style.display = p.getAttribute('data-reports-panel') === tab ? '' : 'none';
                });
                if (tab === 'view') loadShiftSessions();
                if (tab === 'business') loadBusinessReport();
            });
        });

        document.getElementById('pos-reports-refresh')?.addEventListener('click', () => {
            loadTimesheets();
            loadShiftSessions();
        });
        document.getElementById('pos-shift-sessions-refresh')?.addEventListener('click', loadShiftSessions);
        document.getElementById('pos-day-summary-btn')?.addEventListener('click', loadDaySummary);
        document.getElementById('pos-send-daily-sales-btn')?.addEventListener('click', sendTestDailySalesEmail);
        document.getElementById('biz-report-refresh')?.addEventListener('click', loadBusinessReport);
        document.getElementById('biz-report-type')?.addEventListener('change', renderBusinessReportView);
        document.querySelectorAll('[data-biz-preset]').forEach((btn) => {
            btn.addEventListener('click', () => {
                setBizPreset(Number(btn.getAttribute('data-biz-preset')) || 30);
                loadBusinessReport();
            });
        });
    }

    window.AdminPersonnelPos = {
        init() {
            bindPersonnelTabs();
            bindReportsTabs();
            const today = new Date();
            const weekAgo = new Date(Date.now() - 7 * 86400000);
            const fromEl = document.getElementById('pos-report-from');
            const toEl = document.getElementById('pos-report-to');
            const dayEl = document.getElementById('pos-day-summary-date');
            if (fromEl && !fromEl.value) fromEl.value = weekAgo.toISOString().slice(0, 10);
            if (toEl && !toEl.value) toEl.value = today.toISOString().slice(0, 10);
            if (dayEl && !dayEl.value) dayEl.value = today.toISOString().slice(0, 10);
            const bizFrom = document.getElementById('biz-report-from');
            const bizTo = document.getElementById('biz-report-to');
            if (bizFrom && !bizFrom.value) setBizPreset(30);
            if (bizTo && !bizTo.value) bizTo.value = today.toISOString().slice(0, 10);
            if (document.getElementById('biz-report-summary')) {
                loadBusinessReport();
            } else if (document.getElementById('pos-shift-sessions-list')) {
                loadShiftSessions();
            }
        },
        loadTimesheets,
        loadShiftSessions,
        loadScheduledShifts,
        loadShiftEmployeeSelect,
        loadBusinessReport,
    };
})();
