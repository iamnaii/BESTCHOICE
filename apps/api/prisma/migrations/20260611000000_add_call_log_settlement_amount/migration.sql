-- Add settlement amount + split-payment columns to CallLog.
-- All nullable to keep historical rows intact.
ALTER TABLE "call_logs"
  ADD COLUMN "settlement_amount" DECIMAL(12, 2),
  ADD COLUMN "second_settlement_date" TIMESTAMP(3),
  ADD COLUMN "second_settlement_amount" DECIMAL(12, 2);
