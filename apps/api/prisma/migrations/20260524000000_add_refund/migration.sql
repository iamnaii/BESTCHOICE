-- Refund workflow with 2-person approval + bank reversal tracking (T1-C1).
-- BESTCHOICE does NOT pay refunds from our own account — staff call the
-- bank to reverse the original charge. This table records the request,
-- the approval chain, and whatever reference the bank returns.

CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSED', 'FAILED', 'REJECTED');

CREATE TABLE "refunds" (
  "id"                  TEXT NOT NULL,
  "payment_id"          TEXT NOT NULL,
  "contract_id"         TEXT NOT NULL,
  "amount"              DECIMAL(12,2) NOT NULL,
  "reason"              TEXT NOT NULL,
  "status"              "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
  "requested_by_id"     TEXT NOT NULL,
  "requested_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by_id"      TEXT,
  "approved_at"         TIMESTAMP(3),
  "rejected_by_id"      TEXT,
  "rejected_at"         TIMESTAMP(3),
  "rejected_reason"     TEXT,
  "bank_reversal_ref"   TEXT,
  "bank_reversal_at"    TIMESTAMP(3),
  "bank_reversal_notes" TEXT,
  "failure_reason"      TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  "deleted_at"          TIMESTAMP(3),
  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refunds_payment_id_idx"      ON "refunds"("payment_id");
CREATE INDEX "refunds_contract_id_idx"     ON "refunds"("contract_id");
CREATE INDEX "refunds_status_idx"          ON "refunds"("status");
CREATE INDEX "refunds_requested_by_id_idx" ON "refunds"("requested_by_id");
CREATE INDEX "refunds_approved_by_id_idx"  ON "refunds"("approved_by_id");
CREATE INDEX "refunds_created_at_idx"      ON "refunds"("created_at");

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_rejected_by_id_fkey"
  FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
