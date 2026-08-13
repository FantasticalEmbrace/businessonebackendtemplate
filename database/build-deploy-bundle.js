#!/usr/bin/env node
/**
 * Builds database/deploy-staging.sql — one file for Linode Managed MySQL import.
 * Run: npm run db:build-staging
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname);
const outFile = path.join(root, 'deploy-staging.sql');

const sections = [
    {
        title: 'Preamble',
        file: path.join(root, 'staging', '00-preamble.sql')
    },
    {
        title: 'Base data (Dec 2025 backup — catalog, brands, admin)',
        file: path.join(root, 'hmherbs_backup_20251216_170604.sql')
    },
    {
        title: 'Admin password reset columns',
        file: path.join(root, 'migrations', 'add_password_reset_tokens.sql')
    },
    {
        title: 'Payment cards (hosting-safe)',
        file: path.join(root, 'staging', '03-payment-cards-safe.sql')
    },
    {
        title: 'Menu tables',
        file: path.join(root, 'migrations', 'create_menu_tables.sql')
    },
    {
        title: 'Product COA columns (hosting-safe)',
        file: path.join(root, 'staging', '05-product-coa-columns-safe.sql')
    },
    {
        title: 'Price fixes — Irwin / Life Extension / AgeLoss',
        file: path.join(root, 'migrations', '20260413_fix_irwin_life_extension_zero_prices.sql')
    },
    {
        title: 'NOW Foods catalog updates',
        file: path.join(root, 'migrations', '20260413_now_foods_nutraflora_glutathione_chlorophyll.sql')
    },
    {
        title: 'COA URL mappings',
        file: path.join(root, 'migrations', '20260417_product_coa_urls.sql')
    },
    {
        title: 'Customer DB, gift cards, loyalty',
        file: path.join(root, 'migrations', '20260427_customer_database_giftcards_loyalty.sql')
    },
    {
        title: 'Wishlist collections',
        file: path.join(root, 'migrations', '20260427_wishlist_collections.sql')
    },
    {
        title: 'Tax reserve ledger',
        file: path.join(root, 'migrations', '20260508_tax_reserve_ledger.sql')
    },
    {
        title: 'Web promotions',
        file: path.join(root, 'migrations', '20260509_web_promotions_marketing.sql')
    },
    {
        title: 'CBD category and product assignments',
        file: path.join(root, 'migrations', '20260612_cbd_category.sql')
    },
    {
        title: 'CBD COA URLs (Hemp Bombs, Hippie Jack Yummy Hemp)',
        file: path.join(root, 'migrations', '20260612_cbd_coa_urls.sql')
    },
    {
        title: 'Remove Vista Life CBD products from catalog',
        file: path.join(root, 'migrations', '20260604_remove_vista_life_cbd_products.sql')
    },
    {
        title: 'Regal Labs COA URLs (Cannabis Care + Organic CBD Oils)',
        file: path.join(root, 'migrations', '20260604_regal_labs_coa_urls.sql')
    },
    {
        title: 'Regal Labs CBD Gummies COA',
        file: path.join(root, 'migrations', '20260603_regal_labs_cbd_gummies_coa.sql')
    },
    {
        title: 'Regal Labs Pet CBD Oil COA',
        file: path.join(root, 'migrations', '20260619_regal_labs_pet_cbd_oil_coa.sql')
    },
    {
        title: 'Customer groups',
        file: path.join(root, 'migrations', '20260612_customer_groups.sql')
    },
    {
        title: 'Customer password reset (hosting-safe)',
        file: path.join(root, 'staging', '14-users-password-reset-safe.sql')
    },
    {
        title: 'Postamble',
        file: path.join(root, 'staging', '99-postamble.sql')
    }
];

const includedBasenames = new Set(
    sections.map((s) => path.basename(s.file)).filter((name) => name.toLowerCase().endsWith('.sql'))
);
const migrationsDir = path.join(root, 'migrations');
const extraMigrations = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .filter((name) => !includedBasenames.has(name))
    .sort((a, b) => a.localeCompare(b));

const postambleIndex = sections.findIndex((s) => path.basename(s.file) === '99-postamble.sql');
const insertAt = postambleIndex >= 0 ? postambleIndex : sections.length;
for (const filename of extraMigrations) {
    sections.splice(insertAt, 0, {
        title: filename.replace(/\.sql$/i, ''),
        file: path.join(migrationsDir, filename)
    });
}

const header = `-- =============================================================================
-- HM Herbs — STAGING DEPLOY BUNDLE (auto-generated)
-- Generated: ${new Date().toISOString()}
-- DO NOT EDIT BY HAND — run: npm run db:build-staging
--
-- Import (Linode Managed MySQL):
--   mysql -h HOST -P 3306 -u USER -p --ssl-mode=REQUIRED DB_NAME < deploy-staging.sql
--   See database/DEPLOY-DATABASE.md and LINODE_DEPLOY.md
-- =============================================================================

`;

let body = '';
let totalBytes = 0;

for (const { title, file } of sections) {
    if (!fs.existsSync(file)) {
        console.error(`Missing: ${file}`);
        process.exit(1);
    }
    const content = fs.readFileSync(file, 'utf8');
    totalBytes += Buffer.byteLength(content, 'utf8');
    body += `\n-- ########## ${title} ##########\n-- Source: ${path.basename(file)}\n\n`;
    body += content.trimEnd();
    body += '\n\n';
}

fs.writeFileSync(outFile, header + body, 'utf8');

const mb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(2);
console.log(`Wrote ${outFile}`);
console.log(`Size: ${mb} MB (${sections.length} sections)`);
