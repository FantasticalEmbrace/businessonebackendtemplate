'use strict';

/**
 * Product slug -> public COA path (+ optional date).
 * Files live under /images/coa/ at site root.
 */
const PRODUCT_COA_MAP = [
    {
        slug: 'herbs-for-life-cbd-gummies-sleep',
        coa_url: '/images/coa/herbs-for-life-15mg-coa-2024-09-19.pdf',
        coa_updated_at: '2024-09-19'
    },
    {
        slug: 'herbs-for-life-cbd-gummies-30mg',
        coa_url: '/images/coa/herbs-for-life-30mg-coa-2024-09-19.pdf',
        coa_updated_at: '2024-09-19'
    },
    {
        slug: 'herbs-for-life-delta-9-gummies-10mg-ea',
        coa_url: '/images/coa/herbs-for-life-delta-9-coa.pdf',
        coa_updated_at: '2024-09-19'
    },
    {
        slug: 'hippie-jack-s-cbd-extreme-1000mg-pain-cream',
        coa_url: '/images/coa/hippie-jacks-extreme-pain-cream-coa.pdf',
        coa_updated_at: '2026-04-16'
    },
    {
        slug: 'hippie-jack-s-yummy-hemp-gummie',
        coa_url: '/images/coa/hippie-jacks-yummy-hemp-gummie-coa.pdf',
        coa_updated_at: '2026-06-12'
    },
    {
        slug: 'hemp-bombs-cbd-gummies-w-mushroom',
        coa_url: '/images/coa/hemp-bombs-cbd-gummies-w-mushroom-coas.html',
        coa_updated_at: '2026-06-12'
    },
    {
        slug: 'regalabs-cannabis-care-cream-free-shipping',
        coa_url: '/images/coa/regalabs-cannabis-care-coa.html',
        coa_updated_at: '2026-06-04'
    },
    {
        slug: 'regalabs-cannabis-care-roll-on',
        coa_url: '/images/coa/regalabs-cannabis-care-coa.html',
        coa_updated_at: '2026-06-04'
    },
    {
        slug: 'regalabs-organic-cbd-oils',
        coa_url: '/images/coa/regalabs-organic-cbd-oils-coas.html',
        coa_updated_at: '2026-06-04'
    },
    {
        slug: 'regalabs-full-spectrum-cbd-gummies',
        coa_url: '/images/coa/Regal Labs - CBD Gummies COA.pdf',
        coa_updated_at: '2026-06-03'
    },
    {
        slug: 'regalabs-cannabis-oil-for-pets',
        coa_url: '/images/coa/Pet CBD Oil.pdf',
        coa_updated_at: '2026-06-19'
    }
];

/** Old hmherbs.com download_file URLs to pull into /images/coa/ */
const OLD_SITE_COA_DOWNLOADS = [
    {
        dest: 'hippie-jacks-yummy-hemp-gummie-coa.pdf',
        url: 'https://hmherbs.com/index.php/download_file/view/106032a6-4e0b-4ff2-8491-df15966240c2/4066',
        slug: 'hippie-jack-s-yummy-hemp-gummie'
    },
    {
        dest: 'hippie-jacks-extreme-pain-cream-coa.pdf',
        url: 'https://hmherbs.com/index.php/download_file/view/cfacb2e3-1615-49ae-ad74-d916f674ae15/3236',
        slug: 'hippie-jack-s-cbd-extreme-1000mg-pain-cream'
    },
    {
        dest: 'hemp-bombs-cbd-gummies-w-mushroom-coa-1.pdf',
        url: 'https://hmherbs.com/index.php/download_file/view/a4d15538-f6e3-4350-b9b9-8735a5a98e00/839',
        slug: 'hemp-bombs-cbd-gummies-w-mushroom'
    },
    {
        dest: 'hemp-bombs-cbd-gummies-w-mushroom-coa-2.pdf',
        url: 'https://hmherbs.com/index.php/download_file/view/5e15abc1-d2be-47fb-83c9-a4298a39646a/839',
        slug: 'hemp-bombs-cbd-gummies-w-mushroom'
    },
    {
        dest: 'regal-hemp-seed-oil-5mg-coa.pdf',
        url: 'https://hmherbs.com/index.php/download_file/view/53ef5af5-8df0-40d0-899a-edc26fd842fb/4725',
        slug: 'regalabs-organic-cbd-oils'
    },
    {
        dest: 'regal-hemp-seed-oil-silver-10mg-coa.pdf',
        url: 'https://hmherbs.com/index.php/download_file/view/3b6d5b9d-3588-4158-bd28-dbe9e5c3e8b0/4725',
        slug: 'regalabs-organic-cbd-oils'
    },
    {
        dest: 'regal-cannabis-care-coa.pdf',
        url: 'https://hmherbs.com/index.php/download_file/view/1e430c85-ce28-4801-9b5f-2acbc07a31d4/4741',
        slug: 'regalabs-cannabis-care-cream-free-shipping'
    }
];

/** Products with no public COA found online (hmherbs, wayback, manufacturer sites). */
const COA_PENDING_SLUGS = [];

module.exports = { PRODUCT_COA_MAP, OLD_SITE_COA_DOWNLOADS, COA_PENDING_SLUGS };
