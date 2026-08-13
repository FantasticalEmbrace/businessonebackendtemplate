-- =============================================================================
-- HM Herbs — Staging database import (postamble)
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 1;
SET UNIQUE_CHECKS = 1;

-- Staging import complete. Point backend DB_* at this database and restart the API.
