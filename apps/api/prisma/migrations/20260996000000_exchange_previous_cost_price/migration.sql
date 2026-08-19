-- workbook 2026-08-19 Phase 1: snapshot costPrice เดิมของเครื่องเก่าก่อน A.4 เขียนทับเป็นราคารับซื้อ
ALTER TABLE "contract_exchange_requests"
  ADD COLUMN IF NOT EXISTS "previous_cost_price" DECIMAL(12,2);
