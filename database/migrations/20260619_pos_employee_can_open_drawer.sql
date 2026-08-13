ALTER TABLE pos_employees
    ADD COLUMN can_open_drawer TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'May manually open cash drawer from register (Admin/Developer sets)';
