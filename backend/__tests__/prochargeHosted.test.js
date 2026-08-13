'use strict';

const {
    buildHostedTokenizerUrl,
    getHostedFieldsClientConfig,
    isProchargeHostedTokenizerConfigured,
    isProchargeRequireHostedFields
} = require('../utils/prochargeHostedEnv');
const {
    hasRawCardFields,
    hasRawAchFields,
    assertNoRawPaymentData
} = require('../utils/paymentPayloadValidation');
const { getPlatformBillingClientConfig } = require('../services/platformBillingClientConfig');
const { isHostedPaymentToken } = require('../services/prochargeClient');

describe('prochargeHostedEnv', () => {
    const envBackup = { ...process.env };

    afterEach(() => {
        process.env = { ...envBackup };
    });

    it('builds CardPointe UAT card tokenizer URL with expiry and CVV', () => {
        process.env.PROCHARGE_HOSTED_TOKENIZER_HOST = 'fts-uat.cardconnect.com';
        delete process.env.PROCHARGE_HOSTED_TOKENIZER_URL;
        process.env.PROCHARGE_SANDBOX = '1';

        const url = buildHostedTokenizerUrl('card');
        expect(url).toContain('https://fts-uat.cardconnect.com/itoke/ajax-tokenizer.html');
        expect(url).toContain('useexpiry=true');
        expect(url).toContain('usecvv=true');
        expect(url).toContain('tokenizewheninactive=true');
        expect(url).toContain('css=');
        expect(url).toContain('formatinput=true');
    });

    it('builds ACH tokenizer URL with full mobile keyboard', () => {
        process.env.PROCHARGE_HOSTED_TOKENIZER_HOST = 'fts-uat.cardconnect.com';
        const url = buildHostedTokenizerUrl('ach');
        expect(url).toContain('fullmobilekeyboard=true');
    });

    it('reports hosted configured when tokenizer host is set', () => {
        process.env.PROCHARGE_HOSTED_TOKENIZER_HOST = 'fts-uat.cardconnect.com';
        expect(isProchargeHostedTokenizerConfigured()).toBe(true);
        const cfg = getHostedFieldsClientConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.cardTokenizerUrl).toContain('fts-uat.cardconnect.com');
        expect(cfg.messageOrigin).toBe('https://fts-uat.cardconnect.com');
    });
});

describe('paymentPayloadValidation', () => {
    const envBackup = { ...process.env };

    afterEach(() => {
        process.env = { ...envBackup };
    });

    it('detects raw card fields', () => {
        expect(hasRawCardFields({ cardNumber: '4111' })).toBe(true);
        expect(hasRawCardFields({ paymentToken: 'tok' })).toBe(false);
    });

    it('detects raw ACH fields', () => {
        expect(
            hasRawAchFields({ bankAccount: { routingNumber: '123', accountNumber: '456' } })
        ).toBe(true);
        expect(hasRawAchFields({ paymentToken: 'tok' })).toBe(false);
    });

    it('rejects raw card data when hosted fields are required', () => {
        process.env.PROCHARGE_HOSTED_TOKENIZER_HOST = 'fts-uat.cardconnect.com';
        expect(isProchargeRequireHostedFields()).toBe(true);
        expect(() => assertNoRawPaymentData({ cardNumber: '4111' })).toThrow(/hosted payment fields/i);
        expect(() => assertNoRawPaymentData({ paymentToken: 'tok' })).not.toThrow();
    });

    it('allows legacy raw card data when hosted fields are not configured', () => {
        delete process.env.PROCHARGE_HOSTED_TOKENIZER_HOST;
        delete process.env.PROCHARGE_HOSTED_TOKENIZER_URL;
        delete process.env.PROCHARGE_REQUIRE_HOSTED_FIELDS;
        expect(isProchargeRequireHostedFields()).toBe(false);
        expect(() => assertNoRawPaymentData({ cardNumber: '4111' })).not.toThrow();
    });
});

describe('prochargeClient hosted token routing', () => {
    it('detects CardPointe hosted iframe token shape', () => {
        expect(isHostedPaymentToken('9417111111111111')).toBe(true);
        expect(isHostedPaymentToken('950378768')).toBe(false);
        expect(isHostedPaymentToken('')).toBe(false);
    });
});

describe('platformBillingClientConfig', () => {
    const envBackup = { ...process.env };

    afterEach(() => {
        process.env = { ...envBackup };
    });

    it('exposes hosted fields before API credentials exist', () => {
        process.env.PROCHARGE_HOSTED_TOKENIZER_HOST = 'fts-uat.cardconnect.com';
        delete process.env.PROCHARGE_EMAIL;
        delete process.env.PROCHARGE_PASSWORD;
        delete process.env.PROCHARGE_APPLICATION_KEY;
        delete process.env.PROCHARGE_MERCHANT_NUMBER;

        const cfg = getPlatformBillingClientConfig({ signupEnabled: true });
        expect(cfg.hostedFields.enabled).toBe(true);
        expect(cfg.configured).toBe(false);
        expect(cfg.paymentReady).toBe(false);
        expect(cfg.enabled).toBe(false);
        expect(cfg.cardFields).toBe(false);
    });
});
