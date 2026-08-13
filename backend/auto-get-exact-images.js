require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

const dbConfig = { host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'hmherbs' };

const missing = JSON.parse(fs.readFileSync('all-products-missing-image-info.json'));

// Util for Amazon (and fallback: Google Images)
function buildSearchUrls(product) {
  const q = encodeURIComponent(
    `${product.brand ? product.brand + ' ' : ''}${product.name}`
  );
  return [
    `https://www.amazon.com/s?k=${q}`,
    `https://www.walmart.com/search/?query=${q}`,
    `https://www.iherb.com/search?kw=${q}`,
    `https://www.vitacost.com/Search.aspx?Ntt=${q}`,
    `https://www.swansonvitamins.com/q?kw=${q}`,
    `https://www.google.com/search?tbm=isch&q=${q}`
  ];
}

// Try to scrape Amazon for the exact main image
async function tryAmazon(product) {
  const searchUrl = buildSearchUrls(product)[0];
  const resp = await axios.get(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const $ = cheerio.load(resp.data);
  let firstResult = $('div.s-main-slot div[data-asin][data-component-type=s-search-result]').first();
  if (!firstResult.length) return null;
  
  const detailLink = firstResult.find('h2 a.a-link-normal').attr('href');
  if (!detailLink) return null;
  const productUrl = 'https://www.amazon.com' + detailLink;
  const prodResp = await axios.get(productUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const $$ = cheerio.load(prodResp.data);
  let imageUrl = $$('img#landingImage').attr('src');
  // fallback: other selectors for alternate layouts
  if (!imageUrl) imageUrl = $$('img[data-old-hires]').attr('data-old-hires');
  if (!imageUrl) imageUrl = $$('img.a-dynamic-image').attr('src');
  return imageUrl && imageUrl.length > 8 ? imageUrl : null;
}

// Fallback: Google Images
async function tryGoogle(product) {
  const gUrl = buildSearchUrls(product)[5];
  // Use DuckDuckGo images for lighter protection
  const dUrl = `https://duckduckgo.com/?q=${encodeURIComponent(product.brand + ' ' + product.name)}&iax=images&ia=images`;
  return dUrl;
}

(async () => {
  const connection = await mysql.createConnection(dbConfig);
  const found = [];
  for (const product of missing) {
    let image_url = null, source = null;
    try {
      image_url = await tryAmazon(product);
      source = image_url ? 'amazon' : null;
    } catch (e) { image_url = null; }

    // TODO: Add Walmart/iHerb/Vitacost scraping if needed
    if (!image_url) {
      image_url = await tryGoogle(product);
      source = 'duckduckgo-images';
    }

    found.push({ ...product, image_url, source });
    if (image_url && image_url.includes('amazon')) {
      // Insert or update backend
      const [existing] = await connection.execute(
        'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1',
        [product.id]
      );
      if (existing.length > 0) {
        await connection.execute(
          'UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?',
          [image_url, product.name, existing[0].id]
        );
      } else {
        await connection.execute(
          'INSERT INTO product_images (product_id, image_url, alt_text, is_primary) VALUES (?, ?, ?, 1)',
          [product.id, image_url, product.name]
        );
      }
    }
  }
  fs.writeFileSync('auto-image-results.json', JSON.stringify(found, null, 2));
  await connection.end();
})();

