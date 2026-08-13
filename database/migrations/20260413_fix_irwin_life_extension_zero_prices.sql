-- SKUs where hmherbs.com had $0.00 or bad thumbnails: Irwin, Life Extension, Nature's Plus AgeLoss.
-- Prices aligned to manufacturer retail as of 2026-04-13.
-- Product images: backend CATALOG_PRIMARY_IMAGE_BY_SLUG + /images/products/*-official.* files.

UPDATE products SET price = 23.99 WHERE sku = '28706' AND (price IS NULL OR price = 0);
UPDATE products SET price = 19.99 WHERE sku = '28708' AND (price IS NULL OR price = 0);
UPDATE products SET price = 26.99 WHERE sku = '28707' AND (price IS NULL OR price = 0);
UPDATE products SET price = 19.13 WHERE sku = '28701' AND (price IS NULL OR price = 0);
UPDATE products SET price = 30.00 WHERE sku = '28702' AND (price IS NULL OR price = 0);
UPDATE products SET price = 14.25 WHERE sku = '28703' AND (price IS NULL OR price = 0);
UPDATE products SET price = 16.50 WHERE sku = '28704' AND (price IS NULL OR price = 0);
UPDATE products SET price = 31.50 WHERE sku = '28705' AND (price IS NULL OR price = 0);

-- Nature's Plus AgeLoss (hmherbs placeholders / $0); MSRP from naturesplus.com 2026-04
UPDATE products SET price = 49.95 WHERE sku = '18615' AND (price IS NULL OR price = 0);
UPDATE products SET price = 59.95 WHERE sku = '18103' AND (price IS NULL OR price = 0);
UPDATE products SET price = 42.95 WHERE sku = '18491' AND (price IS NULL OR price = 0);

-- Life Extension B3 / liposomal C + Life-flo magnesium sprays (hmherbs placeholders / $0)
UPDATE products SET price = 6.00 WHERE sku = '28700' AND (price IS NULL OR price = 0);
UPDATE products SET price = 21.99 WHERE sku = '28686' AND (price IS NULL OR price = 0);
UPDATE products SET price = 15.39 WHERE sku = '28698' AND (price IS NULL OR price = 0);
UPDATE products SET price = 7.29 WHERE sku = '28697' AND (price IS NULL OR price = 0);
