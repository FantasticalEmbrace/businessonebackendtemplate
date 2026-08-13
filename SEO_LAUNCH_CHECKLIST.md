# SEO migration launch checklist

Use this when switching from the old Concrete CMS site to the Node + static storefront.

## Before launch (development / staging)

- [ ] Run full verification:
  ```bash
  npm run seo:verify
  ```
- [ ] With the API server running, add live HTTP checks:
  ```bash
  npm run seo:verify:live
  ```
- [ ] Regenerate sitemaps from the current catalog:
  ```bash
  npm run seo:generate-sitemap -- --base-url https://hmherbs.com
  ```
- [ ] Regenerate legacy URL redirects (old sitemap clean URLs):
  ```bash
  npm run seo:legacy-redirects
  ```
- [ ] On **staging only**, keep indexing blocked in `backend/.env`:
  ```bash
  STAGING_BLOCK_INDEXING=true
  ```

## Redirect files (deploy together)

| File | Purpose |
|------|---------|
| `redirects-301.csv` | ~1,061 rules from old `/index.php/...` URLs (Concrete crawl) |
| `redirects-legacy-sitemap.csv` | ~118 rules from old clean URLs (`/categories/...`, `/health-conditions/...`, `/brands/...`) |
| `redirects-products-db.csv` | ~731 rules for **current** product slugs in MySQL |
| `redirects-slug-aliases.csv` | ~491 rules: old Concrete slug → **current** DB slug (auto-generated) |

The API server loads all four automatically. Later files win if the same `from_path` appears twice. Rules reload every 120 seconds without restart.

**Renamed slugs:** Run `npm run seo:slug-aliases` then `npm run seo:resolve-unmatched` (or `npm run seo:verify`, which runs both). Resolution log: `scripts/seo-migration/output/unmatched-resolved-log.csv`.

## Production environment (`backend/.env`)

```bash
NODE_ENV=production
FRONTEND_URL=https://hmherbs.com
STOREFRONT_PUBLIC_URL=https://hmherbs.com
# STAGING_BLOCK_INDEXING must be unset or false on production
```

## Deploy requirements

- [ ] Node backend serves the site (redirects are applied in Express **before** static files).
- [ ] `redirects-301.csv` and `redirects-legacy-sitemap.csv` at the **project root** (same folder as `sitemap.xml`).
- [ ] `sitemap.xml`, `sitemap-pages.xml`, `sitemap-products.xml`, and `robots.txt` at project root.
- [ ] HTTPS enabled on the live domain.

## Launch day

1. [ ] Remove or set `STAGING_BLOCK_INDEXING=false` on production.
2. [ ] Restart the Node process so env and redirect CSVs load.
3. [ ] Confirm redirects:
   - `https://hmherbs.com/index.php/products/{slug}` → `product.html?slug=...`
   - `https://hmherbs.com/categories/herbs` → `categories.html`
4. [ ] Confirm `https://hmherbs.com/robots.txt` lists three sitemaps.
5. [ ] Confirm `https://hmherbs.com/sitemap.xml` opens the sitemap index.

## Google Search Console

1. [ ] Add / verify `https://hmherbs.com` property.
2. [ ] Submit sitemap: `https://hmherbs.com/sitemap.xml`
3. [ ] Inspect a few legacy URLs (old product, brand, category) — expect **URL is on Google** to update after redirects are crawled.
4. [ ] Monitor **Pages** and **Indexing** for 404 spikes during the first 2–4 weeks.

## Ongoing maintenance

| Task | Command |
|------|---------|
| New products / catalog changes | `npm run seo:generate-sitemap -- --base-url https://hmherbs.com` and `npm run seo:product-redirects` |
| New brands or health categories | `npm run seo:legacy-redirects` |
| Re-test all redirects | `npm run seo:verify` |

## npm scripts reference

| Script | What it does |
|--------|----------------|
| `seo:verify` | Redirect tests + product slug audit + file checks |
| `seo:verify:live` | Above + HTTP checks against localhost:3001 |
| `seo:generate-sitemap` | Build sitemap index + pages + products from MySQL |
| `seo:legacy-redirects` | Regenerate `redirects-legacy-sitemap.csv` |
| `seo:product-redirects` | Regenerate `redirects-products-db.csv` from MySQL |
| `seo:slug-aliases` | Regenerate `redirects-slug-aliases.csv` (old slug → new slug) |
| `seo:resolve-unmatched` | Map the remaining unmatched old URLs (search/brand/product) |
| `test:seo-redirects` | Middleware unit tests only |
