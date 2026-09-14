'use strict';

const { resolveStoreBranding } = require('./storeBranding');
const { isEcommerceStore } = require('../middleware/requireEcommerceStore');

function starterProgramsForBranding(branding) {
    const store = branding.storeName || 'Your Store';
    return [
        {
            name: 'Starter guide: High-value cart offer',
            is_starter_guide: 1,
            sort_order: 10,
            min_subtotal: 50,
            max_subtotal: null,
            delay_value: 2,
            delay_unit: 'weeks',
            trigger_type: 'time',
            discount_type: 'percent',
            discount_value: 5,
            promo_code: 'SAVE5',
            email_subject: `Complete your order at ${store} — save 5%`,
            email_intro: `Hi {{first_name}}, you left a cart worth {{subtotal}} at ${store}. Come back within the next few days and save 5% with code {{promo_code}}.`,
            require_marketing_opt_in: 0,
            is_active: 0,
        },
        {
            name: 'Starter guide: Small cart reminder',
            is_starter_guide: 1,
            sort_order: 20,
            min_subtotal: null,
            max_subtotal: 49.99,
            delay_value: 3,
            delay_unit: 'days',
            trigger_type: 'time',
            discount_type: 'none',
            discount_value: null,
            promo_code: null,
            email_subject: `Your ${store} cart is waiting`,
            email_intro: `Hi {{first_name}}, you still have items in your cart at ${store} ({{subtotal}}). Tap below when you are ready to checkout — no pressure.`,
            require_marketing_opt_in: 0,
            is_active: 0,
        },
        {
            name: 'Starter guide: Item went on sale',
            is_starter_guide: 1,
            sort_order: 30,
            min_subtotal: null,
            max_subtotal: null,
            delay_value: 1,
            delay_unit: 'days',
            trigger_type: 'item_on_sale',
            discount_type: 'none',
            discount_value: null,
            promo_code: null,
            email_subject: `Good news — something in your ${store} cart is on sale`,
            email_intro: `Hi {{first_name}}, an item you left in your cart at ${store} is now on sale. Your cart subtotal is {{subtotal}}.`,
            require_marketing_opt_in: 0,
            is_active: 0,
        },
    ];
}

async function seedAbandonedCartStarterProgramsIfEmpty(pool) {
    if (!pool) return { seeded: 0, skipped: true };
    if (!(await isEcommerceStore(pool))) return { seeded: 0, skipped: 'not_ecommerce' };

    const [countRows] = await pool.execute('SELECT COUNT(*) AS n FROM abandoned_cart_programs');
    if (Number(countRows[0]?.n) > 0) return { seeded: 0, skipped: 'already_has_programs' };

    const branding = await resolveStoreBranding(pool);
    const starters = starterProgramsForBranding(branding);
    let seeded = 0;

    for (const p of starters) {
        await pool.execute(
            `INSERT INTO abandoned_cart_programs (
                name, is_active, is_starter_guide, sort_order, min_subtotal, max_subtotal,
                delay_value, delay_unit, trigger_type, discount_type, discount_value,
                promo_code, email_subject, email_intro, require_marketing_opt_in
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                p.name,
                p.is_active,
                p.is_starter_guide,
                p.sort_order,
                p.min_subtotal,
                p.max_subtotal,
                p.delay_value,
                p.delay_unit,
                p.trigger_type,
                p.discount_type,
                p.discount_value,
                p.promo_code,
                p.email_subject,
                p.email_intro,
                p.require_marketing_opt_in,
            ]
        );
        seeded += 1;
    }

    return { seeded, skipped: false };
}

module.exports = {
    starterProgramsForBranding,
    seedAbandonedCartStarterProgramsIfEmpty,
};
