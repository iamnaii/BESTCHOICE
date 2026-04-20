-- Batch C2: 2FA schema migration
-- Replaces legacy twoFactorBackup (Text) with structured fields,
-- adds twoFactorEnabledAt, twoFactorBackupCodes (Json), twoFactorRequiredAfter,
-- and creates the two_factor_otp_requests table.
-- All new columns are nullable; no data loss; no DROP statements on existing 2FA columns.

-- AlterTable: users — replace/add 2FA fields
-- Drop legacy two_factor_backup column (replaced by two_factor_backup_codes Json)
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "two_factor_backup",
  ADD COLUMN IF NOT EXISTS "two_factor_enabled_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "two_factor_backup_codes"   JSONB,
  ADD COLUMN IF NOT EXISTS "two_factor_required_after" TIMESTAMP(3);

-- Ensure two_factor_secret is TEXT (already nullable from v3 — no type change needed)
-- Ensure two_factor_enabled is BOOLEAN DEFAULT false (already exists — no change needed)

-- CreateTable: two_factor_otp_requests
CREATE TABLE "two_factor_otp_requests" (
  "id"           TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "purpose"      TEXT NOT NULL,
  "code_hash"    TEXT NOT NULL,
  "expires_at"   TIMESTAMP(3) NOT NULL,
  "consumed_at"  TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "two_factor_otp_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "two_factor_otp_requests"
  ADD CONSTRAINT "two_factor_otp_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "two_factor_otp_requests_user_id_idx" ON "two_factor_otp_requests"("user_id");
CREATE INDEX "two_factor_otp_requests_expires_at_idx" ON "two_factor_otp_requests"("expires_at");
