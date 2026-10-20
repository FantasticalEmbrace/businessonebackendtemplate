'use strict';

const logger = require('../utils/logger');
const EmailCampaignService = require('./email-campaign');
const { getStorefrontPublicBaseUrl } = require('../utils/storefrontUrl');
const { createNewsletterSubscribeToken } = require('../utils/newsletterSubscribeToken');
const { parseCheckoutMeta } = require('../utils/orderCheckoutMeta');
const { upsertAudienceMember } = require('./mailchimpAudience');

function normalizeEmail(email) {
    return String(email || '')
        .trim()
        .toLowerCase();
}

/**
 * Keep users.marketing_email_opt_in in sync with explicit newsletter consent.
 * Does not create users — only updates matching accounts.
 */
async function setUserMarketingEmailOptIn(pool, email, optIn) {
    const normalized = normalizeEmail(email);
    if (!normalized) return 0;
    try {
        const [result] = await pool.execute(
            `UPDATE users
                SET marketing_email_opt_in = ?,
                    updated_at = CURRENT_TIMESTAMP
              WHERE LOWER(TRIM(email)) = ?`,
            [optIn ? 1 : 0, normalized]
        );
        return Number(result?.affectedRows) || 0;
    } catch (err) {
        // Older schemas without the column should not break subscribe.
        if (err && err.errno === 1054) return 0;
        throw err;
    }
}

/**
 * Keep users.marketing_sms_opt_in in sync with explicit SMS marketing consent.
 * Affirmative opt-in only — does not create users.
 */
async function setUserMarketingSmsOptIn(pool, email, optIn) {
    const normalized = normalizeEmail(email);
    if (!normalized) return 0;
    try {
        const [result] = await pool.execute(
            `UPDATE users
                SET marketing_sms_opt_in = ?,
                    updated_at = CURRENT_TIMESTAMP
              WHERE LOWER(TRIM(email)) = ?`,
            [optIn ? 1 : 0, normalized]
        );
        return Number(result?.affectedRows) || 0;
    } catch (err) {
        if (err && err.errno === 1054) return 0;
        throw err;
    }
}

/**
 * Subscribe an email to the newsletter list. Idempotent — already-subscribed is OK.
 * Also sets marketing_email_opt_in=1 on any matching user account.
 * @returns {Promise<{ subscribed: boolean, alreadySubscribed?: boolean, usersUpdated?: number }>}
 */
async function subscribeEmail(
    pool,
    {
        email,
        firstName = null,
        lastName = null,
        source = 'website',
        signupIp = null,
        signupUserAgent = null,
        signupReferrer = null,
    } = {}
) {
    const normalized = normalizeEmail(email);
    if (!normalized) return { subscribed: false };

    const service = new EmailCampaignService(pool);
    const referrer = signupReferrer || source;
    let alreadySubscribed = false;

    try {
        await service.addSubscriber({
            email: normalized,
            first_name: firstName || null,
            last_name: lastName || null,
            campaign_id: null,
            signup_ip: signupIp,
            signup_user_agent: signupUserAgent,
            signup_referrer: referrer,
        });
    } catch (err) {
        if (err && String(err.message || '').includes('already subscribed')) {
            alreadySubscribed = true;
        } else {
            throw err;
        }
    }

    const usersUpdated = await setUserMarketingEmailOptIn(pool, normalized, true);
    return { subscribed: true, alreadySubscribed, usersUpdated };
}

async function unsubscribeEmail(pool, email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return { unsubscribed: false };

    const service = new EmailCampaignService(pool);
    const subscribers = await service.getSubscribers({ search: normalized, limit: 5 });
    let found = false;
    for (const row of subscribers || []) {
        if (normalizeEmail(row.email) !== normalized) continue;
        found = true;
        await service.updateSubscriberStatus(row.id, 'unsubscribed');
    }
    const usersUpdated = await setUserMarketingEmailOptIn(pool, normalized, false);
    return { unsubscribed: found || usersUpdated > 0, usersUpdated };
}

function buildNewsletterSubscribeUrl(email, { source = 'gift_card_recipient' } = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;

    const token = createNewsletterSubscribeToken(normalized, { source });
    if (!token) return null;

    const base = getStorefrontPublicBaseUrl();
    const params = new URLSearchParams({
        email: normalized,
        token,
        source: String(source),
    });
    return `${base}/newsletter-subscribe.html?${params.toString()}`;
}

async function resolveContactPhone(pool, orderRow) {
    const direct = String(orderRow?.phone || '').trim();
    if (direct) return direct;
    try {
        if (orderRow?.user_id) {
            const [byId] = await pool.execute('SELECT phone FROM users WHERE id = ? LIMIT 1', [orderRow.user_id]);
            const fromUser = String(byId[0]?.phone || '').trim();
            if (fromUser) return fromUser;
        }
        const email = normalizeEmail(orderRow?.email);
        if (email) {
            const [byEmail] = await pool.execute(
                `SELECT phone FROM users
                  WHERE LOWER(TRIM(email)) = ?
                    AND phone IS NOT NULL
                    AND TRIM(phone) <> ''
                  LIMIT 1`,
                [email]
            );
            const fromEmail = String(byEmail[0]?.phone || '').trim();
            if (fromEmail) return fromEmail;
        }
    } catch (err) {
        if (!err || err.errno !== 1054) {
            logger.warn('[mailchimp] phone lookup failed', { message: err?.message || String(err) });
        }
    }
    return null;
}

/**
 * Push checkout consent to the same Mailchimp audience used for newsletter signups.
 * Email marketing is subscribed only for an email opt-in.
 * Text opt-in sets SMS consent (or the phone merge field) and does not subscribe email by itself.
 * A Mailchimp failure must not throw — the paid order already succeeded.
 */
async function pushOrderConsentToMailchimp(pool, orderRow, { emailOptIn, smsOptIn, firstName, lastName }) {
    if (!emailOptIn && !smsOptIn) return;
    const email = normalizeEmail(orderRow?.email);
    if (!email) return;
    try {
        const phone = await resolveContactPhone(pool, orderRow);
        const result = await upsertAudienceMember(email, {
            firstName,
            lastName,
            phone,
            emailMarketing: Boolean(emailOptIn),
            smsConsent: Boolean(smsOptIn),
        });
        const log = result.ok ? logger.info.bind(logger) : logger.warn.bind(logger);
        log('[mailchimp] checkout consent', {
            orderId: orderRow.id,
            emailOptIn: Boolean(emailOptIn),
            smsOptIn: Boolean(smsOptIn),
            ok: Boolean(result.ok),
            already: Boolean(result.already),
            added: Boolean(result.added),
            phoneIncluded: Boolean(result.phoneOnContact),
            tagsSet: Boolean(result.tagsSet),
            smsConsentSet: Boolean(result.smsConsentSet),
            emailMarketingSet: Boolean(result.emailMarketingSet),
            smsApiSupported: result.smsApiSupported,
            phoneMergeTag: result.phoneMergeTag || null,
            reason: result.reason || null,
        });
    } catch (err) {
        logger.error('[mailchimp] checkout consent failed', {
            orderId: orderRow?.id,
            message: err?.message || String(err),
        });
    }
}

/**
 * After a web order is paid, honor checkout + gift-card giver newsletter opt-ins
 * and optional SMS marketing consent (stored on matching user accounts).
 */
async function processOrderNewsletterOptIns(pool, orderRow, orderItems = []) {
    if (!orderRow) return;

    const meta = parseCheckoutMeta(orderRow.notes);
    const email = normalizeEmail(orderRow.email);
    if (!email) return;

    const firstName = orderRow.shipping_first_name || orderRow.billing_first_name || null;
    const lastName = orderRow.shipping_last_name || orderRow.billing_last_name || null;

    const checkoutOptIn = Boolean(meta.newsletterOptIn);
    const smsOptIn = Boolean(meta.smsOptIn || meta.sms_opt_in || meta.marketingSmsOptIn);
    const giftCardGiverOptIn =
        Boolean(meta.giftCardGiverNewsletterOptIn) ||
        (Array.isArray(orderItems) &&
            orderItems.some((line) => {
                let parsed = line.metadata;
                if (typeof parsed === 'string') {
                    try {
                        parsed = JSON.parse(parsed);
                    } catch {
                        parsed = null;
                    }
                }
                const gc = parsed?.giftCard || parsed?.gift_card;
                return Boolean(gc?.newsletterOptIn || gc?.newsletter_opt_in);
            }));

    if (checkoutOptIn || giftCardGiverOptIn) {
        const source = checkoutOptIn ? 'checkout' : 'gift_card_giver';
        try {
            const result = await subscribeEmail(pool, {
                email,
                firstName,
                lastName,
                source,
            });
            logger.info('[newsletter] Order opt-in processed', {
                orderId: orderRow.id,
                email,
                source,
                alreadySubscribed: Boolean(result.alreadySubscribed),
                usersUpdated: result.usersUpdated || 0,
            });
        } catch (err) {
            logger.error('[newsletter] Order opt-in failed', {
                orderId: orderRow.id,
                email,
                source,
                message: err.message,
            });
        }
    }

    // Affirmative SMS opt-in only — leaving the box unchecked never opts someone out.
    // SMS-only consent stays in MySQL and is not written to email_subscribers.
    if (smsOptIn) {
        try {
            const usersUpdated = await setUserMarketingSmsOptIn(pool, email, true);
            logger.info('[newsletter] Order SMS opt-in processed', {
                orderId: orderRow.id,
                email,
                usersUpdated,
            });
        } catch (err) {
            logger.error('[newsletter] Order SMS opt-in failed', {
                orderId: orderRow.id,
                email,
                message: err.message,
            });
        }
    }

    await pushOrderConsentToMailchimp(pool, orderRow, {
        emailOptIn: checkoutOptIn || giftCardGiverOptIn,
        smsOptIn,
        firstName,
        lastName,
    });
}

module.exports = {
    subscribeEmail,
    unsubscribeEmail,
    setUserMarketingEmailOptIn,
    setUserMarketingSmsOptIn,
    buildNewsletterSubscribeUrl,
    processOrderNewsletterOptIns,
};
