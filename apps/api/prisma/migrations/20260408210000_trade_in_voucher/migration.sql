-- Trade-In Voucher feature: walk-in seller, ID card, voucher, payment method, signatures
-- Phase: เพิ่มการรับซื้อมือถือมือสองพร้อมออกใบสำคัญจ่ายเงิน + anti-stolen-goods

-- ─── Make customerId optional (รองรับ walk-in seller) ───
ALTER TABLE "trade_ins" ALTER COLUMN "customer_id" DROP NOT NULL;

-- ─── New columns: branch / device color ───
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "branch_id" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "device_color" TEXT;

-- ─── Walk-in seller info ───
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "seller_name" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "seller_phone" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "seller_id_card_number" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "seller_address" TEXT;

-- ─── ID card evidence ───
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "id_card_photo_url" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "id_card_source" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "id_card_verified_at" TIMESTAMP(3);
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "id_card_verified_by_id" TEXT;

-- ─── Anti-theft consent ───
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "seller_signature_url" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "seller_signature_base64" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "seller_consent_signed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "police_report_acknowledged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "imei_blacklist_checked_at" TIMESTAMP(3);
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "imei_blacklist_result" TEXT;

-- ─── Payment to seller ───
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "transfer_bank_name" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "transfer_account_number" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "transfer_account_name" TEXT;

-- ─── Voucher (ใบสำคัญจ่ายเงิน) ───
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "voucher_number" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "voucher_date" TIMESTAMP(3);
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "voucher_pdf_url" TEXT;
ALTER TABLE "trade_ins" ADD COLUMN IF NOT EXISTS "voucher_printed_at" TIMESTAMP(3);

-- ─── Indexes ───
CREATE UNIQUE INDEX IF NOT EXISTS "trade_ins_voucher_number_key" ON "trade_ins"("voucher_number");
CREATE INDEX IF NOT EXISTS "trade_ins_imei_idx" ON "trade_ins"("imei");
CREATE INDEX IF NOT EXISTS "trade_ins_branch_id_idx" ON "trade_ins"("branch_id");

-- ─── Foreign keys ───
ALTER TABLE "trade_ins"
  ADD CONSTRAINT "trade_ins_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trade_ins"
  ADD CONSTRAINT "trade_ins_id_card_verified_by_id_fkey"
  FOREIGN KEY ("id_card_verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
