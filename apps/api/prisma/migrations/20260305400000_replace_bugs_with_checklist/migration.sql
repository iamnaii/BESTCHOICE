-- Replace has_bugs/bug_details with checklist_results (JSONB) for checklist-style inspection

-- Products: drop old columns, add new
ALTER TABLE "products" DROP COLUMN IF EXISTS "has_bugs";
ALTER TABLE "products" DROP COLUMN IF EXISTS "bug_details";
ALTER TABLE "products" ADD COLUMN "checklist_results" JSONB;

-- Goods receiving items: drop old columns, add new
ALTER TABLE "goods_receiving_items" DROP COLUMN IF EXISTS "has_bugs";
ALTER TABLE "goods_receiving_items" DROP COLUMN IF EXISTS "bug_details";
ALTER TABLE "goods_receiving_items" ADD COLUMN "checklist_results" JSONB;
