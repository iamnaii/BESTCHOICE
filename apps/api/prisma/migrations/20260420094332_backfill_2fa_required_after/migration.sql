-- Backfill: 2FA enrollment grace period for existing active staff
--
-- Context: Batch C2 (Admin Hardening) introduced TOTP-based 2FA with a
-- `two_factor_required_after` deadline field. When this deadline passes and
-- a user has not yet enrolled (two_factor_enabled = false), the login flow
-- returns state 2FA_SETUP_REQUIRED, forcing them through the setup wizard
-- before they can access the app.
--
-- This migration sets a 7-day grace period for all existing active staff
-- who have not yet enrolled in 2FA. After 7 days from this migration's
-- deployment, login will require 2FA setup to proceed.
--
-- Idempotent: only updates rows where two_factor_required_after IS NULL,
-- so re-running (e.g. via restore + replay) will not overwrite a deadline
-- that was already set.

UPDATE "users"
SET "two_factor_required_after" = NOW() + INTERVAL '7 days'
WHERE "deleted_at" IS NULL
  AND "two_factor_required_after" IS NULL
  AND "two_factor_enabled" = false;
