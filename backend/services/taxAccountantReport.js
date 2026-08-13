'use strict';

const ExcelJS = require('exceljs');
const logger = require('../utils/logger');
const { isSmtpConfigured } = require('../utils/smtpConfig');
const { TaxLedgerService, toDateKey } = require('./taxLedger');
const { resolveCounty } = require('../utils/zipCountyLookup');

const TARGET_STATE_ORDER = ['GA', 'IN', 'MI', 'NC', 'OH'];
const STATE_LABELS = {
    GA: 'Georgia',
    IN: 'Indiana',
    MI: 'Michigan',
    NC: 'North Carolina',
    OH: 'Ohio'
};

const DETAIL_HEADERS = [
    'State',
    'County',
    'Order Date',
    'Order ID',
    'Source',
    'ZIP',
    'Taxable Amount',
    'Tax Collected'
];

const MONEY_FMT = '"$"#,##0.00';

function getAccountantEmail() {
    return String(process.env.TAX_ACCOUNTANT_EMAIL || 'wandaforto@aol.com').trim();
}

function getPreviousMonthRange(referenceDate = new Date()) {
    const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    const year = ref.getFullYear();
    const month = ref.getMonth();
    // Full previous calendar month: e.g. on 2026-06-01 → 2026-05-01 … 2026-05-31
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return {
        startDate: toDateKey(start),
        endDate: toDateKey(end)
    };
}

function parseDateRange(startDate, endDate) {
    const start = String(startDate || '').slice(0, 10);
    const end = String(endDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        throw new Error('startDate and endDate are required (YYYY-MM-DD)');
    }
    if (start > end) {
        throw new Error('startDate must be on or before endDate');
    }
    return { startDate: start, endDate: end };
}

function formatOrderDate(createdAt) {
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function compareRows(a, b) {
    const stateCmp = String(a.state_code).localeCompare(String(b.state_code));
    if (stateCmp !== 0) return stateCmp;
    const countyCmp = String(a.county_name || '').localeCompare(String(b.county_name || ''));
    if (countyCmp !== 0) return countyCmp;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function aggregateByStateCounty(rows) {
    const map = new Map();
    for (const row of rows) {
        const key = `${row.state_code}|${row.county_name || ''}`;
        const existing = map.get(key) || {
            state_code: row.state_code,
            state_label: row.state_label,
            county_name: row.county_name || '',
            order_count: 0,
            taxable_total: 0,
            tax_total: 0
        };
        existing.order_count += 1;
        existing.taxable_total += Number(row.taxable_amount) || 0;
        existing.tax_total += Number(row.tax_amount) || 0;
        map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => {
        const sc = a.state_code.localeCompare(b.state_code);
        if (sc !== 0) return sc;
        return a.county_name.localeCompare(b.county_name);
    });
}

function aggregateByState(rows) {
    const map = new Map();
    for (const row of rows) {
        const code = row.state_code;
        const existing = map.get(code) || {
            state_code: code,
            state_label: row.state_label,
            order_count: 0,
            taxable_total: 0,
            tax_total: 0
        };
        existing.order_count += 1;
        existing.taxable_total += Number(row.taxable_amount) || 0;
        existing.tax_total += Number(row.tax_amount) || 0;
        map.set(code, existing);
    }
    return TARGET_STATE_ORDER
        .map((code) => map.get(code))
        .filter(Boolean)
        .concat(
            Array.from(map.values()).filter((r) => !TARGET_STATE_ORDER.includes(r.state_code))
        );
}

function styleHeaderRow(sheet, colCount) {
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    if (colCount > 0 && sheet.rowCount > 1) {
        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: sheet.rowCount, column: colCount }
        };
    }
}

function addDetailSheet(workbook, sheetName, rows) {
    const sheet = workbook.addWorksheet(sheetName.substring(0, 31));
    sheet.addRow(DETAIL_HEADERS);
    const sorted = [...rows].sort(compareRows);

    for (const row of sorted) {
        sheet.addRow([
            row.state_label,
            row.county_name || '',
            formatOrderDate(row.created_at),
            row.order_id,
            row.source === 'pos' ? 'POS' : 'Website',
            row.zip_code || '',
            Number(row.taxable_amount) || 0,
            Number(row.tax_amount) || 0
        ]);
    }

    const moneyCols = [7, 8];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
        for (const c of moneyCols) {
            sheet.getCell(r, c).numFmt = MONEY_FMT;
        }
    }

    sheet.columns = [
        { width: 16 },
        { width: 22 },
        { width: 14 },
        { width: 18 },
        { width: 12 },
        { width: 10 },
        { width: 16 },
        { width: 14 }
    ];
    styleHeaderRow(sheet, DETAIL_HEADERS.length);
    return sheet;
}

async function buildStateAccountantWorkbook(stateCode, rows) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'H&M Herbs';
    workbook.created = new Date();
    const label = STATE_LABELS[stateCode] || stateCode;

    addDetailSheet(workbook, 'Transactions', rows);

    const summaryCounty = workbook.addWorksheet('Summary by County');
    summaryCounty.addRow(['County', 'Orders', 'Taxable Amount', 'Tax Collected']);
    for (const agg of aggregateByStateCounty(rows)) {
        summaryCounty.addRow([
            agg.county_name,
            agg.order_count,
            agg.taxable_total,
            agg.tax_total
        ]);
    }
    for (let r = 2; r <= summaryCounty.rowCount; r += 1) {
        summaryCounty.getCell(r, 3).numFmt = MONEY_FMT;
        summaryCounty.getCell(r, 4).numFmt = MONEY_FMT;
    }
    summaryCounty.columns = [{ width: 22 }, { width: 10 }, { width: 18 }, { width: 14 }];
    styleHeaderRow(summaryCounty, 4);

    const totals = aggregateByState(rows)[0] || {
        order_count: 0,
        taxable_total: 0,
        tax_total: 0
    };
    const summaryState = workbook.addWorksheet('State Summary');
    summaryState.addRow(['State', 'Orders', 'Taxable Amount', 'Tax Collected']);
    summaryState.addRow([label, totals.order_count, totals.taxable_total, totals.tax_total]);
    summaryState.getCell(2, 3).numFmt = MONEY_FMT;
    summaryState.getCell(2, 4).numFmt = MONEY_FMT;
    summaryState.columns = [{ width: 18 }, { width: 10 }, { width: 18 }, { width: 14 }];
    styleHeaderRow(summaryState, 4);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

async function buildAccountantWorkbooksByState(rows, { startDate, endDate } = {}) {
    const periodSuffix =
        startDate && endDate ? `${startDate}-to-${endDate}` : 'report';
    const files = [];

    for (const code of TARGET_STATE_ORDER) {
        const stateRows = rows.filter((r) => r.state_code === code);
        if (!stateRows.length) continue;
        const label = STATE_LABELS[code] || code;
        const buffer = await buildStateAccountantWorkbook(code, stateRows);
        files.push({
            stateCode: code,
            stateLabel: label,
            filename: `hmherbs-tax-${code}-${periodSuffix}.xlsx`,
            buffer,
            rowCount: stateRows.length
        });
    }

    const otherCodes = [...new Set(rows.map((r) => r.state_code))].filter(
        (code) => !TARGET_STATE_ORDER.includes(code)
    );
    for (const code of otherCodes) {
        const stateRows = rows.filter((r) => r.state_code === code);
        if (!stateRows.length) continue;
        const buffer = await buildStateAccountantWorkbook(code, stateRows);
        files.push({
            stateCode: code,
            stateLabel: code,
            filename: `hmherbs-tax-${code}-${periodSuffix}.xlsx`,
            buffer,
            rowCount: stateRows.length
        });
    }

    return files;
}

/** @deprecated Combined workbook — prefer buildAccountantWorkbooksByState for filing. */
async function buildAccountantWorkbook(rows) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'H&M Herbs';
    workbook.created = new Date();

    addDetailSheet(workbook, 'All Transactions', rows);

    const summaryCounty = workbook.addWorksheet('Summary by State County');
    summaryCounty.addRow([
        'State',
        'County',
        'Orders',
        'Taxable Amount',
        'Tax Collected'
    ]);
    for (const agg of aggregateByStateCounty(rows)) {
        summaryCounty.addRow([
            agg.state_label,
            agg.county_name,
            agg.order_count,
            agg.taxable_total,
            agg.tax_total
        ]);
    }
    for (let r = 2; r <= summaryCounty.rowCount; r += 1) {
        summaryCounty.getCell(r, 4).numFmt = MONEY_FMT;
        summaryCounty.getCell(r, 5).numFmt = MONEY_FMT;
    }
    summaryCounty.columns = [
        { width: 16 },
        { width: 22 },
        { width: 10 },
        { width: 18 },
        { width: 14 }
    ];
    styleHeaderRow(summaryCounty, 5);

    const summaryState = workbook.addWorksheet('Summary by State');
    summaryState.addRow(['State', 'Orders', 'Taxable Amount', 'Tax Collected']);
    for (const agg of aggregateByState(rows)) {
        summaryState.addRow([
            agg.state_label,
            agg.order_count,
            agg.taxable_total,
            agg.tax_total
        ]);
    }
    for (let r = 2; r <= summaryState.rowCount; r += 1) {
        summaryState.getCell(r, 3).numFmt = MONEY_FMT;
        summaryState.getCell(r, 4).numFmt = MONEY_FMT;
    }
    summaryState.columns = [{ width: 18 }, { width: 10 }, { width: 18 }, { width: 14 }];
    styleHeaderRow(summaryState, 4);

    for (const code of TARGET_STATE_ORDER) {
        const stateRows = rows.filter((r) => r.state_code === code);
        if (!stateRows.length) continue;
        addDetailSheet(workbook, STATE_LABELS[code] || code, stateRows);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

async function getMailTransporter() {
    const smtpHost = String(process.env.SMTP_HOST || process.env.EMAIL_HOST || '').trim();
    const smtpUser = String(process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
    const smtpPass = String(process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || '').trim();
    const smtpPort = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587) || 587;
    if (!smtpHost || !smtpUser || !smtpPass) return null;

    const nodemailer = require('nodemailer');
    return {
        transporter: nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass }
        }),
        from: {
            name: 'HM Herbs',
            address: String(process.env.SMTP_FROM || process.env.EMAIL_FROM || smtpUser).trim()
        }
    };
}

class TaxAccountantReportService {
    constructor(pool) {
        this.pool = pool;
        this.ledger = new TaxLedgerService(pool);
    }

    enrichCounty(row) {
        if (row.county_name) return row;
        const county = resolveCounty({
            orderCounty: null,
            zip: row.zip_code,
            stateCode: row.state_code
        });
        return { ...row, county_name: county };
    }

    async fetchReportRows(startDate, endDate) {
        const [rows] = await this.pool.execute(
            `SELECT te.order_id,
                    te.source,
                    te.state_code,
                    te.county_name,
                    te.zip_code,
                    COALESCE(te.taxable_amount, o.subtotal, 0) AS taxable_amount,
                    te.tax_amount,
                    te.created_at
               FROM tax_entries te
          LEFT JOIN orders o
                 ON te.source = 'webstore'
                AND (te.order_id = o.order_number OR te.order_id = CAST(o.id AS CHAR))
              WHERE te.created_at >= ?
                AND te.created_at < DATE_ADD(?, INTERVAL 1 DAY)
                AND te.source = 'webstore'
                AND te.state_code IN ('GA', 'NC', 'IN', 'MI', 'OH')
              ORDER BY te.state_code ASC, te.county_name ASC, te.created_at ASC, te.id ASC`,
            [`${startDate} 00:00:00`, `${endDate} 00:00:00`]
        );

        return rows.map((row) => {
            const enriched = this.enrichCounty(row);
            const stateCode = String(enriched.state_code || '').toUpperCase();
            return {
                ...enriched,
                state_code: stateCode,
                state_label: STATE_LABELS[stateCode] || stateCode,
                county_name: enriched.county_name || resolveCounty({
                    orderCounty: null,
                    zip: enriched.zip_code,
                    stateCode
                })
            };
        });
    }

    async buildExcelBuffer(startDate, endDate, stateCode = null) {
        const rows = await this.fetchReportRows(startDate, endDate);
        if (stateCode) {
            const code = String(stateCode).toUpperCase();
            const stateRows = rows.filter((r) => r.state_code === code);
            const buffer = await buildStateAccountantWorkbook(code, stateRows);
            return { buffer, rowCount: stateRows.length, rows: stateRows, stateCode: code };
        }
        const files = await buildAccountantWorkbooksByState(rows, { startDate, endDate });
        if (files.length === 1) {
            return {
                buffer: files[0].buffer,
                rowCount: files[0].rowCount,
                rows,
                files
            };
        }
        const buffer = files.length ? files[0].buffer : await buildAccountantWorkbook([]);
        return { buffer, rowCount: rows.length, rows, files };
    }

    async buildStateExcelFiles(startDate, endDate) {
        const rows = await this.fetchReportRows(startDate, endDate);
        const files = await buildAccountantWorkbooksByState(rows, { startDate, endDate });
        return { files, rowCount: rows.length, rows };
    }

    async wasScheduledReportSent(periodStart, periodEnd) {
        const [rows] = await this.pool.execute(
            `SELECT id FROM tax_report_deliveries
              WHERE period_start = ? AND period_end = ?
                AND trigger_type = 'scheduled'
              LIMIT 1`,
            [periodStart, periodEnd]
        );
        return rows.length > 0;
    }

    async logDelivery({ periodStart, periodEnd, triggerType, recipientEmail, rowCount }) {
        await this.pool.execute(
            `INSERT INTO tax_report_deliveries
                (period_start, period_end, trigger_type, recipient_email, row_count, sent_at)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [periodStart, periodEnd, triggerType, recipientEmail, rowCount]
        );
    }

    async sendReportEmail({ startDate, endDate, files, rowCount, recipientEmail }) {
        const mail = await getMailTransporter();
        const to = recipientEmail || getAccountantEmail();
        const periodLabel = `${startDate} through ${endDate}`;
        const subject = `H&M Herbs Online Sales Tax — ${periodLabel}`;
        const stateList = (files || []).map((f) => f.stateLabel).join(', ') || 'none';
        const attachmentCount = (files || []).length;
        const html = `
            <p>Hello,</p>
            <p>Attached are <strong>${attachmentCount}</strong> separate Excel workbook(s) for H&amp;M Herbs <strong>online (website) sales tax</strong> for <strong>${periodLabel}</strong>.</p>
            <p>States included: <strong>${stateList}</strong>. In-store/POS sales are <em>not</em> included — those are handled separately at the register.</p>
            <p>Each file is for one state, with transaction detail and county summaries for filing.</p>
            <p>Online transaction count: <strong>${rowCount}</strong></p>
            <p>— H&amp;M Herbs automated tax report</p>
        `.trim();
        const text = [
            `H&M Herbs online sales tax for ${periodLabel}.`,
            `${attachmentCount} Excel file(s): ${stateList}.`,
            `Online transactions: ${rowCount}. In-store sales excluded.`,
            'One spreadsheet per state is attached.'
        ].join('\n');

        if (!files?.length) {
            logger.warn('[tax-report] No state workbooks to email', { periodLabel });
            return {
                sent: false,
                skipped: true,
                reason: 'No online tax transactions in period',
                to,
                filenames: []
            };
        }

        const attachments = files.map((file) => ({
            filename: file.filename,
            content: file.buffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }));

        if (!mail) {
            logger.warn('[tax-report] Email skipped — SMTP not configured', { to, subject });
            return {
                sent: false,
                skipped: true,
                reason: 'SMTP not configured',
                to,
                filenames: attachments.map((a) => a.filename)
            };
        }

        await mail.transporter.sendMail({
            from: mail.from,
            to,
            subject,
            html,
            text,
            attachments
        });

        return { sent: true, to, filenames: attachments.map((a) => a.filename) };
    }

    /**
     * Sync ledger for each day in range, build Excel, and email accountant.
     */
    async deliverMonthlyReport({
        startDate,
        endDate,
        triggerType = 'manual',
        recipientEmail,
        skipIfScheduledAlreadySent = false,
        syncBeforeExport = true
    }) {
        const range = parseDateRange(startDate, endDate);
        const to = recipientEmail || getAccountantEmail();

        if (!to) {
            throw new Error('Accountant email is not configured');
        }

        if (skipIfScheduledAlreadySent && triggerType === 'scheduled') {
            const already = await this.wasScheduledReportSent(range.startDate, range.endDate);
            if (already) {
                return {
                    skipped: true,
                    reason: 'Scheduled report already sent for this period',
                    ...range
                };
            }
        }

        let syncSummary = null;
        if (syncBeforeExport) {
            syncSummary = await this.ledger.syncDateRange(range.startDate, range.endDate);
        }

        const { files, rowCount } = await this.buildStateExcelFiles(range.startDate, range.endDate);
        const emailResult = await this.sendReportEmail({
            startDate: range.startDate,
            endDate: range.endDate,
            files,
            rowCount,
            recipientEmail: to
        });

        if (emailResult.sent) {
            await this.logDelivery({
                periodStart: range.startDate,
                periodEnd: range.endDate,
                triggerType,
                recipientEmail: to,
                rowCount
            });
        }

        return {
            ...range,
            rowCount,
            stateFiles: (files || []).map((f) => ({
                stateCode: f.stateCode,
                stateLabel: f.stateLabel,
                filename: f.filename,
                rowCount: f.rowCount
            })),
            recipientEmail: to,
            email: emailResult,
            syncSummary,
            smtpConfigured: isSmtpConfigured()
        };
    }

    async deliverPreviousMonthReport(options = {}) {
        const range = getPreviousMonthRange(options.referenceDate || new Date());
        logger.info('[tax-report] Previous calendar month range', range);
        return this.deliverMonthlyReport({
            ...range,
            triggerType: options.triggerType || 'scheduled',
            recipientEmail: options.recipientEmail,
            skipIfScheduledAlreadySent: options.skipIfScheduledAlreadySent !== false,
            syncBeforeExport: options.syncBeforeExport !== false
        });
    }
}

module.exports = {
    TaxAccountantReportService,
    getAccountantEmail,
    getPreviousMonthRange,
    parseDateRange,
    buildAccountantWorkbook,
    buildStateAccountantWorkbook,
    buildAccountantWorkbooksByState,
    STATE_LABELS,
    TARGET_STATE_ORDER
};
