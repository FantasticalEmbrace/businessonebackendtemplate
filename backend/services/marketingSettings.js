'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'data', 'marketing-config.json');

function readConfig() {
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const j = JSON.parse(raw);
        return {
            signupLandingUrl: String(j.signupLandingUrl ?? ''),
            headline: String(j.headline ?? 'Sign up for Exclusive Discounts').trim().slice(0, 200)
        };
    } catch {
        return { signupLandingUrl: '', headline: 'Sign up for Exclusive Discounts' };
    }
}

function mergedPublicConfig() {
    const stored = readConfig();
    const envUrl = String(process.env.MAILCHIMP_SIGNUP_LANDING_URL ?? '').trim();
    return {
        signupLandingUrl: (stored.signupLandingUrl || '').trim() || envUrl,
        headline: stored.headline || 'Sign up for Exclusive Discounts'
    };
}

function saveConfig(partial = {}) {
    const prev = readConfig();
    const next = {
        signupLandingUrl: String(partial.signupLandingUrl ?? prev.signupLandingUrl ?? '').trim().slice(
            0,
            500
        ),
        headline: (
            String(partial.headline ?? prev.headline ?? '')
                .trim()
                .slice(0, 200) || 'Sign up for Exclusive Discounts'
        )
    };
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

function mailchimpEnvStatus() {
    const key = String(process.env.MAILCHIMP_API_KEY ?? '').trim();
    const aud = String(process.env.MAILCHIMP_AUDIENCE_ID ?? '').trim();
    let serverPrefix =
        String(process.env.MAILCHIMP_SERVER_PREFIX ?? process.env.SERVER_PREFIX ?? '').trim() || null;
    if (!serverPrefix && key.includes('-')) {
        serverPrefix = key.split('-').pop() || null;
    }
    return {
        configured: !!(key && aud),
        hasApiKey: !!key,
        hasAudienceId: !!aud,
        serverPrefix,
        signupLandingEnv: String(process.env.MAILCHIMP_SIGNUP_LANDING_URL ?? '').trim()
    };
}

module.exports = {
    CONFIG_PATH,
    readConfig,
    mergedPublicConfig,
    saveConfig,
    mailchimpEnvStatus
};
