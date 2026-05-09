-- Add partial-receipt fields per CPA Policy A spec.
-- payment_status: PARTIAL until installmentTotal cleared, then PAID.
-- installment_partial_seq: 1, 2, 3 ... for partial receipts within same installment.
-- remaining_amount: installment balance still owed AFTER this receipt.
ALTER TABLE "receipts"
  ADD COLUMN "payment_status" TEXT NOT NULL DEFAULT 'PAID',
  ADD COLUMN "installment_partial_seq" INTEGER,
  ADD COLUMN "remaining_amount" DECIMAL(12, 2);
