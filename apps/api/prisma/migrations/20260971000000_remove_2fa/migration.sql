-- Remove staff-login 2FA (feature removed by owner decision; resolves Wave-1 #8
-- plaintext-backup-codes bug by removing the feature). Customer KYC/LIFF/OTP
-- verification is a SEPARATE system and is untouched.
--
-- ⚠️ DESTRUCTIVE: drops the 2FA columns/table (secrets, backup codes, OTP requests).
-- Irreversible. Verify staff login works in staging before applying to prod.

ALTER TABLE "users"
  DROP COLUMN IF EXISTS "two_factor_secret",
  DROP COLUMN IF EXISTS "two_factor_enabled",
  DROP COLUMN IF EXISTS "two_factor_enabled_at",
  DROP COLUMN IF EXISTS "two_factor_backup_codes",
  DROP COLUMN IF EXISTS "two_factor_required_after";

ALTER TABLE "login_audit_logs"
  DROP COLUMN IF EXISTS "two_factor_used",
  DROP COLUMN IF EXISTS "two_factor_method";

DROP TABLE IF EXISTS "two_factor_otp_requests";
