-- Order channel: online (website) vs in_store (POS/retail) for admin visibility and tax sync filtering
CALL hmherbs_add_column_if_missing(
    'orders',
    'sales_channel',
    "ENUM('online', 'in_store', 'mobile', 'phone', 'other') NOT NULL DEFAULT 'online' COMMENT 'online=website; in_store=POS'"
);
