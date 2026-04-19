-- Credit-check override audit: track who overrode an AI decision, from what
-- state, and why. Reason is required at the service layer; DB keeps the
-- column nullable so historical rows don't need backfill.

ALTER TABLE "credit_checks"
  ADD COLUMN "original_status" "CreditCheckStatus",
  ADD COLUMN "original_score" INTEGER,
  ADD COLUMN "overridden_at" TIMESTAMP(3),
  ADD COLUMN "overridden_by_id" TEXT,
  ADD COLUMN "override_reason" TEXT;

CREATE INDEX "credit_checks_overridden_by_id_idx" ON "credit_checks"("overridden_by_id");

ALTER TABLE "credit_checks"
  ADD CONSTRAINT "credit_checks_overridden_by_id_fkey"
  FOREIGN KEY ("overridden_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
