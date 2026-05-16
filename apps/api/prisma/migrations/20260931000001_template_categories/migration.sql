-- D1.2.4.5 — TemplateCategory model + categoryId FK on ExpenseTemplate
--
-- Adds a shop-wide grouping for Expense Templates ("เงินเดือน", "ค่าเช่า",
-- etc.). Templates remain valid without a category; the FK is nullable
-- and uses SetNull on delete so removing a category doesn't cascade-
-- delete any templates.
--
-- Additive only — `category_id` defaults to NULL on existing rows.

CREATE TABLE "template_categories" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "deleted_at"  TIMESTAMP(3),

  CONSTRAINT "template_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "template_categories_name_key"
  ON "template_categories" ("name");

CREATE INDEX "template_categories_deleted_at_idx"
  ON "template_categories" ("deleted_at");

ALTER TABLE "expense_templates"
  ADD COLUMN "category_id" TEXT;

CREATE INDEX "expense_templates_category_id_deleted_at_idx"
  ON "expense_templates" ("category_id", "deleted_at");

ALTER TABLE "expense_templates"
  ADD CONSTRAINT "expense_templates_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "template_categories" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed 5 starter categories. `gen_random_uuid()` requires the pgcrypto
-- extension; on Cloud SQL this is enabled by default. Each row sets
-- updated_at = created_at so the column NOT NULL constraint is satisfied.
INSERT INTO "template_categories" ("id", "name", "description", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'รายจ่ายทั่วไป',   'ค่าใช้จ่ายดำเนินงานทั่วไป',     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'เงินเดือน',       'เงินเดือน + ค่าแรงพนักงาน',     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ค่าเช่า',         'ค่าเช่าสถานที่ + อุปกรณ์',       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ค่าสาธารณูปโภค', 'ค่าน้ำ ค่าไฟ ค่าโทรศัพท์ อินเทอร์เน็ต', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'อื่นๆ',           'รายจ่ายที่ไม่เข้าหมวดอื่น',      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
