-- InternalControlActionBar — Phase 1: shared component infrastructure
--
-- Adds:
--   1. `users.can_reverse_override` — per-user override for the CUSTOM reverse-permission mode
--   2. `reverse_reasons` — admin-managed dropdown items for the reverse-confirmation dialog
--
-- Both are idempotent (IF NOT EXISTS) so re-running on a partially-migrated DB is safe.

-- 1. Per-user override flag on users table -----------------------------------
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "can_reverse_override" BOOLEAN;

-- 1b. Other Income — structured reverse-reason label (preserves audit
--     fidelity when an enum-collapsed `OTHER` is paired with a label
--     picked from the admin-managed `reverse_reasons` table).
ALTER TABLE "other_incomes"
  ADD COLUMN IF NOT EXISTS "reverse_reason_label" TEXT;

-- 2. Reverse reasons table ----------------------------------------------------
-- `id` has a server-side `gen_random_uuid()` DEFAULT so raw SQL scripts
-- (seeds, manual ops) can `INSERT` without specifying an id. Prisma client
-- still generates the UUID client-side via `@default(uuid())` — this DEFAULT
-- is a belt-and-suspenders guard for non-Prisma callers.
CREATE TABLE IF NOT EXISTS "reverse_reasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "reverse_reasons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reverse_reasons_is_active_sort_order_idx"
  ON "reverse_reasons" ("is_active", "sort_order");

-- 3. Seed default reasons (skip if rows already exist) ------------------------
-- Relies on the column DEFAULTs declared above for `id`/`updated_at`.
INSERT INTO "reverse_reasons" ("label", "sort_order")
SELECT label, sort_order
FROM (VALUES
  ('บันทึกผิดบัญชี',                              10),
  ('บันทึกผิดยอด',                                20),
  ('ลูกค้าคืนเงิน / ลูกค้ายกเลิกธุรกรรม',        30),
  ('แก้ไขตามคำขอ auditor',                        40),
  ('อื่นๆ (ระบุ)',                                 50)
) AS defaults(label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "reverse_reasons");
