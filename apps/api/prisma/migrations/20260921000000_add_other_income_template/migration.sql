CREATE TABLE "other_income_templates" (
  "id"             TEXT NOT NULL,
  "company_id"     TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "is_favorite"    BOOLEAN NOT NULL DEFAULT false,
  "use_count"      INTEGER NOT NULL DEFAULT 0,
  "last_used_at"   TIMESTAMP(3),
  "items_json"     JSONB NOT NULL,
  "price_type"     "OtherIncomePriceType" NOT NULL DEFAULT 'EXCLUSIVE',
  "created_by_id"  TEXT NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  "deleted_at"     TIMESTAMP(3),

  CONSTRAINT "other_income_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "other_income_templates_company_deleted_idx"
  ON "other_income_templates" ("company_id", "deleted_at");
CREATE INDEX "other_income_templates_favorite_used_idx"
  ON "other_income_templates" ("is_favorite", "last_used_at");

ALTER TABLE "other_income_templates"
  ADD CONSTRAINT "other_income_templates_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "company_info"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "other_income_templates_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
