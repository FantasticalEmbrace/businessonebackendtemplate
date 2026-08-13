-- Add password reset token fields to admin_users table
-- Run this migration to enable password reset functionality

ALTER TABLE admin_users
ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS password_reset_token_expires TIMESTAMP NULL,
ADD INDEX IF NOT EXISTS idx_password_reset_token (password_reset_token);

