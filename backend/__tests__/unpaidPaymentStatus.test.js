'use strict';

const {
    nmiUnpaidOutcomeFromSale,
    markUnpaidPaymentOutcome,
} = require('../services/unpaidPaymentStatus');

describe('unpaidPaymentStatus', () => {
    test('NMI response=2 is declined', () => {
        expect(nmiUnpaidOutcomeFromSale({ responseCode: '2' })).toBe('declined');
        expect(nmiUnpaidOutcomeFromSale({ fields: { response: '2' } })).toBe('declined');
    });

    test('NMI response=3 and other non-2 are failed', () => {
        expect(nmiUnpaidOutcomeFromSale({ responseCode: '3' })).toBe('failed');
        expect(nmiUnpaidOutcomeFromSale({ responseCode: '' })).toBe('failed');
        expect(nmiUnpaidOutcomeFromSale(null)).toBe('failed');
    });

    test('markUnpaidPaymentOutcome rejects invalid status and skips paid rows', async () => {
        const calls = [];
        const pool = {
            execute: async (sql, binds) => {
                calls.push({ sql, binds });
                return [{ affectedRows: 0 }];
            },
        };
        const bad = await markUnpaidPaymentOutcome(pool, 1, 'pending');
        expect(bad.updated).toBe(false);
        expect(calls.length).toBe(0);

        await markUnpaidPaymentOutcome(pool, 42, 'declined');
        expect(calls[0].binds).toEqual(['declined', 42]);
        expect(calls[0].sql).toMatch(/status = 'pending'/);
        expect(calls[0].sql).toMatch(/payment_reference IS NULL/);
    });
});
