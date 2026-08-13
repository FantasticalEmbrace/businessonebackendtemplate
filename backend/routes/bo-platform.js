'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { getProductFeatures, WEBSITE_LOCKED_SECTIONS } = require('../config/productFeatures');

const BRANDING_PATH = path.join(__dirname, '..', '..', 'data', 'branding.json');

function readBranding() {
    try {
        return JSON.parse(fs.readFileSync(BRANDING_PATH, 'utf8'));
    } catch {
        return {
            storeName: 'Business One Merchant',
            tagline: 'Powered by Business One',
            logoUrl: '/images/business-one/logo-big.png',
            primaryColor: '#ff9b1f',
            accentColor: '#1f82ff',
            inkColor: '#0f172a',
            receiptFooter: 'Thank you for shopping with us'
        };
    }
}

function writeBranding(data) {
    const dir = path.dirname(BRANDING_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BRANDING_PATH, JSON.stringify(data, null, 2), 'utf8');
}

const BO_DEFAULTS = {
    storeName: 'Business One Merchant',
    tagline: 'Powered by Business One',
    logoUrl: '/images/business-one/logo-big.png',
    primaryColor: '#ff9b1f',
    accentColor: '#1f82ff',
    inkColor: '#0f172a',
    receiptFooter: 'Thank you for shopping with us'
};

/** Public — admin UI loads this before login chrome */
router.get('/features', (_req, res) => {
    const features = getProductFeatures();
    res.json({
        ...features,
        websiteLockedSections: WEBSITE_LOCKED_SECTIONS,
        branding: readBranding(),
        note: 'Default product is admin + POS — no website face until websiteEnabled'
    });
});

router.get('/branding', (_req, res) => {
    res.json({ branding: readBranding(), defaults: BO_DEFAULTS });
});

router.put('/branding', (req, res) => {
    const features = getProductFeatures();
    const body = req.body || {};
    const current = readBranding();
    const next = {
        ...current,
        storeName: body.storeName != null ? String(body.storeName).slice(0, 200) : current.storeName,
        tagline: body.tagline != null ? String(body.tagline).slice(0, 200) : current.tagline,
        logoUrl: body.logoUrl != null ? String(body.logoUrl).slice(0, 500) : current.logoUrl,
        primaryColor: body.primaryColor != null ? String(body.primaryColor).slice(0, 32) : current.primaryColor,
        accentColor: body.accentColor != null ? String(body.accentColor).slice(0, 32) : current.accentColor,
        inkColor: body.inkColor != null ? String(body.inkColor).slice(0, 32) : current.inkColor,
        receiptFooter:
            body.receiptFooter != null ? String(body.receiptFooter).slice(0, 300) : current.receiptFooter,
        updatedAt: new Date().toISOString()
    };

    // Full storefront color pack only when website is enabled; always allow name/logo/receipt
    if (!features.websiteEnabled) {
        next.primaryColor = current.primaryColor || BO_DEFAULTS.primaryColor;
        next.accentColor = current.accentColor || BO_DEFAULTS.accentColor;
        next.inkColor = current.inkColor || BO_DEFAULTS.inkColor;
    }

    writeBranding(next);
    res.json({ success: true, branding: next, websiteEnabled: features.websiteEnabled });
});

router.post('/branding/reset', (_req, res) => {
    const next = { ...BO_DEFAULTS, updatedAt: new Date().toISOString() };
    writeBranding(next);
    res.json({ success: true, branding: next });
});

/** Client phone settings → local PBX */
router.get('/phone-settings', async (_req, res) => {
    const features = getProductFeatures();
    if (!features.phonesEnabled) {
        return res.status(403).json({ error: 'Phone service is not on this plan' });
    }
    const { apiOrigin, merchantId, servicePin } = features.pbx;
    if (!merchantId) {
        return res.json({
            configured: false,
            message: 'Set PBX_MERCHANT_ID in .env (from Business One Phone admin)',
            settings: null
        });
    }
    try {
        const r = await fetch(`${apiOrigin}/api/config`, {
            headers: {
                'x-bo-pin': servicePin || '2468',
                'x-bo-merchant': merchantId
            }
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'PBX error');
        res.json({
            configured: true,
            merchantId,
            voicemail: data.voicemail,
            ivr: data.ivr,
            businessHours: data.businessHours || null,
            holdMusic: data.holdMusic || []
        });
    } catch (e) {
        res.status(502).json({ error: e.message || 'PBX unreachable', configured: false });
    }
});

router.patch('/phone-settings', async (req, res) => {
    const features = getProductFeatures();
    if (!features.phonesEnabled) {
        return res.status(403).json({ error: 'Phone service is not on this plan' });
    }
    const { apiOrigin, merchantId, servicePin } = features.pbx;
    if (!merchantId) {
        return res.status(400).json({ error: 'PBX_MERCHANT_ID not set' });
    }
    const headers = {
        'Content-Type': 'application/json',
        'x-bo-pin': servicePin || '2468',
        'x-bo-merchant': merchantId
    };
    const body = req.body || {};
    try {
        if (body.voicemail) {
            await fetch(`${apiOrigin}/api/voicemail`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify(body.voicemail)
            });
        }
        if (body.ivr) {
            await fetch(`${apiOrigin}/api/ivr`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify(body.ivr)
            });
        }
        if (body.businessHours) {
            await fetch(`${apiOrigin}/api/business-hours`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify(body.businessHours)
            });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(502).json({ error: e.message || 'PBX update failed' });
    }
});

module.exports = router;
