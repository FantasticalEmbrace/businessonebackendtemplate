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
    let bizExportState = null;

    const BIZ_REPORT_LABELS = {
        'new-members': 'New members',
        sales: 'Sales',
        'paid-orders': 'Sales', // legacy alias
        newsletter: 'Newsletter signups',
        rewards: 'Rewards earned / redeemed',
        buyers: 'First-time vs returning buyers',
        channel: 'Online vs in-store',
        'gift-cards': 'Gift cards',
        edsa: 'EDSA bookings',
        catalog: 'Products & inventory',
        daily: 'Day-by-day activity',
        'top-products': 'Top products',
    };

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

    function isSalesReportType(type) {
        return type === 'sales' || type === 'paid-orders';
    }

    function selectedSalesChannelFilter() {
        const v = String(document.getElementById('biz-report-channel')?.value || 'all').trim();
        return v === 'online' || v === 'store' ? v : 'all';
    }

    function salesChannelFilterLabel(filter) {
        if (filter === 'online') return 'Online';
        if (filter === 'store') return 'In-store';
        return 'All channels';
    }

    function isInStoreOrderChannel(channel) {
        const c = String(channel || '').toLowerCase();
        return c === 'in_store' || c === 'pos' || c === 'instore';
    }

    function filterOrdersBySalesChannel(orders, filter) {
        const list = Array.isArray(orders) ? orders : [];
        if (filter === 'online') return list.filter((o) => !isInStoreOrderChannel(o.channel));
        if (filter === 'store') return list.filter((o) => isInStoreOrderChannel(o.channel));
        return list;
    }

    function salesStatsFromOrders(orders) {
        const list = Array.isArray(orders) ? orders : [];
        let revenue = 0;
        let onlineOrders = 0;
        let inStoreOrders = 0;
        let onlineRevenue = 0;
        let inStoreRevenue = 0;
        const buyers = new Set();
        for (const o of list) {
            const total = Number(o.total) || 0;
            revenue += total;
            if (isInStoreOrderChannel(o.channel)) {
                inStoreOrders += 1;
                inStoreRevenue += total;
            } else {
                onlineOrders += 1;
                onlineRevenue += total;
            }
            const key = String(o.email || o.customer || o.id || '')
                .trim()
                .toLowerCase();
            if (key) buyers.add(key);
        }
        const paidOrders = list.length;
        return {
            paidOrders,
            revenue,
            avgOrderValue: paidOrders ? revenue / paidOrders : 0,
            onlineOrders,
            inStoreOrders,
            onlineRevenue,
            inStoreRevenue,
            uniqueBuyers: buyers.size,
        };
    }

    function syncSalesChannelFilterVisibility() {
        const show = isSalesReportType(selectedBizReportType());
        setBizElVisible('biz-report-channel-wrap', show);
    }

    function setBizElVisible(id, visible, display) {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = visible ? display || '' : 'none';
    }

    function csvEscape(val) {
        const s = String(val == null ? '' : val);
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function downloadTextFile(filename, text, mime) {
        const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    function buildBizTableHtml(headers, rows) {
        if (!rows.length) {
            return '<p style="color:var(--gray-500);padding:0.75rem;">No rows in this range.</p>';
        }
        return `<table class="table"><thead><tr>${headers
            .map((h) => `<th>${esc(h)}</th>`)
            .join('')}</tr></thead><tbody>${rows
            .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`;
    }

    function getBizListBundle(type, report) {
        const lists = report.lists || {};
        const limit = Number(report.listLimit) || 2000;

        if (type === 'new-members') {
            const rows = (lists.members || report.recentMembers || []).map((u) => [
                u.name || '—',
                u.email || '',
                fmtDay(u.createdAt),
                u.tier || '—',
            ]);
            return {
                title: 'New members in range',
                headers: ['Name', 'Email', 'Joined', 'Tier'],
                rows,
                empty: 'No new members in this range.',
                limit,
            };
        }
        if (type === 'newsletter') {
            const rows = (lists.newsletter || []).map((s) => [
                s.email || '',
                fmtDay(s.subscribedAt),
                s.status || '—',
                s.source || '—',
            ]);
            return {
                title: 'Newsletter signups in range',
                headers: ['Email', 'Subscribed', 'Status', 'Source'],
                rows,
                empty: 'No newsletter signups in this range.',
                limit,
            };
        }
        if (type === 'rewards') {
            const rows = (lists.rewards || []).map((t) => [
                t.customer || '—',
                money(t.amount),
                t.type || '—',
                fmtDay(t.date),
                t.orderNumber || '—',
                t.source || '—',
            ]);
            return {
                title: 'Rewards transactions in range',
                headers: ['Customer', 'Amount', 'Type', 'Date', 'Order', 'Source'],
                rows,
                empty: 'No rewards activity in this range.',
                limit,
            };
        }
        if (isSalesReportType(type)) {
            const channelFilter = selectedSalesChannelFilter();
            const orders = filterOrdersBySalesChannel(lists.orders || [], channelFilter);
            const channelLabel = salesChannelFilterLabel(channelFilter);
            const rows = orders.map((o) => [
                o.orderNumber || '—',
                fmtDay(o.createdAt),
                o.customer || '—',
                o.email || '',
                isInStoreOrderChannel(o.channel)
                    ? 'In-store'
                    : o.channel === 'online'
                      ? 'Online'
                      : o.channel || 'Online',
                o.status || o.paymentStatus || 'paid',
                num(o.itemCount),
                money(o.total),
            ]);
            return {
                title:
                    channelFilter === 'all'
                        ? 'Sales (paid orders) in range'
                        : `Sales — ${channelLabel} in range`,
                headers: ['Order #', 'Date', 'Customer', 'Email', 'Channel', 'Status', 'Items', 'Total'],
                rows,
                empty:
                    channelFilter === 'all'
                        ? 'No paid sales in this range.'
                        : `No ${channelLabel.toLowerCase()} paid sales in this range.`,
                limit,
                channelFilter,
                channelLabel,
            };
        }
        if (type === 'channel') {
            const rows = (lists.orders || []).map((o) => [
                o.orderNumber || '—',
                o.customer || '—',
                o.channel === 'in_store' ? 'In-store' : o.channel || 'online',
                money(o.total),
                fmtDay(o.createdAt),
            ]);
            return {
                title: 'Paid orders by channel',
                headers: ['Order #', 'Customer', 'Channel', 'Total', 'Date'],
                rows,
                empty: 'No paid orders in this range.',
                limit,
            };
        }
        if (type === 'buyers') {
            const rows = (lists.buyers || []).map((b) => [
                b.customer || '—',
                b.email || '',
                b.buyerType === 'first-time' ? 'First-time' : 'Returning',
                num(b.orderCount),
                money(b.spendInRange),
                fmtDay(b.firstPaidAt),
            ]);
            return {
                title: 'Buyers in range',
                headers: ['Customer', 'Email', 'Type', 'Orders', 'Spend in range', 'First paid order'],
                rows,
                empty: 'No buyers in this range.',
                limit,
            };
        }
        if (type === 'gift-cards') {
            const rows = (lists.giftCards || []).map((g) => [
                g.code || '—',
                g.cardType || '—',
                g.status || '—',
                money(g.initialBalance),
                money(g.currentBalance),
                g.recipient || '—',
                fmtDay(g.createdAt),
            ]);
            return {
                title: 'Gift cards issued in range',
                headers: ['Code', 'Type', 'Status', 'Initial', 'Balance', 'Recipient', 'Issued'],
                rows,
                empty: 'No gift cards issued in this range.',
                limit,
            };
        }
        if (type === 'edsa') {
            const rows = (lists.edsa || []).map((b) => [
                b.name || '—',
                b.email || '',
                b.phone || '',
                b.status || '—',
                fmtDay(b.preferredDate),
                fmtDay(b.createdAt),
            ]);
            return {
                title: 'EDSA bookings in range',
                headers: ['Name', 'Email', 'Phone', 'Status', 'Preferred date', 'Created'],
                rows,
                empty: 'No EDSA bookings in this range.',
                limit,
            };
        }
        if (type === 'catalog') {
            const rows = (lists.catalog || []).map((p) => [
                p.name || '—',
                p.sku || '—',
                p.active ? 'Active' : 'Inactive',
                p.inventory != null ? num(p.inventory) : '—',
                fmtDay(p.createdAt),
            ]);
            return {
                title: 'Products added in range',
                headers: ['Product', 'SKU', 'Status', 'Inventory', 'Created'],
                rows,
                empty: 'No products added in this range.',
                limit,
            };
        }
        if (type === 'daily') {
            const rows = (lists.daily || report.daily || []).map((d) => [
                d.day || '—',
                num(d.newAccounts),
                money(d.rewardsCashEarned),
                num(d.paidOrders),
                money(d.revenue),
            ]);
            return {
                title: 'Day-by-day activity',
                headers: ['Day', 'New members', 'Rewards earned', 'Orders', 'Revenue'],
                rows,
                empty: 'No daily activity in this range.',
                limit,
            };
        }
        if (type === 'top-products') {
            const rows = (lists.topProducts || report.topProducts || []).map((p) => [
                p.name || '—',
                p.sku || '—',
                num(p.unitsSold),
                money(p.revenue),
            ]);
            return {
                title: 'Top products (paid orders)',
                headers: ['Product', 'SKU', 'Units', 'Revenue'],
                rows,
                empty: 'No paid product sales in this range.',
                limit,
            };
        }
        return null;
    }

    function renderBusinessReportView() {
        const status = document.getElementById('biz-report-status');
        const summary = document.getElementById('biz-report-summary');
        const empty = document.getElementById('biz-report-empty');
        const detail = document.getElementById('biz-report-detail');
        const detailTitle = document.getElementById('biz-report-detail-title');
        const detailMeta = document.getElementById('biz-report-detail-meta');
        const detailTable = document.getElementById('biz-report-detail-table');
        if (!summary) return;

        const type = selectedBizReportType();
        const r = bizReportCache || {};
        const m = r.members || {};
        const rw = r.rewards || {};
        const o = r.orders || {};
        const g = r.giftCards || {};
        const e = r.edsa || {};
        const c = r.catalog || {};
        const t = r.totals || {};
        const rangeLabel = r.range ? `${r.range.from} → ${r.range.to}` : '';

        if (status && bizReportCache) {
            status.textContent = rangeLabel
                ? `Showing ${rangeLabel}. Store totals: ${num(t.customers)} customers · ${money(t.outstandingCashCredit)} store credit outstanding · ${num(t.newsletterSubscribers)} newsletter.`
                : 'Report loaded.';
        }

        summary.innerHTML = '';
        bizExportState = null;
        setBizElVisible('biz-report-export', false);
        setBizElVisible('biz-report-detail', false);
        syncSalesChannelFilterVisibility();
        if (detailTable) detailTable.innerHTML = '';
        if (detailTitle) detailTitle.textContent = '';
        if (detailMeta) detailMeta.textContent = '';

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

        const salesChannelFilter = selectedSalesChannelFilter();
        const salesChannelLabel = salesChannelFilterLabel(salesChannelFilter);
        const salesOrdersFiltered = isSalesReportType(type)
            ? filterOrdersBySalesChannel((r.lists && r.lists.orders) || [], salesChannelFilter)
            : [];
        const salesFiltered = isSalesReportType(type) ? salesStatsFromOrders(salesOrdersFiltered) : null;
        const salesHint =
            salesChannelFilter === 'all' ? 'Paid orders in range' : `${salesChannelLabel} paid orders in range`;

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
            sales: salesFiltered
                ? [
                      renderBizStat('Orders', num(salesFiltered.paidOrders), salesHint),
                      renderBizStat(
                          'Revenue',
                          money(salesFiltered.revenue),
                          `${num(salesFiltered.uniqueBuyers)} unique buyers`
                      ),
                      renderBizStat('Avg order value', money(salesFiltered.avgOrderValue), 'AOV'),
                      renderBizStat(
                          'Online / in-store',
                          `${money(salesFiltered.onlineRevenue)} / ${money(salesFiltered.inStoreRevenue)}`,
                          `${num(salesFiltered.onlineOrders)} online · ${num(salesFiltered.inStoreOrders)} in-store`
                      ),
                  ]
                : [],
            'paid-orders': salesFiltered
                ? [
                      renderBizStat('Orders', num(salesFiltered.paidOrders), salesHint),
                      renderBizStat(
                          'Revenue',
                          money(salesFiltered.revenue),
                          `${num(salesFiltered.uniqueBuyers)} unique buyers`
                      ),
                      renderBizStat('Avg order value', money(salesFiltered.avgOrderValue), 'AOV'),
                      renderBizStat(
                          'Online / in-store',
                          `${money(salesFiltered.onlineRevenue)} / ${money(salesFiltered.inStoreRevenue)}`,
                          `${num(salesFiltered.onlineOrders)} online · ${num(salesFiltered.inStoreOrders)} in-store`
                      ),
                  ]
                : [],
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
            edsa: [
                renderBizStat(
                    'EDSA bookings',
                    num(e.bookings),
                    `${num(e.confirmed)} confirmed · ${num(e.pending)} pending`
                ),
            ],
            catalog: [
                renderBizStat('Products added', num(c.productsAdded), `${num(t.lowStockNow)} low stock now`),
            ],
            daily: [],
            'top-products': [],
        };

        summary.innerHTML = (statsByType[type] || []).join('');

        const bundle = getBizListBundle(type, r);
        if (!bundle || !detail || !detailTable) return;

        const rowCount = bundle.rows.length;
        const truncated =
            rowCount >= bundle.limit
                ? ` Showing first ${bundle.limit} rows (raise date range filter if needed).`
                : '';
        detailTitle.textContent = bundle.title;
        detailMeta.textContent = `${rowCount} row${rowCount === 1 ? '' : 's'}.${truncated}`;
        detailTable.innerHTML = rowCount
            ? buildBizTableHtml(bundle.headers, bundle.rows)
            : `<p style="color:var(--gray-500);padding:0.75rem;">${esc(bundle.empty)}</p>`;
        setBizElVisible('biz-report-detail', true);
        setBizElVisible('biz-report-export', true, 'flex');

        const label = BIZ_REPORT_LABELS[type] || bundle.title;
        const from = r.range?.from || '';
        const to = r.range?.to || '';
        const channelSuffix =
            isSalesReportType(type) && bundle.channelFilter && bundle.channelFilter !== 'all'
                ? ` · ${bundle.channelLabel}`
                : '';
        const channelFile =
            isSalesReportType(type) && bundle.channelFilter && bundle.channelFilter !== 'all'
                ? `-${bundle.channelFilter}`
                : '';
        bizExportState = {
            type,
            label: `${label}${channelSuffix}`,
            from,
            to,
            headers: bundle.headers,
            rows: bundle.rows,
            filenameBase: `business-report-${type}${channelFile}-${from || 'from'}-to-${to || 'to'}`,
        };
    }

    function printBizReport() {
        if (!bizExportState) {
            window.adminApp?.showToast('Run a report first', 'error');
            return;
        }
        const { label, from, to, headers, rows } = bizExportState;
        const w = window.open('', '_blank');
        if (!w) {
            window.adminApp?.showToast('Allow popups to print this report.', 'error');
            return;
        }
        const table =
            rows.length > 0
                ? `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
                      .map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
                      .join('')}</tbody></table>`
                : '<p>No rows in this range.</p>';
        w.document.write(`<!DOCTYPE html><html><head><title>${esc(label)}</title>
<style>
  body{font-family:system-ui,Segoe UI,sans-serif;padding:24px;color:#111;font-size:12px}
  h1{font-size:18px;margin:0 0 6px}
  p{margin:0 0 14px;color:#444}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f3f3f3}
  @media print{body{padding:0}}
</style></head><body>
  <h1>${esc(label)}</h1>
  <p>${esc(from)} → ${esc(to)} · ${rows.length} row${rows.length === 1 ? '' : 's'}</p>
  ${table}
  <script>window.onload=function(){window.focus();window.print();}</script>
</body></html>`);
        w.document.close();
    }

    function downloadBizCsv() {
        if (!bizExportState) {
            window.adminApp?.showToast('Run a report first', 'error');
            return;
        }
        const { headers, rows, filenameBase } = bizExportState;
        const lines = [headers.map(csvEscape).join(',')].concat(
            rows.map((row) => row.map(csvEscape).join(','))
        );
        downloadTextFile(filenameBase + '.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    }

    async function downloadBizPdf() {
        if (!bizExportState) {
            window.adminApp?.showToast('Run a report first', 'error');
            return;
        }
        const { label, from, to, headers, rows, filenameBase } = bizExportState;
        try {
            if (typeof window.loadJsPdf !== 'function') {
                throw new Error('PDF helper unavailable');
            }
            const mod = await window.loadJsPdf();
            const JsPDF = mod.jsPDF || mod.default || window.jsPDF;
            if (!JsPDF) throw new Error('jsPDF missing');
            const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
            const margin = 36;
            let y = margin;
            doc.setFontSize(14);
            doc.text(label, margin, y);
            y += 18;
            doc.setFontSize(10);
            doc.text(`${from} → ${to} · ${rows.length} rows`, margin, y);
            y += 16;
            const colCount = Math.max(headers.length, 1);
            const pageWidth = doc.internal.pageSize.getWidth();
            const usable = pageWidth - margin * 2;
            const colW = usable / colCount;
            const lineH = 12;

            const drawRow = (cells, bold) => {
                if (y > doc.internal.pageSize.getHeight() - margin) {
                    doc.addPage();
                    y = margin;
                }
                doc.setFont(undefined, bold ? 'bold' : 'normal');
                let maxLines = 1;
                const wrapped = cells.map((cell) => {
                    const lines = doc.splitTextToSize(String(cell == null ? '' : cell), colW - 4);
                    maxLines = Math.max(maxLines, lines.length);
                    return lines;
                });
                wrapped.forEach((lines, i) => {
                    doc.text(lines, margin + i * colW, y);
                });
                y += maxLines * lineH + 4;
            };

            drawRow(headers, true);
            rows.forEach((row) => drawRow(row, false));
            doc.save(filenameBase + '.pdf');
        } catch (err) {
            window.adminApp?.showToast(
                (err && err.message) || 'PDF failed — use Print → Save as PDF',
                'error'
            );
            printBizReport();
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
            bizExportState = null;
            if (status) status.textContent = err.message || 'Failed to load business report';
            summary.innerHTML = `<p style="color:var(--error);">${esc(err.message || 'Failed to load')}</p>`;
            setBizElVisible('biz-report-export', false);
            setBizElVisible('biz-report-detail', false);
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
        document.getElementById('biz-report-channel')?.addEventListener('change', renderBusinessReportView);
        document.getElementById('biz-report-print')?.addEventListener('click', printBizReport);
        document.getElementById('biz-report-csv')?.addEventListener('click', downloadBizCsv);
        document.getElementById('biz-report-pdf')?.addEventListener('click', () => {
            downloadBizPdf();
        });
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
