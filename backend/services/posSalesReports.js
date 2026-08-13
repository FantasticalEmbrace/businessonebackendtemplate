'use strict';

const personnel = require('./posPersonnel');

function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
}

function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatShiftReport(report, reportType) {
    const shift = report.shift;
    const sales = report.sales || [];
    const totalSales = roundMoney(sales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0));
    return {
        reportType,
        title: reportType === 'x' ? 'Current shift summary' : reportType === 'z' ? 'End-of-shift summary' : reportType === 'day' ? 'Daily sales summary' : 'Shift report',
        isFinal: reportType === 'z',
        generatedAt: new Date().toISOString(),
        shift: {
            id: shift.id,
            employeeCode: shift.employee_code,
            employeeName: `${shift.first_name || ''} ${shift.last_name || ''}`.trim(),
            status: shift.status,
            openedAt: shift.opened_at,
            closedAt: shift.closed_at,
            openingCash: Number(shift.opening_cash) || 0,
            closingCash: shift.closing_cash != null ? Number(shift.closing_cash) : null,
            expectedCash: Number(report.expectedCash) || 0,
            overShortAmount: shift.over_short_amount != null ? Number(shift.over_short_amount) : null,
            cashSalesTotal: Number(shift.cash_sales_total) || 0,
            cardSalesTotal: Number(shift.card_sales_total) || 0,
            checkSalesTotal: Number(shift.check_sales_total) || 0,
            saleCount: sales.length,
            merchandiseTotal: totalSales
        },
        events: report.events || [],
        sales
    };
}

async function buildXReport(pool, shiftSessionId) {
    const report = await personnel.getShiftReport(pool, shiftSessionId);
    if (!report) return null;
    if (report.shift.status !== 'open') {
        const err = new Error('SHIFT_NOT_OPEN');
        err.code = 'SHIFT_NOT_OPEN';
        err.message = 'Current shift summary is only available for an open shift.';
        throw err;
    }
    return formatShiftReport(report, 'x');
}

async function buildZReport(pool, shiftSessionId) {
    const report = await personnel.getShiftReport(pool, shiftSessionId);
    if (!report) return null;
    return formatShiftReport(report, report.shift.status === 'open' ? 'x' : 'z');
}

async function getDaySalesSummary(pool, dateKey) {
    const date = String(dateKey || localDateKey()).slice(0, 10);
    const [totalsRows] = await pool.execute(
        `SELECT COUNT(*) AS order_count,
                COALESCE(SUM(subtotal), 0) AS subtotal,
                COALESCE(SUM(tax_amount), 0) AS tax_total,
                COALESCE(SUM(discount_amount), 0) AS discount_total,
                COALESCE(SUM(total_amount), 0) AS total_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) AS cash_total,
                COALESCE(SUM(CASE WHEN payment_method = 'check' THEN total_amount ELSE 0 END), 0) AS check_total,
                COALESCE(SUM(CASE WHEN payment_method = 'card_terminal' THEN total_amount ELSE 0 END), 0) AS card_total
         FROM orders
         WHERE sales_channel = 'in_store'
           AND payment_status = 'paid'
           AND DATE(created_at) = ?`,
        [date]
    );
    const totals = totalsRows[0] || {};
    const [refundRows] = await pool.execute(
        `SELECT COUNT(*) AS refund_count,
                COALESCE(SUM(total_amount), 0) AS refund_total
         FROM orders
         WHERE sales_channel = 'in_store'
           AND payment_status = 'refunded'
           AND DATE(updated_at) = ?`,
        [date]
    );
    const [openShiftRows] = await pool.execute(
        `SELECT COUNT(*) AS open_count FROM pos_shift_sessions WHERE status = 'open'`
    );
    const [shiftRows] = await pool.execute(
        `SELECT ss.id, ss.status, ss.opened_at, ss.closed_at,
                ss.cash_sales_total, ss.card_sales_total, ss.check_sales_total,
                e.employee_code, e.first_name, e.last_name
         FROM pos_shift_sessions ss
         JOIN pos_employees e ON e.id = ss.employee_id
         WHERE DATE(ss.opened_at) = ?
         ORDER BY ss.opened_at ASC`,
        [date]
    );
    return {
        reportType: 'day',
        title: 'Daily sales summary',
        date,
        generatedAt: new Date().toISOString(),
        totals: {
            orderCount: Number(totals.order_count) || 0,
            subtotal: roundMoney(totals.subtotal),
            taxTotal: roundMoney(totals.tax_total),
            discountTotal: roundMoney(totals.discount_total),
            totalSales: roundMoney(totals.total_sales),
            cashTotal: roundMoney(totals.cash_total),
            checkTotal: roundMoney(totals.check_total),
            cardTotal: roundMoney(totals.card_total),
            refundCount: Number(refundRows[0]?.refund_count) || 0,
            refundTotal: roundMoney(refundRows[0]?.refund_total)
        },
        openShiftCount: Number(openShiftRows[0]?.open_count) || 0,
        shifts: shiftRows
    };
}

module.exports = {
    localDateKey,
    buildXReport,
    buildZReport,
    getDaySalesSummary,
    formatShiftReport
};
