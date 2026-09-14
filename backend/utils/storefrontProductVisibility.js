'use strict';

/**
 * SQL fragment: product visible on the public website.
 * Excludes in-store-only rows and soft-deleted (admin Delete) catalog rows.
 */
const STOREFRONT_VISIBLE_WHERE =
    "COALESCE(p.show_on_web, 1) = 1 AND p.deleted_at IS NULL";

module.exports = {
    STOREFRONT_VISIBLE_WHERE
};
