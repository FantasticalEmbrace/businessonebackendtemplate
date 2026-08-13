'use strict';

jest.mock('../services/prochargeClient', () => ({
    voidSale: jest.fn(),
    refundToken: jest.fn()
}));

jest.mock('../services/platformBillingAccount', () => ({
    getAccountById: jest.fn()
}));

const { voidSale, refundToken } = require('../services/prochargeClient');
const { getAccountById } = require('../services/platformBillingAccount');
const { refundOrVoidCharge, compensateSignupBilling } = require('../services/prochargeRefunds');

function mockPool(rowsByQuery) {
    return {
        execute: jest.fn(async (sql, params) => {
            if (sql.includes('FROM billing_charges') && sql.includes('WHERE id = ?')) {
                const chargeId = params[0];
                const row = rowsByQuery.charges?.[chargeId];
                return [row ? [row] : []];
            }
            if (sql.includes("status = 'refunded'") && sql.includes('billing_charges')) {
                return [{ affectedRows: 1 }];
            }
            if (sql.includes('billing_build_contracts')) {
                return [{ affectedRows: 1 }];
            }
            if (sql.includes('billing_build_milestones')) {
                return [{ affectedRows: 1 }];
            }
            if (sql.includes('billing_accounts SET') && sql.includes('notes')) {
                return [{ affectedRows: 1 }];
            }
            return [[], {}];
        })
    };
}

describe('prochargeRefunds', () => {
    const originalDryRun = process.env.BILLING_DRY_RUN;

    afterEach(() => {
        process.env.BILLING_DRY_RUN = originalDryRun;
        jest.clearAllMocks();
    });

    test('refundOrVoidCharge voids when approval code is stored', async () => {
        process.env.BILLING_DRY_RUN = 'false';
        const pool = mockPool({
            charges: {
                42: {
                    id: 42,
                    account_id: 7,
                    charge_type: 'build_deposit',
                    amount: 375,
                    status: 'paid',
                    procharge_transaction_id: 'TX123',
                    procharge_approval_code: 'AUTH99',
                    refund_method: null
                }
            }
        });
        getAccountById.mockResolvedValue({
            id: 7,
            paymentMethodType: 'card',
            prochargeToken: 'tok_abc',
            billingEmail: 'a@b.com',
            businessName: 'Test Co'
        });
        voidSale.mockResolvedValue({ ok: true, transactionId: 'VOID1', approvalCode: 'AUTH99' });

        const result = await refundOrVoidCharge(pool, 7, 42, {
            description: 'Test refund'
        });

        expect(voidSale).toHaveBeenCalledWith({
            transactionId: 'TX123',
            approvalCode: 'AUTH99'
        });
        expect(refundToken).not.toHaveBeenCalled();
        expect(result.method).toBe('void');
        expect(result.amount).toBe(375);
    });

    test('refundOrVoidCharge falls back to token refund when void fails', async () => {
        process.env.BILLING_DRY_RUN = 'false';
        const pool = mockPool({
            charges: {
                55: {
                    id: 55,
                    account_id: 3,
                    charge_type: 'signup_proration',
                    amount: 50,
                    status: 'paid',
                    procharge_transaction_id: 'TX456',
                    procharge_approval_code: 'AUTH12',
                    refund_method: null
                }
            }
        });
        getAccountById.mockResolvedValue({
            id: 3,
            paymentMethodType: 'card',
            prochargeToken: 'tok_xyz',
            billingEmail: 'x@y.com',
            businessName: 'Shop'
        });
        voidSale.mockResolvedValue({ ok: false, responseText: 'Batch closed' });
        refundToken.mockResolvedValue({ ok: true, transactionId: 'RF789' });

        const result = await refundOrVoidCharge(pool, 3, 55);

        expect(refundToken).toHaveBeenCalledWith(
            expect.objectContaining({
                amount: 50,
                token: 'tok_xyz',
                transactionId: 'TX456',
                approvalCode: 'AUTH12'
            })
        );
        expect(result.method).toBe('refund');
    });

    test('compensateSignupBilling refunds signup charge ids and cancels build contract', async () => {
        process.env.BILLING_DRY_RUN = 'true';
        const pool = mockPool({
            charges: {
                10: {
                    id: 10,
                    account_id: 1,
                    charge_type: 'signup_proration',
                    amount: 25,
                    status: 'paid',
                    procharge_transaction_id: 'T1',
                    procharge_approval_code: 'A1',
                    refund_method: null
                }
            }
        });

        const signupBilling = {
            charges: [{ type: 'proration', chargeId: 10, ok: true }],
            buildContract: { contract: { id: 99 } }
        };

        const result = await compensateSignupBilling(pool, 1, signupBilling, {
            reason: 'Hardware failed'
        });

        expect(result.chargeIds).toEqual([10]);
        expect(result.refunded).toHaveLength(1);
        expect(pool.execute).toHaveBeenCalledWith(
            expect.stringContaining('billing_build_contracts'),
            expect.arrayContaining(['Hardware failed', 99, 1])
        );
    });
});
