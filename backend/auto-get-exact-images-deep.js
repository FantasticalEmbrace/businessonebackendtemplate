require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

const dbConfig = { host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'hmherbs' };

const missing = JSON.parse(fs.readFileSync('all-products-missing-image-info.json'));

const fallbackHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' };

function buildSearchQueries(product) {
  const text = `${product.brand || ''} ${product.name || ''}`.trim();
  return [
    { site: 'amazon', url: `https://www.amazon.com/s?k=${encodeURIComponent(text)}` },
    { site: 'walmart', url: `https://www.walmart.com/search/?query=${encodeURIComponent(text)}` },
    { site: 'iherb',   url: `https://www.iherb.com/search?kw=${encodeURIComponent(text)}` },
    { site: 'vitacost',url: `https://www.vitacost.com/Search.aspx?Ntt=${encodeURIComponent(text)}` },
    { site: 'swanson', url: `https://www.swansonvitamins.com/q?kw=${encodeURIComponent(text)}` },
    { site: 'google',  url: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(text)}` },
  ];
}

async function extractAmazonImage(product) {
  try {
    const { url } = buildSearchQueries(product)[0];
    const resp = await axios.get(url, { headers: fallbackHeaders });
    const $ = cheerio.load(resp.data);
    const first = $('div[data-asin][data-component-type=s-search-result]:first');
    const detail = first.find('h2 a').attr('href');
    if (!detail) return null;
    const prodUrl = `https://www.amazon.com${detail}`;
    const pResp = await axios.get(prodUrl, { headers: fallbackHeaders });
    const $$ = cheerio.load(pResp.data);
    let image = $$('img#landingImage').attr('src')
      || $$('img.a-dynamic-image').attr('src')
      || $$('img[data-old-hires]').attr('data-old-hires');
    return image && image.startsWith('http') ? image : null;
  } catch { return null; }
}
async function extractWalmartImage(product) {
  try {
    const { url } = buildSearchQueries(product)[1];
    const resp = await axios.get(url, { headers: fallbackHeaders });
    const $ = cheerio.load(resp.data);
    const pills = $('[data-testid="grid-view-item-image"]').first().find('img');
    return pills.length ? pills.attr('src') : null;
  } catch { return null; }
}
async function extractIHerbImage(product) {
  try {
    const { url } = buildSearchQueries(product)[2];
    const resp = await axios.get(url, { headers: fallbackHeaders });
    const $ = cheerio.load(resp.data);
    const img = $('a.product-image img').attr('src');
    return img && img.startsWith('http') ? img : null;
  } catch { return null; }
}
async function extractGoogleImage(product) {
  // No scrape: manual fallback for user security
  return null;
}

(async () => {
  const connection = await mysql.createConnection(dbConfig);
  const log = [];
  for (const product of missing) {
    let image = await extractAmazonImage(product);
    let source = 'amazon';
    if (!image) {
      image = await extractWalmartImage(product);
      source = 'walmart';
    }
    if (!image) {
      image = await extractIHerbImage(product);
      source = 'iherb';
    }
    // Google Images would normally require API or unsafe scraping; skip or review manually if source list exhausted
    if (!image) {
      image = null;
      source = 'notfound';
    }
    log.push({ sku: product.sku, name: product.name, brand: product.brand, attempted_sources: source, image });
    if (image) {
      // Update or insert image in backend
      const [existing] = await connection.execute('SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1', [product.id]);
      if (existing.length) {
        await connection.execute('UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?', [image, product.name, existing[0].id]);
      } else {
        await connection.execute('INSERT INTO product_images (product_id, image_url, alt_text, is_primary) VALUES (?, ?, ?, 1)', [product.id, image, product.name]);
      }
    }
  }
  fs.writeFileSync('final-automated-image-results.json', JSON.stringify(log, null, 2));
  await connection.end();
})();

