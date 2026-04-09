-- Brute-force protection on User: track failed logins and auto-lock the
-- account for a cool-off window. NULL/0 = unlocked.
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "locked_until" TIMESTAMP(3);
