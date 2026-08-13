-- =============================================================================
-- 20260427_wishlist_collections.sql
-- Adds support for multiple, named wishlist "collections" per customer
-- (e.g. "My Wishlist", "Birthday Ideas", "Reorder Soon").
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. wishlist_collections — a user can have many named lists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wishlist_collections (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) DEFAULT NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    is_public  TINYINT(1) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    share_token VARCHAR(48) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_wishlist_collections_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_wlc_user (user_id),
    INDEX idx_wlc_default (user_id, is_default),
    UNIQUE KEY uniq_wlc_share_token (share_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 2. Make sure each user has at least a "My Wishlist" default collection
-- ---------------------------------------------------------------------------
INSERT INTO wishlist_collections (user_id, name, is_default, sort_order)
SELECT u.id, 'My Wishlist', 1, 0
FROM users u
LEFT JOIN wishlist_collections wc
       ON wc.user_id = u.id AND wc.is_default = 1
WHERE wc.id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Extend wishlists with collection_id + notes + priority
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS hmherbs_add_wishlist_columns;
DELIMITER $$
CREATE PROCEDURE hmherbs_add_wishlist_columns()
BEGIN
    DECLARE col_exists INT;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wishlists' AND COLUMN_NAME = 'collection_id';
    IF col_exists = 0 THEN
        ALTER TABLE wishlists ADD COLUMN collection_id INT NULL AFTER user_id;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wishlists' AND COLUMN_NAME = 'notes';
    IF col_exists = 0 THEN
        ALTER TABLE wishlists ADD COLUMN notes VARCHAR(500) NULL;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wishlists' AND COLUMN_NAME = 'priority';
    IF col_exists = 0 THEN
        ALTER TABLE wishlists ADD COLUMN priority TINYINT NOT NULL DEFAULT 0;
    END IF;

    SELECT COUNT(*) INTO col_exists FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wishlists' AND COLUMN_NAME = 'added_at';
    IF col_exists = 0 THEN
        ALTER TABLE wishlists ADD COLUMN added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
END$$
DELIMITER ;
CALL hmherbs_add_wishlist_columns();
DROP PROCEDURE IF EXISTS hmherbs_add_wishlist_columns;

-- Backfill collection_id for existing rows -> point at each user's default list
UPDATE wishlists w
JOIN wishlist_collections wc ON wc.user_id = w.user_id AND wc.is_default = 1
SET w.collection_id = wc.id
WHERE w.collection_id IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Add FK + unique constraint (collection, product) so the same product
--    can live in multiple lists, but not be duplicated within one list.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS hmherbs_fix_wishlist_indexes;
DELIMITER $$
CREATE PROCEDURE hmherbs_fix_wishlist_indexes()
BEGIN
    DECLARE has_idx INT;

    -- drop the old unique (user_id, product_id) so a product can appear in multiple lists
    SELECT COUNT(*) INTO has_idx FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wishlists' AND INDEX_NAME = 'unique_user_product';
    IF has_idx > 0 THEN
        ALTER TABLE wishlists DROP INDEX unique_user_product;
    END IF;

    -- add new unique (collection_id, product_id) if not already present
    SELECT COUNT(*) INTO has_idx FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wishlists' AND INDEX_NAME = 'uniq_wl_collection_product';
    IF has_idx = 0 THEN
        ALTER TABLE wishlists
            ADD UNIQUE KEY uniq_wl_collection_product (collection_id, product_id);
    END IF;

    SELECT COUNT(*) INTO has_idx FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wishlists' AND INDEX_NAME = 'idx_wl_collection';
    IF has_idx = 0 THEN
        ALTER TABLE wishlists ADD INDEX idx_wl_collection (collection_id);
    END IF;

    -- FK to wishlist_collections (only if not already present)
    SELECT COUNT(*) INTO has_idx FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wishlists'
       AND CONSTRAINT_NAME = 'fk_wishlists_collection';
    IF has_idx = 0 THEN
        ALTER TABLE wishlists
            ADD CONSTRAINT fk_wishlists_collection
            FOREIGN KEY (collection_id) REFERENCES wishlist_collections(id) ON DELETE CASCADE;
    END IF;
END$$
DELIMITER ;
CALL hmherbs_fix_wishlist_indexes();
DROP PROCEDURE IF EXISTS hmherbs_fix_wishlist_indexes;
