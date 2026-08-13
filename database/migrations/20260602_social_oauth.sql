-- =============================================================================
-- H&M Herbs - Social OAuth (Google / Apple) for customers and admins
-- Migration: 20260602
-- =============================================================================

ALTER TABLE users
    MODIFY COLUMN password_hash VARCHAR(255) NULL,
    ADD COLUMN auth_provider VARCHAR(20) NOT NULL DEFAULT 'local' AFTER password_hash,
    ADD COLUMN oauth_subject VARCHAR(255) NULL AFTER auth_provider;

CREATE INDEX idx_users_oauth ON users (auth_provider, oauth_subject);

ALTER TABLE admin_users
    MODIFY COLUMN password_hash VARCHAR(255) NULL,
    ADD COLUMN auth_provider VARCHAR(20) NOT NULL DEFAULT 'local' AFTER password_hash,
    ADD COLUMN oauth_subject VARCHAR(255) NULL AFTER auth_provider;

CREATE INDEX idx_admin_users_oauth ON admin_users (auth_provider, oauth_subject);
