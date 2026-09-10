'use strict';

/**
 * Unit tests for admin chrome branding (default Business One vs merchant name+logo).
 */
const {
    isPlatformDefaultName,
    isPlatformDefaultLogo,
    resolveAdminChromeBranding,
    DEFAULT_CHROME_NAME,
} = require('../services/storeBranding');

function mockPool(settings = {}, { principal = false } = {}) {
    return {
        async execute(sql, params) {
            if (/FROM settings/i.test(sql) && /key_name IN/i.test(sql)) {
                const rows = (params || [])
                    .filter((k) => settings[k] != null && settings[k] !== '')
                    .map((k) => ({ key_name: k, value: settings[k] }));
                return [rows];
            }
            if (/FROM billing_accounts/i.test(sql)) {
                if (principal) {
                    return [[{ id: 1, account_key: 'default', status: 'active' }]];
                }
                return [[]];
            }
            return [[]];
        },
    };
}

describe('admin chrome branding', () => {
    test('platform default names/logos detected', () => {
        expect(isPlatformDefaultName('Business One')).toBe(true);
        expect(isPlatformDefaultName('Business One Admin')).toBe(true);
        expect(isPlatformDefaultName('Acme Auto')).toBe(false);
        expect(isPlatformDefaultLogo('/images/logo.png')).toBe(true);
        expect(isPlatformDefaultLogo('/images/business-one/logo-big.png?v=2')).toBe(true);
        expect(isPlatformDefaultLogo('https://cdn.example.com/acme-mark.png')).toBe(false);
    });

    test('defaults when no merchant branding', async () => {
        const chrome = await resolveAdminChromeBranding(mockPool({}));
        expect(chrome.useDefault).toBe(true);
        expect(chrome.displayName).toBe(DEFAULT_CHROME_NAME);
        expect(chrome.logoUrl).toBeNull();
    });

    test('defaults when only name is set (no custom logo)', async () => {
        const chrome = await resolveAdminChromeBranding(
            mockPool({ store_name: 'Acme Auto Repair' })
        );
        expect(chrome.useDefault).toBe(true);
        expect(chrome.displayName).toBe(DEFAULT_CHROME_NAME);
    });

    test('adopts merchant name+logo when both custom', async () => {
        const chrome = await resolveAdminChromeBranding(
            mockPool({
                store_name: 'Acme Auto Repair',
                store_logo_url: 'https://cdn.example.com/acme-icon.png',
            })
        );
        expect(chrome.useDefault).toBe(false);
        expect(chrome.displayName).toBe('Acme Auto Repair');
        expect(chrome.logoUrl).toBe('https://cdn.example.com/acme-icon.png');
    });

    test('pos_store_logo_url counts as logo', async () => {
        const chrome = await resolveAdminChromeBranding(
            mockPool({
                store_name: 'River Tire',
                pos_store_logo_url: '/uploads/river-tire.png',
            })
        );
        expect(chrome.useDefault).toBe(false);
        expect(chrome.displayName).toBe('River Tire');
        expect(chrome.logoUrl).toBe('/uploads/river-tire.png');
    });

    test('still adopts merchant branding when principal billing account exists', async () => {
        const chrome = await resolveAdminChromeBranding(
            mockPool(
                {
                    store_name: 'Acme Auto Repair',
                    store_logo_url: 'https://cdn.example.com/acme-icon.png',
                },
                { principal: true }
            )
        );
        expect(chrome.useDefault).toBe(false);
        expect(chrome.displayName).toBe('Acme Auto Repair');
        expect(chrome.isPrincipalStore).toBe(true);
    });
});
