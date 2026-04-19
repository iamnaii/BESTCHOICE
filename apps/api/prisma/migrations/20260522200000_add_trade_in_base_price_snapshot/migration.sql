-- Snapshot of TradeInValuation.basePrice at appraisal time. Used both to
-- prevent price gaming (offeredPrice must stay within ±15% of basePrice)
-- and to compute historical deviation reports if the base table is edited later.

ALTER TABLE "trade_ins" ADD COLUMN "base_price_at_appraisal" DECIMAL(12,2);
