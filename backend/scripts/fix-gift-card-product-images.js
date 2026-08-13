#!/usr/bin/env node
/**
 * Replace wrong product_images on digital/physical gift card products.
 *
 * Usage (from backend/):
 *   node scripts/fix-gift-card-product-images.js
 *   node scripts/fix-gift-card-product-images.js --dry-run
 */
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const {
    repairAllGiftCardProductImages,
    GIFT_CARD_PRODUCT_IMAGES,
} = require('../utils/ensureGiftCardCatalog');

loadBackendEnv();

const dryRun = process.argv.includes('--dry-run');

async function main() {
    const pool = createPool();

    const [before] = await pool.query(
        `SELECT p.id, p.sku, p.name, p.gift_card_type, pi.image_url
           FROM products p
           LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
          WHERE p.gift_card_type IN ('digital', 'physical')
             OR p.sku IN ('GC-DIGITAL', 'GC-PHYSICAL')
          ORDER BY p.gift_card_type, p.name`
    );

    console.log('Before:');
    for (const row of before) {
        console.log(`  #${row.id} ${row.sku} (${row.gift_card_type || '?'}) -> ${row.image_url || '(none)'}`);
    }

    if (dryRun) {
        console.log('\nDry run — no changes written.');
        console.log('Expected images:', GIFT_CARD_PRODUCT_IMAGES);
        await pool.end();
        return;
    }

    await repairAllGiftCardProductImages(pool);

    const [after] = await pool.query(
        `SELECT p.id, p.sku, p.name, p.gift_card_type, pi.image_url
           FROM products p
           LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
          WHERE p.gift_card_type IN ('digital', 'physical')
             OR p.sku IN ('GC-DIGITAL', 'GC-PHYSICAL')
          ORDER BY p.gift_card_type, p.name`
    );

    console.log('\nAfter:');
    for (const row of after) {
        console.log(`  #${row.id} ${row.sku} (${row.gift_card_type || '?'}) -> ${row.image_url || '(none)'}`);
    }

    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
