-- Fix Report P1-3 — account_role_map table.
-- Lets JE templates resolve account codes by semantic role rather than hard-
-- coding them. Owner can update routing via admin UI without a deploy.

CREATE TABLE "account_role_map" (
  "id"           TEXT         NOT NULL,
  "role"         TEXT         NOT NULL,
  "account_code" TEXT         NOT NULL,
  "priority"     INTEGER      NOT NULL DEFAULT 1,
  "is_active"    BOOLEAN      NOT NULL DEFAULT TRUE,
  "note"         TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "account_role_map_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_role_map_role_account_code_key"
  ON "account_role_map"("role", "account_code");

CREATE INDEX "account_role_map_role_is_active_priority_idx"
  ON "account_role_map"("role", "is_active", "priority");

-- Seed the canonical roles per Fix Report §2.4. Uses gen_random_uuid() (pgcrypto
-- is available — already used elsewhere in the schema). Idempotent via the
-- (role, account_code) unique index.
INSERT INTO "account_role_map" ("id", "role", "account_code", "priority", "is_active", "note") VALUES
  (gen_random_uuid(), 'vat_input',           '11-4101', 1, TRUE, 'ภาษีซื้อ — input tax credit (claimable on ภ.พ.30)'),
  (gen_random_uuid(), 'vat_input_pending',   '11-4102', 1, TRUE, 'ภาษีซื้อยังไม่ถึงกำหนด'),
  (gen_random_uuid(), 'vat_output',          '21-2101', 1, TRUE, 'ภาษีขาย ภ.พ.30 — output tax'),
  (gen_random_uuid(), 'payable_default',     '21-1104', 1, TRUE, 'เจ้าหนี้ค่าใช้จ่ายกิจการ — generic AP'),
  (gen_random_uuid(), 'payable_canva',       '21-1105', 1, TRUE, 'ค่าโปรแกรม CANVA ค้างจ่าย — context-specific AP'),
  (gen_random_uuid(), 'wht_individual',      '21-3102', 1, TRUE, 'ภ.ง.ด. 3 ค้างจ่าย — WHT บุคคลธรรมดา'),
  (gen_random_uuid(), 'wht_juristic',        '21-3103', 1, TRUE, 'ภ.ง.ด. 53 ค้างจ่าย — WHT นิติบุคคล'),
  (gen_random_uuid(), 'wht_payroll',         '21-3101', 1, TRUE, 'ภ.ง.ด. 1 ค้างจ่าย — WHT พนักงาน'),
  (gen_random_uuid(), 'wht_dividend',        '21-3104', 1, TRUE, 'ภ.ง.ด. 2 ค้างจ่าย — WHT ปันผล'),
  (gen_random_uuid(), 'sso_employee',        '21-3105', 1, TRUE, 'เงินสมทบประกันสังคม-พนักงานค้างนำส่ง'),
  (gen_random_uuid(), 'sso_employer',        '21-3106', 1, TRUE, 'เงินสมทบประกันสังคม-นายจ้างค้างนำส่ง'),
  (gen_random_uuid(), 'payroll_expense',     '53-1101', 1, TRUE, 'เงินเดือน-ค่าจ้าง (ฝั่งค่าใช้จ่าย)'),
  (gen_random_uuid(), 'payroll_sso_expense', '53-1102', 1, TRUE, 'เงินสมทบประกันสังคม (นายจ้าง — ค่าใช้จ่าย)'),
  (gen_random_uuid(), 'payroll_overtime',    '53-1103', 1, TRUE, 'ค่าล่วงเวลา'),
  (gen_random_uuid(), 'payroll_bonus',       '53-1104', 1, TRUE, 'โบนัส'),
  (gen_random_uuid(), 'payroll_deduction',   '42-1104', 1, TRUE, 'รายได้จากการหักค่าจ้าง'),
  (gen_random_uuid(), 'employee_bond',       '21-4102', 1, TRUE, 'เงินค้ำประกันพนักงาน'),
  (gen_random_uuid(), 'adj_overpay',         '53-1503', 1, TRUE, 'กำไร/ขาดทุน-สุทธิปัดเศษ (สำหรับ overpay adjustment)'),
  (gen_random_uuid(), 'adj_underpay',        '52-1104', 1, TRUE, 'ส่วนลดไม่จ่ายเศษสตางค์ (สำหรับ underpay adjustment)');
