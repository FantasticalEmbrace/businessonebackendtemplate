'use strict';

const {
    computeProration,
    firstOfNextMonth,
    todayDateString
} = require('../services/platformBillingCalendar');

describe('platformBillingCalendar', () => {
    test('prorates mid-month signup', () => {
        const result = computeProration(300, new Date('2026-07-15T12:00:00'));
        expect(result.daysInMonth).toBe(31);
        expect(result.remainingDays).toBe(17);
        expect(result.proratedAmount).toBeCloseTo(164.52, 2);
        expect(result.nextBillDate).toBe('2026-08-01');
    });

    test('full month when signing up on the 1st', () => {
        const result = computeProration(100, new Date('2026-07-01T09:00:00'));
        expect(result.remainingDays).toBe(31);
        expect(result.proratedAmount).toBe(100);
    });

    test('firstOfNextMonth crosses year boundary', () => {
        expect(todayDateString(firstOfNextMonth(new Date('2026-12-20')))).toBe('2027-01-01');
    });
});
