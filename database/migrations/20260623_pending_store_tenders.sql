-- Defer wallet redemptions until card payment succeeds (web split checkout)
-- Migration: 20260623

ALTER TABLE orders
    ADD COLUMN pending_store_tenders JSON NULL
        COMMENT 'Wallet tenders to apply when card payment captures';
