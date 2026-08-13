-- Customer storefront password reset (token columns on `users`).
-- The Node server also runs ensureUserPasswordResetSchema on startup; this file is for manual DBA runs.

ALTER TABLE users
    ADD COLUMN password_reset_token VARCHAR(255) NULL,
    ADD COLUMN password_reset_token_expires TIMESTAMP NULL;

CREATE INDEX idx_users_password_reset_token ON users (password_reset_token);
