-- PR 5 หลังการขาย (2026-10-12) — ใบขายสด/ไฟแนนซ์นอกที่สลับเครื่องแล้ว ชี้เคสหลังการขายครั้งล่าสุด
-- คอลัมน์เดียว nullable · forward-only · ไม่มี backfill (prod ไม่มีเคสขายสดที่เปลี่ยนเครื่อง)
ALTER TABLE "sales" ADD COLUMN "exchange_case_id" TEXT;
CREATE INDEX "sales_exchange_case_id_idx" ON "sales"("exchange_case_id");
ALTER TABLE "sales" ADD CONSTRAINT "sales_exchange_case_id_fkey"
  FOREIGN KEY ("exchange_case_id") REFERENCES "after_sales_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
