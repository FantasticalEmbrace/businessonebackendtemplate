-- Add developer role for admin panel (Developer Tools access)

ALTER TABLE admin_users
  MODIFY COLUMN role ENUM(
    'developer',
    'admin',
    'manager',
    'assistant_manager',
    'marketing'
  ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'assistant_manager';
