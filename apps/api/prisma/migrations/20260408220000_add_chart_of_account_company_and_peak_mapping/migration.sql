-- เพิ่ม fields สำหรับ multi-entity (SHOP/FINANCE) + PEAK mapping ใน chart_of_accounts

ALTER TABLE "chart_of_accounts"
  ADD COLUMN "allowed_companies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "peak_account_code" TEXT,
  ADD COLUMN "peak_account_id"   TEXT;
