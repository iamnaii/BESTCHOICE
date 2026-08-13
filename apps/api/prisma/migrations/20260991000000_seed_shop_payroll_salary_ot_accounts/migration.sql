-- Fix latent CI-only boot failure ตั้งแต่ #1395 (migration 20260990):
-- account_role_map ถูก seed ให้อ้าง S52-1201 (shop_payroll_expense) และ
-- S52-1202 (shop_payroll_overtime) แต่ migration นั้น insert เฉพาะบัญชีใหม่ 5 ตัว
-- (S52-1204/1205, S21-3101/3105/3106) — สองตัวนี้ผู้เขียนสันนิษฐานว่ามีอยู่แล้ว
-- จาก seed-coa-shop ซึ่งจริงบน dev/prod แต่ไม่จริงบน DB ที่สร้างจาก migrations
-- ล้วน ๆ (CI test_db) → AccountRoleService.assertCodesExistInCoa fail ตอน boot
-- ทำให้ Lint & Test แดงทุก PR (main ไม่เห็นเพราะ job นี้ถูก skip บน push main)
--
-- ค่าตาม shop-coa.csv แถว S52-1201/S52-1202 — ON CONFLICT = no-op บนเครื่องที่มีแล้ว
INSERT INTO "chart_of_accounts"
  ("id", "code", "name", "type", "normalBalance", "category", "vatApplicable", "notes", "status", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'S52-1201', 'เงินเดือนพนักงานสาขา', 'ค่าใช้จ่าย', 'Dr', 'OpEx-บุคลากร', FALSE,
   'เงินเดือนพนักงานประจำสาขา (เฉพาะส่วน SHOP)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, 'S52-1202', 'ค่าล่วงเวลา - พนักงานสาขา', 'ค่าใช้จ่าย', 'Dr', 'OpEx-บุคลากร', FALSE,
   'OT พนักงานสาขา', 'ใช้งาน', NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
