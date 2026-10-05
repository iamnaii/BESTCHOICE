-- ก้อน 5 — ภาษีซื้อของเครื่องที่ขายผ่อน (2026-10-05): FINANCE เคลม Dr 11-4101 / Cr 42-1108 ตอนเปิดสัญญา

CREATE TYPE "InputVatStatus" AS ENUM ('NONE', 'NOT_ELIGIBLE', 'PENDING_INVOICE', 'CLAIMED', 'REVERSED');

-- VAT ต่อหน่วยที่ปันจาก purchase_orders.vat_amount ตอนรับของ (null = รับก่อนก้อน 5)
ALTER TABLE "goods_receiving_items" ADD COLUMN "received_vat" DECIMAL(12,2);

-- ใบกำกับภาษีที่มาทีหลังใบรับของ (เฉพาะใบที่ไม่ได้รับด้วย TAX_INVOICE)
ALTER TABLE "goods_receivings"
  ADD COLUMN "tax_invoice_number" TEXT,
  ADD COLUMN "tax_invoice_date" TIMESTAMP(3),
  ADD COLUMN "tax_invoice_photo_key" TEXT,
  ADD COLUMN "tax_invoice_recorded_at" TIMESTAMP(3),
  ADD COLUMN "tax_invoice_recorded_by_id" TEXT;
ALTER TABLE "goods_receivings"
  ADD CONSTRAINT "goods_receivings_tax_invoice_recorded_by_id_fkey"
  FOREIGN KEY ("tax_invoice_recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- สถานะการเคลมบนสัญญา (แถวเดิมทุกใบ = NONE ไม่ย้อน)
ALTER TABLE "contracts"
  ADD COLUMN "input_vat_status" "InputVatStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "input_vat_amount" DECIMAL(12,2),
  ADD COLUMN "input_vat_journal_entry_id" TEXT,
  ADD COLUMN "input_vat_reason" TEXT;
CREATE UNIQUE INDEX "contracts_input_vat_journal_entry_id_key" ON "contracts"("input_vat_journal_entry_id");
CREATE INDEX "contracts_input_vat_status_idx" ON "contracts"("input_vat_status");

-- บัญชีใหม่ 42-1108 (เจ้าของเคาะ 2026-10-05 · ห้ามกู้ 42-1106/42-1107) — idempotent ให้ prod ได้พร้อม deploy โดยไม่ต้อง seed:coa
INSERT INTO "chart_of_accounts"
  ("id", "code", "name", "type", "normalBalance", "category", "vatApplicable", "notes", "status", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, '42-1108', 'รายได้อื่น-ภาษีซื้อของสินค้าที่ขายผ่อน', 'รายได้', 'Cr', 'รายได้อื่น', FALSE,
   'ขาคู่ของ Dr 11-4101 เมื่อ FINANCE เคลมภาษีซื้อของเครื่องที่ขายผ่อน (ก้อน 5 · ฝ่ายบัญชี 2.4 แบบ ก 05/10/2569)',
   'ใช้งาน', NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
