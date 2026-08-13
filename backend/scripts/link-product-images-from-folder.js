#!/usr/bin/env node
/**
 * Point product_images at files under the repo `images/` folder.
 *
 * Scans:
 *   - <repo>/images/products/*
 *   - <repo>/images/* (product-style files only; skips icons/logo/etc.)
 *
 * Match order for each file stem (filename without extension):
 *   1. SKU exact (case-insensitive), including numeric SKUs
 *   2. Product slug exact (slugified stem === stored slug)
 *   3. Slugified product name === slugified stem
 *   4. Long stems only: slug(name) contains slug(stem) or the reverse (>= 12 chars on smaller side)
 *
 * Optional manual map: backend/scripts/product-image-map.json
 *   { "BURIED TREASURE ACF EXT STRENGTH PM.jpg": "05284", "other.png": "product-slug-here" }
 *   Value can be SKU or slug.
 *
 * Usage (from backend/):
 *   node scripts/link-product-images-from-folder.js --dry-run
 *   node scripts/link-product-images-from-folder.js
 *
 * Env: DB_* from backend/.env (same as other scripts)
 */
const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
const fs = require('fs').promises;
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const REPO_ROOT = path.join(__dirname, '..', '..');
const IMAGES_DIR = path.join(REPO_ROOT, 'images');
const PRODUCTS_SUBDIR = path.join(IMAGES_DIR, 'products');
const MAP_FILE = path.join(__dirname, 'product-image-map.json');

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;

function parseArgs() {
    const args = process.argv.slice(2);
    return { dryRun: args.includes('--dry-run') };
}

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\.[^.]+$/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function cleanStem(stem) {
    return String(stem || '')
        .replace(/\._AC_[A-Z0-9,_-]+$/i, '')
        .replace(/\s*[-–]\s*free shipping$/i, '')
        .replace(/\s*\(\d+\)\s*$/g, '')
        .trim();
}

/** Strip trailing long hex hash (scraped CDN filenames). */
function stripTrailingContentHash(stem) {
    return String(stem || '').replace(/-[0-9a-f]{20,}$/i, '').trim();
}

function shouldIgnoreRootFile(name) {
    const n = name.toLowerCase();
    if (!IMAGE_EXT.test(name)) return true;
    if (/^(icon-|edsa|health-icon|search-icon|account-icon)/.test(n)) return true;
    if (/^(og-image|twitter-card|screenshot-|storefront|manifest)/.test(n)) return true;
    if (n === 'logo.png' || n === 'hm herbs logo.png') return true;
    if (/^product-image-\d+/i.test(name.replace(/\.\w+$/, ''))) return true;
    return false;
}

function webUrl(subfolder, filename) {
    if (subfolder === 'products') return `/images/products/${filename}`;
    return `/images/${filename}`;
}

async function loadManualMap() {
    try {
        const raw = await fs.readFile(MAP_FILE, 'utf8');
        const j = JSON.parse(raw);
        return j && typeof j === 'object' ? j : {};
    } catch {
        return {};
    }
}

async function collectFiles() {
    const list = [];

    try {
        const names = await fs.readdir(PRODUCTS_SUBDIR);
        for (const name of names) {
            if (!IMAGE_EXT.test(name)) continue;
            const full = path.join(PRODUCTS_SUBDIR, name);
            const st = await fs.stat(full);
            if (st.isFile()) list.push({ sub: 'products', name, full });
        }
    } catch {
        /* no products subdir */
    }

    try {
        const names = await fs.readdir(IMAGES_DIR);
        for (const name of names) {
            if (shouldIgnoreRootFile(name)) continue;
            const full = path.join(IMAGES_DIR, name);
            const st = await fs.stat(full);
            if (st.isFile()) list.push({ sub: '', name, full });
        }
    } catch {
        /* no images dir */
    }

    return list;
}

function productIdFromFilename(stem) {
    const m = String(stem).match(/-id(\d+)(?:-|$)/i);
    return m ? parseInt(m[1], 10) : null;
}

function normalizeImageStem(stem) {
    return cleanStem(stripTrailingContentHash(String(stem || '')))
        .replace(/-hmherbs-primary$/i, '')
        .replace(/-official$/i, '')
        .trim();
}

function baseSlugFromFilename(stem) {
    return normalizeImageStem(stem)
        .replace(/-id\d+.*$/i, '')
        .replace(/-hmherbs-primary$/i, '')
        .replace(/-+$/, '');
}

function findProductForStem(stem, products, bySku, bySlug, byNameSlug, byId) {
    const idFromFile = productIdFromFilename(stem);
    if (idFromFile && byId.has(idFromFile)) {
        return { product: byId.get(idFromFile), how: 'filename-id' };
    }

    const raw = stem.trim();
    const cleaned = normalizeImageStem(raw);
    const baseSlug = baseSlugFromFilename(raw);
    if (baseSlug.length >= 10) {
        let best = null;
        for (const p of products) {
            const ps = slugify(String(p.slug || ''));
            if (!ps) continue;
            if (ps === baseSlug || ps.startsWith(`${baseSlug}-`) || baseSlug.startsWith(ps)) {
                if (!best || ps.length < slugify(String(best.slug || '')).length) {
                    best = p;
                }
            }
        }
        if (best) return { product: best, how: 'slug-prefix' };
    }

    const dehashed = stripTrailingContentHash(cleaned);
    const candidates = [raw, cleaned, dehashed].filter(Boolean);

    for (const c of candidates) {
        const k = c.toLowerCase().trim();
        if (bySku.has(k)) return { product: bySku.get(k), how: 'sku' };
    }

    const slugCandidates = [slugify(cleaned || raw), slugify(dehashed)].filter(Boolean);
    for (const slugFromStem of slugCandidates) {
        if (slugFromStem && bySlug.has(slugFromStem)) {
            return { product: bySlug.get(slugFromStem), how: 'slug' };
        }
        if (slugFromStem && byNameSlug.has(slugFromStem)) {
            return { product: byNameSlug.get(slugFromStem), how: 'name-slug' };
        }
    }

    const slugFromStem = slugCandidates[0] || '';
    if (slugFromStem.length >= 8) {
        for (const p of products) {
            const ns = slugify(p.name);
            if (!ns) continue;
            const a = slugFromStem;
            const b = ns;
            const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
            if (shorter.length < 12) continue;
            if (longer.includes(shorter)) {
                return { product: p, how: 'name-partial' };
            }
        }
    }

    return null;
}

async function setPrimary(pool, productId, name, url, dryRun) {
    if (dryRun) {
        console.log(`  [dry-run] #${productId} ${name}\n           → ${url}`);
        return;
    }
    const [existing] = await pool.execute(
        'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1',
        [productId]
    );
    if (existing.length > 0) {
        await pool.execute('UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?', [
            url,
            name,
            existing[0].id
        ]);
    } else {
        await pool.execute(
            'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
            [productId, url, name]
        );
    }
}

(async () => {
    loadBackendEnv();
    const { dryRun } = parseArgs();

    const pool = createPool({ connectionLimit: 5 });

    const [rows] = await pool.query(
        "SELECT id, sku, name, slug FROM products WHERE COALESCE(TRIM(slug), '') <> '' OR COALESCE(TRIM(sku), '') <> ''"
    );
    const products = rows;

    const bySku = new Map();
    const bySlug = new Map();
    const byNameSlug = new Map();
    const byId = new Map();

    for (const p of products) {
        byId.set(p.id, p);
        if (p.sku != null && String(p.sku).trim() !== '') {
            bySku.set(String(p.sku).trim().toLowerCase(), p);
        }
        if (p.slug != null && String(p.slug).trim() !== '') {
            bySlug.set(slugify(String(p.slug)), p);
        }
        const ns = slugify(p.name);
        if (ns && !byNameSlug.has(ns)) byNameSlug.set(ns, p);
    }

    const files = await collectFiles();
    const manual = await loadManualMap();

    console.log(dryRun ? 'DRY RUN — database not updated\n' : 'Linking images…\n');
    console.log(`Products in DB: ${products.length}`);
    console.log(`Image files found: ${files.length}\n`);

    let linked = 0;
    let skipped = 0;
    const assignedProductIds = new Map();

    for (const f of files) {
        const stem = path.basename(f.name, path.extname(f.name));
        const url = webUrl(f.sub === 'products' ? 'products' : '', f.name);

        let match = null;

        if (manual[f.name]) {
            const key = String(manual[f.name]).trim().toLowerCase();
            let p = bySku.get(key);
            if (!p && bySlug.has(slugify(key))) p = bySlug.get(slugify(key));
            if (p) match = { product: p, how: 'manual-map' };
            else console.warn(`  Manual map ${f.name} → "${manual[f.name]}" — no product match`);
        }

        if (!match) {
            match = findProductForStem(stem, products, bySku, bySlug, byNameSlug, byId);
        }

        if (!match) {
            console.warn(`  No match: ${f.sub ? 'images/products/' : 'images/'}${f.name}`);
            skipped++;
            continue;
        }

        const prev = assignedProductIds.get(match.product.id);
        if (prev) {
            console.warn(
                `  Duplicate assign to ${match.product.name} (#${match.product.id}): had ${prev}, also ${f.name} — using last`
            );
        }
        assignedProductIds.set(match.product.id, f.name);

        console.log(`  ✓ ${f.name} → ${match.product.name} (${match.how})`);
        await setPrimary(pool, match.product.id, match.product.name, url, dryRun);
        linked++;
    }

    await pool.end();

    console.log(`\nDone: ${linked} linked, ${skipped} unmatched.${dryRun ? ' (dry-run — re-run without --dry-run to apply)' : ''}`);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
