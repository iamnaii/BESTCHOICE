-- T5-C3: 4-eyes on every stock adjustment
--
-- Add approver columns. Historical rows are back-filled with adjusted_by_id
-- to satisfy NOT NULL + FK constraints; they are flagged as "self-approved"
-- only for historical context and cannot happen going forward (the service
-- now rejects adjustedById === approvedById in every create call).

-- 1. Add nullable columns first
ALTER TABLE "stock_adjustments"
  ADD COLUMN "approved_by_id" TEXT,
  ADD COLUMN "approved_at"    TIMESTAMP(3);

-- 2. Backfill historical rows (safe: same user ID, records the state before
--    the 4-eyes rule existed). updated_at is untouched so audit is honest.
UPDATE "stock_adjustments"
SET
  "approved_by_id" = "adjusted_by_id",
  "approved_at"    = "created_at"
WHERE "approved_by_id" IS NULL;

-- 3. Promote to NOT NULL + default for new rows
ALTER TABLE "stock_adjustments"
  ALTER COLUMN "approved_by_id" SET NOT NULL,
  ALTER COLUMN "approved_at"    SET NOT NULL,
  ALTER COLUMN "approved_at"    SET DEFAULT CURRENT_TIMESTAMP;

-- 4. FK constraint to users(id)
ALTER TABLE "stock_adjustments"
  ADD CONSTRAINT "stock_adjustments_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
