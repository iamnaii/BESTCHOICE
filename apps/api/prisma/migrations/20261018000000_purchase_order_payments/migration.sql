-- ก้อน 2 จ่ายเงินผู้จัดจำหน่าย (คำตัดสินเจ้าของ 2026-10-05 · คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 9 + 2026-10-05 ข้อ 4):
-- ตารางรายการจ่ายเงินผู้จัดจำหน่ายทีละครั้ง (โอนธนาคารเท่านั้น) คู่รายการบัญชีสมุดหน้าร้าน + บัญชีใหม่ 2 ตัว.
-- Additive ทั้งหมด — ไม่แตะแถวเดิมของ purchase_orders (paidAmount เก่าก่อนเมนูนี้ไม่ย้อนลงบัญชี)
CREATE TYPE "POPaymentKind" AS ENUM ('DEPOSIT', 'SETTLEMENT', 'DEPOSIT_APPLIED', 'DEPOSIT_REFUND', 'DEPOSIT_FORFEIT');

CREATE TABLE "purchase_order_payments" (
  "id" TEXT NOT NULL,
  "po_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "kind" "POPaymentKind" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paid_at" TIMESTAMP(3) NOT NULL,
  "posted_at" TIMESTAMP(3) NOT NULL,
  "bank_account_code" TEXT,
  "reference" TEXT,
  "slip_url" TEXT,
  "note" TEXT,
  "receiving_id" TEXT,
  "journal_entry_id" TEXT,
  "created_by_id" TEXT,
  "voided_at" TIMESTAMP(3),
  "voided_by_id" TEXT,
  "void_reason" TEXT,
  "reversal_journal_entry_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "purchase_order_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_order_payments_journal_entry_id_key" ON "purchase_order_payments"("journal_entry_id");
CREATE INDEX "purchase_order_payments_po_id_deleted_at_idx" ON "purchase_order_payments"("po_id", "deleted_at");
CREATE INDEX "purchase_order_payments_supplier_id_paid_at_idx" ON "purchase_order_payments"("supplier_id", "paid_at");

ALTER TABLE "purchase_order_payments"
  ADD CONSTRAINT "purchase_order_payments_po_id_fkey"
  FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_payments"
  ADD CONSTRAINT "purchase_order_payments_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- บัญชีใหม่ตามคำตอบฝ่ายบัญชี — ค่าตาม shop-coa.csv · ON CONFLICT = no-op บนเครื่องที่ seeder ลงให้แล้ว
INSERT INTO "chart_of_accounts"
  ("id", "code", "name", "type", "normalBalance", "category", "vatApplicable", "notes", "status", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'S11-4201', 'เงินมัดจำจ่ายล่วงหน้า - ผู้จัดจำหน่าย', 'สินทรัพย์', 'Dr', 'เงินจ่ายล่วงหน้า', FALSE,
   'มัดจำที่หน้าร้านโอนให้ผู้จัดจำหน่ายก่อนรับของ (ใบสั่งซื้อ) — หักเข้าเจ้าหนี้ S21-11XX อัตโนมัติตอนรับของ · ยกเลิกใบสั่งซื้อ: ได้คืน Cr คู่ S11-1201 · ไม่ได้คืน Cr คู่ S53-1105',
   'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, 'S53-1105', 'ค่าใช้จ่าย - มัดจำที่ไม่ได้คืน', 'ค่าใช้จ่าย', 'Dr', 'ค่าใช้จ่ายอื่น', FALSE,
   'มัดจำผู้จัดจำหน่ายที่ยกเลิกใบสั่งซื้อแล้วไม่ได้เงินคืน (ถูกริบ/ตามไม่ได้) รวมส่วนที่ได้คืนไม่ครบ — คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 9.2',
   'ใช้งาน', NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
