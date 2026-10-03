-- ข3 (2026-10-01): เอกสารจากผู้จัดจำหน่ายบนใบรับของ — วันที่ในเอกสารเป็นวันที่ลงบัญชีรับสินค้า.
-- Additive ทั้งหมด (nullable) — ใบรับของเดิมไม่มีค่า ลงบัญชีวันที่รับของตามเดิม
CREATE TYPE "SupplierDocType" AS ENUM ('TAX_INVOICE', 'DELIVERY_NOTE', 'CASH_BILL', 'NONE');

ALTER TABLE "goods_receivings"
  ADD COLUMN "supplier_doc_type" "SupplierDocType",
  ADD COLUMN "supplier_doc_number" TEXT,
  ADD COLUMN "supplier_doc_date" TIMESTAMP(3);

CREATE INDEX "goods_receivings_supplier_doc_number_idx" ON "goods_receivings"("supplier_doc_number");
