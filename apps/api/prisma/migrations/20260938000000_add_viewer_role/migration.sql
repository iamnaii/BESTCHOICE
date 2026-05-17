-- D1.3.2.1 — add VIEWER to UserRole enum (Q4-gated, conservative default).
-- The enum value exists so OWNER can assign it to future read-only auditor
-- accounts. Activation of any permission is gated by SystemConfig key
-- `viewer_role_enabled` (default 'false'). No @Roles() decorator in the
-- codebase includes VIEWER today, so granting this role results in empty
-- pages until the flag is turned on AND specific routes are widened.
--
-- ALTER TYPE ... ADD VALUE is idempotent-safe via IF NOT EXISTS in PG12+.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'VIEWER';
