'use strict';



const { getStorefrontPublicBaseUrl } = require('../utils/storefrontUrl');

const { sendMail } = require('../utils/mailTransporter');

const { resolveStoreBranding } = require('./storeBranding');

const { getProgramSettings, listTiers, getTierByKey, DEFAULT_TIERS, rowToTier } = require('./loyaltyTierProgram');

const {

    evaluateTierFromMetrics,

    evaluateCustomerTier,

    nextTier,

    progressTowardTier,

    isPointsMode,

    loadCustomerMetrics,

} = require('./loyaltyTierEngine');



const PROGRAM_INTRO_EMAIL_TYPE = 'program_intro';

const LOYALTY_RATE_CORRECTION_EMAIL_TYPE = 'loyalty_rate_correction';

const LOYALTY_RATE_CORRECTION_SUBJECT =
    'Quick update: corrected loyalty program tier rates';



function escapeHtml(str) {

    return String(str || '')

        .replace(/&/g, '&amp;')

        .replace(/</g, '&lt;')

        .replace(/>/g, '&gt;')

        .replace(/"/g, '&quot;');

}



function buildTierEmailHtml({ intro, ctaLabel, ctaUrl, branding }) {

    const b = branding || {};

    const colors = b.colors || {};

    const storeName = escapeHtml(b.storeName || 'Business One');

    const primary = colors.primary || '#2563eb';

    const accent = colors.accent || '#354c8e';

    const text = colors.text || '#333';

    const lightGreen = colors.lightGreen || '#eff6ff';

    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">

<tr><td align="center">

<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;">

<tr><td style="background:${primary};padding:20px 24px;color:#fff;font-size:20px;font-weight:bold;">${storeName}</td></tr>

<tr><td style="padding:24px;color:${text};font-size:15px;line-height:1.5;">

<p style="margin:0 0 16px;">${intro}</p>

<p style="margin:24px 0;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${accent};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">${escapeHtml(ctaLabel)}</a></p>

</td></tr>

<tr><td style="padding:16px 24px;background:${lightGreen};color:${text};font-size:12px;">Loyalty rewards from ${storeName}</td></tr>

</table></td></tr></table></body></html>`;

}



async function recordEmailSend(pool, { userId, email, emailType, tierKey, subject, metadata }) {

    await pool.execute(

        `INSERT INTO loyalty_email_sends (user_id, email, email_type, tier_key, subject, metadata)

         VALUES (?, ?, ?, ?, ?, ?)`,

        [userId, email, emailType, tierKey || null, subject, metadata ? JSON.stringify(metadata) : null]

    );

}



async function wasRecentlySent(pool, userId, emailType, withinDays = 14) {

    const [rows] = await pool.execute(

        `SELECT id FROM loyalty_email_sends

          WHERE user_id = ? AND email_type = ?

            AND sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY)

          LIMIT 1`,

        [userId, emailType, withinDays]

    );

    return rows.length > 0;

}



async function hasReceivedProgramIntro(pool, userId) {

    const [rows] = await pool.execute(

        `SELECT id FROM loyalty_email_sends

          WHERE user_id = ? AND email_type = ?

          LIMIT 1`,

        [userId, PROGRAM_INTRO_EMAIL_TYPE]

    );

    return rows.length > 0;

}



async function hasReceivedPromotionForTier(pool, userId, tierKey) {
    if (!tierKey) return false;
    const [rows] = await pool.execute(
        `SELECT id FROM loyalty_email_sends
          WHERE user_id = ? AND email_type = 'promotion' AND tier_key = ?
          LIMIT 1`,
        [userId, tierKey]
    );
    return rows.length > 0;
}

async function sendTierPromotionEmail(pool, userId, { fromTier, toTier, user, skipDedupe = false }) {
    const settings = await getProgramSettings(pool);
    if (!settings.enabled) return { sent: false, reason: 'program_disabled' };
    if (!settings.emailPromotionEnabled) return { sent: false, reason: 'disabled' };

    let resolvedUser = user;
    if (!resolvedUser?.email) {
        const [[row]] = await pool.execute(
            'SELECT id, email, first_name, customer_status FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        resolvedUser = row;
    }
    if (!resolvedUser?.email) return { sent: false, reason: 'no_email' };
    if (String(resolvedUser.customer_status || 'active').toLowerCase() !== 'active') {
        return { sent: false, reason: 'not_active' };
    }

    let tier = toTier;
    const tierKey = String(tier?.tierKey || tier || '').toLowerCase();
    if (!tier?.displayName && tierKey) {
        tier = (await getTierByKey(pool, tierKey)) || tier;
    }
    if (!tierKey) return { sent: false, reason: 'invalid_tier' };

    if (!skipDedupe && (await hasReceivedPromotionForTier(pool, userId, tierKey))) {
        return { sent: false, reason: 'already_sent', tierKey };
    }

    const branding = await resolveStoreBranding(pool);
    const tierLabel = tier?.displayName || tier?.tierKey || 'a new tier';
    const firstName = resolvedUser.first_name || 'there';
    const subject = `Congratulations — you're now ${tierLabel}!`;
    const intro = escapeHtml(
        `Hi ${firstName}, you've been promoted to <strong>${escapeHtml(tierLabel)}</strong> in our loyalty program. ` +
            `Enjoy your new perks on your next order.`
    );
    const html = buildTierEmailHtml({
        intro,
        ctaLabel: 'Shop now',
        ctaUrl: `${getStorefrontPublicBaseUrl()}/products.html`,
        branding,
    });

    const mailResult = await sendMail({ to: resolvedUser.email, subject, html });
    if (mailResult && mailResult.sent === false) {
        return { sent: false, reason: mailResult.reason || 'send_failed' };
    }

    await recordEmailSend(pool, {
        userId,
        email: resolvedUser.email,
        emailType: 'promotion',
        tierKey,
        subject,
        metadata: { fromTier, toTier: tierKey },
    });

    return { sent: true, tierKey, subject };
}

async function sendPendingTierPromotionEmails(pool, { dryRun = false, limit = 500 } = {}) {
    const settings = await getProgramSettings(pool);
    if (!settings.enabled || !settings.emailPromotionEnabled) {
        return { sent: 0, skipped: 0, errors: [], reason: 'disabled' };
    }

    const lim = Math.min(2000, Math.max(1, Number(limit) || 500));
    const [rows] = await pool.execute(
        `SELECT lth.user_id, lth.from_tier, lth.to_tier, u.email, u.first_name
           FROM loyalty_tier_history lth
           JOIN users u ON u.id = lth.user_id
          WHERE lth.reason = 'upgrade'
            AND u.email IS NOT NULL AND u.email != ''
            AND u.customer_status = 'active'
            AND NOT EXISTS (
                SELECT 1 FROM loyalty_email_sends s
                 WHERE s.user_id = lth.user_id
                   AND s.email_type = 'promotion'
                   AND s.tier_key = lth.to_tier
            )
          ORDER BY lth.created_at ASC
          LIMIT ${lim}`
    );

    const result = { sent: 0, skipped: 0, errors: [], dryRun: Boolean(dryRun) };
    const seen = new Set();

    for (const row of rows || []) {
        const dedupeKey = `${row.user_id}:${row.to_tier}`;
        if (seen.has(dedupeKey)) {
            result.skipped++;
            continue;
        }
        seen.add(dedupeKey);

        if (dryRun) {
            result.sent++;
            continue;
        }

        try {
            const toTier = await getTierByKey(pool, row.to_tier);
            const sendResult = await sendTierPromotionEmail(pool, row.user_id, {
                fromTier: row.from_tier,
                toTier,
                user: { email: row.email, first_name: row.first_name },
            });
            if (sendResult.sent) result.sent++;
            else result.skipped++;
        } catch (err) {
            result.errors.push({ userId: row.user_id, tier: row.to_tier, message: err?.message || String(err) });
        }
    }

    return result;
}

async function previewTierPromotionEmail(pool, { userId, fromTier = 'bronze', tierKey = 'silver', customerName } = {}) {
    const branding = pool ? await resolveStoreBranding(pool) : { storeName: 'Your Store' };
    const tiers = pool ? await listTiers(pool, { activeOnly: true }) : [];
    const key = String(tierKey || 'silver').toLowerCase();
    const toTier = tiers.find((t) => t.tierKey === key) || tiers[1] || tiers[0] || { tierKey: key, displayName: key };
    const user = {
        first_name: customerName || 'Friend',
        email: 'customer@example.com',
    };
    if (pool && userId) {
        const [[row]] = await pool.execute('SELECT first_name, email FROM users WHERE id = ? LIMIT 1', [userId]);
        if (row) {
            user.first_name = row.first_name || user.first_name;
            user.email = row.email || user.email;
        }
    }
    const tierLabel = toTier?.displayName || toTier?.tierKey || key;
    const fromLabel = String(fromTier || 'bronze');
    const subject = `Congratulations — you're now ${tierLabel}!`;
    const intro = escapeHtml(
        `Hi ${user.first_name}, you've been promoted from <strong>${escapeHtml(fromLabel)}</strong> to ` +
            `<strong>${escapeHtml(tierLabel)}</strong> in our loyalty program.`
    );
    const html = buildTierEmailHtml({
        intro,
        ctaLabel: 'Shop now',
        ctaUrl: `${getStorefrontPublicBaseUrl()}/products.html`,
        branding,
    });
    return {
        emailType: 'promotion',
        subject,
        previewText: `Promoted to ${tierLabel}`,
        html,
        text: `Congratulations, ${user.first_name}! You are now ${tierLabel}.`,
        tierKey: key,
    };
}


async function sendNearTierEmail(pool, user, metrics, nextTierRow, progress, settings) {

    if (!settings.emailNearEnabled) return { sent: false, reason: 'disabled' };

    if (await wasRecentlySent(pool, user.id, 'near_tier', 21)) return { sent: false, reason: 'recent' };

    const branding = await resolveStoreBranding(pool);

    const firstName = user.first_name || 'there';

    const tierName = nextTierRow.displayName || nextTierRow.tierKey;

    const subject = `You're almost ${tierName}!`;

    const perkLine = isPointsMode(settings?.programMode ?? settings?.mode)
        ? `${nextTierRow.pointsMultiplierPercent ?? nextTierRow.discountPercent ?? 0}% bonus points`
        : `${nextTierRow.cashbackPercent ?? nextTierRow.cashBackPercent ?? nextTierRow.discountPercent ?? 0}% cash back`;

    const intro = escapeHtml(

        `Hi ${firstName}, you're ${progress.percent}% of the way to <strong>${escapeHtml(tierName)}</strong>. ` +

            `Keep shopping to unlock ${perkLine}` +

            (nextTierRow.freeShipping ? ' and free shipping' : '') +

            '.'

    );

    const html = buildTierEmailHtml({

        intro,

        ctaLabel: 'Continue shopping',

        ctaUrl: `${getStorefrontPublicBaseUrl()}/products.html`,

        branding,

    });

    await sendMail({ to: user.email, subject, html });

    await recordEmailSend(pool, {

        userId: user.id,

        email: user.email,

        emailType: 'near_tier',

        tierKey: nextTierRow.tierKey,

        subject,

        metadata: { progress },

    });

    return { sent: true };

}



async function sendWinbackEmail(pool, user, settings) {

    if (!settings.emailWinbackEnabled) return { sent: false, reason: 'disabled' };

    if (await wasRecentlySent(pool, user.id, 'winback', 30)) return { sent: false, reason: 'recent' };

    const branding = await resolveStoreBranding(pool);

    const firstName = user.first_name || 'there';

    const subject = 'We miss you — your loyalty perks are waiting';

    const intro = escapeHtml(

        `Hi ${firstName}, it's been a while since your last order. ` +

            `Your loyalty tier perks are still active — come back and save on your favorites.`

    );

    const html = buildTierEmailHtml({

        intro,

        ctaLabel: 'Shop now',

        ctaUrl: `${getStorefrontPublicBaseUrl()}/products.html`,

        branding,

    });

    await sendMail({ to: user.email, subject, html });

    await recordEmailSend(pool, {

        userId: user.id,

        email: user.email,

        emailType: 'winback',

        tierKey: null,

        subject,

        metadata: {},

    });

    return { sent: true };

}



async function sendManualEmail(pool, userId, { subject, message }) {

    const [[user]] = await pool.execute('SELECT id, email, first_name FROM users WHERE id = ?', [userId]);

    if (!user?.email) return { sent: false, reason: 'no_email' };

    const branding = await resolveStoreBranding(pool);

    const finalSubject = subject || `A note from ${branding.storeName || 'your store'}`;

    const intro = escapeHtml(`Hi ${user.first_name || 'there'},</p><p>${escapeHtml(message)}`);

    const html = buildTierEmailHtml({

        intro,

        ctaLabel: 'Visit store',

        ctaUrl: `${getStorefrontPublicBaseUrl()}/products.html`,

        branding,

    });

    await sendMail({ to: user.email, subject: finalSubject, html });

    await recordEmailSend(pool, {

        userId,

        email: user.email,

        emailType: 'manual',

        tierKey: null,

        subject: finalSubject,

        metadata: { message },

    });

    return { sent: true };

}



async function processLoyaltyEmails(pool, { dryRun = false } = {}) {

    const settings = await getProgramSettings(pool);

    if (!settings.enabled) return { sent: 0, skipped: 0, dryRun };

    // program_intro is sent only on program enable or new signup — not from this scheduler path.



    const tiers = await listTiers(pool, { activeOnly: true });

    const result = { sent: 0, skipped: 0, dryRun, details: [] };



    const [users] = await pool.execute(

        `SELECT u.id, u.email, u.first_name, u.last_name, u.total_orders, u.lifetime_value, u.last_order_at,

                cl.tier, cl.points_balance

           FROM users u

           LEFT JOIN customer_loyalty cl ON cl.user_id = u.id

          WHERE u.email IS NOT NULL AND u.email != '' AND u.customer_status = 'active'

            AND u.marketing_opt_in = 1`

    );



    for (const user of users || []) {

        const metrics = await loadCustomerMetrics(pool, user.id);

        if (!metrics) continue;

        const currentTier = evaluateTierFromMetrics(tiers, metrics, settings.programMode ?? settings.mode);

        const currentKey = currentTier?.tierKey || 'bronze';

        const nxt = nextTier(tiers, currentKey);



        if (nxt) {

            const progress = progressTowardTier(metrics, nxt, settings.programMode ?? settings.mode);

            if (progress.percent >= settings.nearThresholdPercent && progress.percent < 100) {

                if (dryRun) {

                    result.details.push({ userId: user.id, type: 'near_tier', wouldSend: true });

                } else {

                    try {

                        const r = await sendNearTierEmail(pool, user, metrics, nxt, progress, settings);

                        if (r.sent) result.sent += 1;

                        else result.skipped += 1;

                    } catch {

                        result.skipped += 1;

                    }

                }

            }

        }



        if (user.last_order_at) {

            const [[daysRow]] = await pool.execute(`SELECT DATEDIFF(NOW(), ?) AS days_since`, [

                user.last_order_at,

            ]);

            const daysSince = Number(daysRow?.days_since) || 0;

            if (daysSince >= settings.winbackDays && metrics.orderCount > 0) {

                if (dryRun) {

                    result.details.push({ userId: user.id, type: 'winback', wouldSend: true });

                } else {

                    try {

                        const r = await sendWinbackEmail(pool, user, settings);

                        if (r.sent) result.sent += 1;

                        else result.skipped += 1;

                    } catch {

                        result.skipped += 1;

                    }

                }

            }

        }

    }



    return result;

}



/** Email type for the program explainer. Recorded in loyalty_email_sends; never sent by processLoyaltyEmails. */



function trimNumber(n) {

    const x = Number(n);

    if (!Number.isFinite(x)) return '0';

    if (Number.isInteger(x)) return String(x);

    return String(Math.round(x * 100) / 100);

}



function formatUsd(n) {

    const x = Number(n) || 0;

    const rounded = Math.round(x * 100) / 100;

    const noCents = Number.isInteger(rounded);

    return `$${rounded.toLocaleString('en-US', {

        minimumFractionDigits: noCents ? 0 : 2,

        maximumFractionDigits: noCents ? 0 : 2,

    })}`;

}



function pointsForOneDollar(dollarPerPoint) {

    const dpp = Number(dollarPerPoint) || 0.01;

    if (dpp <= 0) return 100;

    return Math.round(1 / dpp);

}



function displayPointsMultiplier(tier) {

    const m = Number(tier?.discountPercent ?? tier?.cashbackPercent) || 0;

    return m > 0 ? m : 1;

}



function describeCashQualify(tier) {

    const spend = Number(tier.minLifetimeSpend ?? tier.minSpend) || 0;

    const orders = Number(tier.minOrderCount ?? tier.minOrders) || 0;

    if (spend <= 0 && orders <= 0) return 'Starting membership';

    const spendPart = spend > 0 ? `${formatUsd(spend)} lifetime spend` : null;

    const ordersPart = orders > 0 ? `${orders} paid order${orders === 1 ? '' : 's'}` : null;

    if (spendPart && ordersPart) {

        return tier.requireBothSpendAndOrders || tier.requiresBothGoals

            ? `${spendPart} and ${ordersPart}`

            : `${spendPart} or ${ordersPart}`;

    }

    return spendPart || ordersPart;

}



function describeFreeShipping(tier) {

    if (!tier?.freeShipping) return '—';

    const min = tier.freeShippingMinOrder;

    if (min == null || Number(min) <= 0) return 'On every order';

    return `Orders ${formatUsd(min)}+`;

}



function tierRequiresBothGoals(tier) {

    return Boolean(tier?.requireBothSpendAndOrders || tier?.requiresBothGoals);

}



function formatCashTierRequirementsText(tier) {

    const spend = Number(tier.minLifetimeSpend ?? tier.minSpend) || 0;

    const orders = Number(tier.minOrderCount ?? tier.minOrders) || 0;

    if (spend <= 0 && orders <= 0) return 'Starting membership (no spend or order minimum)';

    const parts = [];

    if (spend > 0) parts.push(`${formatUsd(spend)} lifetime spend`);

    if (orders > 0) parts.push(`${orders} paid order${orders === 1 ? '' : 's'}`);

    let suffix = '';

    if (spend > 0 && orders > 0) {

        suffix = tierRequiresBothGoals(tier)

            ? '. Must meet both to reach this tier'

            : '. Meet either one to qualify';

    }

    return parts.join('; ') + suffix;

}



function formatCashTierRequirementsHtml(tier) {

    const spend = Number(tier.minLifetimeSpend ?? tier.minSpend) || 0;

    const orders = Number(tier.minOrderCount ?? tier.minOrders) || 0;

    if (spend <= 0 && orders <= 0) {

        return 'Starting membership<br><span style="font-size:13px;color:#4b5563;">No spend or order minimum</span>';

    }

    const lines = [];

    if (spend > 0) lines.push(`${formatUsd(spend)} lifetime spend`);

    if (orders > 0) lines.push(`${orders} paid order${orders === 1 ? '' : 's'}`);

    let footer = '';

    if (spend > 0 && orders > 0) {

        footer = tierRequiresBothGoals(tier)

            ? '<br><span style="font-size:13px;color:#4b5563;">Must meet both to reach this tier</span>'

            : '<br><span style="font-size:13px;color:#4b5563;">Meet either one to qualify</span>';

    }

    return lines.join('<br>') + footer;

}



function formatCashTierCashbackText(tier, combinedSpendFrequencyBonus) {

    const base = Number(tier.cashbackPercent ?? tier.discountPercent) || 0;

    const bonus = Number(tier.frequencyBonusPercent) || 0;

    if (base <= 0) return 'No cash-back rate at this tier';

    if (bonus > 0 && combinedSpendFrequencyBonus !== false) {

        const total = Math.round((base + bonus) * 100) / 100;

        return `${trimNumber(base)}% base; ${trimNumber(total)}% total when both spend and order goals are met (+${trimNumber(bonus)}%)`;

    }

    return `${trimNumber(base)}% cash back`;

}



function formatCashTierCashbackHtml(tier, combinedSpendFrequencyBonus) {

    const base = Number(tier.cashbackPercent ?? tier.discountPercent) || 0;

    const bonus = Number(tier.frequencyBonusPercent) || 0;

    if (base <= 0) return '—';

    if (bonus > 0 && combinedSpendFrequencyBonus !== false) {

        const total = Math.round((base + bonus) * 100) / 100;

        return `${trimNumber(base)}% base<br>+${trimNumber(bonus)}% frequency bonus when both spend and order goals met<br><strong>${trimNumber(total)}% total</strong>`;

    }

    return `${trimNumber(base)}% cash back`;

}



function formatPointsTierEarnText(tier, pointsPerDollar, dollarPerPoint) {

    const ppd = Number(pointsPerDollar) > 0 ? Number(pointsPerDollar) : 1;

    const mult = displayPointsMultiplier(tier);

    const effective = Math.round(ppd * mult * 100) / 100;

    const ptsRedeem = pointsForOneDollar(dollarPerPoint);

    return `${trimNumber(mult)}× multiplier (${trimNumber(effective)} pt${effective === 1 ? '' : 's'} per $1). Redeem: ${ptsRedeem} pts = $1`;

}



function formatPointsTierEarnHtml(tier, pointsPerDollar, dollarPerPoint) {

    const ppd = Number(pointsPerDollar) > 0 ? Number(pointsPerDollar) : 1;

    const mult = displayPointsMultiplier(tier);

    const effective = Math.round(ppd * mult * 100) / 100;

    const ptsRedeem = pointsForOneDollar(dollarPerPoint);

    return `${trimNumber(mult)}× multiplier<br>${trimNumber(effective)} pt${effective === 1 ? '' : 's'} per $1<br>${ptsRedeem} pts = $1`;

}



function defaultIntroUrls() {

    const base = getStorefrontPublicBaseUrl();

    return {

        accountUrl: `${base}/account.html#loyalty`,

        shopUrl: `${base}/products.html`,

        homeUrl: `${base}/index.html`,

    };

}



/**

 * Copy for the program explainer. Branches on cashback vs points.

 * Suitable for existing customers who never received an intro and for new accounts.

 */

function buildProgramIntroCopy({

    programMode,

    storeName,

    customerName,

    tierName,

    cashbackRate,

    pointsPerDollar,

    dollarPerPoint,

    pointsMultiplier,

    minCashbackRedeem,

    combinedSpendFrequencyBonus,

    currentTierHasFreeShipping,

    freeShippingMinOrder,

    storePhone,

}) {

    const isPoints = String(programMode || '').toLowerCase() === 'points';

    const name = customerName || 'there';

    const store = storeName || 'our store';

    const tier = tierName || 'Bronze';

    const phone = storePhone || '';

    const ppd = Number(pointsPerDollar) > 0 ? Number(pointsPerDollar) : 1;

    const mult = Number(pointsMultiplier) > 0 ? Number(pointsMultiplier) : 1;

    const effectivePpd = Math.round(ppd * mult * 100) / 100;

    const ptsPerDollar = pointsForOneDollar(dollarPerPoint);

    const rate = Number(cashbackRate) || 0;



    const subject = isPoints

        ? `How rewards points work at ${store}`

        : `How cash back works at ${store}`;



    const previewText = isPoints

        ? `Earn points on paid orders. Redeem them for dollars off at checkout — no extra signup.`

        : `A percentage of each paid order returns as store credit. Apply it the next time you shop.`;



    const greeting = `Hello ${name},`;



    const opening =

        `This is a short note on how rewards work at ${store}. If you already have an account, you are in the program — there is nothing separate to join. ` +

        `Whether you order once in a while or keep a full shelf at home, paid purchases earn the reward, and the reward is yours to use later.`;



    let earnHeading;

    let earnBody;

    let useHeading;

    let useBody;

    let rateSentence;

    let extraPerk = '';



    if (isPoints) {

        earnHeading = 'How you earn points';

        earnBody =

            `On each paid order, you earn ${trimNumber(ppd)} point${ppd === 1 ? '' : 's'} per dollar of eligible merchandise. ` +

            `Your tier can multiply that rate, so the same order is worth more as you move up. ` +

            `Points are posted after the order is paid — they are not an instant checkout discount.`;

        useHeading = 'How you use them';

        useBody =

            `At checkout, redeem points for dollars off. Right now ${ptsPerDollar} points equal $1. ` +

            `Use as many as you like toward an order; unused points remain on your account. ` +

            `Your balance is always visible under Rewards in your account.`;

        rateSentence =

            `You are currently ${tier}. At this tier you earn ${trimNumber(effectivePpd)} point${effectivePpd === 1 ? '' : 's'} per dollar.`;

    } else {

        earnHeading = 'How you earn cash back';

        earnBody =

            `After a paid order, a percentage of the eligible merchandise subtotal is credited to your account as store credit. ` +

            `That credit is not taken off the order you just placed; it is waiting for the next one. ` +

            `The rate follows your tier — Bronze, Silver, Gold, or Platinum.`;

        useHeading = 'How you use it';

        const min = Number(minCashbackRedeem) || 0;

        const minLine =

            min > 0

                ? ` Store credit can be applied once your balance reaches ${formatUsd(min)}.`

                : ` There is no minimum — apply whatever credit you have.`;

        useBody =

            `At checkout, apply available store credit toward a future order.${minLine} ` +

            `Unused credit stays on your account. You can check the balance anytime under Rewards.`;

        rateSentence =

            rate > 0

                ? `You are currently ${tier}. At this tier you earn ${trimNumber(rate)}% back on eligible merchandise.`

                : `You are currently ${tier}. Cash back begins at the next tier that carries a rate; the orders you place still count toward it.`;

    }



    if (currentTierHasFreeShipping) {

        const minShip = Number(freeShippingMinOrder);

        const shipLine =

            minShip > 0

                ? `Your tier also includes free shipping on orders of ${formatUsd(minShip)} or more.`

                : `Your tier also includes free shipping on every order.`;

        extraPerk = extraPerk ? `${extraPerk} ${shipLine}` : shipLine;

    }



    const tiersHeading = 'Bronze, Silver, Gold, Platinum';

    const tiersIntro = isPoints

        ? `Your tier is based on lifetime points earned. Each row lists the minimum points to reach the tier, the earn multiplier, effective points per dollar spent, and redemption value (${ptsPerDollar} points = $1). Free shipping rules are listed where they apply.`

        : combinedSpendFrequencyBonus !== false

          ? `Your tier is based on lifetime spend and paid order count. Each row lists the exact dollar spend and paid-order count required, whether you must meet one or both to reach that tier, the base cash-back percentage, and — when both spend and order goals are met — the frequency bonus percentage and combined total rate. Free shipping rules are listed where they apply.`

          : `Your tier is based on lifetime spend and paid order count. Each row lists the exact dollar spend and paid-order count required, whether you must meet one or both to reach that tier, and the cash-back percentage. Free shipping rules are listed where they apply.`;



    const closing =

        `Shop when you need something. Rewards accumulate with ordinary orders; you do not have to change how you buy to take part.`;



    const signoff = phone

        ? `If something in your account looks off, call us at ${phone} or reply to this email. We would rather sort it out than have you guess.`

        : `If something in your account looks off, reply to this email. We would rather sort it out than have you guess.`;



    return {

        emailType: PROGRAM_INTRO_EMAIL_TYPE,

        programMode: isPoints ? 'points' : 'cashback',

        subject,

        previewText,

        greeting,

        opening,

        earnHeading,

        earnBody,

        useHeading,

        useBody,

        tiersHeading,

        tiersIntro,

        rateSentence,

        extraPerk,

        closing,

        signoff,

        ctaPrimaryLabel: 'View my rewards',

        ctaSecondaryLabel: 'Continue shopping',

        footerNote: `Rewards from ${store}`,

    };

}



function renderIntroTierRowsHtml(tiers, isPoints, colors, settings = {}) {

    const combinedBonus = settings.combinedSpendFrequencyBonus !== false;

    const pointsPerDollar = Number(settings.pointsPerDollar) > 0 ? Number(settings.pointsPerDollar) : 1;

    const dollarPerPoint = Number(settings.dollarPerPoint) || 0.01;

    const rows = (tiers || [])

        .filter((t) => t.isActive !== false)

        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))

        .map((t) => {

            const name = escapeHtml(t.displayName || t.tierKey || '');

            const ship = escapeHtml(describeFreeShipping(t));

            if (isPoints) {

                const minPts = Number(t.minPoints) || 0;

                const earn = formatPointsTierEarnHtml(t, pointsPerDollar, dollarPerPoint);

                return `<tr>

                <td style="padding:8px 10px;border-bottom:1px solid ${colors.border};font-weight:600;">${name}</td>

                <td style="padding:8px 10px;border-bottom:1px solid ${colors.border};">${minPts} pts</td>

                <td style="padding:8px 10px;border-bottom:1px solid ${colors.border};">${earn}</td>

                <td style="padding:8px 10px;border-bottom:1px solid ${colors.border};">${ship}</td>

            </tr>`;

            }

            const requirements = formatCashTierRequirementsHtml(t);

            const cashback = formatCashTierCashbackHtml(t, combinedBonus);

            return `<tr>

                <td style="padding:8px 10px;border-bottom:1px solid ${colors.border};font-weight:600;">${name}</td>

                <td style="padding:8px 10px;border-bottom:1px solid ${colors.border};">${requirements}</td>

                <td style="padding:8px 10px;border-bottom:1px solid ${colors.border};">${cashback}</td>

                <td style="padding:8px 10px;border-bottom:1px solid ${colors.border};">${ship}</td>

            </tr>`;

        })

        .join('');

    const col2 = isPoints ? 'Min points' : 'Requirements';

    const col3 = isPoints ? 'Earn & redeem' : 'Cash back';

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-size:14px;margin:12px 0 16px;color:${colors.text};">

        <thead>

            <tr>

                <th align="left" style="padding:8px 10px;border-bottom:2px solid ${colors.border};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${colors.textMuted};">Tier</th>

                <th align="left" style="padding:8px 10px;border-bottom:2px solid ${colors.border};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${colors.textMuted};">${col2}</th>

                <th align="left" style="padding:8px 10px;border-bottom:2px solid ${colors.border};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${colors.textMuted};">${col3}</th>

                <th align="left" style="padding:8px 10px;border-bottom:2px solid ${colors.border};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${colors.textMuted};">Shipping</th>

            </tr>

        </thead>

        <tbody>${rows}</tbody>

    </table>`;

}



function renderIntroTierRowsText(tiers, isPoints, settings = {}) {

    const combinedBonus = settings.combinedSpendFrequencyBonus !== false;

    const pointsPerDollar = Number(settings.pointsPerDollar) > 0 ? Number(settings.pointsPerDollar) : 1;

    const dollarPerPoint = Number(settings.dollarPerPoint) || 0.01;

    return (tiers || [])

        .filter((t) => t.isActive !== false)

        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))

        .map((t) => {

            const name = t.displayName || t.tierKey;

            const ship = describeFreeShipping(t);

            if (isPoints) {

                const minPts = Number(t.minPoints) || 0;

                const earn = formatPointsTierEarnText(t, pointsPerDollar, dollarPerPoint);

                return `• ${name} — ${minPts} points to qualify. ${earn}. Shipping: ${ship}`;

            }

            const requirements = formatCashTierRequirementsText(t);

            const cashback = formatCashTierCashbackText(t, combinedBonus);

            return `• ${name} — ${requirements}. ${cashback}. Shipping: ${ship}`;

        })

        .join('\n');

}



function buildProgramIntroEmailHtml({ copy, branding, tiers, isPoints, accountUrl, shopUrl, homeUrl, settings }) {

    const b = branding || {};

    const colors = b.colors || {};

    const storeName = escapeHtml(b.storeName || 'Business One');

    const primary = colors.primary || '#2563eb';

    const primaryDark = colors.primaryDark || '#1d4ed8';

    const text = colors.text || '#111827';

    const textMuted = colors.textMuted || '#4b5563';

    const border = colors.border || '#e5e7eb';

    const pageBg = colors.pageBg || '#f3f4f6';

    const lightGreen = colors.lightGreen || '#eff6ff';

    const font = String(b.font || 'Inter, system-ui, Arial, sans-serif').replace(/"/g, "'");

    const logo = b.logoUrl

        ? `<a href="${escapeHtml(homeUrl || '#')}" style="text-decoration:none;"><img src="${escapeHtml(b.logoUrl)}" alt="${storeName}" width="180" style="display:block;margin:0 auto;max-width:180px;height:auto;border:0;" /></a>`

        : `<p style="margin:0;font-size:22px;font-weight:700;color:${primary};">${storeName}</p>`;

    const tagline = b.isPrincipalStore

        ? `<p style="margin:10px 0 0;font-size:12px;line-height:1.4;color:${textMuted};letter-spacing:0.04em;text-transform:uppercase;">Premium natural health products since 1995</p>`

        : '';

    const extraHtml = copy.extraPerk

        ? `<p style="margin:0 0 16px;line-height:1.65;">${escapeHtml(copy.extraPerk)}</p>`

        : '';

    const headline = isPoints ? 'Points on the orders you already place' : 'Cash back on the orders you already place';



    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.subject)}</title></head>

<body style="margin:0;padding:0;background:${pageBg};font-family:${font};">

<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(copy.previewText)}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${pageBg};margin:0;padding:24px 12px;">

<tr><td align="center">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid ${border};border-radius:12px;overflow:hidden;">

<tr>

  <td style="padding:24px 24px 16px;text-align:center;background:#ffffff;border-bottom:3px solid ${primary};">

    ${logo}

    ${tagline}

  </td>

</tr>

<tr>

  <td style="padding:0;background:linear-gradient(135deg,${primary} 0%,${primaryDark} 100%);text-align:center;">

    <p style="margin:0;padding:18px 24px 22px;font-size:24px;line-height:1.3;font-weight:700;color:#ffffff;">${escapeHtml(headline)}</p>

  </td>

</tr>

<tr>

  <td style="padding:28px 28px 8px;font-size:16px;line-height:1.65;color:${text};">

    <p style="margin:0 0 16px;">${escapeHtml(copy.greeting)}</p>

    <p style="margin:0 0 20px;">${escapeHtml(copy.opening)}</p>

    <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${primaryDark};">${escapeHtml(copy.earnHeading)}</p>

    <p style="margin:0 0 20px;">${escapeHtml(copy.earnBody)}</p>

    <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${primaryDark};">${escapeHtml(copy.useHeading)}</p>

    <p style="margin:0 0 20px;">${escapeHtml(copy.useBody)}</p>

    <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${primaryDark};">${escapeHtml(copy.tiersHeading)}</p>

    <p style="margin:0 0 8px;">${escapeHtml(copy.tiersIntro)}</p>

    ${renderIntroTierRowsHtml(tiers, isPoints, { ...colors, text, border, textMuted }, settings || {})}

    <p style="margin:0 0 12px;padding:12px 16px;background:${lightGreen};border-radius:8px;"><strong>${escapeHtml(copy.rateSentence)}</strong></p>

    ${extraHtml}

    <p style="margin:0 0 20px;">${escapeHtml(copy.closing)}</p>

    <p style="margin:24px 0 8px;text-align:center;">

      <a href="${escapeHtml(accountUrl)}" style="display:inline-block;background:${primary};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">${escapeHtml(copy.ctaPrimaryLabel)}</a>

    </p>

    <p style="margin:0 0 20px;text-align:center;">

      <a href="${escapeHtml(shopUrl)}" style="color:${primaryDark};font-weight:600;text-decoration:none;font-size:15px;">${escapeHtml(copy.ctaSecondaryLabel)}</a>

    </p>

    <p style="margin:0 0 8px;font-size:14px;color:${textMuted};">${escapeHtml(copy.signoff)}</p>

  </td>

</tr>

<tr>

  <td style="padding:8px 28px 28px;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${border};">

      <tr>

        <td style="padding-top:18px;font-size:12px;line-height:1.6;color:${textMuted};text-align:center;">

          <p style="margin:0 0 4px;font-weight:600;color:${primaryDark};">${storeName}</p>

          ${b.storePhone ? `<p style="margin:0 0 4px;">${escapeHtml(b.storePhone)}</p>` : ''}

          <p style="margin:0;">${escapeHtml(copy.footerNote)}</p>

        </td>

      </tr>

    </table>

  </td>

</tr>

</table>

</td></tr></table>

</body></html>`;

}



function buildProgramIntroPlainText({ copy, tiers, isPoints, accountUrl, shopUrl, settings }) {

    const extra = copy.extraPerk ? `\n${copy.extraPerk}\n` : '';

    return [

        copy.subject,

        '',

        copy.greeting,

        '',

        copy.opening,

        '',

        copy.earnHeading.toUpperCase(),

        copy.earnBody,

        '',

        copy.useHeading.toUpperCase(),

        copy.useBody,

        '',

        copy.tiersHeading.toUpperCase(),

        copy.tiersIntro,

        renderIntroTierRowsText(tiers, isPoints, settings || {}),

        '',

        copy.rateSentence,

        extra,

        copy.closing,

        '',

        `${copy.ctaPrimaryLabel}: ${accountUrl}`,

        `${copy.ctaSecondaryLabel}: ${shopUrl}`,

        '',

        copy.signoff,

        '',

        copy.footerNote,

    ]

        .filter((line) => line !== undefined)

        .join('\n')

        .replace(/\n{3,}/g, '\n\n');

}



/**

 * Build the program-intro email. Does not send.

 * @param {object} opts

 * @param {'cashback'|'points'|'cash'} [opts.programMode]

 */

function buildProgramIntroEmail({

    programMode,

    branding,

    settings,

    tiers,

    customerName,

    tierName,

    cashbackRate,

    pointsMultiplier,

    currentTierHasFreeShipping,

    freeShippingMinOrder,

    accountUrl,

    shopUrl,

    homeUrl,

} = {}) {

    const urls = {

        ...defaultIntroUrls(),

        ...(accountUrl ? { accountUrl } : {}),

        ...(shopUrl ? { shopUrl } : {}),

        ...(homeUrl ? { homeUrl } : {}),

    };

    const mode = String(programMode || settings?.programMode || settings?.mode || 'cash').toLowerCase();

    const isPoints = mode === 'points';

    const resolvedMode = isPoints ? 'points' : 'cashback';

    const storeName = branding?.storeName || 'Business One';

    const copy = buildProgramIntroCopy({

        programMode: resolvedMode,

        storeName,

        customerName: customerName || '{{customer_name}}',

        tierName: tierName || '{{tier_name}}',

        cashbackRate: cashbackRate ?? 0,

        pointsPerDollar: settings?.pointsPerDollar ?? 1,

        dollarPerPoint: settings?.dollarPerPoint ?? 0.01,

        pointsMultiplier: pointsMultiplier ?? 1,

        minCashbackRedeem: settings?.minCashbackRedeem ?? 0,

        combinedSpendFrequencyBonus: settings?.combinedSpendFrequencyBonus !== false,

        currentTierHasFreeShipping: Boolean(currentTierHasFreeShipping),

        freeShippingMinOrder: freeShippingMinOrder ?? null,

        storePhone: branding?.storePhone || '',

    });

    const resolvedSettings = settings || {};

    const html = buildProgramIntroEmailHtml({

        copy,

        branding,

        tiers: tiers || [],

        isPoints,

        accountUrl: urls.accountUrl,

        shopUrl: urls.shopUrl,

        homeUrl: urls.homeUrl,

        settings: resolvedSettings,

    });

    const text = buildProgramIntroPlainText({

        copy,

        tiers: tiers || [],

        isPoints,

        accountUrl: urls.accountUrl,

        shopUrl: urls.shopUrl,

        settings: resolvedSettings,

    });

    return {

        emailType: PROGRAM_INTRO_EMAIL_TYPE,

        programMode: resolvedMode,

        subject: copy.subject,

        previewText: copy.previewText,

        html,

        text,

        copy,

        placeholders: {

            customer_name: customerName || '{{customer_name}}',

            store_name: storeName,

            tier_name: tierName || '{{tier_name}}',

            cashback_rate: isPoints ? undefined : cashbackRate,

            points_per_dollar: isPoints ? settings?.pointsPerDollar ?? 1 : undefined,

            account_url: urls.accountUrl,

            shop_url: urls.shopUrl,

        },

        sendDisabled: true,

    };

}



function sampleIntroBranding() {

    return {

        storeName: 'Business One',

        storePhone: '(850) 290-2084',

        storeEmail: 'info@businessonecomprehensive.com',

        logoUrl: '/images/logo.png',

        isPrincipalStore: true,

        colors: {

            primary: '#ff9b1f',

            primaryDark: '#e8890f',

            accent: '#1f82ff',

            lightGreen: '#fff7ed',

            text: '#111827',

            textMuted: '#4b5563',

            border: '#e5e7eb',

            pageBg: '#f3f4f6',

        },

        font: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",

    };

}



function sampleIntroSettings(mode) {

    const isPoints = mode === 'points';

    return {

        enabled: true,

        programMode: isPoints ? 'points' : 'cash',

        pointsPerDollar: 1,

        dollarPerPoint: 0.01,

        minCashbackRedeem: 0,

        combinedSpendFrequencyBonus: true,

    };

}



function sampleIntroTiers() {

    return DEFAULT_TIERS.map((t, i) =>

        rowToTier({

            id: i + 1,

            ...t,

            is_active: 1,

        })

    );

}



/**

 * Load live settings/tiers and return a preview payload. Never sends mail.

 */

async function previewProgramIntroEmail(pool, { programMode, customerName, tierKey } = {}) {

    const settings = pool ? await getProgramSettings(pool) : sampleIntroSettings(programMode);

    const branding = pool ? await resolveStoreBranding(pool) : sampleIntroBranding();

    const tiers = pool ? await listTiers(pool, { activeOnly: true }) : sampleIntroTiers();

    const requested = String(programMode || settings.programMode || 'cash').toLowerCase();

    const mode = requested === 'points' ? 'points' : 'cashback';

    const key = String(tierKey || 'bronze').toLowerCase();

    const current = (tiers || []).find((t) => t.tierKey === key) || tiers[0];

    const cashbackRate = Number(current?.cashbackPercent ?? current?.discountPercent) || 0;

    const pointsMultiplier = displayPointsMultiplier(current);

    const name = customerName || 'there';

    return buildProgramIntroEmail({

        programMode: mode,

        branding,

        settings: { ...settings, programMode: mode === 'points' ? 'points' : 'cash' },

        tiers,

        customerName: name,

        tierName: current?.displayName || 'Bronze',

        cashbackRate,

        pointsMultiplier,

        currentTierHasFreeShipping: Boolean(current?.freeShipping),

        freeShippingMinOrder: current?.freeShippingMinOrder ?? null,

    });

}



/**

 * Send the program-intro email to one customer. Gated on program enabled and loyalty_email_sends dedup.

 */

async function sendProgramIntroEmail(pool, userId, { dryRun = false } = {}) {

    if (!pool || !userId) {

        return { sent: false, reason: 'invalid_args', emailType: PROGRAM_INTRO_EMAIL_TYPE };

    }



    const settings = await getProgramSettings(pool);

    if (!settings.enabled) {

        return { sent: false, reason: 'program_disabled', emailType: PROGRAM_INTRO_EMAIL_TYPE };

    }



    const [[user]] = await pool.execute(

        `SELECT id, email, first_name, customer_status

           FROM users

          WHERE id = ?`,

        [userId]

    );

    if (!user?.email) {

        return { sent: false, reason: 'no_email', emailType: PROGRAM_INTRO_EMAIL_TYPE, userId };

    }

    if (String(user.customer_status || '').toLowerCase() !== 'active') {

        return { sent: false, reason: 'not_active', emailType: PROGRAM_INTRO_EMAIL_TYPE, userId };

    }

    if (await hasReceivedProgramIntro(pool, userId)) {

        return { sent: false, reason: 'already_sent', emailType: PROGRAM_INTRO_EMAIL_TYPE, userId };

    }



    const { tier } = await evaluateCustomerTier(pool, userId);

    const tiers = await listTiers(pool, { activeOnly: true });

    const branding = await resolveStoreBranding(pool);

    const current = tier || tiers[0] || null;

    const mode = settings.programMode === 'points' ? 'points' : 'cashback';

    const payload = buildProgramIntroEmail({

        programMode: mode,

        branding,

        settings: { ...settings, programMode: mode === 'points' ? 'points' : 'cash' },

        tiers,

        customerName: user.first_name || 'there',

        tierName: current?.displayName || 'Bronze',

        cashbackRate: Number(current?.cashbackPercent ?? current?.discountPercent) || 0,

        pointsMultiplier: displayPointsMultiplier(current),

        currentTierHasFreeShipping: Boolean(current?.freeShipping),

        freeShippingMinOrder: current?.freeShippingMinOrder ?? null,

    });



    if (dryRun) {

        return {

            sent: false,

            dryRun: true,

            wouldSend: true,

            emailType: PROGRAM_INTRO_EMAIL_TYPE,

            userId,

            subject: payload.subject,

        };

    }



    await sendMail({

        to: user.email,

        subject: payload.subject,

        html: payload.html,

        text: payload.text,

    });

    await recordEmailSend(pool, {

        userId,

        email: user.email,

        emailType: PROGRAM_INTRO_EMAIL_TYPE,

        tierKey: current?.tierKey || null,

        subject: payload.subject,

        metadata: { trigger: 'program_intro' },

    });

    return { sent: true, emailType: PROGRAM_INTRO_EMAIL_TYPE, userId, subject: payload.subject };

}



/**

 * Bulk send when the loyalty program is enabled. Skips customers who already received program_intro.

 */

async function sendProgramIntroToEligibleCustomers(pool, { dryRun = false, background = true, ...runOpts } = {}) {
    const settings = await getProgramSettings(pool);
    if (!settings.enabled) {
        return { sent: 0, skipped: 0, dryRun, reason: 'program_disabled', emailType: PROGRAM_INTRO_EMAIL_TYPE };
    }

    const {
        runThrottledProgramIntroSend,
        scheduleProgramIntroBulkSend,
    } = require('./loyaltyIntroEmailQueue');

    if (background) {
        return scheduleProgramIntroBulkSend(pool, { dryRun, trigger: 'program_enable', ...runOpts });
    }

    return runThrottledProgramIntroSend(pool, {
        dryRun,
        trigger: 'program_enable',
        delayMs: dryRun ? 0 : runOpts.delayMs,
        ...runOpts,
    });
}



/**
 * Correction copy for customers who already received program_intro with older
 * tier percentages. Describes corrected tier rates only (no flat-rate language).
 */
function buildLoyaltyRateCorrectionEmail({ branding, customerName, accountUrl, homeUrl } = {}) {
    const urls = {
        ...defaultIntroUrls(),
        ...(accountUrl ? { accountUrl } : {}),
        ...(homeUrl ? { homeUrl } : {}),
    };
    const b = branding || {};
    const colors = b.colors || {};
    const storeName = b.storeName || 'Business One';
    const firstName = String(customerName || 'there').trim() || 'there';
    const primary = colors.primary || '#2563eb';
    const primaryDark = colors.primaryDark || '#1d4ed8';
    const text = colors.text || '#111827';
    const textMuted = colors.textMuted || '#4b5563';
    const border = colors.border || '#e5e7eb';
    const pageBg = colors.pageBg || '#f3f4f6';
    const lightAccent = colors.lightGreen || colors.lightAccent || '#eff6ff';
    const font = String(b.font || 'Inter, system-ui, Arial, sans-serif').replace(/"/g, "'");
    const subject = LOYALTY_RATE_CORRECTION_SUBJECT;
    const previewText =
        'Updated loyalty tier rates — here is the corrected structure.';

    const textBody = [
        `Hi ${firstName},`,
        '',
        "We're writing with a quick correction about the cash-back loyalty program email we sent you recently.",
        '',
        "That initial email listed older, higher tier percentages. We've since updated the tier rates so they match what's shown on our site.",
        '',
        'Here is the corrected tier structure:',
        '',
        '• Bronze: 0%',
        '• Silver: 1% base + 1% frequency bonus when spend and order goals are met (up to 2%)',
        '• Gold: 2% base + 2% frequency bonus (up to 4%)',
        '• Platinum: 3% base + 2% frequency bonus (up to 5%)',
        '',
        "Base is the earn rate for your tier. The frequency bonus can add on top when you meet that tier's spend and order goals.",
        '',
        'Your account access, current balances, and how you redeem your credit are all unchanged.',
        '',
        'We value you as a customer and wanted to clear this up promptly. If you have any questions, please feel free to reach out.',
        '',
        'Warmly,',
        '',
        `The Team at ${storeName}`,
        '',
        `View your loyalty account: ${urls.accountUrl}`,
    ].join('\n');

    const logo = b.logoUrl
        ? `<a href="${escapeHtml(urls.homeUrl || '#')}" style="text-decoration:none;"><img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(storeName)}" width="180" style="display:block;margin:0 auto;max-width:180px;height:auto;border:0;" /></a>`
        : `<p style="margin:0;font-size:22px;font-weight:700;color:${primary};">${escapeHtml(storeName)}</p>`;

    // Aligned tier table matching program_intro email styling (header + bordered rows)
    const tiersTable = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-size:14px;margin:12px 0 16px;color:${text};">
  <thead>
    <tr>
      <th align="left" width="22%" style="padding:8px 10px;border-bottom:2px solid ${border};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${textMuted};">Tier</th>
      <th align="left" width="28%" style="padding:8px 10px;border-bottom:2px solid ${border};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${textMuted};">Base</th>
      <th align="left" width="50%" style="padding:8px 10px;border-bottom:2px solid ${border};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${textMuted};">With frequency bonus</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:10px;border-bottom:1px solid ${border};font-weight:600;vertical-align:top;">Bronze</td>
      <td style="padding:10px;border-bottom:1px solid ${border};vertical-align:top;">0%</td>
      <td style="padding:10px;border-bottom:1px solid ${border};color:${textMuted};vertical-align:top;">—</td>
    </tr>
    <tr>
      <td style="padding:10px;border-bottom:1px solid ${border};font-weight:600;vertical-align:top;">Silver</td>
      <td style="padding:10px;border-bottom:1px solid ${border};vertical-align:top;">1%</td>
      <td style="padding:10px;border-bottom:1px solid ${border};color:${textMuted};vertical-align:top;">+1% when spend &amp; order goals met<br><strong style="color:${text};">up to 2%</strong></td>
    </tr>
    <tr>
      <td style="padding:10px;border-bottom:1px solid ${border};font-weight:600;vertical-align:top;">Gold</td>
      <td style="padding:10px;border-bottom:1px solid ${border};vertical-align:top;">2%</td>
      <td style="padding:10px;border-bottom:1px solid ${border};color:${textMuted};vertical-align:top;">+2% when spend &amp; order goals met<br><strong style="color:${text};">up to 4%</strong></td>
    </tr>
    <tr>
      <td style="padding:10px;border-bottom:1px solid ${border};font-weight:600;vertical-align:top;">Platinum</td>
      <td style="padding:10px;border-bottom:1px solid ${border};vertical-align:top;">3%</td>
      <td style="padding:10px;border-bottom:1px solid ${border};color:${textMuted};vertical-align:top;">+2% when spend &amp; order goals met<br><strong style="color:${text};">up to 5%</strong></td>
    </tr>
  </tbody>
</table>`;

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${pageBg};font-family:${font};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(previewText)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${pageBg};margin:0;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid ${border};border-radius:12px;overflow:hidden;">
<tr>
  <td style="padding:24px 24px 16px;text-align:center;background:#ffffff;border-bottom:3px solid ${primary};">
    ${logo}
  </td>
</tr>
<tr>
  <td style="padding:0;background:linear-gradient(135deg,${primary} 0%,${primaryDark} 100%);text-align:center;">
    <p style="margin:0;padding:18px 24px 22px;font-size:22px;line-height:1.3;font-weight:700;color:#ffffff;">Corrected loyalty tier rates</p>
  </td>
</tr>
<tr>
  <td style="padding:28px 28px 8px;color:${text};font-size:15px;line-height:1.65;">
    <p style="margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>
    <p style="margin:0 0 16px;">We're writing with a quick correction about the cash-back loyalty program email we sent you recently.</p>
    <p style="margin:0 0 16px;">That initial email listed older, higher tier percentages. We've since updated the tier rates so they match what's shown on our site.</p>
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${primaryDark};">Corrected tier structure</p>
    <p style="margin:0 0 8px;">Here are the updated rates:</p>
    ${tiersTable}
    <p style="margin:0 0 16px;padding:12px 16px;background:${lightAccent};border-radius:8px;">Base is the earn rate for your tier. The frequency bonus can add on top when you meet that tier's spend and order goals.</p>
    <p style="margin:0 0 16px;">Your account access, current balances, and how you redeem your credit are all unchanged.</p>
    <p style="margin:0 0 20px;">We value you as a customer and wanted to clear this up promptly. If you have any questions, please feel free to reach out.</p>
    <p style="margin:24px 0 8px;text-align:center;">
      <a href="${escapeHtml(urls.accountUrl)}" style="display:inline-block;background:${primary};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">View your loyalty account</a>
    </p>
    <p style="margin:0 0 8px;font-size:14px;color:${textMuted};">Warmly,</p>
    <p style="margin:0 0 20px;font-size:14px;color:${textMuted};">The Team at ${escapeHtml(storeName)}</p>
  </td>
</tr>
<tr>
  <td style="padding:8px 28px 28px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${border};">
      <tr>
        <td style="padding-top:18px;font-size:12px;line-height:1.6;color:${textMuted};text-align:center;">
          <p style="margin:0 0 4px;font-weight:600;color:${primaryDark};">${escapeHtml(storeName)}</p>
          <p style="margin:0;">Loyalty rewards from ${escapeHtml(storeName)}</p>
        </td>
      </tr>
    </table>
  </td>
</tr>
</table>
</td></tr></table>
</body></html>`;

    return {
        subject,
        text: textBody,
        html,
        emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE,
        previewText,
    };
}

/** True when metadata marks a prior flat-rate correction as superseded (eligible for re-send). */
function isSupersededCorrectionMetadata(metadata) {
    if (metadata == null) return false;
    let obj = metadata;
    if (typeof metadata === 'string') {
        try {
            obj = JSON.parse(metadata);
        } catch {
            return false;
        }
    }
    if (!obj || typeof obj !== 'object') return false;
    return obj.superseded === true || obj.superseded === 1 || obj.superseded === 'true';
}

async function hasReceivedLoyaltyRateCorrection(pool, userId) {
    const [rows] = await pool.execute(
        `SELECT id, metadata FROM loyalty_email_sends
          WHERE user_id = ? AND email_type = ?
          ORDER BY sent_at DESC
          LIMIT 5`,
        [userId, LOYALTY_RATE_CORRECTION_EMAIL_TYPE]
    );
    // Eligible again if every prior correction row is superseded
    return (rows || []).some((row) => !isSupersededCorrectionMetadata(row.metadata));
}

/**
 * Send rate-correction email only if the customer already received program_intro
 * and has not yet received an active (non-superseded) loyalty_rate_correction.
 */
async function sendLoyaltyRateCorrectionEmail(pool, userId, { dryRun = false } = {}) {
    if (!pool || !userId) {
        return { sent: false, reason: 'invalid_args', emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE };
    }

    const [[user]] = await pool.execute(
        `SELECT id, email, first_name, customer_status
           FROM users
          WHERE id = ?`,
        [userId]
    );

    if (!user || !user.email) {
        return { sent: false, reason: 'user_not_found', emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE, userId };
    }
    if (String(user.customer_status || '').toLowerCase() !== 'active') {
        return { sent: false, reason: 'inactive', emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE, userId };
    }

    if (!(await hasReceivedProgramIntro(pool, userId))) {
        return { sent: false, reason: 'missing_program_intro', emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE, userId };
    }

    if (await hasReceivedLoyaltyRateCorrection(pool, userId)) {
        return { sent: false, reason: 'already_sent', emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE, userId };
    }

    const branding = await resolveStoreBranding(pool);
    const payload = buildLoyaltyRateCorrectionEmail({
        branding,
        customerName: user.first_name || 'there',
    });

    if (dryRun) {
        return {
            sent: false,
            dryRun: true,
            wouldSend: true,
            emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE,
            userId,
            subject: payload.subject,
        };
    }

    await sendMail({
        to: user.email,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
    });

    await recordEmailSend(pool, {
        userId,
        email: user.email,
        emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE,
        tierKey: null,
        subject: payload.subject,
        metadata: { trigger: 'loyalty_rate_correction', copy_version: 'tiers_only' },
    });

    return {
        sent: true,
        emailType: LOYALTY_RATE_CORRECTION_EMAIL_TYPE,
        userId,
        subject: payload.subject,
    };
}

function scheduleProgramIntroForUser(pool, userId, log) {

    if (!pool || !userId) return;

    setImmediate(() => {

        sendProgramIntroEmail(pool, userId).catch((err) => {

            const logger = log || console;

            if (typeof logger.warn === 'function') {

                logger.warn('[loyalty] program intro on signup failed:', err);

            }

        });

    });

}



module.exports = {

    PROGRAM_INTRO_EMAIL_TYPE,

    LOYALTY_RATE_CORRECTION_EMAIL_TYPE,

    LOYALTY_RATE_CORRECTION_SUBJECT,

    sendTierPromotionEmail,

    sendPendingTierPromotionEmails,

    previewTierPromotionEmail,

    sendNearTierEmail,

    sendWinbackEmail,

    sendManualEmail,

    sendProgramIntroEmail,

    sendProgramIntroToEligibleCustomers,

    scheduleProgramIntroForUser,

    hasReceivedProgramIntro,

    hasReceivedLoyaltyRateCorrection,

    buildLoyaltyRateCorrectionEmail,

    sendLoyaltyRateCorrectionEmail,

    processLoyaltyEmails,

    buildTierEmailHtml,

    buildProgramIntroCopy,

    buildProgramIntroEmail,

    previewProgramIntroEmail,

    sampleIntroBranding,

    sampleIntroSettings,

    sampleIntroTiers,

};


