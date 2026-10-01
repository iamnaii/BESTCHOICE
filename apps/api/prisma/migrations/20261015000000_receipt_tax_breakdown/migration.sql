-- PR3 (คำตัดสินฝ่ายบัญชี D3–D5): ใบกำกับภาษีตามบัญชี — ค่าที่พิมพ์บนเอกสารเก็บ ณ ตอนออกใบ
-- เพิ่มคอลัมน์ nullable อย่างเดียว (ใบเดิมทุกใบ = null → PDF ใช้ตรรกะเดิม · ไม่ backfill)
-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "advance_amount" DECIMAL(12,2),
ADD COLUMN     "advance_vat_amount" DECIMAL(12,2),
ADD COLUMN     "late_fee_amount" DECIMAL(12,2),
ADD COLUMN     "late_fee_waived_amount" DECIMAL(12,2),
ADD COLUMN     "rounding_amount" DECIMAL(12,2);

-- CreateIndex (partial unique — ใบเสร็จหนึ่งใบต่อรายการบัญชีหนึ่งรายการ: กันออกใบซ้ำเมื่อ webhook
-- ส่งซ้ำหรือผู้เรียกเรียกซ้ำ · ใบลดหนี้ตอนยกเลิกใบเสร็จไม่มี source_journal_entry_id จึงไม่ถูกนับ)
CREATE UNIQUE INDEX "receipts_source_journal_entry_key" ON "receipts"("source_journal_entry_id") WHERE "source_journal_entry_id" IS NOT NULL AND "deleted_at" IS NULL;
