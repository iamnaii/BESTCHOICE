-- Backfill allowed_companies + peak_account_code สำหรับบัญชีที่มีอยู่แล้วใน dev DB
-- Run once: npx prisma db execute --file prisma/backfill-coa-companies.sql --schema prisma/schema.prisma

-- Default: peak_account_code = code (ผังบัญชีเราใช้ format PEAK อยู่แล้ว XX-XXXX)
UPDATE "chart_of_accounts" SET "peak_account_code" = "code" WHERE "peak_account_code" IS NULL;

-- FINANCE-only accounts
UPDATE "chart_of_accounts"
SET "allowed_companies" = ARRAY['FINANCE']::TEXT[]
WHERE "code" IN (
  '11-2102', -- ลูกหนี้เช่าซื้อ
  '11-4101', -- ภาษีซื้อ
  '11-4102', -- ภาษีซื้อยังไม่ถึงกำหนด
  '21-2101', -- ภาษีขาย ภ.พ.30
  '21-2102', -- ภ.พ.30 ค้างจ่าย
  '42-1101', -- รายได้ส่วนเพิ่มจากการปิดสัญญา
  '42-1102', -- ค่างวดเบี้ยปรับล่าช้า
  '42-1103', -- ค่ามัดจำ/เงินประกันที่ริบ
  '42-1104'  -- รายได้จากการยึดเครื่อง
);

-- SHOP-only accounts
UPDATE "chart_of_accounts"
SET "allowed_companies" = ARRAY['SHOP']::TEXT[]
WHERE "code" IN (
  '42-1105' -- รายได้ค่านายหน้า/คอมมิชชัน (SHOP รับจาก FINANCE)
);
