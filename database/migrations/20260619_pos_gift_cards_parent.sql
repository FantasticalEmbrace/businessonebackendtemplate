-- POS hierarchy: Gift Cards as a top-level parent (alongside Supplements and CBD).

UPDATE product_categories
SET parent_id = NULL
WHERE slug = 'gift-cards';
