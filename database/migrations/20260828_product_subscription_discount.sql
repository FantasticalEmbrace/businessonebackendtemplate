-- Subscribe & Save discount percent (ecommerce-tier stores only)
ALTER TABLE products
    ADD COLUMN subscription_discount_percent DECIMAL(5,2) NULL DEFAULT NULL
        COMMENT 'Percent off unit price when customer subscribes (0-100)';
