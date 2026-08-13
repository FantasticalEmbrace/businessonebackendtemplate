'use strict';

/**
 * Add web-active CSV rows that had no barcode/SKU, using researched UPCs,
 * descriptions, and downloaded images. Skips items already in DB by SKU or name.
 *
 * Usage: node scripts/add-missing-web-products.js [--commit]
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { createPool, loadBackendEnv } = require('../utils/dbConfig');
const { normalizeScannedSku } = require('../utils/generateProductSku');

loadBackendEnv();

const COMMIT = process.argv.includes('--commit');
const IMAGE_DIR = path.join(__dirname, '..', 'uploads', 'products');
const IMAGE_PREFIX = '/uploads/products';

const ITEMS = [
  { name: 'SABA AM 300', sku: '101013', brand: 'Saba', category: 'Herbs & Vitamins', price: 48.95, cost: null, web_price: null, show_on_web: 1,
    desc: 'Metabolism and weight-management supplement (90 capsules) supporting fat burning, energy, and appetite control when used with exercise.',
    image: 'https://i.ebayimg.com/images/g/z9IAAOSwU8ljxazx/s-l1600.webp' },
  { name: 'REGALABS HAPPY FOOT CREAM', sku: '2070', brand: 'Regal Labs', category: 'Herbs & Vitamins', price: 21.99, cost: null, web_price: 32.0, show_on_web: 1,
    desc: 'Advanced foot-care cream with urea, allantoin, and herbal extracts to soothe tired feet, exfoliate, and support circulation.',
    image: 'https://hmherbs.com/application/files/5017/4155/8831/Regalabs_Happy_Feet_8oz_tube.jpg' },
  { name: "Doctor's Blend Reds & Greens Complete", sku: '850044885138', brand: "Doctor's Blend", category: 'Herbs & Vitamins', price: 25.99, cost: null, web_price: 28.99, show_on_web: 1,
    desc: 'One-capsule daily blend of fruit and vegetable phytonutrients (Phytoserv) equivalent to several produce servings.',
    image: null },
  { name: "Doctor's Blend Total Brain Balance", sku: 'DB-TOTAL-BRAIN-BALANCE', brand: "Doctor's Blend", category: 'Herbs & Vitamins', price: 36.99, cost: null, web_price: 39.95, show_on_web: 1,
    desc: 'Cognitive support powder with Lion\'s Mane, Alpha-GPC, Ashwagandha, and CognatiQ for memory, focus, and stress resilience.',
    image: null },
  { name: "Doctor's Blend Berberine", sku: '850044885817', brand: "Doctor's Blend", category: 'Herbs & Vitamins', price: 31.99, cost: null, web_price: 31.99, show_on_web: 1,
    desc: '60-capsule berberine formula from goldenseal and barberry for blood sugar, metabolism, and gut support.',
    image: null },
  { name: "Doctor's Blend Advanced Joint Relief", sku: '8517', brand: "Doctor's Blend", category: 'Herbs & Vitamins', price: 29.99, cost: null, web_price: null, show_on_web: 1,
    desc: 'Joint formula with glucosamine, chondroitin, MSM, boswellia, and cissus for arthritis and exercise-related joint discomfort.',
    image: null },
  { name: "Doctor's Blend Nutri-Sorb", sku: '8518', brand: "Doctor's Blend", category: 'Herbs & Vitamins', price: 18.99, cost: null, web_price: 18.99, show_on_web: 1,
    desc: 'Absorption booster with Astragin and BioPerine to improve nutrient uptake, gut health, and metabolism.',
    image: null },
  { name: 'Unicity Balance Natural Mix Berry', sku: '194326359321', brand: 'Unicity', category: 'Herbs & Vitamins', price: 64.0, cost: null, web_price: 64.0, show_on_web: 1,
    desc: 'Pre-meal fiber drink in mixed berry flavor with soluble fibers, vitamins, and minerals to support glucose metabolism.',
    image: 'https://s3.amazonaws.com/cdn.unicityscience.org/wp-content/uploads/2020/07/16111429/PDR_Product_Images_Balance-1-2-e1678965314761.png' },
  { name: 'UNICITY OMEGA LIFE RESOLV', sku: '194326320482', brand: 'Unicity', category: 'Herbs & Vitamins', price: 59.0, cost: null, web_price: 59.0, show_on_web: 1,
    desc: 'Purified fish-oil supplement (120 softgels) with EPA/DHA plus L-arginine and wintergreen.',
    image: 'https://d2j6dbq0eux0bg.cloudfront.net/images/30317045/4878642841.jpg' },
  { name: 'UNICITY FEEL GREAT UNIMATE BALANCE', sku: '194326358980', brand: 'Unicity', category: 'Herbs & Vitamins', price: 219.0, cost: null, web_price: 219.0, show_on_web: 1,
    desc: 'Bundle of Unicity Balance and Unimate stick packs for the Feel Great metabolic-health system.',
    image: 'https://m.media-amazon.com/images/I/31I9pBP0O9L._SX300_SY300_QL70_ML2_.jpg' },
  { name: 'UNICITY JOINT MOBILITY', sku: '93047', brand: 'Unicity', category: 'Herbs & Vitamins', price: 43.0, cost: null, web_price: 58.95, show_on_web: 1,
    desc: 'Joint supplement with UC-II collagen, turmeric, boswellia, and vitamin D3 for cartilage and mobility support.',
    image: 'https://cosmic-assets.unicity.com/EUROZONE/configurable_product_images/93047e38ba834323a8fab60f56d9a6f2/assets2F2d5880f5115a4781a58e43a68427e8e3.webp' },
  { name: "Our Father's Healing Herbs Cayenne Deep Heat Salve", sku: 'HS-06', brand: "Our Father's Healing Herbs", category: 'Herbs & Vitamins', price: 15.99, cost: null, web_price: 18.99, show_on_web: 1,
    desc: 'Topical deep-heat salve with cayenne and white willow for arthritis, sore muscles, and stiff joints.',
    image: null },
  { name: "Our Father's Healing Herbs Breathing Salve", sku: 'HS-04', brand: "Our Father's Healing Herbs", category: 'Herbs & Vitamins', price: 15.99, cost: null, web_price: 18.99, show_on_web: 1,
    desc: 'Chest rub with fenugreek, mullein, and eucalyptus for sinus congestion, colds, and breathing support.',
    image: null },
  { name: "Our Father's Healing Herbs Healing Antiseptic Salve 2oz", sku: 'HS-01', brand: "Our Father's Healing Herbs", category: 'Herbs & Vitamins', price: 15.99, cost: null, web_price: 18.99, show_on_web: 1,
    desc: 'Herbal antiseptic salve for cuts, burns, eczema, and skin irritations using comfrey, plantain, and goldenseal.',
    image: null },
  { name: "Our Father's Healing Herbs Anti-Inflammatory", sku: 'HS-02', brand: "Our Father's Healing Herbs", category: 'Herbs & Vitamins', price: 15.99, cost: null, web_price: 18.99, show_on_web: 1,
    desc: 'Anti-inflammatory salve for itchy skin, insect bites, and irritation with turmeric, arnica, and cayenne.',
    image: null },
  { name: "DR. TONY'S RADIANT GREENS", sku: '21008', brand: "Dr Tony O'Donnell", category: 'Herbs & Vitamins', price: 45.95, cost: null, web_price: null, show_on_web: 1,
    desc: 'Non-GMO greens superfood powder with organic grasses, vegetables, and herbs to support energy and immunity.',
    image: 'https://i5.walmartimages.com/seo/Radiant-Greens-Natural-by-Tony-O-Donnell-9-6-Oz-30-Servings_26b7c1cc-4c75-4731-a992-c730d227cab9.22fd7af2aa1ca89bdc0447640537e003.jpeg' },
  { name: "NATURE'S BALANCE CYCHROMAX", sku: 'NB-CYCHRO', brand: "Nature's Balance", category: 'Herbs & Vitamins', price: 39.99, cost: null, web_price: 39.99, show_on_web: 1,
    desc: 'Liver and detox support with chlorella and calcium D-glucarate to aid phase I/II detox pathways (180 caps).',
    image: null },
  { name: 'STANDARD ENZYME O2 SUPPORT', sku: 'SE-O2-SUPPORT', brand: 'Standard Enzyme Company', category: 'Herbs & Vitamins', price: 40.0, cost: null, web_price: null, show_on_web: 1,
    desc: 'Liquid supplement with B vitamins formulated to support oxygen levels in the bloodstream.',
    image: null },
  { name: 'STANDARD ENZYME PROSTA PLUS', sku: '85000229', brand: 'Standard Enzyme Company', category: 'Herbs & Vitamins', price: 50.5, cost: null, web_price: null, show_on_web: 1,
    desc: 'Prostate health formula with bovine prostate tissue, saw palmetto, zinc, and herbs (120 capsules).',
    image: null },
  { name: 'NEWTON INSOMNIA', sku: '788199000710', brand: 'Newton Homeopathics', category: 'Herbs & Vitamins', price: 17.95, cost: null, web_price: 17.95, show_on_web: 1,
    desc: 'Homeopathic I-Sleep liquid for sleeplessness, frequent waking, and restlessness; take before bedtime.',
    image: null },
  { name: 'HM HAPPY PMS CREAM JAR', sku: '0738523769615', brand: 'HM Enterprises', category: 'Herbs & Vitamins', price: 18.99, cost: null, web_price: 18.99, show_on_web: 1,
    desc: 'Plant-derived progesterone moisturizing cream (1200 mg per 2 oz jar) for PMS and hormone-balance support.',
    image: 'https://i.ebayimg.com/images/g/lWcAAOSw5OtnmkMq/s-l225.jpg' },
  { name: '5 DAY FORECAST FOR MEN', sku: '094922052841', brand: '5 Day Forecast', category: 'Herbs & Vitamins', price: 26.95, cost: null, web_price: 27.95, show_on_web: 1,
    desc: 'Male enhancement dietary supplement with proprietary herbal blend, 6 capsules per bottle.',
    image: null },
];

function slugify(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200) || 'product';
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
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

(async () => {
  console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`);
  const pool = createPool({ connectionLimit: 3 });
  const stats = { skipped: 0, created: 0, enriched: 0, errors: 0 };

  for (const item of ITEMS) {
    const sku = normalizeScannedSku(item.sku);
    const sitePrice = item.web_price != null ? item.web_price : item.price;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [bySku] = await conn.execute('SELECT id, short_description, long_description FROM products WHERE sku = ? LIMIT 1', [sku]);
      const [byName] = await conn.execute('SELECT id, sku, short_description, long_description FROM products WHERE name = ? LIMIT 1', [item.name]);
      const existing = bySku[0] || byName[0];

      if (existing) {
        stats.skipped++;
        if (COMMIT) {
          const hasDesc = (existing.short_description && existing.short_description.trim()) || (existing.long_description && existing.long_description.trim());
          if (!hasDesc && item.desc) {
            await conn.execute('UPDATE products SET long_description = ?, short_description = ? WHERE id = ?', [
              item.desc, item.desc.slice(0, 200), existing.id
            ]);
            stats.enriched++;
          }
          if (item.image) {
            const [imgs] = await conn.execute('SELECT COUNT(*) n FROM product_images WHERE product_id = ?', [existing.id]);
            if (imgs[0].n === 0) {
              try {
                const local = await downloadImage(item.image);
                await conn.execute(
                  'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
                  [existing.id, local, item.name.slice(0, 200)]
                );
                stats.enriched++;
              } catch (_) { /* image optional */ }
            }
          }
          await conn.execute(
            'UPDATE products SET price = ?, show_on_web = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [sitePrice, existing.id]
          );
        }
        await conn.commit();
        conn.release();
        continue;
      }

      if (!COMMIT) { stats.created++; await conn.rollback(); conn.release(); continue; }

      const [brand] = await conn.execute('SELECT id FROM brands WHERE name = ? LIMIT 1', [item.brand]);
      let brandId = brand[0]?.id;
      if (!brandId) {
        const [ins] = await conn.execute('INSERT INTO brands (name, slug) VALUES (?, ?)', [item.brand, slugify(item.brand)]);
        brandId = ins.insertId;
      }
      const [cat] = await conn.execute('SELECT id FROM product_categories WHERE name = ? LIMIT 1', [item.category]);
      let catId = cat[0]?.id;
      if (!catId) {
        const [ins] = await conn.execute('INSERT INTO product_categories (name, slug) VALUES (?, ?)', [item.category, slugify(item.category)]);
        catId = ins.insertId;
      }
      let slug = slugify(item.name);
      const [slugHit] = await conn.execute('SELECT id FROM products WHERE slug = ? LIMIT 1', [slug]);
      if (slugHit.length) slug = slugify(`${item.name}-${sku}`);

      const [ins] = await conn.execute(
        `INSERT INTO products (sku, name, slug, short_description, long_description, brand_id, category_id, price, is_active, show_on_web)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [sku, item.name, slug, item.desc.slice(0, 200), item.desc, brandId, catId, sitePrice, item.show_on_web ? 1 : 0]
      );
      const productId = ins.insertId;
      if (item.image) {
        try {
          const local = await downloadImage(item.image);
          await conn.execute(
            'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
            [productId, local, item.name.slice(0, 200)]
          );
        } catch (_) { /* optional */ }
      }
      await conn.commit();
      stats.created++;
      console.log(`+ ${item.name} (${sku})`);
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      stats.errors++;
      console.error(`! ${item.name}: ${e.message}`);
    } finally {
      conn.release();
    }
  }

  await pool.end();
  console.log('SUMMARY', stats);
  if (!COMMIT) console.log('Re-run with --commit to apply.');
})().catch((e) => { console.error(e); process.exit(1); });
