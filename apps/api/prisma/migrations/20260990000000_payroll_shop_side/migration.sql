-- Payroll ฝั่ง SHOP — คำสั่งเจ้าของ 2026-08-06
-- Spec: docs/superpowers/specs/2026-08-06-payroll-shop-side-design.md
--
-- 1) SHOP CoA additions (payroll expense + payables) — inserted HERE, not only in
--    seed-coa-shop, so a prod deploy can never boot with account_role_map rows
--    referencing codes absent from chart_of_accounts (AccountRoleService
--    assertCodesExistInCoa fails the boot loudly in that case).
-- 2) account_role_map: shop_* payroll roles.
-- 3) custom-income whitelist: fix B1 (OT 53-1105 → 53-1103) + new SHOP whitelist.
-- 4) payroll_details.entity_scope ('SHOP' | 'FINANCE') — existing rows backfilled
--    to 'FINANCE' (their JEs used FINANCE-chart codes).
-- 5) payroll_lines unique (payroll_id, user_id) — one employee per document.

-- ── 1. SHOP chart accounts ──────────────────────────────────────────────
INSERT INTO "chart_of_accounts"
  ("id", "code", "name", "type", "normalBalance", "category", "vatApplicable", "notes", "status", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'S52-1204', 'โบนัส - พนักงานสาขา', 'ค่าใช้จ่าย', 'Dr', 'OpEx-บุคลากร', FALSE,
   'โบนัสพนักงานประจำสาขา (custom income ในใบเงินเดือน SHOP) — เทียบผังใหม่ CPA 53-1104', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, 'S52-1205', 'เงินสมทบประกันสังคม และกองทุนทดแทน - สาขา', 'ค่าใช้จ่าย', 'Dr', 'OpEx-บุคลากร', FALSE,
   'เงินสมทบ ปกส. ฝั่งนายจ้าง 5% ของพนักงานสาขา (คู่ FINANCE 53-1102) — เทียบผังใหม่ CPA 53-1102', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, 'S21-3101', 'ภ.ง.ด. 1 ค้างจ่าย - SHOP', 'หนี้สิน', 'Cr', 'WHT', FALSE,
   'ภาษีเงินได้พนักงานสาขาหัก ณ ที่จ่าย รอนำส่ง (นิติบุคคลเดียวกับ FINANCE 21-3101 — ภ.ง.ด.1 ยื่นรวม)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, 'S21-3105', 'เงินสมทบประกันสังคม-พนักงานค้างนำส่ง - SHOP', 'หนี้สิน', 'Cr', 'SSO', FALSE,
   'เงินสมทบที่หักจากพนักงานสาขา 5% รอนำส่ง สปส. (คู่ FINANCE 21-3105)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, 'S21-3106', 'เงินสมทบประกันสังคม-นายจ้างค้างนำส่ง - SHOP', 'หนี้สิน', 'Cr', 'SSO', FALSE,
   'เงินสมทบนายจ้าง 5% พนักงานสาขา รอนำส่ง สปส. (คู่ FINANCE 21-3106)', 'ใช้งาน', NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;

-- ── 2. shop_* payroll account roles ─────────────────────────────────────
INSERT INTO "account_role_map" ("id", "role", "account_code", "priority", "is_active", "note", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'shop_payroll_expense',     'S52-1201', 1, TRUE, 'เงินเดือนพนักงานสาขา (SHOP)', NOW(), NOW()),
  (gen_random_uuid()::text, 'shop_payroll_sso_expense', 'S52-1205', 1, TRUE, 'เงินสมทบ ปกส. นายจ้าง - สาขา (SHOP)', NOW(), NOW()),
  (gen_random_uuid()::text, 'shop_wht_payroll',         'S21-3101', 1, TRUE, 'ภ.ง.ด. 1 ค้างจ่าย - SHOP', NOW(), NOW()),
  (gen_random_uuid()::text, 'shop_sso_employee',        'S21-3105', 1, TRUE, 'เงินสมทบ ปกส.-พนักงานค้างนำส่ง - SHOP', NOW(), NOW()),
  (gen_random_uuid()::text, 'shop_sso_employer',        'S21-3106', 1, TRUE, 'เงินสมทบ ปกส.-นายจ้างค้างนำส่ง - SHOP', NOW(), NOW()),
  (gen_random_uuid()::text, 'shop_payroll_overtime',    'S52-1202', 1, TRUE, 'ค่าล่วงเวลา - พนักงานสาขา (custom income SHOP)', NOW(), NOW()),
  (gen_random_uuid()::text, 'shop_payroll_bonus',       'S52-1204', 1, TRUE, 'โบนัส - พนักงานสาขา (custom income SHOP)', NOW(), NOW())
ON CONFLICT ("role", "account_code") DO NOTHING;

-- ── 3a. B1 fix — FINANCE OT whitelist: 53-1105 (ค่าอบรม สัมมนา) → 53-1103 (ค่าล่วงเวลา) ──
-- Only rewrite the untouched seed default; an owner-customised value is left alone.
UPDATE "system_config"
SET "value" = '["53-1103","53-1104"]',
    "label" = 'C2/V17 — บัญชี Custom Income ที่อนุญาตในใบเงินเดือน FINANCE (แก้ B1: OT = 53-1103 ไม่ใช่ 53-1105 ค่าอบรม)',
    "updated_at" = NOW()
WHERE "key" = 'custom_income_accounts_whitelist'
  AND "value" = '["53-1104","53-1105"]';

-- ── 3b. SHOP custom-income whitelist ────────────────────────────────────
INSERT INTO "system_config" ("id", "key", "value", "label", "created_at", "updated_at")
VALUES (
  gen_random_uuid()::text,
  'custom_income_accounts_whitelist_shop',
  '["S52-1202","S52-1204"]',
  'V17 — บัญชี Custom Income ที่อนุญาตในใบเงินเดือน SHOP (OT + โบนัส พนักงานสาขา). JSON array.',
  NOW(), NOW()
)
ON CONFLICT ("key") DO NOTHING;

-- ── 4. payroll_details.entity_scope ─────────────────────────────────────
ALTER TABLE "payroll_details" ADD COLUMN IF NOT EXISTS "entity_scope" TEXT NOT NULL DEFAULT 'SHOP';
-- Every pre-existing payroll doc was posted with FINANCE-chart codes (53-1101 ฯลฯ).
UPDATE "payroll_details" SET "entity_scope" = 'FINANCE';

-- ── 5. one employee per payroll document ────────────────────────────────
-- The constraint was never enforced before, so a pre-existing duplicate
-- (payroll_id, user_id) pair would abort this whole migration at CREATE
-- UNIQUE INDEX (review W2). Neutralise duplicates first: keep the earliest
-- row's link, NULL the later rows' user_id (snapshot columns stay intact —
-- the money data is untouched; only the FK link is dropped). Legacy payroll
-- is wiped right after deploy anyway (wipe:payroll, คำสั่งเจ้าของข้อ 3).
UPDATE "payroll_lines" SET "user_id" = NULL
WHERE "user_id" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("payroll_id", "user_id") "id"
    FROM "payroll_lines"
    WHERE "user_id" IS NOT NULL
    ORDER BY "payroll_id", "user_id", "created_at" ASC
  );

-- Plain unique index: PG treats NULLs as distinct, so legacy free-text rows
-- (user_id IS NULL) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_lines_payroll_id_user_id_key"
  ON "payroll_lines" ("payroll_id", "user_id");
