'use strict';

jest.mock('../services/nmiReversePayment', () => ({
    nmiReversePayment: jest.fn(),
}));
jest.mock('../services/mxmerchantGateway', () => ({
    voidPayment: jest.fn(),
    refundPayment: jest.fn(),
    getPayment: jest.fn(),
}));
jest.mock('../services/webCheckoutPayments', () => ({
    getCardAmountDueForOrder: jest.fn(),
}));
jest.mock('../services/storePaymentProcessor', () => ({
    normalizeStoreProcessor: (id) => String(id || 'epi').toLowerCase(),
    resolveProcessorCredentials: () => ({
        processor: 'epi',
        privateKey: 'test-private-key',
        transactUrl: 'https://secure.nmi.com/api/transact.php',
    }),
    resolvePosProcessorCredentials: () => ({
        processor: 'nmi',
        privateKey: 'test-pos-key',
        transactUrl: 'https://secure.nmi.com/api/transact.php',
    }),
    MX_PROCESSOR_ID: 'mxmerchant',
}));

const { nmiReversePayment } = require('../services/nmiReversePayment');
const { voidPayment, refundPayment } = require('../services/mxmerchantGateway');
const { getCardAmountDueForOrder } = require('../services/webCheckoutPayments');
const {
    isGatewayRefundableReference,
    reverseCardPayment,
    reverseOrderCardPayment,
} = require('../services/orderPaymentReversal');

describe('isGatewayRefundableReference', () => {
    it('rejects gift card and placeholder refs', () => {
        expect(isGatewayRefundableReference('gift_card:abc')).toBe(false);
        expect(isGatewayRefundableReference('pos:retry:1')).toBe(false);
        expect(isGatewayRefundableReference('')).toBe(false);
    });

    it('accepts processor transaction ids', () => {
        expect(isGatewayRefundableReference('12345678')).toBe(true);
        expect(isGatewayRefundableReference('mx-pay-99')).toBe(true);
    });
});

describe('reverseCardPayment', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('routes EPI through NMI auto reverse', async () => {
        nmiReversePayment.mockResolvedValue({ ok: true, operation: 'void' });
        const result = await reverseCardPayment({
            processor: 'epi',
            scope: 'website',
            transactionId: 'nmi-1',
            operation: 'auto',
        });
        expect(result.ok).toBe(true);
        expect(result.processor).toBe('epi');
        expect(nmiReversePayment).toHaveBeenCalled();
    });

    it('routes nmi through NMI refund for partial amounts', async () => {
        nmiReversePayment.mockResolvedValue({ ok: true, operation: 'refund' });
        await reverseCardPayment({
            processor: 'nmi',
            scope: 'pos',
            transactionId: 'nmi-2',
            amount: 5,
            operation: 'auto',
        });
        expect(nmiReversePayment).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'refund', amount: 5 })
        );
    });

    it('uses MX DELETE force refund for full reversal', async () => {
        refundPayment.mockResolvedValue({ ok: true, operation: 'refund_or_void' });
        const result = await reverseCardPayment({
            processor: 'mxmerchant',
            scope: 'website',
            paymentId: 'mx-1',
            operation: 'auto',
        });
        expect(refundPayment).toHaveBeenCalledWith('mx-1', 'website', {
            amount: null,
            force: true,
            paymentToken: undefined,
        });
        expect(result.ok).toBe(true);
    });

    it('uses MX void when operation is void', async () => {
        voidPayment.mockResolvedValue({ ok: true });
        await reverseCardPayment({
            processor: 'mxmerchant',
            paymentId: 'mx-2',
            operation: 'void',
        });
        expect(voidPayment).toHaveBeenCalledWith('mx-2', 'website', { force: false });
    });
});

describe('reverseOrderCardPayment', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getCardAmountDueForOrder.mockResolvedValue(25);
    });

    it('skips non-card references', async () => {
        const result = await reverseOrderCardPayment(null, {
            payment_reference: 'gift_card:xyz',
            payment_processor: 'epi',
            total_amount: 25,
        });
        expect(result.skipped).toBe(true);
        expect(nmiReversePayment).not.toHaveBeenCalled();
    });

    it('uses card tender amount from pool', async () => {
        nmiReversePayment.mockResolvedValue({ ok: true, operation: 'void' });
        const pool = {};
        await reverseOrderCardPayment(pool, {
            id: 1,
            payment_reference: 'txn-100',
            payment_processor: 'nmi',
            total_amount: 99,
            sales_channel: 'in_store',
        });
        expect(getCardAmountDueForOrder).toHaveBeenCalled();
        expect(nmiReversePayment).toHaveBeenCalledWith(
            expect.objectContaining({ transactionId: 'txn-100' })
        );
    });
});
