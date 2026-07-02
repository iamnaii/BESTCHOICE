-- ปรับดิว (reschedule) collect-first flow: PartialPaymentLink gains a purpose
-- discriminator + a metadata payload so a RESCHEDULE QR can carry its frozen
-- quote (daysToShift/splitMode/fee/lateFee) until the PaySolutions webhook
-- confirms payment — reschedule executes only after money arrives.
ALTER TABLE "partial_payment_links"
  ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'INSTALLMENT',
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;
