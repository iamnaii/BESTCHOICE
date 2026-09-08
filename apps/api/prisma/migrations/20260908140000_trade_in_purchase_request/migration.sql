ALTER TABLE "trade_ins" ADD COLUMN "quick_buy_request_id" TEXT, ADD COLUMN "quick_buy_request_hash" TEXT, ADD COLUMN "quick_buy_requested_by_id" TEXT;
CREATE UNIQUE INDEX "trade_ins_quick_buy_request_id_key" ON "trade_ins"("quick_buy_request_id");
