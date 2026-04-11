-- Schema drift fix: Receipt model compliance fields
-- Context: commit d785a10 "feat(accounting): Thai accounting standards audit fixes"
-- added seven fields to the Receipt model in schema.prisma (C-005 "ใบเสร็จครบ")
-- but never generated a corresponding migration. The seed script and compliance
-- features reference these columns, causing E2E test suite to fail on fresh DB
-- with PrismaClientKnownRequestError P2022: "The column `receipts.payer_address`
-- does not exist in the current database."
--
-- All seven fields are nullable in schema.prisma (String? / Decimal? / DateTime?),
-- so ADD COLUMN without a DEFAULT is safe on existing rows — no backfill needed.
--
-- Fields added:
--   payer_address       — customer address printed on receipt (TAS requirement)
--   payer_tax_id        — เลขประจำตัวผู้เสียภาษีผู้ซื้อ
--   amount_before_vat   — ราคาก่อน VAT (required for VAT-registered FINANCE entity)
--   vat_amount          — จำนวน VAT on the receipt
--   item_description    — รายละเอียดสินค้า/บริการ on the receipt line
--   void_approved_by_id — approver id for receipt void workflow (segregation of duties)
--   void_approved_at    — timestamp of void approval

ALTER TABLE "receipts" ADD COLUMN "payer_address" TEXT;
ALTER TABLE "receipts" ADD COLUMN "payer_tax_id" TEXT;
ALTER TABLE "receipts" ADD COLUMN "amount_before_vat" DECIMAL(12,2);
ALTER TABLE "receipts" ADD COLUMN "vat_amount" DECIMAL(12,2);
ALTER TABLE "receipts" ADD COLUMN "item_description" TEXT;
ALTER TABLE "receipts" ADD COLUMN "void_approved_by_id" TEXT;
ALTER TABLE "receipts" ADD COLUMN "void_approved_at" TIMESTAMP(3);
