-- Products can be sold in-store (POS) but hidden from the public website.
ALTER TABLE products
  ADD COLUMN show_on_web TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '1=visible on website catalog; 0=in-store/POS only'
  AFTER is_featured;
