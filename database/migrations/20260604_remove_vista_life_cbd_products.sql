-- Remove Vista Life CBD products from the public catalog (non-CBD Vista Life items remain).

UPDATE products
SET is_active = 0,
    is_cannabis = 0,
    is_featured = 0
WHERE slug IN (
    'vista-life-cbd-25mg-capsules',
    'vista-life-cbd-25mg-gummies',
    'vista-life-cbd-dead-sea-mud-mask',
    'vista-life-cbd-oil-full-spectrum'
);

DELETE phc
FROM product_health_categories phc
INNER JOIN products p ON p.id = phc.product_id
INNER JOIN health_categories hc ON hc.id = phc.health_category_id
WHERE hc.slug = 'cbd'
  AND p.slug IN (
    'vista-life-cbd-25mg-capsules',
    'vista-life-cbd-25mg-gummies',
    'vista-life-cbd-dead-sea-mud-mask',
    'vista-life-cbd-oil-full-spectrum'
);
