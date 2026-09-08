CREATE TABLE "payment_approval_requests" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "required_permissions" TEXT[] NOT NULL,
  "payload" JSONB NOT NULL,
  "snapshot" JSONB NOT NULL,
  "review_summary" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "payment_approval_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_approval_requests_action_check" CHECK ("action" IN ('RECORD_PAYMENT','WAIVE_LATE_FEE','VOID_RECEIPT','EARLY_PAYOFF')),
  CONSTRAINT "payment_approval_requests_status_check" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','CANCELLED'))
);
CREATE INDEX "payment_approval_requests_contract_id_status_idx" ON "payment_approval_requests"("contract_id", "status");
CREATE INDEX "payment_approval_requests_requested_by_id_created_at_idx" ON "payment_approval_requests"("requested_by_id", "created_at");
CREATE INDEX "payment_approval_requests_status_created_at_idx" ON "payment_approval_requests"("status", "created_at");
CREATE UNIQUE INDEX "payment_approval_requests_pending_target_key" ON "payment_approval_requests"("action", "target_id") WHERE "status" = 'PENDING' AND "deleted_at" IS NULL;
