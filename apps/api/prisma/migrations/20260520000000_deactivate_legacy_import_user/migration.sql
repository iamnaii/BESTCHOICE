-- T7-W9: Deactivate the legacy-import service account
-- This user was created by scripts/import-legacy/index.ts for historical data
-- import (used as the `createdById` FK for imported rows). The import job is
-- finished and the account should not be usable for login any more.
--
-- We do NOT delete the row because imported records still reference its id.
-- Instead: is_active = false so the login path rejects it, and the password
-- is rotated to a value that cannot be matched by any bcrypt input.

UPDATE "users"
SET
  is_active = false,
  password = 'DISABLED_SERVICE_ACCOUNT_NOT_LOGIN_CAPABLE',
  updated_at = NOW()
WHERE email = 'legacy-import@bestchoice.com';
