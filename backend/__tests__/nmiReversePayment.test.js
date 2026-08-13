'use strict';

jest.mock('../services/nmiGateway', () => ({
    nmiVoid: jest.fn(),
    nmiRefund: jest.fn(),
}));

const { nmiVoid, nmiRefund } = require('../services/nmiGateway');
const { nmiReversePayment } = require('../services/nmiReversePayment');

describe('nmiReversePayment', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('voids when operation is void', async () => {
        nmiVoid.mockResolvedValue({ ok: true, responseText: 'Voided' });
        const result = await nmiReversePayment({
            securityKey: 'key',
            transactionId: 'txn-1',
            operation: 'void',
        });
        expect(result.ok).toBe(true);
        expect(result.operation).toBe('void');
        expect(nmiVoid).toHaveBeenCalledWith(
            expect.objectContaining({ transactionId: 'txn-1' })
        );
        expect(nmiRefund).not.toHaveBeenCalled();
    });

    it('refunds when operation is refund', async () => {
        nmiRefund.mockResolvedValue({ ok: true, responseText: 'Refunded' });
        const result = await nmiReversePayment({
            securityKey: 'key',
            transactionId: 'txn-2',
            amount: 12.5,
            operation: 'refund',
        });
        expect(result.ok).toBe(true);
        expect(result.operation).toBe('refund');
        expect(nmiRefund).toHaveBeenCalledWith(
            expect.objectContaining({ transactionId: 'txn-2', amount: 12.5 })
        );
    });

    it('auto tries void first then refund', async () => {
        nmiVoid.mockResolvedValue({ ok: false, responseText: 'Settled' });
        nmiRefund.mockResolvedValue({ ok: true, responseText: 'Refunded' });
        const result = await nmiReversePayment({
            securityKey: 'key',
            transactionId: 'txn-3',
            operation: 'auto',
        });
        expect(nmiVoid).toHaveBeenCalled();
        expect(nmiRefund).toHaveBeenCalled();
        expect(result.ok).toBe(true);
        expect(result.operation).toBe('refund');
        expect(result.voidAttemptMessage).toBe('Settled');
    });
});
