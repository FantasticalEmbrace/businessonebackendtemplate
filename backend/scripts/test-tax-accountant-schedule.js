'use strict';

const assert = require('assert');
const { getPreviousMonthRange } = require('../services/taxAccountantReport');
const { shouldRunMonthlyReport } = require('../services/taxAccountantScheduler');

function check(label, actual, expected) {
    assert.strictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
}

// June 1 → all of May
let r = getPreviousMonthRange(new Date(2026, 5, 1, 8, 0, 0));
check('Jun 1 start', r.startDate, '2026-05-01');
check('Jun 1 end', r.endDate, '2026-05-31');

// January 1 → all of December prior year
r = getPreviousMonthRange(new Date(2026, 0, 1, 8, 0, 0));
check('Jan 1 start', r.startDate, '2025-12-01');
check('Jan 1 end', r.endDate, '2025-12-31');

// March 1 leap year → all of February
r = getPreviousMonthRange(new Date(2024, 2, 1, 8, 0, 0));
check('Mar 1 leap start', r.startDate, '2024-02-01');
check('Mar 1 leap end', r.endDate, '2024-02-29');

// Scheduler: 1st before 8 AM — wait
assert.strictEqual(shouldRunMonthlyReport(new Date(2026, 5, 1, 7, 59, 0)), false);
// 1st at 8:00 — run
assert.strictEqual(shouldRunMonthlyReport(new Date(2026, 5, 1, 8, 0, 0)), true);
// 1st at 3 PM — still run (retry / catch-up same day)
assert.strictEqual(shouldRunMonthlyReport(new Date(2026, 5, 1, 15, 30, 0)), true);
// 2nd — no
assert.strictEqual(shouldRunMonthlyReport(new Date(2026, 5, 2, 8, 0, 0)), false);

console.log('PASS tax accountant previous-month range and scheduler window');
