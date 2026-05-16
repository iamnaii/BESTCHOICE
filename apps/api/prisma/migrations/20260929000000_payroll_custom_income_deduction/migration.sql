-- C2 — Payroll custom income / deduction (V16/V17/V18).
-- Two new tables FK'd to payroll_lines for per-line custom income (bonus, OT,
-- per-diem) and custom deduction (loan repayment, advance recovery).
-- Purely additive — existing payroll docs unaffected; both tables empty by default.

CREATE TABLE "payroll_custom_income" (
    "id" TEXT NOT NULL,
    "payroll_line_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "is_taxable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_custom_income_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_custom_income_payroll_line_id_idx"
    ON "payroll_custom_income"("payroll_line_id");

ALTER TABLE "payroll_custom_income" ADD CONSTRAINT "payroll_custom_income_payroll_line_id_fkey"
    FOREIGN KEY ("payroll_line_id") REFERENCES "payroll_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "payroll_custom_deduction" (
    "id" TEXT NOT NULL,
    "payroll_line_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_custom_deduction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_custom_deduction_payroll_line_id_idx"
    ON "payroll_custom_deduction"("payroll_line_id");

ALTER TABLE "payroll_custom_deduction" ADD CONSTRAINT "payroll_custom_deduction_payroll_line_id_fkey"
    FOREIGN KEY ("payroll_line_id") REFERENCES "payroll_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed the V17 whitelist default into system_config. Owner can override
-- via /settings UI later (A1.2.8.1). Defaults match accounting.md mappings
-- for 53-1104 (โบนัส) + 53-1105 (ค่าล่วงเวลา); other 53-XXXX codes can be
-- added by owner without code changes.
INSERT INTO "system_config" ("id", "key", "value", "label", "created_at", "updated_at")
VALUES (
    gen_random_uuid()::text,
    'custom_income_accounts_whitelist',
    '["53-1104","53-1105"]',
    'C2/V17 — บัญชี Custom Income ที่อนุญาตให้ใช้ในใบเงินเดือน (53-XXXX expense codes). JSON array.',
    NOW(),
    NOW()
)
ON CONFLICT (key) DO NOTHING;
