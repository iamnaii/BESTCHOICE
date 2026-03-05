-- AlterTable
ALTER TABLE "products" ADD COLUMN "stock_in_date" TIMESTAMP(3);

-- Backfill: set stock_in_date for existing IN_STOCK products to their created_at
UPDATE "products" SET "stock_in_date" = "created_at" WHERE "status" = 'IN_STOCK' AND "stock_in_date" IS NULL;
