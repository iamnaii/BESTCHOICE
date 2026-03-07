-- Add dispatch/transit fields to stock_transfers
ALTER TABLE "stock_transfers" ADD COLUMN "dispatched_by_id" TEXT;
ALTER TABLE "stock_transfers" ADD COLUMN "dispatched_at" TIMESTAMP(3);
ALTER TABLE "stock_transfers" ADD COLUMN "tracking_note" TEXT;
ALTER TABLE "stock_transfers" ADD COLUMN "expected_delivery_date" TIMESTAMP(3);

-- AddForeignKey for stock_transfers.dispatched_by_id
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_dispatched_by_id_fkey" FOREIGN KEY ("dispatched_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
