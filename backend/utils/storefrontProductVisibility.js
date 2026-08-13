'use strict';

/** SQL fragment: product visible on public website (not in-store-only). */
const STOREFRONT_VISIBLE_WHERE = 'COALESCE(p.show_on_web, 1) = 1';

module.exports = {
    STOREFRONT_VISIBLE_WHERE
};
