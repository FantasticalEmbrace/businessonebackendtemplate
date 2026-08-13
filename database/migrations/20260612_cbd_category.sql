-- CBD category: product + health taxonomy, assign existing hemp/CBD catalog items

INSERT INTO product_categories (name, slug, description, sort_order, is_active)
SELECT 'CBD', 'cbd', 'Hemp-derived CBD oils, gummies, topicals, and wellness products', 16, 1
WHERE NOT EXISTS (SELECT 1 FROM product_categories WHERE slug = 'cbd');

INSERT INTO health_categories (name, slug, description, sort_order, is_active)
SELECT 'CBD', 'cbd', 'Premium hemp and CBD products for natural wellness support', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM health_categories WHERE slug = 'cbd');

-- Categories display alphabetically by name; clear legacy sort_order on CBD if re-run
UPDATE health_categories SET sort_order = 0 WHERE slug = 'cbd';

UPDATE products p
JOIN product_categories pc ON pc.slug = 'cbd'
SET p.category_id = pc.id, p.is_cannabis = 1
WHERE p.slug IN (
    'hemp-bombs-cbd-gummies-w-mushroom',
    'herbs-for-life-cbd-gummies-30mg',
    'herbs-for-life-cbd-gummies-sleep',
    'herbs-for-life-delta-9-gummies-10mg-ea',
    'hippie-jack-s-cbd-extreme-1000mg-pain-cream',
    'hippie-jack-s-yummy-hemp-gummie',
    'regalabs-cannabis-care-cream-free-shipping',
    'regalabs-cannabis-care-roll-on',
    'regalabs-cannabis-oil-for-pets',
    'regalabs-full-spectrum-cbd-gummies',
    'regalabs-organic-cbd-oils'
)
OR p.is_cannabis = 1
OR LOWER(p.name) LIKE '%cbd%'
OR LOWER(p.name) LIKE '%cannabis%'
OR LOWER(p.slug) LIKE '%cbd%'
OR LOWER(p.slug) LIKE '%cannabis%'
OR LOWER(p.slug) LIKE '%delta-9%'
OR LOWER(p.slug) LIKE '%hemp-gumm%';

INSERT IGNORE INTO product_health_categories (product_id, health_category_id)
SELECT p.id, hc.id
FROM products p
JOIN health_categories hc ON hc.slug = 'cbd'
WHERE p.category_id = (SELECT id FROM product_categories WHERE slug = 'cbd' LIMIT 1);
