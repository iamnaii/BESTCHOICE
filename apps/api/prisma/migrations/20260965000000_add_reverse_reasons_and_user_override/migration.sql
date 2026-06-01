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

-- 2. Reverse reasons table ----------------------------------------------------
CREATE TABLE IF NOT EXISTS "reverse_reasons" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "reverse_reasons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reverse_reasons_is_active_sort_order_idx"
  ON "reverse_reasons" ("is_active", "sort_order");

-- 3. Seed default reasons (skip if rows already exist) ------------------------
INSERT INTO "reverse_reasons" ("id", "label", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), label, sort_order, true, NOW(), NOW()
FROM (VALUES
  ('บันทึกผิดบัญชี',                              10),
  ('บันทึกผิดยอด',                                20),
  ('ลูกค้าคืนเงิน / ลูกค้ายกเลิกธุรกรรม',        30),
  ('แก้ไขตามคำขอ auditor',                        40),
  ('อื่นๆ (ระบุ)',                                 50)
) AS defaults(label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "reverse_reasons");
