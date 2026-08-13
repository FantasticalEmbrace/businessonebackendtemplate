-- Remove marketing admin role; migrate existing accounts to assistant_manager

UPDATE admin_users SET role = 'assistant_manager' WHERE role = 'marketing';

ALTER TABLE admin_users
  MODIFY COLUMN role ENUM(
    'developer',
    'admin',
    'manager',
    'assistant_manager'
  ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'assistant_manager';
