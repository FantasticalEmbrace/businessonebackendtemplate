-- Business One POS device sync columns on orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pos_client_transaction_id VARCHAR(64) NULL
  COMMENT 'Idempotency key from Business One POS offline queue';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pos_device_id VARCHAR(64) NULL
  COMMENT 'Register/device identifier from POS';

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_pos_client_tx ON orders (pos_client_transaction_id);
