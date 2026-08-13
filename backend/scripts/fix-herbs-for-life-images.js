#!/usr/bin/env node
/**
 * Herbs For Life: replace mistaken images (e.g. BBB badges from 404/error HTML) with canonical
 * hmherbs CDN product shots from scraped catalog data.
 *
 * Usage (from backend/): node scripts/fix-herbs-for-life-images.js
 */
const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const BASE = 'https://hmherbs.com';
const REPO_ROOT = path.join(__dirname, '..', '..');
const IMAGES_DIR = path.join(REPO_ROOT, 'images', 'products');

const DEFAULT_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
    Referer: `${BASE}/`
};

/** Primary product photo per SKU (from hmherbs.com / scraped-products.json) */
const SKU_TO_IMAGE_URL = {
    '04592':
        'https://i0.wp.com/hmherbs.com/application/files/cache/thumbnails/herbs-for-life-cbd-gummies-30mg-900mg-per-bottle-e449babf3c65d85ead81a2f1ac0613d4.jpg',
    '58172-CB':
        'https://hmherbs.com/application/files/5517/4172/5177/1ADEBF3A-9B46-4106-A423-95343A2E5914.webp',
    '4778':
        'https://i0.wp.com/hmherbs.com/application/files/cache/thumbnails/herbs-for-life-delta-8-gummies-25mg-30-ct-b7d32860c2e82cf0d52261f0d4845c61.jpg',
    '08851':
        'https://i0.wp.com/hmherbs.com/application/files/cache/thumbnails/herbs-for-life-delta-9-gummies-10mg-40ct-2f7035d0b0f032da6c9bd35c9263cd82.jpg'
};

function safeSlugSegment(s) {
    return String(s || '')
        .replace(/[/\\?*:|"<>]/g, '-')
        .replace(/\s+/g, '-')
        .substring(0, 120);
}

function extFromUrl(u) {
    const clean = String(u).split('?')[0];
    const m = clean.match(/\.(jpe?g|png|gif|webp)$/i);
    return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

async function downloadBinary(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 45000,
        maxRedirects: 5,
        headers: DEFAULT_HEADERS,
        validateStatus: (s) => s === 200
    });
    const buf = Buffer.from(res.data);
    if (buf.length < 200) {
        throw new Error(`Image too small (${buf.length} bytes)`);
    }
    return buf;
}

(async () => {
    loadBackendEnv();
    await fs.mkdir(IMAGES_DIR, { recursive: true });

    const pool = createPool({ connectionLimit: 5 });

    const skus = Object.keys(SKU_TO_IMAGE_URL);
    const [rows] = await pool.execute(
        `SELECT id, sku, slug, name FROM products WHERE sku IN (${skus.map(() => '?').join(',')})`,
        skus
    );

    for (const p of rows) {
        const sku = String(p.sku).trim();
        const srcUrl = SKU_TO_IMAGE_URL[sku];
        if (!srcUrl) continue;

        const stem = safeSlugSegment(p.slug || p.sku || `product-${p.id}`);
        const ext = extFromUrl(srcUrl);
        const filename = `${stem}-id${p.id}-hmherbs-primary.${ext}`;
        const fsPath = path.join(IMAGES_DIR, filename);
        const publicUrl = `/images/products/${encodeURIComponent(filename)}`;

        try {
            const buf = await downloadBinary(srcUrl);
            await fs.writeFile(fsPath, buf);
            console.log(`✅ #${p.id} ${p.name} — ${filename} (${buf.length} b)`);
        } catch (e) {
            console.error(`❌ #${p.id} ${sku} download: ${e.message}`);
            continue;
        }

        const [existing] = await pool.execute(
            'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1 LIMIT 1',
            [p.id]
        );
        const alt = (p.name || '').substring(0, 500);
        if (existing.length > 0) {
            await pool.execute('UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?', [
                publicUrl,
                alt,
                existing[0].id
            ]);
        } else {
            await pool.execute(
                'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
                [p.id, publicUrl, alt]
            );
        }
    }

    await pool.end();
    console.log('Done.');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
