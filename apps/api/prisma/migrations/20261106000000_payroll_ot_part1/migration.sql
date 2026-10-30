-- Payroll D4 part 1 — OT / holiday pay computed from attendance into payroll.

CREATE TYPE "PayrollIncomeSource" AS ENUM ('MANUAL', 'ADJUSTMENT', 'ATTENDANCE_OT', 'ATTENDANCE_HOLIDAY', 'ATTENDANCE_HOLIDAY_OT');

ALTER TABLE "payroll_custom_income"
  ADD COLUMN "source" "PayrollIncomeSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "quantity" DECIMAL(6,1),
  ADD COLUMN "rate" DECIMAL(12,4),
  ADD COLUMN "multiplier" DECIMAL(3,1);

ALTER TABLE "payroll_lines"
  ADD COLUMN "line_no" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "system_pulled_at" TIMESTAMP(3),
  ADD COLUMN "attendance_summary" JSONB,
  ADD COLUMN "system_notes" JSONB;

-- Holiday work + holiday OT account roles (same defaults as payroll_overtime).
INSERT INTO "account_role_map" ("id", "role", "account_code", "priority", "is_active", "note", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'shop_payroll_holiday', 'S52-1202', 1, TRUE, 'ทำงานวันหยุด/OT วันหยุด - พนักงานสาขา (custom income SHOP)', NOW(), NOW()),
  (gen_random_uuid()::text, 'payroll_holiday',      '53-1103',  1, TRUE, 'ทำงานวันหยุด/OT วันหยุด (custom income FINANCE)', NOW(), NOW())
ON CONFLICT ("role", "account_code") DO NOTHING;
