-- Add declined to orders.payment_status for explicit processor declines.
-- Keep pending for unpaid drafts that never attempted payment.
-- failed already exists for non-decline payment errors.
ALTER TABLE orders
  MODIFY COLUMN payment_status
  ENUM('pending', 'paid', 'failed', 'refunded', 'declined')
  NOT NULL
  DEFAULT 'pending';
