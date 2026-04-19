-- Broadcast approval workflow (P2Q15=A): broadcasts now require a second
-- OWNER/FINANCE_MANAGER to approve before they actually dispatch. Default
-- status flips from SCHEDULED to PENDING_APPROVAL for new rows — existing
-- rows keep whatever status they already have.

ALTER TABLE "broadcast_messages"
  ADD COLUMN "approved_by_id" TEXT,
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "rejected_by_id" TEXT,
  ADD COLUMN "rejected_at" TIMESTAMP(3),
  ADD COLUMN "rejected_reason" TEXT;

-- Change default status for rows inserted from now on. Existing rows keep
-- their old statuses so the cron + history pages don't choke.
ALTER TABLE "broadcast_messages"
  ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL';

CREATE INDEX "broadcast_messages_approved_by_id_idx" ON "broadcast_messages"("approved_by_id");
CREATE INDEX "broadcast_messages_rejected_by_id_idx" ON "broadcast_messages"("rejected_by_id");

ALTER TABLE "broadcast_messages"
  ADD CONSTRAINT "broadcast_messages_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "broadcast_messages"
  ADD CONSTRAINT "broadcast_messages_rejected_by_id_fkey"
  FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
