-- PR2ข (คำตอบฝ่ายบัญชี ก1 29/09/2569): ยอดที่ตั้งลูกหนี้งวด (2A) ไปแล้วต่องวด — เพิ่มคอลัมน์อย่างเดียว ค่าเริ่มต้น 0 (แถวเดิมทุกแถว = 0 · ไม่ backfill)
-- AlterTable
ALTER TABLE "installment_schedules" ADD COLUMN     "accrued_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "accrued_interest" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "accrued_vat" DECIMAL(12,2) NOT NULL DEFAULT 0;

