-- เงินสดย่อยหน้าร้าน S11-1106 — เมนูเติม/คืน (ข้อ 20.2 · 2026-10-18)
-- บันทึกคำขอเติม/คืนต่อรายการ (หลักฐาน · requestId · ผู้ทำ) — ยอดคงเหลือยังอ่านจากสมุดบัญชี ไม่ใช่ตารางนี้
CREATE TYPE "ShopPettyCashMovementKind" AS ENUM ('TOP_UP', 'RETURN');

CREATE TABLE "shop_petty_cash_movements" (
  "id" TEXT NOT NULL,
  "kind" "ShopPettyCashMovementKind" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "bank_account_code" TEXT NOT NULL,
  "moved_at" TIMESTAMP(3) NOT NULL,
  "posted_at" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "evidence_key" TEXT,
  "journal_entry_id" TEXT,
  "request_id" TEXT,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "shop_petty_cash_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_petty_cash_movements_journal_entry_id_key" ON "shop_petty_cash_movements"("journal_entry_id");
CREATE INDEX "shop_petty_cash_movements_moved_at_idx" ON "shop_petty_cash_movements"("moved_at");
CREATE INDEX "shop_petty_cash_movements_request_id_idx" ON "shop_petty_cash_movements"("request_id");
