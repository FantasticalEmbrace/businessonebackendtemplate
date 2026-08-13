-- Per-employee permission to process POS refunds (granted in Personnel profile).
ALTER TABLE pos_employees
    ADD COLUMN can_process_refunds TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'May process in-store POS refunds with their register PIN';

-- Preserve refund ability for employees who already had manager approval.
UPDATE pos_employees SET can_process_refunds = 1 WHERE can_authorize = 1;
