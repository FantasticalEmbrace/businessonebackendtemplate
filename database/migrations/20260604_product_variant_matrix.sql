-- Product variant matrix: option groups on product, attributes on each variant row.
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS variant_option_groups JSON NULL COMMENT 'Option dimensions e.g. Size, Form, Pack count';

ALTER TABLE product_variants
    ADD COLUMN IF NOT EXISTS attributes JSON NULL COMMENT 'Selected option values for this SKU';
