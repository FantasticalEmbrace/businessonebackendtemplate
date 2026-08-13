-- Admin roles: admin (top), manager, assistant_manager, marketing
-- Migrates super_admin → admin, staff → assistant_manager

ALTER TABLE admin_users
  MODIFY COLUMN role ENUM(
    'admin',
    'manager',
    'assistant_manager',
    'marketing',
    'super_admin',
    'staff'
  ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'assistant_manager';

UPDATE admin_users SET role = 'admin' WHERE role = 'super_admin';
UPDATE admin_users SET role = 'assistant_manager' WHERE role = 'staff';

ALTER TABLE admin_users
  MODIFY COLUMN role ENUM(
    'admin',
    'manager',
    'assistant_manager',
    'marketing'
  ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'assistant_manager';
