'use strict';

jest.mock('../utils/customPaymentEnv', () => ({
    isCustomPaymentEnabled: () => true,
    getCustomPaymentMinAmount: () => 1,
    getCustomPaymentMaxAmount: () => 25000,
    assertCustomPaymentAccess: () => {}
}));

jest.mock('../services/platformBillingRunner', () => ({
    isBillingDryRun: () => true
}));

const {
    validateAmount,
    validateDescription,
    chargeCustomPayment
} = require('../services/customPayment');

describe('customPayment', () => {
    test('validateAmount enforces min and max', () => {
        expect(() => validateAmount(0)).toThrow(/at least/i);
        expect(() => validateAmount(30000)).toThrow(/cannot exceed/i);
        expect(validateAmount(125.5)).toBe(125.5);
    });

    test('validateDescription requires meaningful text', () => {
        expect(() => validateDescription('ab')).toThrow(/describe/i);
        expect(validateDescription('  On-site install  ')).toBe('On-site install');
    });

    test('chargeCustomPayment dry run', async () => {
        const result = await chargeCustomPayment(null, {
            authorized: true,
            amount: 199.99,
            description: 'Extra hardware',
            businessName: 'Test Shop',
            billingEmail: 'pay@test.com',
            payment_token: 'tok_test'
        });
        expect(result.dryRun).toBe(true);
        expect(result.amount).toBe(199.99);
    });
});
