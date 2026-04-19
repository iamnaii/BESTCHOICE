-- Tier-8 Medium batch migration — T3-C11 + T4-C6 + T4-C10
--
-- T3-C11: contracts.block_auto_escalation — manual hold on cron escalation
-- T4-C10: sales_commissions.snapshot_salesperson_id — freeze earner at create
-- T4-C6 : broadcast_approvals — immutable per-approver audit for large/risky
--          broadcasts (>1000 audience OR trigger-word match)

-- ──────────────────────────────────────────────────────────────
-- T3-C11: Contract manual-hold on auto-escalation
-- ──────────────────────────────────────────────────────────────
ALTER TABLE "contracts"
  ADD COLUMN "block_auto_escalation" TIMESTAMP(3);

-- Partial index: only rows with an active hold are relevant to the cron
CREATE INDEX "contracts_block_auto_escalation_idx"
  ON "contracts"("block_auto_escalation")
  WHERE "block_auto_escalation" IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- T4-C10: SalesCommission snapshot salesperson
-- ──────────────────────────────────────────────────────────────
ALTER TABLE "sales_commissions"
  ADD COLUMN "snapshot_salesperson_id" TEXT;

-- Backfill: existing rows have no snapshot — use salesperson_id as
-- source-of-truth for legacy commissions (they were never reassigned since
-- the reassignment feature was introduced after this field).
UPDATE "sales_commissions"
  SET "snapshot_salesperson_id" = "salesperson_id"
  WHERE "snapshot_salesperson_id" IS NULL;

CREATE INDEX "sales_commissions_snapshot_salesperson_id_idx"
  ON "sales_commissions"("snapshot_salesperson_id");

-- ──────────────────────────────────────────────────────────────
-- T4-C6: BroadcastApproval — immutable per-approver audit
-- ──────────────────────────────────────────────────────────────
CREATE TABLE "broadcast_approvals" (
  "id" TEXT NOT NULL,
  "broadcast_id" TEXT NOT NULL,
  "approver_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "trigger_matched" TEXT,
  "audience_size" INTEGER NOT NULL,
  "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "broadcast_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "broadcast_approvals_broadcast_id_approver_id_key"
  ON "broadcast_approvals"("broadcast_id", "approver_id");
CREATE INDEX "broadcast_approvals_broadcast_id_idx"
  ON "broadcast_approvals"("broadcast_id");
CREATE INDEX "broadcast_approvals_approver_id_idx"
  ON "broadcast_approvals"("approver_id");

ALTER TABLE "broadcast_approvals"
  ADD CONSTRAINT "broadcast_approvals_broadcast_id_fkey"
  FOREIGN KEY ("broadcast_id") REFERENCES "broadcast_messages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broadcast_approvals"
  ADD CONSTRAINT "broadcast_approvals_approver_id_fkey"
  FOREIGN KEY ("approver_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
