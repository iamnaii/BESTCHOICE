-- Additive only: historical receipts remain unknown unless evidence is recorded.
ALTER TABLE "contracts"
  ADD COLUMN "down_payment_method" "PaymentMethod",
  ADD COLUMN "down_payment_received_at" TIMESTAMP(3),
  ADD COLUMN "down_payment_reference" TEXT;
