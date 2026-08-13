#!/usr/bin/env node
/**
 * Sync product variants from hmherbs.com product pages into local database.
 * Uses backend/data/scraped-products.json for source URLs (or fetches all with --limit).
 *
 * Usage: node scripts/sync-hmherbs-variants.js [--limit=50] [--dry-run]
 */
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { ensureProductVariantSchema } = require('../utils/ensureProductVariantSchema');
const { extractHmherbsVariantsFromHtml } = require('../utils/extractHmherbsVariants');
const { saveProductVariants } = require('../utils/saveProductVariants');

loadBackendEnv();

const HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/** @type {Map<string, string>} hm product slug -> local slug */
let slugAliasMap = null;

async function loadSlugAliasMap() {
    if (slugAliasMap) return slugAliasMap;
    slugAliasMap = new Map();
    const csvPath = path.join(__dirname, '../../redirects-slug-aliases.csv');
    try {
        const raw = await fs.readFile(csvPath, 'utf8');
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const [from, to] = trimmed.split(',').map((s) => s.trim());
            if (!from || !to) continue;
            const hmMatch = from.match(/\/products\/([^/?#]+)/i);
            const localMatch = to.match(/[?&]slug=([^&]+)/i);
            if (hmMatch && localMatch) {
                slugAliasMap.set(hmMatch[1].toLowerCase(), localMatch[1].toLowerCase());
            }
        }
    } catch {
        // optional file
    }
    return slugAliasMap;
}

function hmSlugFromUrl(url) {
    const m = String(url).match(/\/products\/([^/?#]+)/i);
    return m ? m[1].toLowerCase() : null;
}

function toLocalSlug(hmSlug) {
    return hmSlug
        .replace(/_/g, '-')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

async function findProductId(pool, scraped, aliases) {
    const hmSlug = hmSlugFromUrl(scraped.url);
    const candidates = new Set();
    if (hmSlug) {
        candidates.add(hmSlug);
        candidates.add(toLocalSlug(hmSlug));
        const aliased = aliases.get(hmSlug.toLowerCase());
        if (aliased) candidates.add(aliased);
    }
    if (scraped.sku) candidates.add(String(scraped.sku).toLowerCase());

    for (const slugGuess of candidates) {
        const [rows] = await pool.query(
            'SELECT id, sku, slug, name FROM products WHERE LOWER(slug) = ? OR LOWER(sku) = ? LIMIT 1',
            [slugGuess, slugGuess]
        );
        if (rows.length) return rows[0];
    }

    if (scraped.name) {
        const [rows] = await pool.query(
            'SELECT id, sku, slug, name FROM products WHERE name = ? LIMIT 1',
            [scraped.name]
        );
        if (rows.length) return rows[0];

        const short = scraped.name.slice(0, 48);
        const [likeRows] = await pool.query(
            'SELECT id, sku, slug, name FROM products WHERE name LIKE ? LIMIT 1',
            [`${short}%`]
        );
        if (likeRows.length) return likeRows[0];
    }

    return null;
}

async function fetchVariants(url) {
    const res = await axios.get(url, { headers: HEADERS, timeout: 25000 });
    return extractHmherbsVariantsFromHtml(res.data);
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const limitArg = args.find((a) => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;

    const jsonPath = path.join(__dirname, '../data/scraped-products.json');
    const raw = await fs.readFile(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    const list = Array.isArray(data.products) ? data.products : data;
    const slice = limit > 0 ? list.slice(0, limit) : list;

    const pool = createPool({ connectionLimit: 4 });
    await ensureProductVariantSchema(pool);
    const aliases = await loadSlugAliasMap();

    let updated = 0;
    let skipped = 0;
    let noVariants = 0;
    let notFound = 0;
    let errors = 0;

    for (let i = 0; i < slice.length; i++) {
        const item = slice[i];
        if (!item.url) {
            skipped++;
            continue;
        }

        const label = item.name || item.url;
        process.stdout.write(`[${i + 1}/${slice.length}] ${label.slice(0, 60)}… `);

        try {
            const extracted = await fetchVariants(item.url);
            if (!extracted.variants.length) {
                console.log('no options');
                noVariants++;
                await new Promise((r) => setTimeout(r, 300));
                continue;
            }

            const product = await findProductId(pool, item, aliases);
            if (!product) {
                console.log('product not in DB');
                notFound++;
                continue;
            }

            if (dryRun) {
                console.log(`would save ${extracted.variants.length} variants → #${product.id}`);
                updated++;
                continue;
            }

            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                const count = await saveProductVariants(
                    connection,
                    product.id,
                    product.sku,
                    extracted.variant_option_groups,
                    extracted.variants.map((v) => ({
                        name: v.name,
                        price: v.price,
                        skuHint: v.skuHint,
                        externalValue: v.externalValue,
                        attributes: v.attributes,
                        inventory_quantity: 100,
                        sort_order: v.sort_order,
                    }))
                );
                await connection.commit();
                console.log(`saved ${count} variants → #${product.id} (${product.slug})`);
                updated++;
            } catch (e) {
                await connection.rollback();
                throw e;
            } finally {
                connection.release();
            }
        } catch (e) {
            console.log(`error: ${e.message}`);
            errors++;
        }

        await new Promise((r) => setTimeout(r, 350));
    }

    console.log('\nDone.', { updated, noVariants, notFound, skipped, errors, dryRun });
    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
