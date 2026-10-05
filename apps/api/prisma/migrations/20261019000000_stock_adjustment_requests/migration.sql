-- ก้อน 3 ตัดสินค้า (2026-10-05): คำขอรออนุมัติ (เจ้าของอนุมัติทุกรายการ) + ลิงก์บัญชี + สถานะเครื่องใหม่
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'ADJUSTMENT_PENDING';
CREATE TYPE "StockAdjustmentStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELED');

-- แถวเดิมทุกใบคือรายการที่มีผลแล้ว (ยุค 4-eyes) → APPROVED ก่อน แล้วสลับ default ให้แถวใหม่เป็นคำขอ
ALTER TABLE "stock_adjustments" ADD COLUMN "status" "StockAdjustmentStatus" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "stock_adjustments" ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL';

ALTER TABLE "stock_adjustments" ALTER COLUMN "approved_by_id" DROP NOT NULL;
ALTER TABLE "stock_adjustments" ALTER COLUMN "approved_at" DROP NOT NULL;
ALTER TABLE "stock_adjustments" ALTER COLUMN "approved_at" DROP DEFAULT;

ALTER TABLE "stock_adjustments"
  ADD COLUMN "request_number" TEXT,
  ADD COLUMN "rejected_by_id" TEXT,
  ADD COLUMN "rejected_at" TIMESTAMP(3),
  ADD COLUMN "rejected_reason" TEXT,
  ADD COLUMN "canceled_by_id" TEXT,
  ADD COLUMN "canceled_at" TIMESTAMP(3),
  ADD COLUMN "cost_amount" DECIMAL(12,2),
  ADD COLUMN "inventory_account_code" TEXT,
  ADD COLUMN "inventory_booked" BOOLEAN,
  ADD COLUMN "booked_source" TEXT,
  ADD COLUMN "journal_entry_id" TEXT,
  ADD COLUMN "reverses_adjustment_id" TEXT;

CREATE UNIQUE INDEX "stock_adjustments_request_number_key" ON "stock_adjustments"("request_number");
CREATE UNIQUE INDEX "stock_adjustments_journal_entry_id_key" ON "stock_adjustments"("journal_entry_id");
CREATE INDEX "stock_adjustments_status_branch_id_idx" ON "stock_adjustments"("status", "branch_id");
CREATE INDEX "stock_adjustments_product_id_status_idx" ON "stock_adjustments"("product_id", "status");

-- หนึ่งเครื่องมีคำขอรออนุมัติได้ใบเดียว (Prisma เขียน partial unique ไม่ได้ — precedent products_imei_serial_active_unique)
CREATE UNIQUE INDEX "stock_adjustments_one_pending_per_product"
  ON "stock_adjustments"("product_id")
  WHERE "status" = 'PENDING_APPROVAL' AND "deleted_at" IS NULL;

ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_rejected_by_id_fkey"
  FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_canceled_by_id_fkey"
  FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
