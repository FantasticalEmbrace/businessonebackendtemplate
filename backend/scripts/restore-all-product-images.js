#!/usr/bin/env node
/**
 * For every product: ensure a working primary image_url pointing at the repo.
 *
 * - Skips products whose primary URL is already /images/... and the file exists on disk.
 * - Otherwise tries to match a file from images/products + images/ (same logic as
 *   link-product-images-from-folder: SKU / slug / name / partial), using each file once.
 * - Remaining rows get DEFAULT_FALLBACK (real JPEG in repo).
 * - Replaces: missing row, empty URL, legacy wp/hmherbs Concrete thumbnails, /uploads/,
 *   and /images/... when the file is missing.
 *
 * Usage (from backend/):
 *   node scripts/restore-all-product-images.js --dry-run
 *   node scripts/restore-all-product-images.js
 */
const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
const fs = require('fs').promises;
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const REPO_ROOT = path.join(__dirname, '..', '..');
const IMAGES_DIR = path.join(REPO_ROOT, 'images');
const PRODUCTS_SUBDIR = path.join(IMAGES_DIR, 'products');

const DEFAULT_FALLBACK = '/images/products/nature-s-puls-probiotic-mega.jpg';

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
    const enc = encodeURIComponent(filename);
    if (subfolder === 'products') return `/images/products/${enc}`;
    return `/images/${enc}`;
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
        /* no dir */
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
        /* no dir */
    }
    return list;
}

async function publicImageFileExists(publicPath) {
    if (!publicPath || typeof publicPath !== 'string' || !publicPath.startsWith('/images/')) {
        return false;
    }
    const parts = publicPath.replace(/^\/+/, '').split('/').map((s) => {
        try {
            return decodeURIComponent(s);
        } catch {
            return s;
        }
    });
    const fsPath = path.join(REPO_ROOT, ...parts);
    try {
        await fs.access(fsPath);
        return true;
    } catch {
        return false;
    }
}

function isLegacyConcreteUrl(u) {
    return (
        /hmherbs\.com\/application\/files\//i.test(u) ||
        /i0\.wp\.com\/hmherbs\.com\/application\/files\//i.test(u)
    );
}

async function needsWork(imageUrl, imageRowId) {
    if (!imageRowId) return true;
    const u = (imageUrl && String(imageUrl).trim()) || '';
    if (!u) return true;
    if (isLegacyConcreteUrl(u)) return true;
    if (u.startsWith('/uploads/')) return true;
    if (u.startsWith('/images/')) {
        return !(await publicImageFileExists(u));
    }
    if (/^https?:\/\//i.test(u)) {
        // Other remote URLs often 404 or CORB; treat as needing a local path
        return true;
    }
    return false;
}

/** Higher = better. 0 = no match. */
function scoreFileForProduct(product, stemRaw) {
    const stem = stripTrailingContentHash(cleanStem(stemRaw.trim()));
    const sku = product.sku != null ? String(product.sku).trim().toLowerCase() : '';
    const slug = product.slug != null ? slugify(String(product.slug)) : '';
    const nameSlug = slugify(product.name || '');

    if (sku && stem.toLowerCase() === sku) return 100;
    if (sku && cleanStem(stemRaw).toLowerCase() === sku) return 100;

    const s1 = slugify(stem);
    if (slug && s1 === slug) return 98;
    if (nameSlug && s1 === nameSlug) return 96;

    const candidates = [s1, slugify(cleanStem(stemRaw)), slugify(stripTrailingContentHash(stemRaw))].filter(Boolean);
    for (const candi of candidates) {
        if (candi.length >= 8 && nameSlug) {
            const [shorter, longer] =
                candi.length <= nameSlug.length ? [candi, nameSlug] : [nameSlug, candi];
            if (shorter.length >= 12 && longer.includes(shorter)) return 70;
        }
    }
    return 0;
}

/**
 * Strong matches (96+) reserve a file so one SKU/slug owns it.
 * Weaker fuzzy matches (70–95) may reuse the same file for many products.
 */
function pickBestFile(product, files, reservedPaths) {
    let best = null;
    let bestScore = 0;
    for (const f of files) {
        if (reservedPaths.has(f.full)) continue;
        const stem = path.basename(f.name, path.extname(f.name));
        const sc = scoreFileForProduct(product, stem);
        if (sc >= 96 && sc > bestScore) {
            best = f;
            bestScore = sc;
        }
    }
    if (best) {
        return { file: best, reserve: true };
    }

    bestScore = 0;
    best = null;
    for (const f of files) {
        const stem = path.basename(f.name, path.extname(f.name));
        const sc = scoreFileForProduct(product, stem);
        if (sc >= 70 && sc > bestScore) {
            best = f;
            bestScore = sc;
        }
    }
    return bestScore >= 70 && best ? { file: best, reserve: false } : null;
}

/** Stable ordered list of /images/... URLs for every file we have (rotation when no strong match). */
function fallbackPoolUrls(files) {
    const urls = files
        .map((f) => webUrl(f.sub === 'products' ? 'products' : '', f.name))
        .filter((u, i, a) => a.indexOf(u) === i)
        .sort();
    if (!urls.includes(DEFAULT_FALLBACK)) {
        urls.push(DEFAULT_FALLBACK);
    }
    return urls.length > 0 ? urls : [DEFAULT_FALLBACK];
}

async function setPrimary(pool, productId, name, url, dryRun, verboseDry) {
    if (dryRun) {
        if (verboseDry) {
            console.log(`  [dry-run] #${productId} → ${url}`);
        }
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

    const [rows] = await pool.query(`
        SELECT p.id, p.sku, p.name, p.slug, pi.id AS image_row_id, pi.image_url
        FROM products p
        LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
        ORDER BY p.id
    `);

    const files = await collectFiles();
    const usedFiles = new Set();
    const poolUrls = fallbackPoolUrls(files);

    let skippedOk = 0;
    let directMatch = 0;
    let rotatedFallback = 0;

    console.log(dryRun ? 'DRY RUN\n' : 'Restoring product images…\n');
    console.log(`Products: ${rows.length}, image files on disk: ${files.length}`);
    console.log(`Placeholder rotation pool: ${poolUrls.length} URLs\n`);

    for (const product of rows) {
        const need = await needsWork(product.image_url, product.image_row_id);
        if (!need) {
            skippedOk++;
            continue;
        }

        const pick = pickBestFile(product, files, usedFiles);
        let url;
        if (pick) {
            const f = pick.file;
            if (pick.reserve) {
                usedFiles.add(f.full);
            }
            url = webUrl(f.sub === 'products' ? 'products' : '', f.name);
            directMatch++;
            if (!dryRun && directMatch <= 40) {
                console.log(`  match #${product.id} ${product.name} → ${f.name}${pick.reserve ? '' : ' (shared fuzzy)'}`);
            }
        } else {
            url = poolUrls[product.id % poolUrls.length];
            rotatedFallback++;
        }

        await setPrimary(pool, product.id, product.name, url, dryRun, false);
    }

    await pool.end();

    console.log('\n--- Summary ---');
    console.log(`Already_OK (local /images file on disk): ${skippedOk}`);
    console.log(`Direct file match (SKU/slug/name/fuzzy): ${directMatch}`);
    console.log(`Rotated among ${poolUrls.length} on-disk images: ${rotatedFallback}`);
    if (dryRun) console.log('\nRe-run without --dry-run to apply.');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
