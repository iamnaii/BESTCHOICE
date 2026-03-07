-- Add batch_number to stock_transfers for grouping transfers (like PO numbers)
ALTER TABLE "stock_transfers" ADD COLUMN "batch_number" TEXT;

-- Index for fast lookup by batch number
CREATE INDEX "stock_transfers_batch_number_idx" ON "stock_transfers"("batch_number");
