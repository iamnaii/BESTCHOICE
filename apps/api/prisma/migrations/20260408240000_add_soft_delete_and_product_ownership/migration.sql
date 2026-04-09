-- Phase 1 hardening:
--   1. Add deleted_at to 7 transactional models that were hard-deleting.
--   2. Add owned_by_company_id to products for SHOP↔FINANCE ownership tracking.
-- All columns are nullable so no backfill is required on existing rows.

-- 1. Soft-delete columns
ALTER TABLE "po_items"              ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "inspection_results"    ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "payment_links"         ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "promotion_usages"      ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "customer_line_links"   ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "chat_messages"         ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "chat_auto_triggers"    ADD COLUMN "deleted_at" TIMESTAMP(3);

-- 2. Product ownership
ALTER TABLE "products" ADD COLUMN "owned_by_company_id" TEXT;

-- 3. Indexes for deleted_at (soft-delete query performance)
CREATE INDEX "po_items_deleted_at_idx"             ON "po_items"("deleted_at");
CREATE INDEX "inspection_results_deleted_at_idx"   ON "inspection_results"("deleted_at");
CREATE INDEX "payment_links_deleted_at_idx"        ON "payment_links"("deleted_at");
CREATE INDEX "promotion_usages_deleted_at_idx"     ON "promotion_usages"("deleted_at");
CREATE INDEX "customer_line_links_deleted_at_idx"  ON "customer_line_links"("deleted_at");
CREATE INDEX "chat_messages_deleted_at_idx"        ON "chat_messages"("deleted_at");
CREATE INDEX "chat_auto_triggers_deleted_at_idx"   ON "chat_auto_triggers"("deleted_at");

-- 4. Product ownership index + FK
CREATE INDEX "products_owned_by_company_id_idx" ON "products"("owned_by_company_id");

ALTER TABLE "products"
  ADD CONSTRAINT "products_owned_by_company_id_fkey"
  FOREIGN KEY ("owned_by_company_id") REFERENCES "company_info"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Backfill: default ownership to the branch's company (if we can derive it)
UPDATE "products" p
SET "owned_by_company_id" = b."company_id"
FROM "branches" b
WHERE p."branch_id" = b."id"
  AND p."owned_by_company_id" IS NULL
  AND b."company_id" IS NOT NULL;
