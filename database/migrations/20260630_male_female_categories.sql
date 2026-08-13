-- Male / Female health categories (renamed from hmherbs.com Men / Women product categories)

UPDATE health_categories
SET name = 'Male',
    slug = 'male',
    description = 'Specialized supplements for male health needs',
    is_active = 1
WHERE slug = 'men-products';

UPDATE health_categories
SET name = 'Female',
    slug = 'female',
    description = 'Specialized supplements for female health needs',
    is_active = 1
WHERE slug = 'women-products';

INSERT INTO health_categories (name, slug, description, sort_order, is_active)
SELECT 'Male', 'male', 'Specialized supplements for male health needs', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM health_categories WHERE slug = 'male');

INSERT INTO health_categories (name, slug, description, sort_order, is_active)
SELECT 'Female', 'female', 'Specialized supplements for female health needs', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM health_categories WHERE slug = 'female');

INSERT IGNORE INTO product_health_categories (product_id, health_category_id)
SELECT phc.product_id, (SELECT id FROM health_categories WHERE slug = 'male' LIMIT 1)
FROM product_health_categories phc
JOIN health_categories hc ON hc.id = phc.health_category_id
WHERE hc.slug = 'mens-health';

INSERT IGNORE INTO product_health_categories (product_id, health_category_id)
SELECT phc.product_id, (SELECT id FROM health_categories WHERE slug = 'female' LIMIT 1)
FROM product_health_categories phc
JOIN health_categories hc ON hc.id = phc.health_category_id
WHERE hc.slug = 'womens-health';

UPDATE health_categories SET is_active = 0 WHERE slug IN ('mens-health', 'womens-health');
