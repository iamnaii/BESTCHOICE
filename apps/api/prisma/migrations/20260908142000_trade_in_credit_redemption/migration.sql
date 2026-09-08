ALTER TABLE "trade_ins"
  ADD COLUMN "credit_base_amount" DECIMAL(12,2),
  ADD COLUMN "credit_bonus_amount" DECIMAL(12,2),
  ADD COLUMN "credit_issued_at" TIMESTAMP(3),
  ADD COLUMN "credit_issue_journal_id" TEXT,
  ADD COLUMN "current_redemption_id" TEXT;
ALTER TABLE "contracts" ADD COLUMN "trade_in_credit_snapshot" JSONB;
ALTER TABLE "sales" ADD COLUMN "trade_in_credit_snapshot" JSONB;
CREATE TABLE "trade_in_credit_redemptions" (
  "id" TEXT PRIMARY KEY,
  "trade_in_id" TEXT NOT NULL REFERENCES "trade_ins"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sale_id" TEXT UNIQUE REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "contract_id" TEXT UNIQUE REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "base_amount" DECIMAL(12,2) NOT NULL CHECK ("base_amount" > 0),
  "bonus_amount" DECIMAL(12,2) NOT NULL CHECK ("bonus_amount" >= 0),
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "application_journal_entry_id" TEXT,
  "released_at" TIMESTAMP(3),
  "released_by_id" TEXT,
  "release_reason" TEXT,
  CONSTRAINT "trade_in_credit_one_target" CHECK (("sale_id" IS NULL) <> ("contract_id" IS NULL))
);
CREATE INDEX "trade_in_credit_redemptions_trade_in_id_idx" ON "trade_in_credit_redemptions"("trade_in_id");
CREATE UNIQUE INDEX "trade_ins_current_redemption_id_key" ON "trade_ins"("current_redemption_id");
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_current_redemption_id_fkey"
  FOREIGN KEY ("current_redemption_id") REFERENCES "trade_in_credit_redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "chart_of_accounts"
  ("id", "code", "name", "type", "normalBalance", "category", "vatApplicable", "notes", "status", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'S21-2003', 'เครดิตรับเครื่องเทิร์นค้างใช้', 'หนี้สิน', 'Cr', 'เจ้าหนี้', FALSE,
  'มูลค่าเครื่องที่ SHOP รับไว้รอลูกค้านำไปใช้ซื้อสินค้า ไม่รวมโบนัส', 'ใช้งาน', NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
