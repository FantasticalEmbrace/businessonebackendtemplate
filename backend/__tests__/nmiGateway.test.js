'use strict';

jest.mock('axios');
jest.mock('../utils/nmiEnv', () => ({
    getNmiTransactUrl: () => 'https://secure.nmi.com/api/transact.php'
}));

const axios = require('axios');
const { nmiSale, parseNmiBody } = require('../services/nmiGateway');

describe('parseNmiBody', () => {
    it('parses ampersand-separated gateway body', () => {
        const raw = 'response=1&responsetext=SUCCESS&transactionid=99&authcode=ABC';
        expect(parseNmiBody(raw)).toMatchObject({
            response: '1',
            responsetext: 'SUCCESS',
            transactionid: '99',
            authcode: 'ABC'
        });
    });
});

describe('nmiSale', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns ok when response=1', async () => {
        axios.post.mockResolvedValue({ data: 'response=1&responsetext=Approved&transactionid=12345&authcode=AUTH' });
        const r = await nmiSale({
            securityKey: 'test-key',
            amount: '10.00',
            paymentToken: 'tok-test'
        });
        expect(r.ok).toBe(true);
        expect(r.responseCode).toBe('1');
        expect(r.transactionId).toBe('12345');
        expect(axios.post).toHaveBeenCalledWith(
            'https://secure.nmi.com/api/transact.php',
            expect.stringContaining('payment_token=tok-test'),
            expect.any(Object)
        );
    });

    it('returns error payload when response is not 1', async () => {
        axios.post.mockResolvedValue({
            data: 'response=3&responsetext=Declined&transactionid=0'
        });
        const r = await nmiSale({
            securityKey: 'test-key',
            amount: '1.00',
            paymentToken: 'bad'
        });
        expect(r.ok).toBe(false);
        expect(r.responseText).toContain('Declined');
    });
});
