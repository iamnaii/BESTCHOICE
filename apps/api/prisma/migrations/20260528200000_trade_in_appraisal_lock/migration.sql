-- T5-C17: Once the first appraise() call sets offeredPrice, further
-- appraise() calls with a different price are rejected to prevent price
-- drift (e.g. 20,000 rejected -> staff tries 18,000 until customer agrees).
-- OWNER can override via explicit `force: true` parameter (audited).

ALTER TABLE "trade_ins"
  ADD COLUMN "first_appraised_at" TIMESTAMP(3),
  ADD COLUMN "appraisal_locked" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any existing trade-in already in APPRAISED/ACCEPTED/COMPLETED
-- state has an immutable price by definition — mark them as locked with
-- first_appraised_at = updatedAt (best proxy we have).
UPDATE "trade_ins"
SET "appraisal_locked" = true,
    "first_appraised_at" = "updated_at"
WHERE "status" IN ('APPRAISED', 'ACCEPTED', 'COMPLETED')
  AND "offered_price" IS NOT NULL;
