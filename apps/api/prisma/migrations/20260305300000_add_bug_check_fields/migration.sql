-- AlterTable: Add checklist results (JSON) to products
ALTER TABLE "products" ADD COLUMN "checklist_results" JSONB;

-- AlterTable: Add checklist results (JSON) to goods_receiving_items
ALTER TABLE "goods_receiving_items" ADD COLUMN "checklist_results" JSONB;
