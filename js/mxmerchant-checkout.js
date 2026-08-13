/**
 * MX browser-side 3-way payment helper.
 * Card data is posted directly to MX — never through HM Herbs servers.
 */
(function (global) {
    'use strict';

    function parseExpiry(expiry) {
        const raw = String(expiry || '').trim();
        const parts = raw.split('/');
        const month = String(parts[0] || '').replace(/\D/g, '').padStart(2, '0').slice(0, 2);
        let year = String(parts[1] || '').replace(/\D/g, '');
        if (year.length === 2) year = `20${year}`;
        return { expiryMonth: month, expiryYear: year };
    }

    function normalizeCardAccount(fields) {
        const { expiryMonth, expiryYear } = parseExpiry(fields.expiry);
        return {
            number: String(fields.number || '').replace(/\s/g, ''),
            expiryMonth,
            expiryYear,
            cvv: String(fields.cvv || '').trim(),
            avsZip: String(fields.avsZip || fields.postalCode || '').trim(),
            avsStreet: String(fields.avsStreet || fields.street || '').trim(),
        };
    }

    function isApprovedStatus(status) {
        const s = String(status || '').trim();
        return s === 'Approved' || s === 'Settled' || s === 'AuthOnly' || s === 'InProgress';
    }

    async function chargeCard({
        apiBaseUrl,
        sessionToken,
        merchantId,
        amount,
        cardAccount,
        clientReference,
        posData,
        paymentType = 'Sale',
        tenderType = 'Card',
    }) {
        const base = String(apiBaseUrl || '').replace(/\/+$/, '');
        const token = String(sessionToken || '').trim();
        const mid = merchantId;
        if (!base || !token || !mid) {
            throw new Error('MX session is not ready');
        }
        const url = `${base}/v3/payment?token=${encodeURIComponent(token)}`;
        const body = {
            merchantId: Number(mid) || mid,
            tenderType,
            paymentType,
            amount: Number(amount),
            cardAccount: normalizeCardAccount(cardAccount),
            source: 'API',
        };
        if (clientReference) body.clientReference = String(clientReference).slice(0, 17);
        if (posData) body.posData = posData;

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = data?.message || data?.errorCode || `Payment failed (${res.status})`;
            const err = new Error(msg);
            err.raw = data;
            throw err;
        }
        if (!isApprovedStatus(data?.status)) {
            const err = new Error(data?.authMessage || data?.status || 'Card declined');
            err.raw = data;
            throw err;
        }
        return {
            paymentId: data?.id != null ? String(data.id) : '',
            authCode: data?.authCode || '',
            last4: data?.cardAccount?.last4 || '',
            cardType: data?.cardAccount?.cardType || '',
            status: data?.status || '',
            raw: data,
        };
    }

    global.HmMxCheckout = {
        chargeCard,
        normalizeCardAccount,
        isApprovedStatus,
    };
})(typeof window !== 'undefined' ? window : globalThis);
