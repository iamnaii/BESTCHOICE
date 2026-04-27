-- Promise lifecycle fields on CallLog (P2P redesign 2026-04-27)
ALTER TABLE "call_logs"
  ADD COLUMN "superseded_at" TIMESTAMP(3),
  ADD COLUMN "superseded_by_call_log_id" TEXT,
  ADD COLUMN "reschedule_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "kept_at" TIMESTAMP(3),
  ADD COLUMN "canceled_at" TIMESTAMP(3),
  ADD COLUMN "canceled_reason" TEXT,
  ADD COLUMN "cycle_started_at" TIMESTAMP(3),
  ADD COLUMN "cycle_deadline" TIMESTAMP(3),
  ADD COLUMN "target_installment_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- keptPromiseCount on Contract
ALTER TABLE "contracts"
  ADD COLUMN "kept_promise_count" INTEGER NOT NULL DEFAULT 0;

-- PromiseSlot table
CREATE TABLE "promise_slots" (
  "id" TEXT NOT NULL,
  "call_log_id" TEXT NOT NULL,
  "slot_index" INTEGER NOT NULL,
  "settlement_date" TIMESTAMP(3) NOT NULL,
  "settlement_amount" DECIMAL(12,2) NOT NULL,
  "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "kept_at" TIMESTAMP(3),
  "broken_at" TIMESTAMP(3),
  "locked_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "promise_slots_pkey" PRIMARY KEY ("id")
);

-- Self-referential FK on call_logs (supersede chain)
ALTER TABLE "call_logs"
  ADD CONSTRAINT "call_logs_superseded_by_call_log_id_fkey"
  FOREIGN KEY ("superseded_by_call_log_id") REFERENCES "call_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FK from promise_slots to call_logs
ALTER TABLE "promise_slots"
  ADD CONSTRAINT "promise_slots_call_log_id_fkey"
  FOREIGN KEY ("call_log_id") REFERENCES "call_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes on call_logs
DROP INDEX IF EXISTS "call_logs_result_settlement_date_broken_at_idx";
CREATE INDEX "call_logs_result_settlement_date_broken_at_superseded_at_ke_idx"
  ON "call_logs"("result", "settlement_date", "broken_at", "superseded_at", "kept_at", "canceled_at");
CREATE INDEX "call_logs_cycle_started_at_cycle_deadline_idx"
  ON "call_logs"("cycle_started_at", "cycle_deadline");
CREATE INDEX "call_logs_superseded_by_call_log_id_idx"
  ON "call_logs"("superseded_by_call_log_id");

-- Indexes on promise_slots
CREATE UNIQUE INDEX "promise_slots_call_log_id_slot_index_key"
  ON "promise_slots"("call_log_id", "slot_index");
CREATE INDEX "promise_slots_call_log_id_settlement_date_idx"
  ON "promise_slots"("call_log_id", "settlement_date");
CREATE INDEX "promise_slots_kept_at_broken_at_idx"
  ON "promise_slots"("kept_at", "broken_at");
