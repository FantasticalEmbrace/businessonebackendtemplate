'use strict';

const logger = require('../utils/logger');
const { sendMail, isSmtpConfigured } = require('../utils/mailTransporter');
const { loadPosStoreConfig } = require('./posStoreConfig');
const {
    loadPosPayrollSettings,
    resolvePayrollPeriod,
    SETTING_LAST_PERIOD_KEY
} = require('./posPayrollSettings');

function roundHours(ms) {
    const h = ms / 3600000;
    return Math.round(h * 100) / 100;
}

function formatMoney(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeCsv(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function entryHours(entry, { now = new Date(), countOpenAsNow = false } = {}) {
    if (!entry?.clock_in) return { hours: 0, open: false };
    const start = new Date(entry.clock_in);
    if (Number.isNaN(start.getTime())) return { hours: 0, open: false };
    if (entry.clock_out) {
        const end = new Date(entry.clock_out);
        if (Number.isNaN(end.getTime()) || end < start) return { hours: 0, open: false };
        return { hours: roundHours(end - start), open: false };
    }
    if (!countOpenAsNow) return { hours: 0, open: true };
    return { hours: roundHours(Math.max(0, now - start)), open: true };
}

/**
 * Build payroll summary from time entries (+ optional hourly rate).
 */
function buildPayrollReport(entries, { fromKey, toKey, includePay = true, now = new Date() } = {}) {
    const byEmployee = new Map();

    for (const row of entries || []) {
        const id = Number(row.employee_id);
        if (!byEmployee.has(id)) {
            byEmployee.set(id, {
                employeeId: id,
                employeeCode: row.employee_code || '',
                firstName: row.first_name || '',
                lastName: row.last_name || '',
                hourlyRate: row.hourly_rate != null ? Number(row.hourly_rate) : null,
                punches: 0,
                openPunches: 0,
                totalHours: 0,
                entries: []
            });
        }
        const emp = byEmployee.get(id);
        const { hours, open } = entryHours(row, { now, countOpenAsNow: false });
        emp.punches += 1;
        if (open) emp.openPunches += 1;
        else emp.totalHours = Math.round((emp.totalHours + hours) * 100) / 100;
        emp.entries.push({
            clockIn: row.clock_in,
            clockOut: row.clock_out,
            hours: open ? null : hours,
            open,
            source: row.source || 'pos'
        });
    }

    const employees = [...byEmployee.values()].map((emp) => {
        const rate = includePay && emp.hourlyRate != null ? Number(emp.hourlyRate) : null;
        const estimatedPay =
            rate != null ? Math.round(emp.totalHours * rate * 100) / 100 : null;
        return { ...emp, estimatedPay };
    });
    employees.sort((a, b) =>
        `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    );

    const totals = employees.reduce(
        (acc, e) => {
            acc.employees += 1;
            acc.hours += e.totalHours;
            acc.openPunches += e.openPunches;
            if (e.estimatedPay != null) acc.estimatedPay += e.estimatedPay;
            return acc;
        },
        { employees: 0, hours: 0, openPunches: 0, estimatedPay: 0 }
    );
    totals.hours = Math.round(totals.hours * 100) / 100;
    totals.estimatedPay = Math.round(totals.estimatedPay * 100) / 100;

    return {
        fromKey,
        toKey,
        includePay,
        employees,
        totals
    };
}

function buildCsv(report) {
    const lines = [
        ['Employee code', 'First name', 'Last name', 'Clock in', 'Clock out', 'Hours', 'Open?', 'Hourly rate', 'Est. pay', 'Source']
            .map(escapeCsv)
            .join(',')
    ];
    for (const emp of report.employees) {
        if (!emp.entries.length) {
            lines.push(
                [
                    emp.employeeCode,
                    emp.firstName,
                    emp.lastName,
                    '',
                    '',
                    emp.totalHours.toFixed(2),
                    'no',
                    emp.hourlyRate != null ? emp.hourlyRate.toFixed(2) : '',
                    emp.estimatedPay != null ? emp.estimatedPay.toFixed(2) : '',
                    ''
                ]
                    .map(escapeCsv)
                    .join(',')
            );
            continue;
        }
        for (const punch of emp.entries) {
            lines.push(
                [
                    emp.employeeCode,
                    emp.firstName,
                    emp.lastName,
                    punch.clockIn ? new Date(punch.clockIn).toISOString() : '',
                    punch.clockOut ? new Date(punch.clockOut).toISOString() : '',
                    punch.open ? '' : Number(punch.hours || 0).toFixed(2),
                    punch.open ? 'yes' : 'no',
                    emp.hourlyRate != null ? emp.hourlyRate.toFixed(2) : '',
                    '',
                    punch.source || ''
                ]
                    .map(escapeCsv)
                    .join(',')
            );
        }
        lines.push(
            [
                emp.employeeCode,
                emp.firstName,
                emp.lastName,
                '',
                'TOTAL',
                emp.totalHours.toFixed(2),
                emp.openPunches ? `${emp.openPunches} open` : 'no',
                emp.hourlyRate != null ? emp.hourlyRate.toFixed(2) : '',
                emp.estimatedPay != null ? emp.estimatedPay.toFixed(2) : '',
                ''
            ]
                .map(escapeCsv)
                .join(',')
        );
    }
    return lines.join('\n');
}

function buildEmailHtml(storeName, report) {
    const payCol = report.includePay;
    const rows = report.employees
        .map(
            (e) => `<tr>
      <td style="padding:0.4rem;border-bottom:1px solid #e5e7eb;">${escapeHtml(e.employeeCode)} — ${escapeHtml(e.firstName)} ${escapeHtml(e.lastName)}</td>
      <td style="padding:0.4rem;border-bottom:1px solid #e5e7eb;text-align:right;">${e.totalHours.toFixed(2)}</td>
      <td style="padding:0.4rem;border-bottom:1px solid #e5e7eb;text-align:right;">${e.punches}</td>
      ${
          payCol
              ? `<td style="padding:0.4rem;border-bottom:1px solid #e5e7eb;text-align:right;">${
                    e.hourlyRate != null ? formatMoney(e.hourlyRate) : '—'
                }</td>
                 <td style="padding:0.4rem;border-bottom:1px solid #e5e7eb;text-align:right;">${
                     e.estimatedPay != null ? formatMoney(e.estimatedPay) : '—'
                 }</td>`
              : ''
      }
      <td style="padding:0.4rem;border-bottom:1px solid #e5e7eb;text-align:right;color:${
          e.openPunches ? '#b45309' : '#6b7280'
      };">${e.openPunches ? `${e.openPunches} open` : '—'}</td>
    </tr>`
        )
        .join('');

    return `
<div style="font-family:system-ui,sans-serif;max-width:720px;color:#111">
  <h2 style="color:#1f82ff;margin:0 0 0.35rem">${escapeHtml(storeName)} — payroll hours</h2>
  <p style="margin:0 0 1rem;color:#555">Period <strong>${escapeHtml(report.fromKey)}</strong> through <strong>${escapeHtml(report.toKey)}</strong></p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead>
      <tr style="background:#f3f4f6;text-align:left">
        <th style="padding:0.45rem;">Employee</th>
        <th style="padding:0.45rem;text-align:right;">Hours</th>
        <th style="padding:0.45rem;text-align:right;">Punches</th>
        ${payCol ? '<th style="padding:0.45rem;text-align:right;">Rate</th><th style="padding:0.45rem;text-align:right;">Est. pay</th>' : ''}
        <th style="padding:0.45rem;text-align:right;">Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="6" style="padding:0.75rem;color:#6b7280;">No time entries in this period.</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td style="padding:0.6rem 0.45rem;font-weight:700;">Totals (${report.totals.employees} employees)</td>
        <td style="padding:0.6rem 0.45rem;text-align:right;font-weight:700;">${report.totals.hours.toFixed(2)}</td>
        <td></td>
        ${
            payCol
                ? `<td></td><td style="padding:0.6rem 0.45rem;text-align:right;font-weight:700;">${formatMoney(
                      report.totals.estimatedPay
                  )}</td>`
                : ''
        }
        <td style="padding:0.6rem 0.45rem;text-align:right;color:#b45309;">${
            report.totals.openPunches ? `${report.totals.openPunches} still open` : ''
        }</td>
      </tr>
    </tfoot>
  </table>
  <p style="margin:1rem 0 0;font-size:13px;color:#6b7280;">
    Open punches are listed but not counted in hours until clocked out. CSV attachment has punch-level detail.
    Estimated pay uses each employee’s hourly rate when set — confirm before running payroll.
  </p>
</div>`;
}

async function loadEntriesForPeriod(pool, from, to) {
    const [rows] = await pool.execute(
        `SELECT t.id, t.employee_id, t.clock_in, t.clock_out, t.source, t.notes,
                e.employee_code, e.first_name, e.last_name, e.hourly_rate
           FROM pos_time_entries t
           JOIN pos_employees e ON e.id = t.employee_id
          WHERE t.clock_in >= ? AND t.clock_in <= ?
          ORDER BY e.last_name ASC, e.first_name ASC, t.clock_in ASC
          LIMIT 5000`,
        [from, to]
    );
    return rows;
}

/**
 * @param {object} pool
 * @param {{ force?: boolean, from?: string|Date, to?: string|Date, toEmail?: string, includePay?: boolean, markSent?: boolean, periodKey?: string }} [opts]
 */
async function sendPayrollTimesheetEmail(pool, opts = {}) {
    if (!isSmtpConfigured()) {
        return { sent: false, reason: 'smtp_not_configured' };
    }

    const settings = await loadPosPayrollSettings(pool);
    if (!settings.payrollEmailEnabled && !opts.force) {
        return { sent: false, reason: 'disabled' };
    }

    const to = String(opts.toEmail || settings.payrollEmailTo || '').trim();
    if (!to) {
        return { sent: false, reason: 'no_recipient' };
    }

    let period;
    if (opts.from && opts.to) {
        const fromDate = new Date(opts.from);
        const toDate = new Date(opts.to);
        const fromKey = fromDate.toISOString().slice(0, 10);
        const toKey = toDate.toISOString().slice(0, 10);
        period = {
            from: fromDate,
            to: toDate,
            fromKey,
            toKey,
            periodKey: opts.periodKey || `manual:${fromKey}_${toKey}`
        };
    } else {
        period = opts.period || resolvePayrollPeriod(new Date(), settings);
    }

    if (
        !opts.force &&
        settings.payrollEmailLastPeriodKey &&
        settings.payrollEmailLastPeriodKey === period.periodKey
    ) {
        return { sent: false, reason: 'already_sent', period };
    }

    const entries = await loadEntriesForPeriod(pool, period.from, period.to);
    const includePay =
        opts.includePay != null ? Boolean(opts.includePay) : settings.payrollEmailIncludePay;
    const report = buildPayrollReport(entries, {
        fromKey: period.fromKey,
        toKey: period.toKey,
        includePay
    });

    const store = await loadPosStoreConfig(pool);
    const storeName = store.storeName || 'Store';
    const subject = `${storeName} — payroll hours ${period.fromKey} to ${period.toKey}`;
    const html = buildEmailHtml(storeName, report);
    const text =
        `${storeName} payroll hours ${period.fromKey} to ${period.toKey}\n` +
        `Employees: ${report.totals.employees}\n` +
        `Total hours: ${report.totals.hours.toFixed(2)}\n` +
        (includePay ? `Est. pay: ${formatMoney(report.totals.estimatedPay)}\n` : '') +
        (report.totals.openPunches ? `Open punches: ${report.totals.openPunches}\n` : '');

    const csv = buildCsv(report);
    await sendMail({
        to,
        subject,
        html,
        text,
        logTag: 'POS payroll email',
        attachments: [
            {
                filename: `payroll-hours-${period.fromKey}_to_${period.toKey}.csv`,
                content: csv,
                contentType: 'text/csv'
            }
        ]
    });

    const markSent = opts.markSent !== false;
    if (markSent) {
        await pool.execute(
            `INSERT INTO settings (key_name, value, description, type) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE value = VALUES(value)`,
            [
                SETTING_LAST_PERIOD_KEY,
                period.periodKey,
                'Last payroll period key emailed',
                'string'
            ]
        );
    }

    logger.info('[pos-payroll] Email sent', {
        to,
        periodKey: period.periodKey,
        employees: report.totals.employees,
        hours: report.totals.hours
    });

    return { sent: true, to, period, report };
}

module.exports = {
    entryHours,
    buildPayrollReport,
    buildCsv,
    buildEmailHtml,
    sendPayrollTimesheetEmail,
    loadEntriesForPeriod
};
