'use strict';

/**
 * Full POS catalog sync from Acadia CSV export.
 * Updates matched products: SKU, price, cost, inventory qty, web visibility,
 * and product images (downloads POS image_url when missing or still pointing at acadiapos).
 *
 * Usage:
 *   node scripts/sync-pos-catalog-from-csv.js --file=/path/to/export.csv
 *   node scripts/sync-pos-catalog-from-csv.js --file=... --commit
 *   node scripts/sync-pos-catalog-from-csv.js --file=... --commit --no-images
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { createPool, loadBackendEnv } = require('../utils/dbConfig');
const { normalizeScannedSku } = require('../utils/generateProductSku');

loadBackendEnv();

const args = process.argv.slice(2);
function argVal(name, def = null) {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

const CSV_FILE = argVal('file');
const COMMIT = Boolean(argVal('commit', false));
const DO_IMAGES = !argVal('no-images', false);
const IMAGE_DIR = path.join(__dirname, '..', 'uploads', 'products');
const IMAGE_PREFIX = '/uploads/products';

if (!CSV_FILE) {
  console.error('ERROR: --file required');
  process.exit(1);
}

function parseCSV(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r') { /* */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseMoney(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseQty(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function slugify(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200) || 'product';
}

function rowScore(r) {
  let s = 0;
  if (r.web_status === 'active') s += 8;
  if (r.web_price != null) s += 4;
  if (r.description) s += 2;
  if (r.image_url) s += 2;
  if (r.cost != null) s += 1;
  if (r.qty != null) s += 1;
  return s;
}

function isExternalPosImage(url) {
  if (!url) return false;
  return /acadiapos\.com|manage\.acadiapos/i.test(url) || /^https?:\/\//i.test(url);
}

function isLocalUploadedImage(url) {
  return url && String(url).startsWith('/uploads/products/');
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const resp = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) throw new Error('empty');
    let ext = (url.match(/\.(png|jpe?g|gif|webp)(\?|$)/i) || [])[1] || 'jpg';
    ext = ext.toLowerCase().replace('jpeg', 'jpg');
    const filename = `product-image-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
    await fsp.mkdir(IMAGE_DIR, { recursive: true });
    await fsp.writeFile(path.join(IMAGE_DIR, filename), buf);
    return `${IMAGE_PREFIX}/${filename}`;
  } finally {
    clearTimeout(timeout);
  }
}

const stats = {
  csvRows: 0,
  uniqueSkus: 0,
  matched: 0,
  created: 0,
  priceUpdated: 0,
  costUpdated: 0,
  qtyUpdated: 0,
  skuFixed: 0,
  webVisibilityUpdated: 0,
  imagesAdded: 0,
  imagesReplaced: 0,
  imageFailures: 0,
  skippedNoSku: 0,
  errors: 0,
  errorSamples: [],
};

async function main() {
  console.log(`\n=== POS catalog sync ===`);
  console.log(`File: ${CSV_FILE}`);
  console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`);
  console.log(`Images: ${DO_IMAGES ? 'yes' : 'no'}\n`);

  const text = fs.readFileSync(CSV_FILE, 'utf8');
  const rows = parseCSV(text);
  const header = rows[0].map((h) => h.trim());
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  const need = (r, key) => (idx[key] != null ? (r[idx[key]] || '').trim() : '');

  const bySku = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length <= 1) continue;
    const name = need(r, 'name');
    const sku = normalizeScannedSku(need(r, 'sku'));
    if (!name || !sku) { stats.skippedNoSku++; continue; }
    stats.csvRows++;
    const rec = {
      sku,
      name,
      description: need(r, 'description'),
      price: parseMoney(need(r, 'price')),
      cost: parseMoney(need(r, 'cost')),
      web_price: parseMoney(need(r, 'web_price')),
      web_status: need(r, 'web_status').toLowerCase(),
      vendor: need(r, 'vendor') || 'Unknown',
      category: need(r, 'category') || 'General',
      image_url: need(r, 'image_url'),
      qty: parseQty(need(r, 'qty')),
      low_stock: parseQty(need(r, 'low_stock_qty') || need(r, 'reorder point')) ?? 10,
    };
    const prev = bySku.get(sku);
    if (!prev || rowScore(rec) > rowScore(prev)) bySku.set(sku, rec);
  }
  stats.uniqueSkus = bySku.size;
  console.log(`Parsed ${stats.csvRows} rows → ${stats.uniqueSkus} unique SKUs\n`);

  const pool = createPool({ connectionLimit: 5 });
  const brandCache = new Map();
  const catCache = new Map();

  async function getOrCreateBrand(conn, name) {
    const key = (name || 'Unknown').trim() || 'Unknown';
    if (brandCache.has(key)) return brandCache.get(key);
    const slug = slugify(key);
    const [ex] = await conn.execute('SELECT id FROM brands WHERE name = ? OR slug = ? LIMIT 1', [key, slug]);
    if (ex.length) { brandCache.set(key, ex[0].id); return ex[0].id; }
    if (!COMMIT) { brandCache.set(key, -1); return -1; }
    const [ins] = await conn.execute('INSERT INTO brands (name, slug) VALUES (?, ?)', [key, slug]);
    brandCache.set(key, ins.insertId);
    return ins.insertId;
  }

  async function getOrCreateCategory(conn, name) {
    const key = (name || 'General').trim() || 'General';
    if (catCache.has(key)) return catCache.get(key);
    const slug = slugify(key);
    const [ex] = await conn.execute('SELECT id FROM product_categories WHERE name = ? OR slug = ? LIMIT 1', [key, slug]);
    if (ex.length) { catCache.set(key, ex[0].id); return ex[0].id; }
    if (!COMMIT) { catCache.set(key, -1); return -1; }
    const [ins] = await conn.execute('INSERT INTO product_categories (name, slug) VALUES (?, ?)', [key, slug]);
    catCache.set(key, ins.insertId);
    return ins.insertId;
  }

  async function findProduct(conn, rec) {
    const [bySku] = await conn.execute('SELECT id, sku, name FROM products WHERE sku = ? LIMIT 1', [rec.sku]);
    if (bySku.length) return bySku[0];
    const [byName] = await conn.execute('SELECT id, sku, name FROM products WHERE name = ? LIMIT 1', [rec.name]);
    if (byName.length) return byName[0];
    return null;
  }

  async function syncImage(conn, productId, rec) {
    if (!DO_IMAGES || !rec.image_url || !COMMIT) return;
    const [imgs] = await conn.execute(
      'SELECT id, image_url FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC',
      [productId]
    );
    const hasLocal = imgs.some((im) => isLocalUploadedImage(im.image_url));
    const hasExternalOnly = imgs.length > 0 && imgs.every((im) => isExternalPosImage(im.image_url));
    const needsImage = imgs.length === 0 || hasExternalOnly;

    if (!needsImage && hasLocal) return;

    try {
      const localUrl = await downloadImage(rec.image_url);
      if (imgs.length === 0) {
        await conn.execute(
          'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
          [productId, localUrl, rec.name.slice(0, 200)]
        );
        stats.imagesAdded++;
      } else if (hasExternalOnly) {
        await conn.execute('DELETE FROM product_images WHERE product_id = ?', [productId]);
        await conn.execute(
          'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
          [productId, localUrl, rec.name.slice(0, 200)]
        );
        stats.imagesReplaced++;
      }
    } catch (e) {
      stats.imageFailures++;
      if (stats.errorSamples.length < 20) {
        stats.errorSamples.push({ sku: rec.sku, msg: 'image: ' + e.message });
      }
    }
  }

  let n = 0;
  for (const rec of bySku.values()) {
    n++;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const webActive = rec.web_status === 'active';
      const sitePrice = (webActive && rec.web_price != null) ? rec.web_price : rec.price;
      const showOnWeb = webActive ? 1 : 0;

      let product = await findProduct(conn, rec);

      if (product) {
        stats.matched++;
        const productId = product.id;
        let skuToUse = rec.sku;

        if (normalizeScannedSku(product.sku) !== rec.sku) {
          const [conflict] = await conn.execute('SELECT id FROM products WHERE sku = ? AND id != ? LIMIT 1', [rec.sku, productId]);
          if (!conflict.length) {
            if (COMMIT) {
              await conn.execute('UPDATE products SET sku = ? WHERE id = ?', [rec.sku, productId]);
            }
            stats.skuFixed++;
          }
        }

        if (COMMIT) {
          await conn.execute(
            `UPDATE products SET
              price = COALESCE(?, price),
              cost_price = COALESCE(?, cost_price),
              inventory_quantity = COALESCE(?, inventory_quantity),
              low_stock_threshold = COALESCE(?, low_stock_threshold),
              show_on_web = ?,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [sitePrice, rec.cost, rec.qty, rec.low_stock, showOnWeb, productId]
          );
        }
        if (sitePrice != null) stats.priceUpdated++;
        if (rec.cost != null) stats.costUpdated++;
        if (rec.qty != null) stats.qtyUpdated++;
        stats.webVisibilityUpdated++;

        await syncImage(conn, productId, rec);
        await conn.commit();
      } else {
        if (!COMMIT) {
          stats.created++;
          await conn.rollback();
          conn.release();
          if (n % 500 === 0) console.log(`  ${n}/${stats.uniqueSkus}...`);
          continue;
        }
        const brandId = await getOrCreateBrand(conn, rec.vendor);
        const catId = await getOrCreateCategory(conn, rec.category);
        let slug = slugify(rec.name);
        const [sh] = await conn.execute('SELECT id FROM products WHERE slug = ? LIMIT 1', [slug]);
        if (sh.length) slug = slugify(`${rec.name}-${rec.sku}`);
        const [ins] = await conn.execute(
          `INSERT INTO products (sku, name, slug, long_description, short_description, brand_id, category_id,
            price, cost_price, inventory_quantity, low_stock_threshold, is_active, show_on_web)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [
            rec.sku, rec.name, slug,
            rec.description || null,
            rec.description ? rec.description.slice(0, 200) : null,
            brandId, catId, sitePrice, rec.cost, rec.qty ?? 0, rec.low_stock, showOnWeb,
          ]
        );
        stats.created++;
        await syncImage(conn, ins.insertId, rec);
        await conn.commit();
      }
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      stats.errors++;
      if (stats.errorSamples.length < 20) stats.errorSamples.push({ sku: rec.sku, msg: e.message });
    } finally {
      conn.release();
    }
    if (n % 500 === 0) console.log(`  ${n}/${stats.uniqueSkus} (matched=${stats.matched}, qty=${stats.qtyUpdated})...`);
  }

  await pool.end();
  printSummary();
}

function printSummary() {
  console.log('\n=== SUMMARY ===');
  console.log(`Unique SKUs in CSV:     ${stats.uniqueSkus}`);
  console.log(`Matched & updated:      ${stats.matched}`);
  console.log(`New products created:   ${stats.created}`);
  console.log(`Prices synced:          ${stats.priceUpdated}`);
  console.log(`Costs synced:           ${stats.costUpdated}`);
  console.log(`Quantities synced:      ${stats.qtyUpdated}`);
  console.log(`SKUs corrected:         ${stats.skuFixed}`);
  console.log(`Web visibility synced:  ${stats.webVisibilityUpdated}`);
  console.log(`Images added:           ${stats.imagesAdded}`);
  console.log(`Images replaced:        ${stats.imagesReplaced}`);
  console.log(`Image failures:         ${stats.imageFailures}`);
  console.log(`Skipped (no sku/name):  ${stats.skippedNoSku}`);
  console.log(`Errors:                 ${stats.errors}`);
  if (stats.errorSamples.length) {
    console.log('--- samples ---');
    stats.errorSamples.forEach((e) => console.log(`  [${e.sku}] ${e.msg}`));
  }
  console.log(COMMIT ? '\nDONE (committed).' : '\nDONE (dry run). Use --commit to apply.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
