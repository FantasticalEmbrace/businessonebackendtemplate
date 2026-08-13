-- POS / catalog hierarchy: Supplements parent with existing categories nested under it.
-- CBD stays a top-level category (slug cbd).

INSERT INTO product_categories (name, slug, description, sort_order, is_active, parent_id)
SELECT 'Supplements', 'supplements', 'Vitamins, herbs, minerals, and wellness products', 0, 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM product_categories WHERE slug = 'supplements');

UPDATE product_categories child
JOIN product_categories parent ON parent.slug = 'supplements'
SET child.parent_id = parent.id
WHERE child.slug <> 'supplements'
  AND child.slug <> 'cbd'
  AND child.slug <> 'gift-cards'
  AND child.parent_id IS NULL;
