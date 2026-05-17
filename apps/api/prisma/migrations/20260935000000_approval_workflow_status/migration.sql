-- D1.2.1.6 — Approval Workflow status extension.
--
-- Adds two new DocumentStatus enum values used when the SystemConfig flag
-- `approval_enabled` is true:
--   PENDING_APPROVAL  — placed after DRAFT, before ACCRUAL (transient)
--   APPROVED          — placed after PENDING_APPROVAL, before ACCRUAL
--
-- Existing rows untouched. Lifecycle when feature flag is OFF (default)
-- is unchanged: DRAFT → POSTED (or DRAFT → ACCRUAL → POSTED).
--
-- Order matters for any consumer that inspects enum ordinals — we keep the
-- conceptual lifecycle order (DRAFT < PENDING_APPROVAL < APPROVED < ACCRUAL
-- < POSTED < VOIDED) by inserting BEFORE 'ACCRUAL'.

ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL' BEFORE 'ACCRUAL';
ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'APPROVED' BEFORE 'ACCRUAL';
