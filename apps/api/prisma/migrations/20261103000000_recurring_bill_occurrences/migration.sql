-- ก้อน 6 — บิลประจำ (D5, 2026-10-26): งวดของบิลประจำ + ฟิลด์ความถี่บนแม่แบบรายจ่าย
-- spec: docs/superpowers/specs/2026-10-26-recurring-bill-reminders-design.md §5, §15.1

CREATE TYPE "RecurrenceKind" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');
CREATE TYPE "RecurringBillStatus" AS ENUM ('PENDING', 'PAID', 'SKIPPED');

ALTER TABLE "expense_templates"
  ADD COLUMN "recurrence" "RecurrenceKind",
  ADD COLUMN "recurring_month" INTEGER,
  ADD COLUMN "reminder_lead_days" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "starts_on" TIMESTAMP(3);

-- backfill: แม่แบบ recurring เดิม (prod = 0 แถว ณ 26/10) — เฉพาะใบรายจ่าย; ประเภทอื่นเป็นบิลประจำไม่ได้ จึงปิดสวิตช์
UPDATE "expense_templates"
  SET "recurrence" = 'MONTHLY',
      "starts_on"  = (date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')
  WHERE "is_recurring" = true AND "document_type" = 'EXPENSE' AND "recurrence" IS NULL;
UPDATE "expense_templates"
  SET "is_recurring" = false
  WHERE "is_recurring" = true AND "document_type" <> 'EXPENSE';

-- index เดิมมีผู้อ่านคนเดียวคือ cron ที่ถูกแทนที่ (recurringDay ไม่ใช่วันสร้างร่างอีกต่อไป)
DROP INDEX IF EXISTS "expense_templates_is_recurring_recurring_day_idx";
CREATE INDEX "expense_templates_is_recurring_deleted_at_idx" ON "expense_templates"("is_recurring", "deleted_at");

-- งวดไม่ถูกลบ (ไม่มี deleted_at) — เปลี่ยนสถานะเป็น SKIPPED เท่านั้น
CREATE TABLE "recurring_bill_occurrences" (
  "id"                  TEXT NOT NULL,
  "template_id"         TEXT NOT NULL,
  "period_key"          TEXT NOT NULL,
  "due_date"            TIMESTAMP(3) NOT NULL,
  "status"              "RecurringBillStatus" NOT NULL DEFAULT 'PENDING',
  "estimated_amount"    DECIMAL(12,2),
  "expense_document_id" TEXT,
  "todo_id"             TEXT,
  "paid_at"             TIMESTAMP(3),
  "paid_by_id"          TEXT,
  "paid_note"           TEXT,
  "skipped_at"          TIMESTAMP(3),
  "skipped_by_id"       TEXT,
  "skip_reason"         TEXT,
  "last_reminded_on"    DATE,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recurring_bill_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recurring_bill_occurrences_expense_document_id_key" ON "recurring_bill_occurrences"("expense_document_id");
CREATE UNIQUE INDEX "recurring_bill_occurrences_todo_id_key" ON "recurring_bill_occurrences"("todo_id");
CREATE UNIQUE INDEX "recurring_bill_occurrences_template_id_period_key_key" ON "recurring_bill_occurrences"("template_id", "period_key");
CREATE INDEX "recurring_bill_occurrences_status_due_date_idx" ON "recurring_bill_occurrences"("status", "due_date");
CREATE INDEX "recurring_bill_occurrences_template_id_due_date_idx" ON "recurring_bill_occurrences"("template_id", "due_date");

ALTER TABLE "recurring_bill_occurrences"
  ADD CONSTRAINT "recurring_bill_occurrences_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "expense_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_bill_occurrences"
  ADD CONSTRAINT "recurring_bill_occurrences_expense_document_id_fkey"
  FOREIGN KEY ("expense_document_id") REFERENCES "expense_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_bill_occurrences"
  ADD CONSTRAINT "recurring_bill_occurrences_todo_id_fkey"
  FOREIGN KEY ("todo_id") REFERENCES "todos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_bill_occurrences"
  ADD CONSTRAINT "recurring_bill_occurrences_paid_by_id_fkey"
  FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_bill_occurrences"
  ADD CONSTRAINT "recurring_bill_occurrences_skipped_by_id_fkey"
  FOREIGN KEY ("skipped_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
