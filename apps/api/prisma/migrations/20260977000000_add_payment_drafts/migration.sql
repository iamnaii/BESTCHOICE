-- Phase 4 — PaymentDraft: an unposted draft receipt for an installment Payment.
-- Additive (new table only). A payment is DRAFT iff it has a live row here.
CREATE TABLE "payment_drafts" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" TEXT NOT NULL,
    "deposit_account_code" TEXT,
    "late_fee" DECIMAL(12,2),
    "late_fee_waiver_amount" DECIMAL(12,2),
    "late_fee_waiver_reason_code" TEXT,
    "waiver_approver_id" TEXT,
    "consume_advance" BOOLEAN NOT NULL DEFAULT true,
    "paid_date" TIMESTAMP(3),
    "payment_case" TEXT,
    "transaction_ref" TEXT,
    "evidence_url" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_drafts_payment_id_key" ON "payment_drafts"("payment_id");
CREATE INDEX "payment_drafts_payment_id_idx" ON "payment_drafts"("payment_id");

ALTER TABLE "payment_drafts" ADD CONSTRAINT "payment_drafts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_drafts" ADD CONSTRAINT "payment_drafts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
